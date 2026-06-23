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
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn upsert_hotels(conn: &Connection, hotels: &[Hotel]) -> Result<(), String> {
    let sql = "INSERT INTO hotels
        (osm_type, osm_id, name, city, country, website, phone, lat, lon, source, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))
        ON CONFLICT(osm_type, osm_id) DO UPDATE SET
            name = excluded.name,
            city = excluded.city,
            country = excluded.country,
            website = excluded.website,
            phone = excluded.phone,
            lat = excluded.lat,
            lon = excluded.lon,
            source = excluded.source,
            updated_at = datetime('now')";
    for h in hotels {
        conn.execute(
            sql,
            params![
                h.osm_type, h.osm_id, h.name, h.city, h.country, h.website, h.phone, h.lat,
                h.lon, h.source
            ],
        )
        .map_err(|e| e.to_string())?;
    }
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
    if !src.exists() {
        // crea uno schema vuoto cosi' il backup e' sempre valido
        let _ = open_db(&app)?;
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
    pub website: Option<String>,
    pub phone: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub source: Option<String>,
    pub family_fit_score: Option<i64>,
    pub score_breakdown: Option<String>,
    pub enrichment: Option<String>,
}

#[tauri::command]
pub fn list_hotels(app: AppHandle, limit: Option<i64>) -> Result<Vec<HotelRow>, String> {
    let conn = open_db(&app)?;
    // Con archivi grandi (decine di migliaia) carichiamo i più rilevanti (voto più alto) per restare scattanti.
    let lim = limit.unwrap_or(5000).clamp(1, 200000);
    let sql = format!(
        "SELECT osm_type, osm_id, name, city, country, website, phone, lat, lon, source,
                family_fit_score, score_breakdown, enrichment
         FROM hotels
         ORDER BY (family_fit_score IS NULL), family_fit_score DESC, name COLLATE NOCASE
         LIMIT {lim}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
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
            })
        })
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
    Ok(())
}
