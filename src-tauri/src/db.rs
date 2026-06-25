// Database locale SQLite (bundled). Nessun server, nessun cloud.
// Il backup = un singolo file .sqlite esportabile/importabile (vedi MASTER.md §8).

use crate::engine::Hotel;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY,
    osm_type TEXT NOT NULL,
    osm_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    city TEXT,
    country TEXT,
    website TEXT,
    phone TEXT,
    lat REAL,
    lon REAL,
    source TEXT,
    family_fit_score INTEGER,
    score_breakdown TEXT,
    enrichment TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(osm_type, osm_id)
);
";

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("kidotel-radar.sqlite"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    // busy_timeout via API rusqlite: si applica SEMPRE, anche se WAL non è disponibile (es. volume
    // exFAT/USB), così evitiamo comunque i "database is locked".
    let _ = conn.busy_timeout(std::time::Duration::from_millis(60_000));
    // WAL: letture (UI) e scritture (scan/score/harvest) convivono. synchronous=NORMAL: sicuro+veloce.
    // Verifichiamo che WAL sia stato accettato; se il volume non lo supporta non è fatale (l'app
    // funziona col journal di rollback), ma lo annotiamo per la diagnostica.
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    if let Ok(mode) = conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0)) {
        if mode.to_lowercase() != "wal" {
            eprintln!("[kidotel] attenzione: journal_mode={mode} (WAL non attivo su questo volume)");
        }
    }
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    migrate(&conn);
    Ok(conn)
}

// Aggiunge le colonne opzionali se mancano (così ogni installazione è autosufficiente, anche
// nuova: region/province prima li creava solo lo script Python). Errore "duplicate column" ignorato.
fn migrate(conn: &Connection) {
    for col in [
        "region TEXT",
        "province TEXT",
        "email TEXT",
        "contact_status TEXT",   // da_contattare | contattato | risposto | trattativa | partner | rifiutato
        "contact_note TEXT",
        "contact_updated TEXT",
        "is_chain INTEGER",      // 1 = catena/non indipendente (escludibile da working set e sito)
        "email_status TEXT",     // ok | role | risky | no_mx | bad (deliverability via MX/DNS)
        "email_checked INTEGER", // 1 = email già cercata (harvest-emails.mjs, per la ripresa)
        "stars INTEGER",         // classificazione internazionale 1–5 (dal tag OSM `stars`)
        "luxury INTEGER",        // 1 = lusso (5 stelle Superior / luxury=yes)
        "price_tier INTEGER",    // fascia di costo REALE dal sito (schema.org priceRange) 1–5 ($→$$$$$)
        "price_eur INTEGER",     // prezzo a notte (≈ EUR) quando il sito pubblica una fascia numerica
        "price_src TEXT",        // prova: il valore priceRange citato verbatim dal sito
    ] {
        let _ = conn.execute(&format!("ALTER TABLE hotels ADD COLUMN {col}"), []);
    }
    // Indici per le query calde (lista per voto, prossimi non valutati, copertura per paese):
    // senza, ogni query è un full scan su 130k+ righe.
    let _ = conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_hotels_score ON hotels(family_fit_score);
         CREATE INDEX IF NOT EXISTS idx_hotels_country ON hotels(country);
         CREATE INDEX IF NOT EXISTS idx_hotels_unscored ON hotels(osm_id)
             WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>'';",
    );
    // Registro delle SCANSIONI: quando un'area (regione) è stata scansionata l'ultima volta. Serve a
    // rendere la ri-scansione INCREMENTALE — saltare le aree già fatte di recente invece di rifarle
    // tutte da capo. + memoria della MISURA OSM per paese (così il grado di copertura non si perde).
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scan_log (area_key TEXT PRIMARY KEY, scanned_at TEXT);
         CREATE TABLE IF NOT EXISTS coverage_meta (country TEXT PRIMARY KEY, osm_total INTEGER, measured_at TEXT);
         CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY, osm_type TEXT, osm_id INTEGER,
            author TEXT, rating REAL, text TEXT, source TEXT, date TEXT);
         CREATE INDEX IF NOT EXISTS idx_reviews_hotel ON reviews(osm_type, osm_id);",
    );
}

// Segna un'area (regione) come scansionata adesso (per la ri-scansione incrementale).
pub fn mark_area_scanned(conn: &Connection, area_key: &str) {
    let _ = conn.execute(
        "INSERT INTO scan_log(area_key, scanned_at) VALUES (?1, datetime('now'))
         ON CONFLICT(area_key) DO UPDATE SET scanned_at = datetime('now')",
        params![area_key],
    );
}

// Tra le chiavi date, quali sono state scansionate negli ultimi `days` giorni (da saltare).
#[tauri::command]
pub fn areas_scanned_within(app: AppHandle, keys: Vec<String>, days: i64) -> Result<Vec<String>, String> {
    if keys.is_empty() {
        return Ok(vec![]);
    }
    let conn = open_db(&app)?;
    let placeholders = keys.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT area_key FROM scan_log
         WHERE area_key IN ({placeholders}) AND scanned_at >= datetime('now', ?{})",
        keys.len() + 1
    );
    let mut params: Vec<rusqlite::types::Value> = keys.iter().map(|k| rusqlite::types::Value::Text(k.clone())).collect();
    params.push(rusqlite::types::Value::Text(format!("-{days} days")));
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// MISURA OSM per paese: salva/legge il denominatore del grado di copertura (così sopravvive al riavvio).
pub fn save_osm_count(conn: &Connection, country: &str, total: i64) {
    let _ = conn.execute(
        "INSERT INTO coverage_meta(country, osm_total, measured_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(country) DO UPDATE SET osm_total = ?2, measured_at = datetime('now')",
        params![country, total],
    );
}

#[derive(Serialize)]
pub struct OsmCount {
    pub country: String,
    pub osm_total: i64,
}

#[tauri::command]
pub fn osm_counts(app: AppHandle) -> Result<Vec<OsmCount>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT country, osm_total FROM coverage_meta WHERE osm_total IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok(OsmCount { country: r.get(0)?, osm_total: r.get(1)? }))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ----- RECENSIONI (raccolte da Cowork, importate via JSON; traducibili nell'app) -----
#[derive(Serialize)]
pub struct Review {
    pub author: Option<String>,
    pub rating: Option<f64>,
    pub text: String,
    pub source: Option<String>,
    pub date: Option<String>,
}

#[tauri::command]
pub fn get_reviews(app: AppHandle, osm_type: String, osm_id: i64) -> Result<Vec<Review>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT author, rating, text, source, date FROM reviews WHERE osm_type=?1 AND osm_id=?2 ORDER BY (date IS NULL), date DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![osm_type, osm_id], |r| {
            Ok(Review { author: r.get(0)?, rating: r.get(1)?, text: r.get(2)?, source: r.get(3)?, date: r.get(4)? })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// Numero di recensioni per hotel (per il badge in elenco). Restituisce "osm_type/osm_id" -> count.
#[tauri::command]
pub fn review_counts(app: AppHandle) -> Result<std::collections::HashMap<String, i64>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare("SELECT osm_type || '/' || osm_id, COUNT(*) FROM reviews GROUP BY osm_type, osm_id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = std::collections::HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        out.insert(k, v);
    }
    Ok(out)
}

// Importa recensioni da un JSON prodotto da Cowork: { "reviews": [ { id:"node/123", author, rating,
// text, source, date } ] }. Per ogni hotel presente nel file, SOSTITUISCE le sue recensioni (re-import
// pulito). `id` = "osm_type/osm_id". Restituisce quante recensioni inserite.
#[tauri::command]
pub fn import_reviews(app: AppHandle, path: String) -> Result<usize, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("JSON non valido: {e}"))?;
    let arr = v.get("reviews").and_then(|x| x.as_array()).ok_or("manca la chiave \"reviews\" (array)")?;
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut cleared: std::collections::HashSet<(String, i64)> = std::collections::HashSet::new();
    let mut n = 0usize;
    for r in arr {
        let id = match r.get("id").and_then(|x| x.as_str()) {
            Some(s) => s,
            None => continue,
        };
        let (ot, oid_s) = match id.split_once('/') {
            Some(p) => p,
            None => continue,
        };
        let oid: i64 = match oid_s.parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let text = r.get("text").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        if text.is_empty() {
            continue;
        }
        // al primo review di un hotel, svuota le sue recensioni precedenti (re-import pulito)
        if cleared.insert((ot.to_string(), oid)) {
            let _ = tx.execute("DELETE FROM reviews WHERE osm_type=?1 AND osm_id=?2", params![ot, oid]);
        }
        let author = r.get("author").and_then(|x| x.as_str());
        let rating = r.get("rating").and_then(|x| x.as_f64());
        let source = r.get("source").and_then(|x| x.as_str());
        let date = r.get("date").and_then(|x| x.as_str());
        tx.execute(
            "INSERT INTO reviews(osm_type, osm_id, author, rating, text, source, date) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![ot, oid, author, rating, text, source, date],
        )
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(n)
}

pub fn upsert_hotels(conn: &Connection, hotels: &[Hotel]) -> Result<(), String> {
    // NB: i campi CRM (contact_*) e la valutazione NON vengono toccati al ri-scan: si preservano.
    // email: si aggiorna solo se la nuova non è vuota (non cancella un contatto già trovato).
    let sql = "INSERT INTO hotels
        (osm_type, osm_id, name, city, country, website, phone, email, lat, lon, source, stars, luxury, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'))
        ON CONFLICT(osm_type, osm_id) DO UPDATE SET
            name = excluded.name,
            -- city/country/region/province NON si toccano: la geo precisa la mette il
            -- reverse-geocoding (backfill); l'addr:country di OSM è spesso un codice ISO ('AT')
            -- e sovrascriverlo al ri-scan rompeva il raggruppamento per paese.
            city = COALESCE(hotels.city, excluded.city),
            country = COALESCE(hotels.country, excluded.country),
            -- website/phone: aggiorna se OSM ne ha uno NUOVO, ma NON azzerare quello già noto se OSM
            -- ora lo lascia vuoto. Prima `website = excluded.website` cancellava il sito a un hotel già
            -- VALUTATO → restavano hotel con punteggio ma senza sito (scored > with_site → avanzamento
            -- valutazione >100%, numeri incoerenti). Ora si preserva l'ultimo sito/telefono conosciuto.
            website = COALESCE(NULLIF(excluded.website, ''), hotels.website),
            phone = COALESCE(NULLIF(excluded.phone, ''), hotels.phone),
            email = COALESCE(excluded.email, hotels.email),
            lat = excluded.lat,
            lon = excluded.lon,
            source = excluded.source,
            -- stelle: riempi se OSM ora ce le ha, ma non azzerare quelle già note.
            stars = COALESCE(excluded.stars, hotels.stars),
            luxury = COALESCE(excluded.luxury, hotels.luxury),
            updated_at = datetime('now')";
    for h in hotels {
        let luxury: Option<i64> = if h.stars.is_some() { Some(if h.luxury { 1 } else { 0 }) } else { None };
        conn.execute(
            sql,
            params![
                h.osm_type, h.osm_id, h.name, h.city, h.country, h.website, h.phone, h.email,
                h.lat, h.lon, h.source, h.stars, luxury
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Bounding box ricavato dagli hotel GIÀ in archivio per un'area (fallback se Nominatim è giù).
// Restituisce (sud, nord, ovest, est, n_hotel) se ci sono hotel con coordinate per quel termine.
pub fn bbox_for_term(conn: &Connection, term: &str) -> Option<(f64, f64, f64, f64, i64)> {
    let pattern = format!("%{}%", term.trim());
    let row = conn
        .query_row(
            "SELECT MIN(lat), MAX(lat), MIN(lon), MAX(lon), COUNT(*) FROM hotels
             WHERE lat<>0 AND lon<>0
               AND (country LIKE ?1 OR region LIKE ?1 OR province LIKE ?1 OR city LIKE ?1)",
            params![pattern],
            |r| {
                Ok((
                    r.get::<_, Option<f64>>(0)?,
                    r.get::<_, Option<f64>>(1)?,
                    r.get::<_, Option<f64>>(2)?,
                    r.get::<_, Option<f64>>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            },
        )
        .ok()?;
    match row {
        (Some(s), Some(n), Some(w), Some(e), c) if c > 0 => Some((s, n, w, e, c)),
        _ => None,
    }
}

// Salva l'email SOLO se l'hotel non ne ha già una (non sovrascrive un contatto già presente).
pub fn set_email_if_absent(conn: &Connection, osm_type: &str, osm_id: i64, email: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE hotels SET email = ?3 WHERE osm_type = ?1 AND osm_id = ?2 AND (email IS NULL OR email = '')",
        params![osm_type, osm_id, email],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// Fascia di prezzo REALE trovata sul sito (schema.org priceRange), con la sua prova citata.
pub fn set_price(conn: &Connection, osm_type: &str, osm_id: i64, tier: i64, eur: Option<i64>, src: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE hotels SET price_tier = ?3, price_eur = ?4, price_src = ?5 WHERE osm_type = ?1 AND osm_id = ?2",
        params![osm_type, osm_id, tier, eur, src],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_enrichment(
    conn: &Connection,
    osm_type: &str,
    osm_id: i64,
    score: u32,
    breakdown_json: &str,
    enrichment_json: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE hotels SET family_fit_score = ?3, score_breakdown = ?4, enrichment = ?5,
            updated_at = datetime('now') WHERE osm_type = ?1 AND osm_id = ?2",
        params![osm_type, osm_id, score, breakdown_json, enrichment_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_backup(app: AppHandle, path: String) -> Result<(), String> {
    let src = db_path(&app)?;
    // In WAL le scritture recenti stanno nel file -wal: facciamo un checkpoint TRUNCATE così il
    // .sqlite copiato è completo e autosufficiente (altrimenti il backup perderebbe dati recenti).
    {
        let conn = open_db(&app)?;
        let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    }
    std::fs::copy(&src, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct HotelRow {
    pub osm_type: String,
    pub osm_id: i64,
    pub name: String,
    pub city: Option<String>,
    pub country: Option<String>,
    pub region: Option<String>,
    pub province: Option<String>,
    pub website: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub source: Option<String>,
    pub family_fit_score: Option<i64>,
    pub score_breakdown: Option<String>,
    pub enrichment: Option<String>,
    pub contact_status: Option<String>,
    pub contact_note: Option<String>,
    pub contact_updated: Option<String>,
    pub email_status: Option<String>,
    pub stars: Option<i64>,
    pub luxury: Option<i64>,
    pub price_tier: Option<i64>,
    pub price_eur: Option<i64>,
    pub price_src: Option<String>,
}

fn row_to_hotel(r: &rusqlite::Row) -> rusqlite::Result<HotelRow> {
    Ok(HotelRow {
        osm_type: r.get(0)?,
        osm_id: r.get(1)?,
        name: r.get(2)?,
        city: r.get(3)?,
        country: r.get(4)?,
        website: r.get(5)?,
        phone: r.get(6)?,
        lat: r.get(7)?,
        lon: r.get(8)?,
        source: r.get(9)?,
        family_fit_score: r.get(10)?,
        score_breakdown: r.get(11)?,
        enrichment: r.get(12)?,
        region: r.get(13)?,
        province: r.get(14)?,
        email: r.get(15)?,
        contact_status: r.get(16)?,
        contact_note: r.get(17)?,
        contact_updated: r.get(18)?,
        email_status: r.get(19)?,
        stars: r.get(20)?,
        luxury: r.get(21)?,
        price_tier: r.get(22)?,
        price_eur: r.get(23)?,
        price_src: r.get(24)?,
    })
}

const HOTEL_COLS: &str = "osm_type, osm_id, name, city, country, website, phone, lat, lon, source,
    family_fit_score, score_breakdown, enrichment, region, province,
    email, contact_status, contact_note, contact_updated, email_status, stars, luxury,
    price_tier, price_eur, price_src";

// Cerca/elenca dall'archivio. `search` filtra per nome/città/provincia/regione/paese (tutti i record).
#[tauri::command]
pub fn list_hotels(app: AppHandle, limit: Option<i64>, search: Option<String>, offset: Option<i64>) -> Result<Vec<HotelRow>, String> {
    let conn = open_db(&app)?;
    let lim = limit.unwrap_or(5000).clamp(1, 200000);
    let off = offset.unwrap_or(0).max(0);
    let term = search.unwrap_or_default();
    let term = term.trim();
    let order = "ORDER BY (family_fit_score IS NULL), family_fit_score DESC, name COLLATE NOCASE";
    let mut out = Vec::new();
    if term.is_empty() {
        let sql = format!("SELECT {HOTEL_COLS} FROM hotels {order} LIMIT {lim} OFFSET {off}");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_hotel).map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let sql = format!(
            "SELECT {HOTEL_COLS} FROM hotels
             WHERE name LIKE ?1 OR city LIKE ?1 OR region LIKE ?1 OR province LIKE ?1 OR country LIKE ?1
             {order} LIMIT {lim}"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let pattern = format!("%{term}%");
        let rows = stmt.query_map(params![pattern], row_to_hotel).map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn count_hotels(app: AppHandle) -> Result<i64, String> {
    let conn = open_db(&app)?;
    conn.query_row("SELECT COUNT(*) FROM hotels", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

// Selezione a criteri per l'export "cowork": compone il gruppo di hotel da esportare combinando
// ambito geografico (paesi), fascia di punteggio, "le migliori N", e filtri di qualità del contatto.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SelectArgs {
    #[serde(default)]
    pub countries: Vec<String>, // vuoto = tutti i paesi (usato anche per "un continente" = i suoi paesi)
    pub score_min: Option<i64>,
    pub score_max: Option<i64>,
    #[serde(default)]
    pub only_scored: bool,
    #[serde(default)]
    pub only_contactable: bool,
    #[serde(default)]
    pub only_deliverable: bool,
    pub limit: Option<i64>, // "le migliori N" (ordinate per punteggio)
}

// Costruisce WHERE + parametri legati (niente interpolazione di valori → niente SQL injection).
fn build_select_where(a: &SelectArgs) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;
    let mut clauses: Vec<String> = vec!["1=1".into()];
    let mut p: Vec<Value> = Vec::new();
    if !a.countries.is_empty() {
        let placeholders = a.countries.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        clauses.push(format!("country IN ({placeholders})"));
        for c in &a.countries {
            p.push(Value::Text(c.clone()));
        }
    }
    if let Some(min) = a.score_min {
        clauses.push("family_fit_score >= ?".into());
        p.push(Value::Integer(min));
    }
    if let Some(max) = a.score_max {
        clauses.push("family_fit_score <= ?".into());
        p.push(Value::Integer(max));
    }
    if a.only_scored {
        clauses.push("family_fit_score IS NOT NULL".into());
    }
    if a.only_contactable {
        clauses.push("((website IS NOT NULL AND website<>'') OR (email IS NOT NULL AND email<>'') OR (phone IS NOT NULL AND phone<>''))".into());
    }
    if a.only_deliverable {
        clauses.push("email IS NOT NULL AND email<>'' AND email_status IN ('ok','role')".into());
    }
    (clauses.join(" AND "), p)
}

// Quanti hotel soddisfano i criteri (conteggio live mentre l'utente regola la selezione).
#[tauri::command]
pub fn count_select(app: AppHandle, args: SelectArgs) -> Result<i64, String> {
    let conn = open_db(&app)?;
    let (where_sql, p) = build_select_where(&args);
    let sql = format!("SELECT COUNT(*) FROM hotels WHERE {where_sql}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(rusqlite::params_from_iter(p.iter()), |r| r.get(0))
        .map_err(|e| e.to_string())
}

// Restituisce gli hotel selezionati (ordinati per punteggio ↓) pronti per l'export CSV/JSON.
#[tauri::command]
pub fn select_hotels(app: AppHandle, args: SelectArgs) -> Result<Vec<HotelRow>, String> {
    let conn = open_db(&app)?;
    let lim = args.limit.unwrap_or(500000).clamp(1, 500000);
    let (where_sql, p) = build_select_where(&args);
    let order = "ORDER BY (family_fit_score IS NULL), family_fit_score DESC, name COLLATE NOCASE";
    let sql = format!("SELECT {HOTEL_COLS} FROM hotels WHERE {where_sql} {order} LIMIT {lim}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(p.iter()), row_to_hotel)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// Riga LEGGERA per il CRM: solo i campi che servono all'acquisizione (niente score_breakdown/enrichment,
// che per decine di migliaia di righe peserebbero centinaia di MB). Così il CRM può caricare TUTTO
// l'archivio contattabile (non solo i primi 5000) e filtrarlo in memoria, in fretta.
#[derive(Serialize)]
pub struct CrmRow {
    pub osm_type: String,
    pub osm_id: i64,
    pub name: String,
    pub city: Option<String>,
    pub country: Option<String>,
    pub region: Option<String>,
    pub province: Option<String>,
    pub website: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub email_status: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub family_fit_score: Option<i64>,
    pub stars: Option<i64>,
    pub contact_status: Option<String>,
    pub contact_note: Option<String>,
}

#[tauri::command]
pub fn select_crm(app: AppHandle, args: SelectArgs) -> Result<Vec<CrmRow>, String> {
    let conn = open_db(&app)?;
    let lim = args.limit.unwrap_or(500000).clamp(1, 500000);
    let (where_sql, p) = build_select_where(&args);
    let order = "ORDER BY (family_fit_score IS NULL), family_fit_score DESC, name COLLATE NOCASE";
    let cols = "osm_type, osm_id, name, city, country, region, province, website, phone, email, email_status, lat, lon, family_fit_score, stars, contact_status, contact_note";
    let sql = format!("SELECT {cols} FROM hotels WHERE {where_sql} {order} LIMIT {lim}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(p.iter()), |r| {
            Ok(CrmRow {
                osm_type: r.get(0)?, osm_id: r.get(1)?, name: r.get(2)?, city: r.get(3)?, country: r.get(4)?,
                region: r.get(5)?, province: r.get(6)?, website: r.get(7)?, phone: r.get(8)?, email: r.get(9)?,
                email_status: r.get(10)?, lat: r.get(11)?, lon: r.get(12)?, family_fit_score: r.get(13)?,
                stars: r.get(14)?, contact_status: r.get(15)?, contact_note: r.get(16)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct ScoreStats {
    pub total: i64,
    pub with_site: i64,
    pub scored: i64,
    pub strong: i64,
    pub to_score: i64, // hotel con sito ma ancora senza voto (coda di valutazione)
}

// Statistiche su TUTTO il database (per la barra di avanzamento globale). `threshold` = soglia
// "family hotel" (impostabile dall'utente); default 60 se non passata.
#[tauri::command]
pub fn score_stats(app: AppHandle, threshold: Option<i64>) -> Result<ScoreStats, String> {
    let conn = open_db(&app)?;
    let thr = threshold.unwrap_or(60);
    conn.query_row(
        "SELECT COUNT(*), SUM(website IS NOT NULL AND website<>''),
                SUM(family_fit_score IS NOT NULL), SUM(family_fit_score>=?1),
                SUM(family_fit_score IS NULL AND website IS NOT NULL AND website<>'') FROM hotels",
        [thr],
        |r| {
            Ok(ScoreStats {
                total: r.get::<_, i64>(0)?,
                with_site: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                scored: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                strong: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                // hotel ANCORA da valutare (sito presente, voto mancante): la coda della valutazione.
                to_score: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            })
        },
    )
    .map_err(|e| e.to_string())
}

// Distribuzione dei punteggi in 10 fasce (0–9, 10–19, …, 90–100): centro dell'infografica (#9).
// Conta solo gli hotel valutati. La fascia 100 finisce nell'ultima (indice 9).
#[tauri::command]
pub fn score_histogram(app: AppHandle) -> Result<Vec<i64>, String> {
    let conn = open_db(&app)?;
    let mut buckets = vec![0i64; 10];
    let mut stmt = conn
        .prepare("SELECT family_fit_score, COUNT(*) FROM hotels WHERE family_fit_score IS NOT NULL GROUP BY family_fit_score")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (score, n) = row.map_err(|e| e.to_string())?;
        let idx = (score.clamp(0, 100) / 10).min(9) as usize;
        buckets[idx] += n;
    }
    Ok(buckets)
}

#[derive(Serialize)]
pub struct CountryCoverage {
    pub country: String,
    pub total: i64,
    pub scored: i64,
    pub strong: i64,
}

// Copertura per paese: quanti hotel hai per area, quanti valutati, quanti family (>= soglia).
#[tauri::command]
pub fn coverage_by_country(app: AppHandle, threshold: Option<i64>) -> Result<Vec<CountryCoverage>, String> {
    let conn = open_db(&app)?;
    let thr = threshold.unwrap_or(60);
    // GROUP BY sulla STESSA espressione dell'etichetta: altrimenti country NULL e '' creano due
    // righe "(sconosciuto)" separate con i conteggi spezzati.
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(NULLIF(country,''),'(sconosciuto)'), COUNT(*),
                    SUM(family_fit_score IS NOT NULL), SUM(family_fit_score>=?1)
             FROM hotels GROUP BY COALESCE(NULLIF(country,''),'(sconosciuto)') ORDER BY COUNT(*) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([thr], |r| {
            Ok(CountryCoverage {
                country: r.get(0)?,
                total: r.get(1)?,
                scored: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                strong: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ---------- CRM / Outreach ----------
// Stato del contatto per ogni hotel (acquisizione partner). Lo stato e la nota vivono nel DB
// e SOPRAVVIVONO ai ri-scan (upsert_hotels non li tocca) e ai backup (sono colonne del .sqlite).

const CONTACT_STATES: &[&str] = &[
    "da_contattare", "contattato", "risposto", "trattativa", "partner", "rifiutato",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactArgs {
    pub osm_type: String,
    pub osm_id: i64,
    pub status: String,
    pub note: Option<String>,
}

#[tauri::command]
pub fn set_contact(app: AppHandle, args: ContactArgs) -> Result<(), String> {
    if !CONTACT_STATES.contains(&args.status.as_str()) {
        return Err(format!("Stato non valido: {}", args.status));
    }
    let conn = open_db(&app)?;
    conn.execute(
        "UPDATE hotels SET contact_status = ?3, contact_note = ?4, contact_updated = datetime('now')
         WHERE osm_type = ?1 AND osm_id = ?2",
        params![args.osm_type, args.osm_id, args.status, args.note],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct ContactStat {
    pub status: String,
    pub count: i64,
}

// Conteggio hotel per stato di contatto. "da_contattare" include anche chi non ha ancora stato (NULL).
#[tauri::command]
pub fn contact_stats(app: AppHandle) -> Result<Vec<ContactStat>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(NULLIF(contact_status,''),'da_contattare'), COUNT(*)
             FROM hotels GROUP BY COALESCE(NULLIF(contact_status,''),'da_contattare')",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok(ContactStat { status: r.get(0)?, count: r.get(1)? }))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct UnscoredRef {
    pub id: String,
    pub website: String,
}

// Prossimo blocco di hotel con sito e SENZA voto (per valutare tutto l'archivio).
#[tauri::command]
pub fn list_unscored(app: AppHandle, limit: Option<i64>) -> Result<Vec<UnscoredRef>, String> {
    let conn = open_db(&app)?;
    let lim = limit.unwrap_or(60).clamp(1, 1000);
    let sql = format!(
        "SELECT (osm_type || '/' || osm_id), website FROM hotels
         WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>''
         ORDER BY osm_id LIMIT {lim}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok(UnscoredRef { id: r.get(0)?, website: r.get(1)? }))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// Import dei voti family-fit prodotti dall'AI (Cowork) — formato { "results": [ { id, family_fit_score, breakdown? } ] }.
// id = "osm_type/osm_id". Salva score + breakdown nel database.
#[derive(Deserialize)]
struct AiResult {
    id: String,
    family_fit_score: u32,
    #[serde(default)]
    breakdown: serde_json::Value,
}

#[derive(Deserialize)]
struct AiResultsFile {
    results: Vec<AiResult>,
}

#[tauri::command]
pub fn import_ai_scores(app: AppHandle, path: String) -> Result<usize, String> {
    let txt = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: AiResultsFile = serde_json::from_str(&txt)
        .map_err(|e| format!("File non valido (atteso {{\"results\":[...]}}): {e}"))?;
    let conn = open_db(&app)?;
    let mut n = 0usize;
    for r in parsed.results {
        let (otype, oid) = match r.id.split_once('/') {
            Some((t, i)) => (t.to_string(), i.parse::<i64>().unwrap_or(0)),
            None => continue,
        };
        if oid == 0 {
            continue;
        }
        let score = r.family_fit_score.min(100);
        let breakdown = if r.breakdown.is_null() {
            "[]".to_string()
        } else {
            r.breakdown.to_string()
        };
        let enrichment = serde_json::json!({ "website_ok": true, "source": "ai-cowork" }).to_string();
        update_enrichment(&conn, &otype, oid, score, &breakdown, &enrichment)?;
        n += 1;
    }
    Ok(n)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// Apre un URL (sito, mailto:, tel:) nel programma di sistema: nel webview Tauri un semplice
// link target="_blank" NON apre nulla (come window.print()). Qui usiamo il plugin opener.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let u = url.trim();
    // sicurezza: solo schemi attesi, niente file:// o altro.
    let ok = u.starts_with("http://") || u.starts_with("https://")
        || u.starts_with("mailto:") || u.starts_with("tel:");
    if !ok {
        return Err(format!("Schema URL non consentito: {url}"));
    }
    app.opener()
        .open_url(u.to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

// Stampa affidabile in Tauri: scrive un report HTML e lo apre nel browser di sistema,
// dove Stampa e "Salva in PDF" funzionano davvero (window.print() nel webview è un no-op).
#[tauri::command]
pub fn open_report(app: AppHandle, html: String) -> Result<(), String> {
    let path = std::env::temp_dir().join("kidotel-radar-report.html");
    std::fs::write(&path, html).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_backup(app: AppHandle, path: String) -> Result<(), String> {
    let dst = db_path(&app)?;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&path, &dst).map_err(|e| e.to_string())?;
    // CRITICO (WAL): rimuovere i sidecar -wal/-shm del vecchio DB, altrimenti SQLite li ri-applica
    // sul file appena importato → corruzione / dati vecchi. Si rigenerano alla prossima apertura.
    for ext in ["-wal", "-shm"] {
        let side = dst.with_file_name(format!(
            "{}{ext}",
            dst.file_name().and_then(|f| f.to_str()).unwrap_or("kidotel-radar.sqlite")
        ));
        let _ = std::fs::remove_file(&side); // ignora "non esiste"
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::types::Value;

    #[test]
    fn select_where_all_is_unfiltered() {
        let a = SelectArgs::default();
        let (sql, p) = build_select_where(&a);
        assert_eq!(sql, "1=1");
        assert!(p.is_empty());
    }

    #[test]
    fn select_where_countries_bind_one_placeholder_each() {
        let a = SelectArgs { countries: vec!["Italy".into(), "Germany".into()], ..Default::default() };
        let (sql, p) = build_select_where(&a);
        assert!(sql.contains("country IN (?,?)"), "sql was: {sql}");
        assert_eq!(p.len(), 2);
        assert_eq!(p[0], Value::Text("Italy".into()));
    }

    #[test]
    fn select_where_score_range_and_filters() {
        let a = SelectArgs {
            score_min: Some(59),
            score_max: Some(80),
            only_contactable: true,
            only_deliverable: true,
            ..Default::default()
        };
        let (sql, p) = build_select_where(&a);
        assert!(sql.contains("family_fit_score >= ?"));
        assert!(sql.contains("family_fit_score <= ?"));
        assert!(sql.contains("email_status IN ('ok','role')"));
        // due valori legati: min e max (i filtri booleani non legano valori)
        assert_eq!(p, vec![Value::Integer(59), Value::Integer(80)]);
    }
}
