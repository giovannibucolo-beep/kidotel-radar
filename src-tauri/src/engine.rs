// Motore Kidotel Radar.
// SCOPRI: Nominatim (bbox del luogo) -> Overpass (hotel da OpenStreetMap). Mondiale, gratis.
// ARRICCHISCI/VALUTA (v0.2): crawl del sito ufficiale + riconoscitore family multilingue
// "a regole" (nessuna API). Ogni segnale family esiste solo se accompagnato dalla frase
// citata sul sito e RI-VERIFICATA carattere per carattere (MASTER.md §5). Niente dati inventati.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::time::{Duration, Instant};

#[derive(Serialize, Clone)]
pub struct Hotel {
    pub osm_type: String,
    pub osm_id: i64,
    pub name: String,
    pub city: Option<String>,
    pub country: Option<String>,
    pub website: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub source: String,
    pub lat: f64,
    pub lon: f64,
    pub stars: Option<i64>, // classificazione internazionale 1–5 (dal tag OSM `stars`, dove c'è)
    pub luxury: bool,       // "lusso" = 5 stelle Superior (o tag luxury=yes)
}

// Interpreta il tag OSM `stars`: "1".."5", con eventuale "S"/"Superior" (classificazione tedesca,
// es. "4S", "5S"). Restituisce (stelle 1–5, è_lusso). Lusso = 5 stelle Superior, o tag luxury=yes.
fn parse_stars(raw: Option<&str>, luxury_tag: bool) -> (Option<i64>, bool) {
    let s = match raw {
        Some(s) => s,
        None => return (None, luxury_tag),
    };
    let digit = s
        .chars()
        .find(|c| ('1'..='5').contains(c))
        .and_then(|c| c.to_digit(10))
        .map(|d| d as i64);
    let superior = s.to_lowercase().contains('s'); // "4s"/"5s"/"superior"
    let luxury = luxury_tag || (digit == Some(5) && superior);
    (digit, luxury)
}

#[derive(Serialize)]
pub struct DiscoverResult {
    pub area_label: String,
    pub count: usize,
    pub hotels: Vec<Hotel>,
}

const UA: &str = "KidotelRadar/0.1 (https://kidotel.co; contact: info@kidotel.co)";

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        // connessione: se un server non risponde in 10s lo si scarta in fretta (così la
        // cascata Overpass non resta bloccata su un endpoint morto). Il timeout TOTALE di
        // default (20s) va bene per Nominatim e per il crawl dei siti; per Overpass, dove le
        // aree grandi possono richiedere oltre un minuto, lo allunghiamo per-richiesta.
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

// Client DEDICATO alla valutazione (crawl dei siti hotel): timeout PIÙ corti e — soprattutto —
// CONDIVISO (creato una sola volta), così non ricostruiamo lo stack TLS a ogni hotel e riusiamo le
// connessioni. Era questa la causa principale del "si blocca quasi subito": un client nuovo per
// hotel + timeout da 20s su un sito lento bloccava il worker a lungo. Ora connect 6s, totale 10s.
fn enrich_client() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .connect_timeout(std::time::Duration::from_secs(6))
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("enrich client")
    })
}

// Client CONDIVISO per Overpass (scoperta + ri-scansione stelle): creato una sola volta → riusa lo
// stack TLS e le connessioni keep-alive invece di ricostruirli a ogni chiamata. Niente timeout di
// default: ogni query Overpass passa il proprio timeout PER-richiesta (le aree grandi durano oltre un
// minuto). È uno dei pilastri della scansione stelle "ultra-veloce".
fn overpass_client() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .connect_timeout(std::time::Duration::from_secs(10))
            .pool_max_idle_per_host(6)
            .build()
            .expect("overpass client")
    })
}

// ---------- SCOPRI ----------

struct Bbox {
    s: f64,
    n: f64,
    w: f64,
    e: f64,
    label: String,
    osm_type: String,
    osm_id: i64,
    kind: String, // addresstype Nominatim: "country" | "continent" | "state" | … (per il guard)
    cc: String,   // country_code ISO alpha-2 (es. "fr"), per filtrare le sotto-aree del paese
    country_name: String, // nome paese pieno (es. "Italy") da timbrare sugli hotel scoperti
}

// area_id Overpass dall'osm_type/osm_id (relation → 3600000000+id, way → 2400000000+id).
fn area_id_of(osm_type: &str, osm_id: i64) -> Option<i64> {
    match osm_type {
        "relation" => Some(3_600_000_000 + osm_id),
        "way" => Some(2_400_000_000 + osm_id),
        _ => None,
    }
}

// Nominatim con ritentativi: il server è severo (rate-limit / reset di connessione). Un "luogo
// non trovato" NON è transitorio e non si ritenta; un errore di rete sì (con attesa crescente).
async fn nominatim_bbox(client: &reqwest::Client, query: &str) -> Result<Bbox, String> {
    let mut last = String::from("errore sconosciuto");
    for attempt in 0..3 {
        match nominatim_bbox_once(client, query).await {
            Ok(b) => return Ok(b),
            Err(e) => {
                last = e;
                if last.contains("non trovato") || last.contains("not found") {
                    break; // definitivo: inutile ritentare
                }
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_secs(2 * (attempt + 1))).await;
                }
            }
        }
    }
    Err(last)
}

async fn nominatim_bbox_once(client: &reqwest::Client, query: &str) -> Result<Bbox, String> {
    let resp = client
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[("q", query), ("format", "json"), ("limit", "1"), ("addressdetails", "1")])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let arr: Value = resp.json().await.map_err(|e| e.to_string())?;
    let first = arr
        .get(0)
        .ok_or_else(|| "Luogo non trovato / Place not found".to_string())?;
    let bb = first
        .get("boundingbox")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Bounding box mancante".to_string())?;
    let parse = |i: usize| -> Result<f64, String> {
        bb.get(i)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or_else(|| "Bounding box non valido".to_string())
    };
    // Nominatim: [south, north, west, east]
    let s = parse(0)?;
    let n = parse(1)?;
    let w = parse(2)?;
    let e = parse(3)?;
    let label = first
        .get("display_name")
        .and_then(|v| v.as_str())
        .unwrap_or(query)
        .to_string();
    let osm_type = first.get("osm_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let osm_id = first.get("osm_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let kind = first.get("addresstype").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let cc = first
        .get("address")
        .and_then(|a| a.get("country_code"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let country_name = first
        .get("address")
        .and_then(|a| a.get("country"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(Bbox { s, n, w, e, label, osm_type, osm_id, kind, cc, country_name })
}

// Server Overpass in cascata: se uno è sovraccarico/non risponde, prova il successivo.
// Sono ~2-3 backend indipendenti (kumi≈private.coffee; lz4≈overpass-api.de): basta tenerne
// pochi ma sani. maps.mail.ru rimosso (instabile/irraggiungibile: causava l'errore sui paesi).
const OVERPASS_ENDPOINTS: &[&str] = &[
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter", // istanza per query grandi
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
];

// Budget complessivo di una scansione (anche a tasselli): oltre questo tempo restituiamo i
// risultati PARZIALI già raccolti invece di restare appesi (difetto noto: nessun tetto totale).
const SCAN_BUDGET: Duration = Duration::from_secs(240);

// Una sola query Overpass su UN giro della cascata. `per_req` = timeout per singola richiesta.
// connect_timeout (10s, dal client) scarta in fretta gli endpoint morti; `per_req` limita anche
// gli endpoint che accettano la connessione ma poi "stallano" il corpo.
async fn overpass_once(client: &reqwest::Client, q: &str, per_req: Duration) -> Result<Vec<Value>, String> {
    overpass_once_from(client, q, per_req, 0).await
}

// Come overpass_once ma partendo dall'endpoint con indice `start` (a rotazione). Serve quando più
// query girano IN PARALLELO: assegnando a ciascuna un endpoint diverso si distribuisce il carico
// invece di accalcarsi tutte sul primo (era la causa della ri-scansione stelle lenta).
async fn overpass_once_from(client: &reqwest::Client, q: &str, per_req: Duration, start: usize) -> Result<Vec<Value>, String> {
    let mut last = String::from("nessun endpoint disponibile");
    let n = OVERPASS_ENDPOINTS.len();
    for k in 0..n {
        let ep = OVERPASS_ENDPOINTS[(start + k) % n];
        match client.post(ep).form(&[("data", q)]).timeout(per_req).send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status == 400 {
                    // query non valida: fallirebbe identica su ogni endpoint → inutile insistere.
                    return Err(format!("query Overpass non valida (HTTP 400) su {ep}"));
                }
                if !(200..300).contains(&status) {
                    last = format!("{ep}: HTTP {status}");
                    continue;
                }
                match resp.text().await {
                    Ok(text) => match serde_json::from_str::<Value>(&text) {
                        Ok(v) => {
                            return Ok(v
                                .get("elements")
                                .and_then(|e| e.as_array())
                                .cloned()
                                .unwrap_or_default());
                        }
                        Err(_) => last = format!("{ep}: risposta non valida (probabile sovraccarico)"),
                    },
                    Err(_) => last = format!("{ep}: risposta interrotta durante la lettura"),
                }
            }
            Err(e) => {
                last = if e.is_timeout() {
                    format!("{ep}: nessuna risposta entro {}s", per_req.as_secs())
                } else if e.is_connect() {
                    format!("{ep}: connessione non riuscita")
                } else {
                    e.to_string()
                };
            }
        }
    }
    Err(last)
}

// Come overpass_once ma con UN ritentativo (dopo 2s) se il fallimento è transitorio (sovraccarico).
async fn overpass_query(client: &reqwest::Client, q: &str, per_req: Duration) -> Result<Vec<Value>, String> {
    overpass_query_from(client, q, per_req, 0).await
}

async fn overpass_query_from(client: &reqwest::Client, q: &str, per_req: Duration, start: usize) -> Result<Vec<Value>, String> {
    match overpass_once_from(client, q, per_req, start).await {
        Ok(v) => Ok(v),
        Err(first) => {
            // se è chiaramente non-transitorio (query 400), non ritentare.
            if first.contains("HTTP 400") {
                return Err(first);
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
            overpass_once_from(client, q, per_req, start).await
        }
    }
}

fn overpass_unavailable(detail: &str) -> String {
    format!(
        "Server OpenStreetMap (Overpass) momentaneamente non disponibile. \
         Riprova tra qualche secondo oppure scegli un'area più piccola \
         (una regione o una città invece di un intero paese). Dettaglio: {detail}"
    )
}

// Divide un bounding box in tasselli ~quadrati di lato `max_deg`, con un tetto `max_tiles`
// (se servirebbero troppi tasselli si allarga il lato). Funzione pura → testata sotto.
fn split_tiles(b: &Bbox, max_deg: f64, max_tiles: usize) -> Vec<(f64, f64, f64, f64)> {
    let (s0, n0) = (b.s.min(b.n), b.s.max(b.n));
    let (w0, e0) = (b.w.min(b.e), b.w.max(b.e));
    let h = (n0 - s0).max(1e-6);
    let w = (e0 - w0).max(1e-6);
    let mut step = max_deg.max(0.05);
    loop {
        let rows = (h / step).ceil() as usize;
        let cols = (w / step).ceil() as usize;
        if rows.max(1) * cols.max(1) <= max_tiles.max(1) {
            break;
        }
        step *= 1.3;
    }
    let rows = ((h / step).ceil() as usize).max(1);
    let cols = ((w / step).ceil() as usize).max(1);
    let mut out = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            let s = s0 + (r as f64) * step;
            let n = (s + step).min(n0);
            let w = w0 + (c as f64) * step;
            let e = (w + step).min(e0);
            out.push((s, w, n, e));
        }
    }
    out
}

// Scansione a TASSELLI per aree grandi: ogni query è piccola (veloce, niente timeout/sovraccarico).
// Se c'è il confine amministrativo (area_id) ogni tassello è intersecato col confine → niente
// sconfinamenti nelle regioni vicine. Rispetta SCAN_BUDGET: oltre, restituisce i parziali.
async fn tiled_scan(
    client: &reqwest::Client,
    b: &Bbox,
    area_id: Option<i64>,
    started: Instant,
) -> Result<Vec<Hotel>, String> {
    let tiles = split_tiles(b, 1.5, 120);
    let filter = area_id.map(|a| format!("(area:{a})")).unwrap_or_default();
    let mut seen: HashSet<(String, i64)> = HashSet::new();
    let mut all: Vec<Hotel> = Vec::new();
    let mut ok = 0usize;
    let mut last = String::from("nessuna risposta");
    for (s, w, n, e) in &tiles {
        if started.elapsed() > SCAN_BUDGET {
            break; // budget esaurito: meglio risultati parziali che restare appesi
        }
        let q = format!(
            "[out:json][timeout:60];(node[\"tourism\"=\"hotel\"]{filter}({s},{w},{n},{e});way[\"tourism\"=\"hotel\"]{filter}({s},{w},{n},{e}););out center tags;"
        );
        match overpass_once(client, &q, Duration::from_secs(65)).await {
            Ok(elements) => {
                ok += 1;
                for h in parse_elements(elements) {
                    if seen.insert((h.osm_type.clone(), h.osm_id)) {
                        all.push(h);
                    }
                }
            }
            Err(e) => last = e,
        }
    }
    if ok == 0 {
        return Err(overpass_unavailable(&last));
    }
    Ok(all)
}

fn parse_elements(elements: Vec<Value>) -> Vec<Hotel> {
    let mut hotels = Vec::new();
    for el in elements {
        let tags = el.get("tags");
        let name = match tags.and_then(|t| t.get("name")).and_then(|x| x.as_str()) {
            Some(n) if !n.trim().is_empty() => n.to_string(),
            _ => continue, // niente nome -> scartato (niente dati inventati)
        };
        let get = |k: &str| {
            tags.and_then(|t| t.get(k)).and_then(|x| x.as_str()).map(|s| s.to_string())
        };
        let website = get("website").or_else(|| get("contact:website")).or_else(|| get("url"));
        let phone = get("phone").or_else(|| get("contact:phone"));
        let email = get("email").or_else(|| get("contact:email"));
        let city = get("addr:city");
        let country = get("addr:country");
        let luxury_tag = get("luxury").map(|v| v == "yes" || v == "1").unwrap_or(false);
        let (stars, luxury) = parse_stars(get("stars").as_deref(), luxury_tag);
        let otype = el.get("type").and_then(|x| x.as_str()).unwrap_or("node").to_string();
        let oid = el.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
        let (lat, lon) = if let (Some(la), Some(lo)) = (
            el.get("lat").and_then(|x| x.as_f64()),
            el.get("lon").and_then(|x| x.as_f64()),
        ) {
            (la, lo)
        } else if let Some(c) = el.get("center") {
            (
                c.get("lat").and_then(|x| x.as_f64()).unwrap_or(0.0),
                c.get("lon").and_then(|x| x.as_f64()).unwrap_or(0.0),
            )
        } else {
            (0.0, 0.0)
        };
        hotels.push(Hotel {
            osm_type: otype,
            osm_id: oid,
            name,
            city,
            country,
            website,
            phone,
            email,
            source: "OpenStreetMap".to_string(),
            lat,
            lon,
            stars,
            luxury,
        });
    }
    hotels.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    hotels
}

async fn overpass_hotels(client: &reqwest::Client, b: &Bbox) -> Result<Vec<Hotel>, String> {
    let started = Instant::now();
    let area_id = match b.osm_type.as_str() {
        "relation" => Some(3_600_000_000_i64 + b.osm_id),
        "way" => Some(2_400_000_000_i64 + b.osm_id),
        _ => None,
    };
    let area_deg2 = (b.n - b.s).abs() * (b.e - b.w).abs();

    // AREE GRANDI (paese / regione estesa): scansione a tasselli. Ogni query è piccola → veloce
    // e non manda Overpass in timeout/sovraccarico. Con budget complessivo e risultati parziali.
    if area_deg2 > 4.0 {
        return tiled_scan(client, b, area_id, started).await;
    }

    // AREE PICCOLE (città/regione contenuta): query singola per CONFINE (niente sconfini),
    // con fallback al bounding box SOLO se il confine non è disponibile o non dà risultati.
    // Tutto sotto un tetto di tempo, per non restare mai appesi.
    if let Some(aid) = area_id {
        let q = format!(
            "[out:json][timeout:120];(node[\"tourism\"=\"hotel\"](area:{aid});way[\"tourism\"=\"hotel\"](area:{aid}););out center tags;"
        );
        if let Ok(elements) = overpass_query(client, &q, Duration::from_secs(125)).await {
            let hotels = parse_elements(elements);
            if !hotels.is_empty() {
                return Ok(hotels);
            }
        }
    }
    let q = format!(
        "[out:json][timeout:90];(node[\"tourism\"=\"hotel\"]({s},{w},{n},{e});way[\"tourism\"=\"hotel\"]({s},{w},{n},{e}););out center tags;",
        s = b.s, w = b.w, n = b.n, e = b.e
    );
    let elements = overpass_query(client, &q, Duration::from_secs(95))
        .await
        .map_err(|e| overpass_unavailable(&e))?;
    Ok(parse_elements(elements))
}

#[tauri::command]
pub async fn discover(app: tauri::AppHandle, query: String) -> Result<DiscoverResult, String> {
    let client = http_client()?;
    // 1) geocodifica con Nominatim. 2) se non risponde, ripiega sul bounding box ricavato dagli
    //    hotel GIÀ in archivio per quell'area (così ri-scansionare un paese noto funziona anche
    //    se Nominatim è irraggiungibile). 3) altrimenti errore chiaro.
    let bbox = match nominatim_bbox(&client, &query).await {
        Ok(b) => b,
        Err(geo_err) => {
            let conn = crate::db::open_db(&app)?;
            match crate::db::bbox_for_term(&conn, &query) {
                Some((s, n, w, e, c)) => Bbox {
                    s, n, w, e,
                    label: format!("{query} (~ da archivio: {c} hotel — Nominatim non raggiungibile)"),
                    osm_type: String::new(),
                    osm_id: 0,
                    kind: "country".to_string(), // l'utente ha digitato un'area che abbiamo già: scansionabile
                    cc: String::new(),
                    country_name: String::new(),
                },
                None => {
                    return Err(format!(
                        "Geocodifica non riuscita e nessun dato in archivio per «{query}». \
                         Controlla la connessione e riprova tra poco. Dettaglio: {geo_err}"
                    ));
                }
            }
        }
    };
    // Guida verso un'area gestibile. Due casi distinti:
    let span_w = (bbox.e - bbox.w).abs();
    let span_h = (bbox.n - bbox.s).abs();
    // 1) paese "sparso" sul globo: territori d'oltremare / attraversa l'antimeridiano (USA, Francia,
    //    Russia → bbox largo ~360°). Il bounding box è inutile: meglio scansionare per stato/regione.
    if span_w > 90.0 || span_h > 90.0 {
        return Err(
            "Questo paese è troppo esteso per una singola scansione (territori sparsi o a cavallo dell'antimeridiano). Scansiona per stato, regione o città — es. \"California\", \"Texas\", \"Florida\", \"Baviera\". / This country is too spread out to scan at once — scan by state, region or city."
                .to_string(),
        );
    }
    // 2) intero continente: troppi hotel anche a tasselli. Nominatim restituisce per i continenti
    //    bbox piccoli/incoerenti (Africa ~2500 < Canada ~3694), quindi l'area da sola non basta:
    //    sopra le 2000 si consente SOLO un vero PAESE (addresstype=country); il resto si rifiuta.
    let area_deg2 = span_w * span_h;
    let is_country = bbox.kind == "country";
    if area_deg2 > 4000.0 || (area_deg2 > 2000.0 && !is_country) {
        return Err(
            "Area troppo grande per una singola scansione (sembra un intero continente). Scegli un paese, una regione o una città — es. \"Kenya\", \"Andalusia\", \"Cape Town\"."
                .to_string(),
        );
    }
    let mut hotels = overpass_hotels(&client, &bbox).await?;
    // Timbra il PAESE pieno (es. "Italy") dalla geocodifica su tutti gli hotel dell'area: l'addr:country
    // di OSM è spesso un codice ("IT") o assente, e finiva in "(sconosciuto)" / bucket sbagliato in
    // Copertura → "Completa" sembrava non far crescere il paese. Tutti gli hotel dell'area sono in quel paese.
    if !bbox.country_name.is_empty() {
        for h in hotels.iter_mut() {
            h.country = Some(bbox.country_name.clone());
        }
    }
    {
        let conn = crate::db::open_db(&app)?;
        crate::db::upsert_hotels(&conn, &hotels)?;
    }
    Ok(DiscoverResult {
        area_label: bbox.label,
        count: hotels.len(),
        hotels,
    })
}

// Quanti hotel esistono su OSM per quest'area (DENOMINATORE del grado di copertura). Usa la query
// per CONFINE (count), quindi funziona anche per i paesi enormi/antimeridiano (USA, Francia).
#[tauri::command]
pub async fn osm_hotel_count(app: tauri::AppHandle, query: String) -> Result<i64, String> {
    let client = http_client()?;
    let bbox = nominatim_bbox(&client, &query).await?;
    let area_id = area_id_of(&bbox.osm_type, bbox.osm_id)
        .ok_or_else(|| "Serve un'area amministrativa (paese/regione/città).".to_string())?;
    // contiamo solo gli hotel CON NOME: sono gli unici utilizzabili (gli anonimi li scartiamo),
    // così il grado di copertura è onesto (denominatore = ciò che possiamo davvero avere).
    let q = format!(
        "[out:json][timeout:180];area({area_id})->.a;(node[\"tourism\"=\"hotel\"][\"name\"](area.a);way[\"tourism\"=\"hotel\"][\"name\"](area.a););out count;"
    );
    let els = overpass_query(&client, &q, Duration::from_secs(180))
        .await
        .map_err(|e| overpass_unavailable(&e))?;
    let total = els
        .first()
        .and_then(|e| e.get("tags"))
        .and_then(|t| t.get("total"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    // CONSOLIDA la misura: salvala nel DB così il grado di copertura sopravvive al riavvio
    // (prima «Austria 100%» spariva chiudendo l'app).
    if let Ok(conn) = crate::db::open_db(&app) {
        crate::db::save_osm_count(&conn, &query, total);
    }
    Ok(total)
}

// Traduzione automatica (servizio gratuito, senza chiave). Rileva la lingua di origine e traduce
// verso `target` (it|en|ru). Usato dal pulsante «Traduci» su prove e recensioni: l'ORIGINALE resta
// sempre visibile (la prova verbatim non si tocca) — questa è solo una comodità.
#[tauri::command]
pub async fn translate(text: String, target: String) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(String::new());
    }
    let client = http_client()?;
    let resp = client
        .get("https://translate.googleapis.com/translate_a/single")
        .query(&[("client", "gtx"), ("sl", "auto"), ("tl", target.as_str()), ("dt", "t"), ("q", text)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("traduzione non disponibile ({})", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = String::new();
    if let Some(segs) = v.get(0).and_then(|x| x.as_array()) {
        for seg in segs {
            if let Some(s) = seg.get(0).and_then(|x| x.as_str()) {
                out.push_str(s);
            }
        }
    }
    if out.trim().is_empty() {
        return Err("traduzione vuota".to_string());
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct StarsBatch {
    pub processed: usize,  // hotel controllati in questo blocco
    pub with_stars: usize, // di questi, quanti hanno una classificazione
    pub remaining: i64,    // hotel ancora da controllare
}

// Scarica il tag `stars`/`luxury` da Overpass per un insieme di hotel (osm_type, osm_id), IN
// PARALLELO: divide gli id in al massimo 3 blocchi e fa 3 query concorrenti (client condiviso) — così
// la latenza di rete si sovrappone invece di sommarsi. Restituisce (mappa "type/id" → (stelle, lusso),
// insieme degli id effettivamente COPERTI da una risposta riuscita). Gli id di un blocco fallito NON
// finiscono in `covered`: restano stars=NULL e verranno ritentati, invece di essere marcati "0".
async fn fetch_stars_for(
    items: &[(String, i64)],
) -> Result<
    (
        std::collections::HashMap<String, (Option<i64>, bool)>,
        std::collections::HashSet<String>,
    ),
    String,
> {
    use std::collections::{HashMap, HashSet};
    if items.is_empty() {
        return Ok((HashMap::new(), HashSet::new()));
    }
    // Il costo Overpass è dominato dall'ATTESA DI UNO SLOT, non dal calcolo né dal round-trip. Quindi:
    // pochi blocchi GRANDI (uno per endpoint, una sola ondata) battono tanti blocchi piccoli su più
    // ondate. Spezziamo in ≤ N blocchi (N = numero di endpoint) e li lanciamo IN PARALLELO con
    // ROTAZIONE: ognuno parte da un endpoint diverso → niente coda sullo stesso mirror.
    let n_eps = OVERPASS_ENDPOINTS.len().max(1);
    let n_chunks = items.len().div_ceil(200).clamp(1, n_eps);
    let chunk_size = items.len().div_ceil(n_chunks);

    let mut handles = Vec::new();
    for (i, chunk) in items.chunks(chunk_size).enumerate() {
        let chunk: Vec<(String, i64)> = chunk.to_vec();
        handles.push(tauri::async_runtime::spawn(async move {
            let client = overpass_client();
            let ids = |kind: &str| {
                chunk.iter().filter(|(t, _)| t == kind).map(|(_, i)| i.to_string()).collect::<Vec<_>>().join(",")
            };
            let mut parts = String::new();
            let nn = ids("node");
            if !nn.is_empty() { parts.push_str(&format!("node(id:{nn});")); }
            let ww = ids("way");
            if !ww.is_empty() { parts.push_str(&format!("way(id:{ww});")); }
            let rr = ids("relation");
            if !rr.is_empty() { parts.push_str(&format!("relation(id:{rr});")); }
            let q = format!("[out:json][timeout:40];({parts});out tags;");
            let res = overpass_query_from(client, &q, Duration::from_secs(45), i).await;
            (chunk, res)
        }));
    }

    let mut found: HashMap<String, (Option<i64>, bool)> = HashMap::new();
    let mut covered: HashSet<String> = HashSet::new();
    let mut last_err = String::from("nessun blocco riuscito");
    for h in handles {
        let (chunk, res) = match h.await {
            Ok(pair) => pair,
            Err(e) => { last_err = e.to_string(); continue; }
        };
        match res {
            Ok(els) => {
                for (t, id) in &chunk {
                    covered.insert(format!("{t}/{id}"));
                }
                for el in els {
                    let t = el.get("type").and_then(|x| x.as_str()).unwrap_or("");
                    let id = el.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
                    let tags = el.get("tags");
                    let stars_raw = tags.and_then(|x| x.get("stars")).and_then(|v| v.as_str());
                    let lux_tag = tags.and_then(|x| x.get("luxury")).and_then(|v| v.as_str()) == Some("yes");
                    found.insert(format!("{t}/{id}"), parse_stars(stars_raw, lux_tag));
                }
            }
            Err(e) => { last_err = e; }
        }
    }
    if covered.is_empty() {
        return Err(last_err);
    }
    Ok((found, covered))
}

// Ri-scansione DB per le STELLE: prende un blocco di hotel senza classificazione, chiede a Overpass il
// tag `stars` per i loro osm_id e lo salva (gli hotel senza stelle vengono marcati stars=0 = controllati).
// Riusabile a blocchi dal frontend con avanzamento — è la versione in-app di scripts/backfill-stars.mjs.
#[tauri::command]
pub async fn backfill_stars(app: tauri::AppHandle, limit: Option<i64>) -> Result<StarsBatch, String> {
    // Blocco più grande (700 di default) + fetch concorrente: meno round-trip, latenza sovrapposta.
    let lim = limit.unwrap_or(700).clamp(1, 2000);
    let items: Vec<(String, i64)> = {
        let conn = crate::db::open_db(&app)?;
        let mut stmt = conn
            .prepare("SELECT osm_type, osm_id FROM hotels WHERE stars IS NULL ORDER BY osm_id LIMIT ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([lim], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut v = Vec::new();
        for row in rows {
            v.push(row.map_err(|e| e.to_string())?);
        }
        v
    };
    if items.is_empty() {
        return Ok(StarsBatch { processed: 0, with_stars: 0, remaining: 0 });
    }

    let (found, covered) = fetch_stars_for(&items).await.map_err(|e| overpass_unavailable(&e))?;

    let mut with_stars = 0usize;
    let mut processed = 0usize;
    let remaining: i64 = {
        let mut conn = crate::db::open_db(&app)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (t, id) in &items {
            let key = format!("{t}/{id}");
            if !covered.contains(&key) {
                continue; // blocco fallito per questo id → lascialo NULL, si riprova al prossimo giro
            }
            processed += 1;
            let (stars_opt, luxury) = found.get(&key).cloned().unwrap_or((None, false));
            let stars = stars_opt.unwrap_or(0); // controllato ma senza tag stelle → 0
            if stars >= 1 { with_stars += 1; }
            tx.execute(
                "UPDATE hotels SET stars=?3, luxury=?4 WHERE osm_type=?1 AND osm_id=?2",
                rusqlite::params![t, id, stars, luxury as i64],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        conn.query_row("SELECT COUNT(*) FROM hotels WHERE stars IS NULL", [], |r| r.get(0)).unwrap_or(0)
    };
    Ok(StarsBatch { processed, with_stars, remaining })
}

#[derive(Serialize)]
pub struct SubArea {
    pub name: String,
    pub osm_type: String,
    pub osm_id: i64,
    pub s: f64,
    pub n: f64,
    pub w: f64,
    pub e: f64,
}

// Elenca le REGIONI (admin_level=4) di un paese con il loro osm_id + bounding box, filtrate al paese
// via ISO3166-2 (niente regioni estere confinanti). Così "Completa" le scansiona PER AREA, senza
// ri-geocodificare ognuna su Nominatim (che, in raffica, bloccava l'IP → scansioni a vuoto).
#[tauri::command]
pub async fn list_subareas(query: String) -> Result<Vec<SubArea>, String> {
    let client = http_client()?;
    let bbox = nominatim_bbox(&client, &query).await?;
    let area_id = area_id_of(&bbox.osm_type, bbox.osm_id)
        .ok_or_else(|| "Serve un'area amministrativa (paese).".to_string())?;
    let prefix = if bbox.cc.is_empty() { String::new() } else { format!("{}-", bbox.cc.to_uppercase()) };

    // estrae le sotto-aree da una risposta Overpass, filtrando al paese via ISO3166-2 quando disponibile.
    let parse = |els: Vec<Value>| -> Vec<SubArea> {
        let mut out: Vec<SubArea> = Vec::new();
        for el in els {
            let tags = el.get("tags");
            let name = match tags.and_then(|t| t.get("name")).and_then(|v| v.as_str()) {
                Some(n) if !n.trim().is_empty() => n.to_string(),
                _ => continue,
            };
            if !prefix.is_empty() {
                let iso = tags.and_then(|t| t.get("ISO3166-2")).and_then(|v| v.as_str()).unwrap_or("");
                if !iso.to_uppercase().starts_with(&prefix) {
                    continue; // scarta regioni estere confinanti / senza codice del paese
                }
            }
            let b = el.get("bounds");
            let g = |k: &str| b.and_then(|x| x.get(k)).and_then(|v| v.as_f64());
            let osm_id = el.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let osm_type = el.get("type").and_then(|v| v.as_str()).unwrap_or("relation").to_string();
            if osm_id != 0 {
                out.push(SubArea {
                    name, osm_type, osm_id,
                    s: g("minlat").unwrap_or(0.0), n: g("maxlat").unwrap_or(0.0),
                    w: g("minlon").unwrap_or(0.0), e: g("maxlon").unwrap_or(0.0),
                });
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out.dedup_by(|a, b| a.osm_id == b.osm_id);
        out
    };

    // CASCATA di criteri: prova i livelli amministrativi più comuni per la prima suddivisione di un
    // paese (4 = stati/regioni; 6/5/3 in altri ordinamenti). Si usa il primo che dà >=2 regioni DEL paese.
    for lvl in ["4", "6", "5", "3"] {
        let q = format!(
            "[out:json][timeout:120];area({area_id})->.a;rel(area.a)[\"admin_level\"=\"{lvl}\"][\"boundary\"=\"administrative\"];out tags bb;"
        );
        if let Ok(els) = overpass_query(&client, &q, Duration::from_secs(150)).await {
            let out = parse(els);
            if out.len() >= 2 {
                return Ok(out);
            }
        }
    }

    // FALLBACK universale: nessuna suddivisione utile (Grecia, Giamaica, Aruba…) → restituisci il
    // PAESE come un'unica area. discover_area lo scansiona a TASSELLI ritagliati sul confine, quindi
    // funziona per qualsiasi paese senza dipendere dalle regioni amministrative.
    Ok(vec![SubArea {
        name: query.clone(),
        osm_type: bbox.osm_type.clone(),
        osm_id: bbox.osm_id,
        s: bbox.s, n: bbox.n, w: bbox.w, e: bbox.e,
    }])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaArgs {
    pub osm_type: String,
    pub osm_id: i64,
    pub s: f64,
    pub n: f64,
    pub w: f64,
    pub e: f64,
    pub country: String,
}

// Scansiona gli hotel di UNA regione data per osm_id+bbox (NESSUNA chiamata Nominatim → niente
// rate-limit in raffica). Riusa il motore a tasselli/confine; timbra il paese. Ritorna quanti trovati.
#[tauri::command]
pub async fn discover_area(app: tauri::AppHandle, args: AreaArgs) -> Result<usize, String> {
    let client = http_client()?;
    let bbox = Bbox {
        s: args.s, n: args.n, w: args.w, e: args.e,
        label: String::new(), osm_type: args.osm_type, osm_id: args.osm_id,
        kind: "region".to_string(), cc: String::new(), country_name: args.country.clone(),
    };
    let mut hotels = overpass_hotels(&client, &bbox).await?;
    if !args.country.is_empty() {
        for h in hotels.iter_mut() {
            h.country = Some(args.country.clone());
        }
    }
    {
        let conn = crate::db::open_db(&app)?;
        crate::db::upsert_hotels(&conn, &hotels)?;
        // registra la regione come scansionata ADESSO → la prossima «Completa» la salta (incrementale).
        crate::db::mark_area_scanned(&conn, &format!("{}/{}", bbox.osm_type, bbox.osm_id));
    }
    Ok(hotels.len())
}

// ---------- ARRICCHISCI / VALUTA ----------

// Dizionario dei segnali family caricato da signals.json (dato esterno, multilingue, estensibile).
// Pesi come da MASTER.md §6 (reviews = futuro, sempre assente per ora -> max attuale 94/100).
#[derive(serde::Deserialize)]
struct SignalSpec {
    key: String,
    weight: u32,
    patterns: Vec<String>,
}

#[derive(serde::Deserialize)]
struct SignalsFile {
    signals: Vec<SignalSpec>,
}

static SIGNALS_JSON: &str = include_str!("signals.json");

fn signal_defs() -> &'static [SignalSpec] {
    use std::sync::OnceLock;
    static CELL: OnceLock<Vec<SignalSpec>> = OnceLock::new();
    CELL.get_or_init(|| {
        let parsed: SignalsFile =
            serde_json::from_str(SIGNALS_JSON).expect("signals.json non valido");
        parsed.signals
    })
    .as_slice()
}

#[derive(Serialize, Clone)]
pub struct SignalResult {
    pub key: String,
    pub weight: u32,
    pub present: bool,
    pub quote: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize)]
pub struct EnrichResult {
    pub website_ok: bool,
    pub pages_fetched: u32,
    pub family_fit_score: u32,
    pub signals: Vec<SignalResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichArgs {
    pub osm_type: String,
    pub osm_id: i64,
    pub website: Option<String>,
}

// HTML -> testo: rimuove script/style/commenti, trasforma i tag in interruzioni.
// Usa Vec<char> per evitare problemi di confini byte con caratteri multibyte.
pub fn html_to_text(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    while i < n {
        if chars[i] == '<' {
            let peek: String = chars[i..(i + 8).min(n)].iter().collect::<String>().to_lowercase();
            if peek.starts_with("<script") {
                i = skip_until(&chars, i, "</script>");
                out.push('\n');
                continue;
            }
            if peek.starts_with("<style") {
                i = skip_until(&chars, i, "</style>");
                out.push('\n');
                continue;
            }
            if peek.starts_with("<!--") {
                i = skip_until(&chars, i, "-->");
                continue;
            }
            while i < n && chars[i] != '>' {
                i += 1;
            }
            i += 1; // oltre '>'
            out.push('\n'); // ogni tag = possibile separatore
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    decode_entities(&out)
}

fn skip_until(chars: &[char], start: usize, close: &str) -> usize {
    let cl: Vec<char> = close.chars().collect();
    let n = chars.len();
    let mut i = start + 1;
    while i + cl.len() <= n {
        let matches = (0..cl.len()).all(|k| chars[i + k].to_ascii_lowercase() == cl[k]);
        if matches {
            return i + cl.len();
        }
        i += 1;
    }
    n
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&agrave;", "à")
        .replace("&egrave;", "è")
        .replace("&igrave;", "ì")
        .replace("&ograve;", "ò")
        .replace("&ugrave;", "ù")
        .replace("&ndash;", "-")
        .replace("&mdash;", "-")
}

fn normalize_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in text.chars() {
        if matches!(c, '.' | '!' | '?' | '\n' | ';' | '•' | '|') {
            let s = normalize_ws(&cur);
            let len = s.chars().count();
            if len >= 4 && len <= 400 {
                out.push(s);
            }
            cur.clear();
        } else {
            cur.push(c);
        }
    }
    let s = normalize_ws(&cur);
    let len = s.chars().count();
    if len >= 4 && len <= 400 {
        out.push(s);
    }
    out
}

fn cap(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        s.to_string()
    } else {
        let mut t: String = chars[..max].iter().collect();
        t.push('…');
        t
    }
}

// La citazione deve esistere DAVVERO nel testo della pagina (verifica verbatim).
fn verify_verbatim(sentence: &str, pages: &[(String, String)]) -> bool {
    let needle = normalize_ws(sentence);
    if needle.is_empty() {
        return false;
    }
    pages.iter().any(|(_, t)| normalize_ws(t).contains(&needle))
}

// Calcola il punteggio family-fit dalle pagine, con prova citata e verificata.
pub fn score_pages(pages: &[(String, String)]) -> (u32, Vec<SignalResult>) {
    let mut tagged: Vec<(String, String)> = Vec::new(); // (frase, url)
    for (url, text) in pages {
        for s in split_sentences(text) {
            tagged.push((s, url.clone()));
        }
    }
    let mut signals = Vec::new();
    let mut score = 0u32;
    for def in signal_defs() {
        let mut found: Option<(String, String)> = None;
        if !def.patterns.is_empty() {
            for (sent, url) in &tagged {
                let sl = sent.to_lowercase();
                if def.patterns.iter().any(|p| sl.contains(p.as_str())) && verify_verbatim(sent, pages) {
                    found = Some((cap(sent, 220), url.clone()));
                    break;
                }
            }
        }
        let present = found.is_some();
        if present {
            score += def.weight;
        }
        let (quote, url) = match found {
            Some((q, u)) => (Some(q), Some(u)),
            None => (None, None),
        };
        signals.push(SignalResult {
            key: def.key.clone(),
            weight: def.weight,
            present,
            quote,
            url,
        });
    }
    (score, signals)
}

// Estrae un'email di contatto plausibile dall'HTML grezzo (cattura anche i mailto: e i JSON-LD).
// Solo dato REALE trovato sul sito (niente indirizzi inventati). Preferisce contatti "ufficiali".
fn find_email(html: &str) -> Option<String> {
    let chars: Vec<char> = html.chars().collect();
    let is_local = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-');
    let is_domain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '-');
    // Spazzatura su domini/loghi/estensioni: confronto per SOTTOSTRINGA (sicuro, non c'è rischio di
    // colpire indirizzi reali).
    const JUNK_SUB: &[&str] = &[
        "example.", "sentry", "wixpress", "@2x", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
        "domain.com", "yourdomain", "googleapis", "gstatic", "schema.org", "w3.org", "@example",
        "@sentry", "@domain", "@yourdomain",
    ];
    // Segnaposto nella parte LOCALE (prima della @): confronto ESATTO. Con la sottostringa scartavamo
    // indirizzi veri come "firstname@", "superuser@", "myemail@", "contest@".
    const JUNK_LOCAL: &[&str] = &[
        "your-email", "youremail", "name", "user", "test", "email", "example",
        "your", "firstname.lastname", "nome", "tuamail", "tuaemail",
    ];
    let mut candidates: Vec<String> = Vec::new();
    for (i, &c) in chars.iter().enumerate() {
        if c != '@' {
            continue;
        }
        let mut l = i;
        while l > 0 && is_local(chars[l - 1]) {
            l -= 1;
        }
        let mut r = i + 1;
        while r < chars.len() && is_domain(chars[r]) {
            r += 1;
        }
        if l == i || r == i + 1 {
            continue;
        }
        let local: String = chars[l..i].iter().collect();
        let mut domain: String = chars[i + 1..r].iter().collect();
        while domain.ends_with('.') {
            domain.pop();
        }
        if !domain.contains('.') || local.len() > 64 || domain.len() > 100 {
            continue;
        }
        let tld = domain.rsplit('.').next().unwrap_or("");
        if tld.len() < 2 || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
            continue;
        }
        let email = format!("{local}@{domain}").to_lowercase();
        let local_lc = local.to_lowercase();
        if JUNK_SUB.iter().any(|j| email.contains(j)) || JUNK_LOCAL.contains(&local_lc.as_str()) {
            continue;
        }
        if !candidates.contains(&email) {
            candidates.push(email);
        }
    }
    const PREF: &[&str] = &["info@", "reception", "reservation", "booking", "hotel@", "contact", "welcome", "office", "mail@"];
    candidates.sort_by_key(|e| if PREF.iter().any(|p| e.contains(p)) { 0 } else { 1 });
    candidates.into_iter().next()
}

async fn fetch(client: &reqwest::Client, url: &str) -> Option<String> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

async fn robots_blocks_root(client: &reqwest::Client, base: &reqwest::Url) -> bool {
    let mut u = base.clone();
    u.set_path("/robots.txt");
    u.set_query(None);
    let txt = match client.get(u).send().await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => return false,
    };
    let mut in_star = false;
    for line in txt.lines() {
        let l = line.trim().to_lowercase();
        if l.starts_with("user-agent:") {
            in_star = l.contains('*');
        } else if in_star && l.starts_with("disallow:") {
            let path = l["disallow:".len()..].trim();
            if path == "/" {
                return true;
            }
        }
    }
    false
}

const FAMILY_HREF_HINTS: &[&str] = &[
    "famigli", "famiglia", "bambini", "bimbi", "kids", "kinder", "family", "familie", "enfant",
    "infantil", "child", "miniclub",
];

fn extract_family_links(html: &str, base: &reqwest::Url) -> Vec<String> {
    // Lavora SUI BYTE (mai slicing di &str con indici arbitrari: andava in panic su HTML reale con
    // virgolette non chiuse o caratteri multibyte — start fuori dai limiti / non su confine di char).
    // Il panic in `enrich_hotel` lasciava l'invoke appeso → il worker si bloccava → valutazione ferma.
    let lower = html.to_ascii_lowercase();
    let lb = lower.as_bytes();
    let hb = html.as_bytes();
    let n = lb.len();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i + 4 <= n {
        if &lb[i..i + 4] != b"href" {
            i += 1;
            continue;
        }
        let mut j = i + 4;
        while j < n && (lb[j] == b' ' || lb[j] == b'=') {
            j += 1;
        }
        if j < n && (lb[j] == b'"' || lb[j] == b'\'') {
            let q = lb[j];
            j += 1;
            let s = j;
            while j < n && lb[j] != q {
                j += 1;
            }
            // s..j sono delimitati da virgolette ASCII → estrazione sicura via from_utf8_lossy.
            let href = String::from_utf8_lossy(&hb[s..j]);
            let href_l = String::from_utf8_lossy(&lb[s..j]);
            if FAMILY_HREF_HINTS.iter().any(|h| href_l.contains(h)) {
                if let Ok(abs) = base.join(&href) {
                    if abs.host_str() == base.host_str() {
                        let a = abs.to_string();
                        if a != base.as_str() && !out.contains(&a) {
                            out.push(a);
                        }
                    }
                }
            }
            i = j + 1;
        } else {
            i = j.max(i + 4); // garantisce avanzamento, niente loop infinito né overflow
        }
    }
    out.truncate(3);
    out
}

// ---------- FASCIA DI PREZZO ($ → $$$$$) ----------
// Componente REALE del costo: legge la fascia di prezzo che il sito stesso PUBBLICA in modo
// strutturato (schema.org `priceRange`), o come simboli di valuta ("€€€" → livello 3) o come fascia
// numerica ("120-300", "€90 - €140" → prezzo a notte → livello). Dato citato dal sito (niente
// inventato): se assente → None, e la UI ripiega sulla STIMA da stelle+paese. La componente stima è
// lato frontend; qui sta solo la parte "vera" dal sito.
struct PriceHit {
    tier: i64,           // livello 1–5 ($ → $$$$$)
    eur: Option<i64>,    // prezzo a notte (≈ EUR) quando è una fascia numerica
    src: String,         // valore verbatim del priceRange (prova: è copiato dal sito)
}

// Cambio approssimato verso EUR: serve solo a incasellare in 5 fasce, non a un calcolo preciso.
fn currency_rate_to_eur(sym: &str) -> f64 {
    match sym {
        "€" | "eur" => 1.0,
        "$" | "usd" | "us$" => 0.92,
        "£" | "gbp" => 1.17,
        "chf" | "fr" => 1.05,
        "¥" | "jpy" => 0.0061,
        "₽" | "rub" => 0.011,
        "zł" | "pln" => 0.23,
        "kč" | "czk" => 0.040,
        "₺" | "try" => 0.030,
        _ => 1.0, // sconosciuto → assumi EUR (l'incasellamento è grezzo, va bene)
    }
}

fn price_bucket_eur(eur: f64) -> i64 {
    if eur < 70.0 { 1 } else if eur < 120.0 { 2 } else if eur < 200.0 { 3 } else if eur < 350.0 { 4 } else { 5 }
}

// Estrae i numeri "interi" da un token, gestendo separatori migliaia (gruppo da 3) vs decimali.
fn numbers_in(token: &str) -> Vec<f64> {
    let chars: Vec<char> = token.chars().collect();
    let mut nums: Vec<f64> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let mut intpart = String::new();
            loop {
                while i < chars.len() && chars[i].is_ascii_digit() {
                    intpart.push(chars[i]);
                    i += 1;
                }
                if i + 1 < chars.len() && (chars[i] == '.' || chars[i] == ',') && chars[i + 1].is_ascii_digit() {
                    let mut k = i + 1;
                    let mut grp = 0;
                    while k < chars.len() && chars[k].is_ascii_digit() { grp += 1; k += 1; }
                    if grp == 3 {
                        i += 1; // separatore migliaia → concatena le cifre successive
                        continue;
                    } else {
                        i = k; // separatore decimale → chiudi il numero (ignora la frazione)
                        break;
                    }
                } else {
                    break;
                }
            }
            if let Ok(v) = intpart.parse::<f64>() { nums.push(v); }
        } else {
            i += 1;
        }
    }
    nums
}

fn parse_price_range(token: &str) -> Option<(i64, Option<i64>, String)> {
    let trimmed = token.trim();
    if trimmed.is_empty() { return None; }
    let sym_count = trimmed.chars().filter(|c| matches!(c, '€' | '$' | '£' | '¥' | '₽')).count();
    let mut nums = numbers_in(trimmed);
    nums.retain(|&v| (10.0..=20000.0).contains(&v)); // prezzo a notte plausibile
    let src: String = trimmed.chars().take(28).collect();
    if !nums.is_empty() {
        let low = nums.iter().cloned().fold(f64::INFINITY, f64::min);
        let lc = trimmed.to_lowercase();
        let sym = if trimmed.contains('€') || lc.contains("eur") { "€" }
            else if trimmed.contains('£') || lc.contains("gbp") { "£" }
            else if lc.contains("chf") { "chf" }
            else if trimmed.contains('$') || lc.contains("usd") { "$" }
            else if trimmed.contains('¥') || lc.contains("jpy") { "¥" }
            else if trimmed.contains('₽') || lc.contains("rub") { "₽" }
            else { "€" };
        let eur = low * currency_rate_to_eur(sym);
        return Some((price_bucket_eur(eur), Some(eur.round() as i64), src));
    }
    if sym_count >= 1 {
        return Some(((sym_count as i64).clamp(1, 5), None, src));
    }
    None
}

// Dalla finestra dopo "pricerange", estrae il token-valore (es. `: "€€€"`, `content="$$"`,
// `>€120 - €300<`): salta fino al primo simbolo di valuta o cifra, poi copia fino a un delimitatore.
fn price_range_token(window: &str) -> Option<String> {
    let chars: Vec<char> = window.chars().collect();
    let mut s = 0;
    while s < chars.len() && !(chars[s].is_ascii_digit() || matches!(chars[s], '€' | '$' | '£' | '¥' | '₽')) {
        s += 1;
    }
    if s >= chars.len() { return None; }
    let mut out = String::new();
    let mut j = s;
    while j < chars.len() && out.chars().count() < 40 {
        let c = chars[j];
        if matches!(c, '"' | '<' | '>' | '{' | '}' | ';' | '\n' | '\r' | '|') { break; }
        out.push(c);
        j += 1;
    }
    let tok = out.trim().to_string();
    if tok.is_empty() { None } else { Some(tok) }
}

fn extract_price(html: &str) -> Option<PriceHit> {
    // `to_ascii_lowercase` non cambia i byte multibyte (€,£,…) né la lunghezza → gli indici di `lower`
    // combaciano con quelli di `html`, così possiamo estrarre il valore ORIGINALE (coi simboli).
    let lower = html.to_ascii_lowercase();
    let hay = lower.as_bytes();
    let raw = html.as_bytes();
    let needle = b"pricerange";
    let mut i = 0usize;
    while i + needle.len() <= hay.len() {
        if &hay[i..i + needle.len()] != needle {
            i += 1;
            continue;
        }
        let start = i + needle.len();
        let end = (start + 90).min(raw.len());
        let window = String::from_utf8_lossy(&raw[start..end]);
        if let Some(tok) = price_range_token(&window) {
            if let Some((tier, eur, src)) = parse_price_range(&tok) {
                return Some(PriceHit { tier, eur, src });
            }
        }
        i = start;
    }
    None
}

// Restituisce le pagine (testo) PIÙ un'eventuale email di contatto e la fascia di prezzo trovate
// sull'HTML grezzo.
async fn gather_pages(
    client: &reqwest::Client,
    base_url: &str,
) -> (Vec<(String, String)>, Option<String>, Option<PriceHit>) {
    let mut pages = Vec::new();
    let mut email: Option<String> = None;
    let mut price: Option<PriceHit> = None;
    let base = match reqwest::Url::parse(base_url) {
        Ok(u) => u,
        Err(_) => return (pages, email, price),
    };
    if robots_blocks_root(client, &base).await {
        return (pages, email, price);
    }
    if let Some(home) = fetch(client, base.as_str()).await {
        email = email.or_else(|| find_email(&home));
        price = price.or_else(|| extract_price(&home));
        let links = extract_family_links(&home, &base);
        pages.push((base.to_string(), html_to_text(&home)));
        for l in links.into_iter().take(2) {
            if let Some(h) = fetch(client, &l).await {
                email = email.or_else(|| find_email(&h));
                price = price.or_else(|| extract_price(&h));
                pages.push((l, html_to_text(&h)));
            }
        }
    }
    (pages, email, price)
}

fn absent_signals() -> Vec<SignalResult> {
    signal_defs()
        .iter()
        .map(|d| SignalResult {
            key: d.key.clone(),
            weight: d.weight,
            present: false,
            quote: None,
            url: None,
        })
        .collect()
}

#[tauri::command]
pub async fn enrich_hotel(app: tauri::AppHandle, args: EnrichArgs) -> Result<EnrichResult, String> {
    let website = match args.website {
        Some(w) if !w.trim().is_empty() => w,
        _ => {
            return Ok(EnrichResult {
                website_ok: false,
                pages_fetched: 0,
                family_fit_score: 0,
                signals: absent_signals(),
            })
        }
    };
    let client = enrich_client();
    // Tetto DURO per hotel: qualunque sito che superi 16s viene abbandonato (pagine raccolte fin lì,
    // di norma vuote). Impedisce a un singolo sito lento di inchiodare un worker e "bloccare" la corsa.
    let (pages, found_email, price) = match tokio::time::timeout(
        std::time::Duration::from_secs(16),
        gather_pages(client, &website),
    )
    .await
    {
        Ok(res) => res,
        Err(_) => (Vec::new(), None, None), // timeout complessivo: trattato come sito non raggiungibile
    };
    let website_ok = !pages.is_empty();
    let (score, signals) = score_pages(&pages);

    {
        let conn = crate::db::open_db(&app)?;
        let breakdown = serde_json::to_string(&signals).unwrap_or_else(|_| "[]".to_string());
        let enrichment = serde_json::json!({
            "website_ok": website_ok,
            "pages_fetched": pages.len(),
        })
        .to_string();
        crate::db::update_enrichment(
            &conn,
            &args.osm_type,
            args.osm_id,
            score,
            &breakdown,
            &enrichment,
        )?;
        // email trovata sul sito → la salviamo se non c'era già (dato reale, per il CRM).
        if let Some(em) = &found_email {
            let _ = crate::db::set_email_if_absent(&conn, &args.osm_type, args.osm_id, em);
        }
        // fascia di prezzo pubblicata dal sito (dato reale, con prova) → la salviamo.
        if let Some(p) = &price {
            let _ = crate::db::set_price(&conn, &args.osm_type, args.osm_id, p.tier, p.eur, &p.src);
        }
    }

    Ok(EnrichResult {
        website_ok,
        pages_fetched: pages.len() as u32,
        family_fit_score: score,
        signals,
    })
}

#[derive(Serialize)]
pub struct EnrichOne {
    pub id: String, // "osm_type/osm_id"
    pub website_ok: bool,
    pub pages_fetched: u32,
    pub family_fit_score: u32,
    pub signals: Vec<SignalResult>,
}

#[derive(Serialize)]
pub struct EnrichBatch {
    pub processed: usize, // hotel valutati in questo blocco
    pub remaining: i64,   // hotel ancora da valutare (per la barra e per sapere quando fermarsi)
    pub results: Vec<EnrichOne>,
}

// Valuta un INTERO blocco di hotel in UN solo comando: legge i non valutati, scarica+valuta i siti
// IN PARALLELO (client condiviso, tetto 16s per hotel), e scrive TUTTO in un'unica transazione (una
// sola connessione, niente migrate per-hotel, niente contesa). Era la vecchia architettura "un invoke
// + una connessione per hotel" a far arrancare/«bloccare» la valutazione su archivi grandi.
#[tauri::command]
pub async fn enrich_batch(app: tauri::AppHandle, limit: Option<i64>) -> Result<EnrichBatch, String> {
    let lim = limit.unwrap_or(24).clamp(1, 100);

    // 1) leggi il blocco di non valutati (connessione breve, subito rilasciata)
    let items: Vec<(String, i64, String)> = {
        let conn = crate::db::open_db(&app)?;
        let mut stmt = conn
            .prepare(
                "SELECT osm_type, osm_id, website FROM hotels
                 WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>''
                 ORDER BY osm_id LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([lim], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
            })
            .map_err(|e| e.to_string())?;
        let mut v = Vec::new();
        for row in rows {
            v.push(row.map_err(|e| e.to_string())?);
        }
        v
    };
    if items.is_empty() {
        return Ok(EnrichBatch { processed: 0, remaining: 0, results: vec![] });
    }

    // 2) scarica+valuta in parallelo (un task per hotel; client condiviso 'static; tetto 16s/hotel)
    let mut handles = Vec::new();
    for (ot, oid, website) in items {
        handles.push(tauri::async_runtime::spawn(async move {
            let client = enrich_client();
            let (pages, email, price) = match tokio::time::timeout(
                Duration::from_secs(16),
                gather_pages(client, &website),
            )
            .await
            {
                Ok(res) => res,
                Err(_) => (Vec::new(), None, None),
            };
            let website_ok = !pages.is_empty();
            let pages_fetched = pages.len() as u32;
            let (score, signals) = score_pages(&pages);
            let price = price.map(|p| (p.tier, p.eur, p.src)); // appiattisci PriceHit (PriceHit non è Send-trasparente nel tuple)
            (ot, oid, website_ok, pages_fetched, score, signals, email, price)
        }));
    }
    let mut scored = Vec::new();
    for h in handles {
        if let Ok(res) = h.await {
            scored.push(res);
        }
    }

    // 3) scrivi TUTTO in una sola transazione (una connessione, nessun migrate per-hotel)
    let remaining: i64 = {
        let mut conn = crate::db::open_db(&app)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (ot, oid, website_ok, pages_fetched, score, signals, email, price) in &scored {
            let breakdown = serde_json::to_string(signals).unwrap_or_else(|_| "[]".to_string());
            let enrichment = serde_json::json!({ "website_ok": website_ok, "pages_fetched": pages_fetched }).to_string();
            tx.execute(
                "UPDATE hotels SET family_fit_score=?3, score_breakdown=?4, enrichment=?5, updated_at=datetime('now')
                 WHERE osm_type=?1 AND osm_id=?2",
                rusqlite::params![ot, oid, score, breakdown, enrichment],
            )
            .map_err(|e| e.to_string())?;
            if let Some(em) = email {
                let _ = tx.execute(
                    "UPDATE hotels SET email=?3 WHERE osm_type=?1 AND osm_id=?2 AND (email IS NULL OR email='')",
                    rusqlite::params![ot, oid, em],
                );
            }
            // fascia di prezzo dal sito (dato reale, con prova): la scriviamo dove l'abbiamo trovata.
            if let Some((tier, eur, src)) = price {
                let _ = tx.execute(
                    "UPDATE hotels SET price_tier=?3, price_eur=?4, price_src=?5 WHERE osm_type=?1 AND osm_id=?2",
                    rusqlite::params![ot, oid, tier, eur, src],
                );
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT COUNT(*) FROM hotels WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>''",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };

    let results = scored
        .into_iter()
        .map(|(ot, oid, website_ok, pages_fetched, score, signals, _, _)| EnrichOne {
            id: format!("{ot}/{oid}"),
            website_ok,
            pages_fetched,
            family_fit_score: score,
            signals,
        })
        .collect::<Vec<_>>();
    Ok(EnrichBatch { processed: results.len(), remaining, results })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bbox(s: f64, n: f64, w: f64, e: f64) -> Bbox {
        Bbox { s, n, w, e, label: String::new(), osm_type: String::new(), osm_id: 0, kind: String::new(), cc: String::new(), country_name: String::new() }
    }

    // Prova LIVE della traduzione automatica: `cargo test -- --ignored live_translate --nocapture`
    #[test]
    #[ignore]
    fn live_translate() {
        tauri::async_runtime::block_on(async {
            let out = translate("Kinderbetreuung und Familienzimmer".to_string(), "it".to_string()).await.unwrap();
            println!("DE→IT: {out}");
            assert!(!out.trim().is_empty());
            assert_ne!(out, "Kinderbetreuung und Familienzimmer"); // deve essere tradotto
            let ru = translate("miniclub e menù per bambini".to_string(), "ru".to_string()).await.unwrap();
            println!("IT→RU: {ru}");
            assert!(ru.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c))); // contiene cirillico
        });
    }

    #[test]
    fn parse_stars_handles_osm_values() {
        assert_eq!(parse_stars(Some("3"), false), (Some(3), false));
        assert_eq!(parse_stars(Some("4S"), false), (Some(4), false)); // superior ma non 5 → non lusso
        assert_eq!(parse_stars(Some("5S"), false), (Some(5), true)); // 5 Superior → lusso
        assert_eq!(parse_stars(Some("5"), false), (Some(5), false));
        assert_eq!(parse_stars(Some("5 Superior"), false), (Some(5), true));
        assert_eq!(parse_stars(Some("3-4"), false), (Some(3), false)); // prende la prima cifra
        assert_eq!(parse_stars(Some("boutique"), false), (None, false));
        assert_eq!(parse_stars(None, true), (None, true)); // tag luxury=yes senza stelle
    }

    #[test]
    fn extract_price_reads_schema_pricerange() {
        // Simboli di valuta: "€€€" → livello 3, nessun numero.
        let h = r#"<script type="application/ld+json">{"@type":"Hotel","priceRange":"€€€"}</script>"#;
        let p = extract_price(h).expect("priceRange simboli");
        assert_eq!(p.tier, 3);
        assert_eq!(p.eur, None);

        // Microdata con $$ → livello 2.
        let h2 = r#"<span itemprop="priceRange" content="$$">prezzi</span>"#;
        assert_eq!(extract_price(h2).unwrap().tier, 2);

        // Fascia numerica senza simbolo → assume EUR; low=120 → livello 3.
        let h3 = r#"{"priceRange":"120-300"}"#;
        let p3 = extract_price(h3).unwrap();
        assert_eq!(p3.tier, 3);
        assert_eq!(p3.eur, Some(120));

        // Fascia con simbolo €, prende il minimo (90) → livello 2.
        let h4 = r#"<div data-pricerange=": €90 - €140 a notte">"#;
        let p4 = extract_price(h4).unwrap();
        assert_eq!(p4.eur, Some(90));
        assert_eq!(p4.tier, 2);

        // USD 250 → ~230 EUR → livello 4.
        let h5 = r#""priceRange":"USD 250""#;
        assert_eq!(extract_price(h5).unwrap().tier, 4);

        // Separatore migliaia: "€1.200" → 1200 EUR → livello 5.
        let h6 = r#""priceRange":"€1.200""#;
        let p6 = extract_price(h6).unwrap();
        assert_eq!(p6.eur, Some(1200));
        assert_eq!(p6.tier, 5);

        // Assente / vuoto → None (la UI userà la stima).
        assert!(extract_price("<html>nessun prezzo qui</html>").is_none());
        assert!(extract_price(r#"<x itemprop="priceRange" content="">"#).is_none());
    }

    // Verifica + tempo della ri-scansione STELLE concorrente sul DB REALE.
    // `cargo test -- --ignored live_backfill_stars --nocapture`
    #[test]
    #[ignore]
    fn live_backfill_stars() {
        use rusqlite::Connection;
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
        tauri::async_runtime::block_on(async {
            let conn = Connection::open(&path).unwrap();
            conn.busy_timeout(Duration::from_secs(30)).unwrap();
            let items: Vec<(String, i64)> = {
                let mut stmt = conn
                    .prepare("SELECT osm_type, osm_id FROM hotels WHERE stars IS NULL ORDER BY osm_id LIMIT 700")
                    .unwrap();
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|x| x.unwrap()).collect()
            };
            if items.is_empty() {
                println!("nessun hotel da classificare (tutte le stelle già fatte)");
                return;
            }
            let t0 = Instant::now();
            let (found, covered) = fetch_stars_for(&items).await.unwrap();
            let secs = t0.elapsed().as_secs_f64();
            let with = items.iter().filter(|(t, i)| {
                found.get(&format!("{t}/{i}")).map(|(s, _)| s.is_some()).unwrap_or(false)
            }).count();
            println!(
                "STELLE: {} hotel chiesti, {} coperti, {} con classificazione in {:.1}s (≈ {:.0} hotel/s)",
                items.len(), covered.len(), with, secs, covered.len() as f64 / secs.max(0.001)
            );
            assert!(!covered.is_empty(), "nessuna risposta Overpass");
            assert!(secs < 90.0, "troppo lento: {secs:.1}s (atteso ben meno con la rotazione endpoint)");
        });
    }

    #[test]
    fn extract_family_links_never_panics() {
        let base = reqwest::Url::parse("https://hotel.de/").unwrap();
        // HTML patologico che faceva crashare la valutazione: virgoletta NON chiusa, caratteri
        // multibyte (umlaut), "href" a fine stringa. Non deve mai andare in panic.
        let bad = "<a href=\"/für-familien/angebot?näh=ö Größe und ßßß";
        let _ = extract_family_links(bad, &base); // niente panic = ok
        let bad2 = "blah href"; // "href" proprio in fondo
        let _ = extract_family_links(bad2, &base);
        // caso buono: trova il link family con umlaut nel percorso
        let good = "<a href=\"/familie/kinder\">x</a> <a href='https://altro.com/family'>y</a>";
        let links = extract_family_links(good, &base);
        assert!(links.iter().any(|l| l.contains("/familie/kinder")), "links: {links:?}");
        // l'host esterno (altro.com) va scartato
        assert!(!links.iter().any(|l| l.contains("altro.com")));
    }

    #[test]
    fn find_email_picks_real_contact() {
        // mailto + email ufficiale preferita rispetto a una generica
        let html = r#"<a href="mailto:reception@hotelsole.it">scrivici</a>
            <p>Webmaster: noreply@hotelsole.it</p>
            <img src="logo@2x.png">"#;
        assert_eq!(find_email(html).as_deref(), Some("reception@hotelsole.it"));

        // niente email reale → None (logo@2x.png e sentry scartati)
        let junk = r#"<img src="hero@2x.png"><script src="https://o123.ingest.sentry.io/x"></script>"#;
        assert_eq!(find_email(junk), None);

        // email in testo semplice
        let plain = "Per info: Info@Familienhotel.DE oppure chiama.";
        assert_eq!(find_email(plain).as_deref(), Some("info@familienhotel.de"));

        // local-part legittimi che la vecchia denylist a sottostringa scartava per sbaglio
        assert_eq!(find_email("scrivi a firstname@hotelmare.it").as_deref(), Some("firstname@hotelmare.it"));
        assert_eq!(find_email("contatto: superuser@resort.com").as_deref(), Some("superuser@resort.com"));
        assert_eq!(find_email("posta info@email-resort.com").as_deref(), Some("info@email-resort.com"));

        // veri segnaposto (local esatto) → scartati
        assert_eq!(find_email("name@example.com user@domain.com"), None);
        assert_eq!(find_email("your-email@yourdomain.com"), None);
    }

    #[test]
    fn split_tiles_basic_grid() {
        let b = bbox(0.0, 2.0, 0.0, 3.0);
        let t = split_tiles(&b, 1.0, 100);
        assert_eq!(t.len(), 6, "2x3 = 6 tasselli attesi");
        // ogni tassello sta DENTRO il bbox e non è degenere
        for (s, w, n, e) in &t {
            assert!(*s >= 0.0 && *n <= 2.0 && *w >= 0.0 && *e <= 3.0, "tassello fuori dai limiti");
            assert!(*n > *s && *e > *w, "tassello degenere");
        }
    }

    #[test]
    fn split_tiles_respects_max_cap() {
        // 10x10 gradi con lato 0.5 darebbe 400 tasselli: il tetto deve allargare il passo.
        let b = bbox(0.0, 10.0, 0.0, 10.0);
        let t = split_tiles(&b, 0.5, 16);
        assert!(!t.is_empty() && t.len() <= 16, "atteso <=16 tasselli, trovati {}", t.len());
    }

    #[test]
    fn split_tiles_handles_reversed_and_tiny() {
        // coordinate invertite (s>n, w>e) gestite via min/max
        let b = bbox(2.0, 0.0, 3.0, 0.0);
        let t = split_tiles(&b, 1.0, 100);
        assert_eq!(t.len(), 6);
        for (s, w, n, e) in &t {
            assert!(*s >= 0.0 && *n <= 2.0 && *w >= 0.0 && *e <= 3.0);
        }
        // area minuscola → almeno un tassello
        let tiny = split_tiles(&bbox(45.0, 45.001, 11.0, 11.001), 1.5, 120);
        assert_eq!(tiny.len(), 1);
    }

    #[test]
    fn html_to_text_removes_scripts_and_styles() {
        let html = r#"<html><head><style>.x{color:red}</style></head>
        <body><h1>Hotel Test</h1><script>var kids = 'tracking';</script>
        <p>Benvenuti.</p></body></html>"#;
        let text = html_to_text(html).to_lowercase();
        assert!(text.contains("benvenuti"));
        assert!(!text.contains("var kids"));
        assert!(!text.contains("color:red"));
    }

    #[test]
    fn detects_family_signals_with_verified_proof() {
        let html = r#"<html><body>
            <p>Il nostro Miniclub è aperto tutti i giorni dalle 9 alle 18 per bambini dai 3 anni.</p>
            <p>Disponiamo di una piscina per bambini riscaldata e di camere familiari spaziose.</p>
            <p>Su richiesta offriamo servizio babysitting.</p>
        </body></html>"#;
        let pages = vec![("https://esempio-hotel.it".to_string(), html_to_text(html))];
        let (score, signals) = score_pages(&pages);

        let get = |k: &str| signals.iter().find(|s| s.key == k).unwrap();
        assert!(get("kids_club").present, "miniclub non rilevato");
        assert!(get("kids_facilities").present, "piscina bimbi non rilevata");
        assert!(get("family_rooms").present, "camere familiari non rilevate");
        assert!(get("childcare").present, "babysitting non rilevato");

        // la prova deve essere una frase reale del sito (verbatim)
        let kc = get("kids_club");
        let quote = kc.quote.as_ref().unwrap();
        assert!(quote.to_lowercase().contains("miniclub"));
        assert!(verify_verbatim(quote, &pages), "citazione non verificata");

        // reviews = futuro -> mai presente
        assert!(!get("reviews").present);
        // i 4 segnali presenti valgono almeno 22+18+14+12 = 66 (il dizionario ampliato può aggiungerne)
        assert!(score >= 66, "score atteso >= 66, ottenuto {score}");
    }

    #[test]
    fn no_signal_no_score() {
        let html = "<html><body><p>Hotel in centro città, vicino alla stazione.</p></body></html>";
        let pages = vec![("https://x.it".to_string(), html_to_text(html))];
        let (score, signals) = score_pages(&pages);
        assert_eq!(score, 0);
        assert!(signals.iter().all(|s| !s.present));
    }

    // Test LIVE (rete reale). Eseguire a mano: `cargo test -- --ignored live_discover_small_area`
    #[test]
    #[ignore]
    fn live_discover_small_area() {
        let n = tauri::async_runtime::block_on(async {
            let c = http_client().unwrap();
            let bbox = nominatim_bbox(&c, "Ortisei").await.unwrap();
            let hotels = overpass_hotels(&c, &bbox).await.unwrap();
            for h in hotels.iter().take(5) {
                println!("- {} | {:?}", h.name, h.website);
            }
            hotels.len()
        });
        println!("LIVE: {} hotel trovati a Ortisei", n);
        assert!(n > 0);
    }

    // Prova EMPIRICA sul database REALE: replica enrich_batch (leggi 24 non valutati → scarica+valuta
    // in parallelo → scrivi in una transazione) e misura il tempo + quanti vengono valutati. Conferma
    // che la valutazione PROGREDISCE e non si blocca. `cargo test -- --ignored live_enrich_real_batch --nocapture`
    #[test]
    #[ignore]
    fn live_enrich_real_batch() {
        use rusqlite::Connection;
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
        tauri::async_runtime::block_on(async {
            let conn = Connection::open(&path).unwrap();
            conn.busy_timeout(Duration::from_secs(30)).unwrap();
            let before: i64 = conn
                .query_row("SELECT COUNT(*) FROM hotels WHERE family_fit_score IS NOT NULL", [], |r| r.get(0))
                .unwrap();
            let items: Vec<(String, i64, String)> = {
                let mut stmt = conn
                    .prepare("SELECT osm_type, osm_id, website FROM hotels WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>'' ORDER BY osm_id LIMIT 24")
                    .unwrap();
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .unwrap()
                    .map(|x| x.unwrap())
                    .collect()
            };
            println!("blocco di {} hotel; scaricando in parallelo…", items.len());
            let t0 = Instant::now();
            let mut handles = Vec::new();
            for (ot, oid, website) in items {
                handles.push(tauri::async_runtime::spawn(async move {
                    let client = enrich_client();
                    let start = Instant::now();
                    let (pages, _email, _price) = match tokio::time::timeout(Duration::from_secs(16), gather_pages(client, &website)).await {
                        Ok(r) => r,
                        Err(_) => (Vec::new(), None, None),
                    };
                    let (score, _signals) = score_pages(&pages);
                    (ot, oid, pages.len(), score, start.elapsed().as_secs_f64(), website)
                }));
            }
            let mut scored = Vec::new();
            for h in handles {
                scored.push(h.await.unwrap());
            }
            let fetch_secs = t0.elapsed().as_secs_f64();
            // scrivi in transazione
            let tw = Instant::now();
            {
                let mut c2 = Connection::open(&path).unwrap();
                c2.busy_timeout(Duration::from_secs(30)).unwrap();
                let tx = c2.transaction().unwrap();
                for (ot, oid, _n, score, _el, _w) in &scored {
                    tx.execute("UPDATE hotels SET family_fit_score=?3, updated_at=datetime('now') WHERE osm_type=?1 AND osm_id=?2", rusqlite::params![ot, oid, score]).unwrap();
                }
                tx.commit().unwrap();
            }
            let write_secs = tw.elapsed().as_secs_f64();
            for (_, _, n, score, el, w) in &scored {
                println!("  {el:5.1}s pagine={n} voto={score}  {w}");
            }
            let after: i64 = conn
                .query_row("SELECT COUNT(*) FROM hotels WHERE family_fit_score IS NOT NULL", [], |r| r.get(0))
                .unwrap();
            println!(
                "FETCH+VALUTA {} hotel in {:.1}s (parallelo) · SCRITTURA {:.2}s · valutati: {} → {} (+{})",
                scored.len(), fetch_secs, write_secs, before, after, after - before
            );
            assert!(after > before, "nessun hotel valutato: la pipeline è ferma");
            assert!(fetch_secs < 20.0, "il blocco ci ha messo troppo: {fetch_secs:.1}s");
        });
    }

    // Prova che un sito MORTO/lento non blocca la valutazione: il client dedicato (connect 6s) +
    // il tetto di 16s su gather_pages devono far rientrare il tutto ben sotto i 16s.
    // `cargo test -- --ignored enrich_dead_host_is_bounded --nocapture`
    #[test]
    #[ignore]
    fn enrich_dead_host_is_bounded() {
        tauri::async_runtime::block_on(async {
            let start = Instant::now();
            let res = tokio::time::timeout(
                Duration::from_secs(16),
                gather_pages(enrich_client(), "http://10.255.255.1/"),
            )
            .await;
            let elapsed = start.elapsed();
            println!("dead host: elapsed={:?} timed_out={}", elapsed, res.is_err());
            // deve terminare per connect_timeout (~6s per fetch), MAI vicino/oltre i 16s
            assert!(elapsed < Duration::from_secs(15), "ha quasi raggiunto il tetto: {:?}", elapsed);
            if let Ok((pages, _, _)) = res {
                assert!(pages.is_empty(), "host morto non dovrebbe dare pagine");
            }
        });
    }

    // Diagnostica fetch grezzo: `cargo test -- --ignored live_fetch_debug --nocapture`
    #[test]
    #[ignore]
    fn live_fetch_debug() {
        tauri::async_runtime::block_on(async {
            let c = http_client().unwrap();
            for u in [
                "https://www.greif.it",
                "https://www.laurin.it",
                "https://www.cavallino-bianco.com",
            ] {
                match c.get(u).send().await {
                    Ok(r) => println!("{:<32} status={} final={}", u, r.status(), r.url()),
                    Err(e) => println!("{:<32} ERRORE: {}", u, e),
                }
            }
        });
    }

    // Diagnostica punteggi su hotel reali: `cargo test -- --ignored live_score_samples --nocapture`
    #[test]
    #[ignore]
    fn live_score_samples() {
        let sites = [
            ("Cavallino Bianco (family BZ)", "https://www.cavallino-bianco.com"),
            ("Feuerstein (family)", "https://www.feuerstein.info"),
            ("Sonnwies (family)", "https://www.sonnwies.com"),
            ("Schwarzenstein (family)", "https://www.schwarzenstein.com"),
            ("Hotel Greif Bolzano (city)", "https://www.greif.it"),
            ("Parkhotel Laurin (city lux)", "https://www.laurin.it"),
        ];
        tauri::async_runtime::block_on(async {
            let c = http_client().unwrap();
            for (name, url) in sites {
                let (pages, email, price) = gather_pages(&c, url).await;
                let chars: usize = pages.iter().map(|(_, t)| t.chars().count()).sum();
                let (score, signals) = score_pages(&pages);
                let present: Vec<&str> =
                    signals.iter().filter(|s| s.present).map(|s| s.key.as_str()).collect();
                let price_s = price.map(|p| format!("liv.{} {:?} «{}»", p.tier, p.eur, p.src));
                println!(
                    "{:<30} score={:>3} pagine={} testo={:>6} email={:?} prezzo={:?} segnali={:?}",
                    name, score, pages.len(), chars, email, price_s, present
                );
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        });
    }

    // Prova LIVE mondiale: `cargo test -- --ignored live_discover_world --nocapture`
    #[test]
    #[ignore]
    fn live_discover_world() {
        let places = [
            "Queenstown, New Zealand",
            "Cancun, Mexico",
            "Zanzibar, Tanzania",
            "Reykjavik, Iceland",
            "Bariloche, Argentina",
            "Phuket, Thailand",
        ];
        tauri::async_runtime::block_on(async {
            let c = http_client().unwrap();
            for p in places {
                match nominatim_bbox(&c, p).await {
                    Ok(b) => match overpass_hotels(&c, &b).await {
                        Ok(h) => println!(
                            "{:<26} -> {:>4} hotel | es: {}",
                            p,
                            h.len(),
                            h.first().map(|x| x.name.as_str()).unwrap_or("-")
                        ),
                        Err(e) => println!("{:<26} -> overpass err: {}", p, e),
                    },
                    Err(e) => println!("{:<26} -> nominatim err: {}", p, e),
                }
                std::thread::sleep(std::time::Duration::from_millis(1300));
            }
        });
    }
}
