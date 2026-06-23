// Motore Kidotel Radar.
// SCOPRI: Nominatim (bbox del luogo) -> Overpass (hotel da OpenStreetMap). Mondiale, gratis.
// ARRICCHISCI/VALUTA (v0.2): crawl del sito ufficiale + riconoscitore family multilingue
// "a regole" (nessuna API). Ogni segnale family esiste solo se accompagnato dalla frase
// citata sul sito e RI-VERIFICATA carattere per carattere (MASTER.md §5). Niente dati inventati.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Clone)]
pub struct Hotel {
    pub osm_type: String,
    pub osm_id: i64,
    pub name: String,
    pub city: Option<String>,
    pub country: Option<String>,
    pub website: Option<String>,
    pub phone: Option<String>,
    pub source: String,
    pub lat: f64,
    pub lon: f64,
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
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

// ---------- SCOPRI ----------

struct Bbox {
    s: f64,
    n: f64,
    w: f64,
    e: f64,
    label: String,
}

async fn nominatim_bbox(client: &reqwest::Client, query: &str) -> Result<Bbox, String> {
    let resp = client
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[("q", query), ("format", "json"), ("limit", "1")])
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
    Ok(Bbox { s, n, w, e, label })
}

// Più server Overpass in cascata: se uno è sovraccarico/non risponde JSON, prova il successivo.
const OVERPASS_ENDPOINTS: &[&str] = &[
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async fn overpass_query(client: &reqwest::Client, q: &str) -> Result<Vec<Value>, String> {
    let mut last = String::from("nessun endpoint disponibile");
    for ep in OVERPASS_ENDPOINTS {
        match client.post(*ep).form(&[("data", q)]).send().await {
            Ok(resp) => {
                let ok = resp.status().is_success();
                let text = resp.text().await.unwrap_or_default();
                if !ok {
                    last = format!("{ep} ha risposto con un errore (forse sovraccarico)");
                    continue;
                }
                match serde_json::from_str::<Value>(&text) {
                    Ok(v) => {
                        return Ok(v
                            .get("elements")
                            .and_then(|e| e.as_array())
                            .cloned()
                            .unwrap_or_default());
                    }
                    Err(_) => {
                        last = format!("{ep} ha restituito una risposta non valida (probabile sovraccarico)");
                        continue;
                    }
                }
            }
            Err(e) => {
                last = e.to_string();
                continue;
            }
        }
    }
    Err(format!(
        "Server OpenStreetMap (Overpass) momentaneamente non disponibile — riprova tra qualche secondo. Dettaglio: {last}"
    ))
}

async fn overpass_hotels(client: &reqwest::Client, b: &Bbox) -> Result<Vec<Hotel>, String> {
    let q = format!(
        "[out:json][timeout:90];(node[\"tourism\"=\"hotel\"]({s},{w},{n},{e});way[\"tourism\"=\"hotel\"]({s},{w},{n},{e});relation[\"tourism\"=\"hotel\"]({s},{w},{n},{e}););out center tags;",
        s = b.s, w = b.w, n = b.n, e = b.e
    );
    let elements = overpass_query(client, &q).await?;

    let mut hotels = Vec::new();
    for el in elements {
        let tags = el.get("tags");
        let name = match tags.and_then(|t| t.get("name")).and_then(|x| x.as_str()) {
            Some(n) if !n.trim().is_empty() => n.to_string(),
            _ => continue, // niente nome -> scartato (niente dati inventati)
        };
        let get = |k: &str| {
            tags.and_then(|t| t.get(k))
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        };
        let website = get("website").or_else(|| get("contact:website")).or_else(|| get("url"));
        let phone = get("phone").or_else(|| get("contact:phone"));
        let city = get("addr:city");
        let country = get("addr:country");
        let osm_type = el.get("type").and_then(|x| x.as_str()).unwrap_or("node").to_string();
        let osm_id = el.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
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
            osm_type,
            osm_id,
            name,
            city,
            country,
            website,
            phone,
            source: "OpenStreetMap".to_string(),
            lat,
            lon,
        });
    }
    hotels.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(hotels)
}

#[tauri::command]
pub async fn discover(app: tauri::AppHandle, query: String) -> Result<DiscoverResult, String> {
    let client = http_client()?;
    let bbox = nominatim_bbox(&client, &query).await?;
    let hotels = overpass_hotels(&client, &bbox).await?;
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

// ---------- ARRICCHISCI / VALUTA ----------

struct SignalDef {
    key: &'static str,
    weight: u32,
    patterns: &'static [&'static str],
}

// Pesi come da MASTER.md §6 (reviews = futuro, sempre assente per ora -> max attuale 94/100).
const SIGNALS: &[SignalDef] = &[
    SignalDef { key: "kids_club", weight: 22, patterns: &[
        "miniclub", "mini club", "mini-club", "baby club", "babyclub", "kids club", "kids' club",
        "children's club", "kinderclub", "kinderbetreuung", "kinderanimation", "animazione bambini",
        "animazione per bambini", "club bimbi", "junior club", "club enfants", "club infantil",
    ]},
    SignalDef { key: "kids_facilities", weight: 18, patterns: &[
        "piscina per bambini", "piscina bambini", "piscina baby", "vasca bambini", "kinderbecken",
        "kids pool", "children's pool", "baby pool", "splash", "parco acquatico", "waterpark",
        "water park", "scivoli", "playground", "parco giochi", "area giochi", "spielplatz",
        "sala giochi", "play area", "kids area", "giochi per bambini",
    ]},
    SignalDef { key: "family_rooms", weight: 14, patterns: &[
        "camera familiare", "camere familiari", "camera famiglia", "family room", "family rooms",
        "familienzimmer", "camere comunicanti", "connecting rooms", "suite famiglia", "family suite",
        "habitación familiar", "chambre familiale", "appartamenti per famiglie",
    ]},
    SignalDef { key: "childcare", weight: 12, patterns: &[
        "babysitting", "baby sitting", "baby-sitting", "babysitter", "baby sitter",
        "assistenza bimbi", "assistenza neonati", "tagesmutter", "nursery", "krippe",
        "garde d'enfants", "guardería", "childcare", "nanny",
    ]},
    SignalDef { key: "kids_dining", weight: 10, patterns: &[
        "menù bambini", "menu bambini", "menù per bambini", "menu per bambini", "menù bimbi",
        "kids menu", "kids' menu", "children's menu", "kindermenü", "kinderbuffet", "seggiolone",
        "seggioloni", "high chair", "high chairs", "menu enfant", "menú infantil", "sala pappe",
    ]},
    SignalDef { key: "activities_age", weight: 10, patterns: &[
        "attività per bambini", "attività per famiglie", "intrattenimento per bambini",
        "entertainment for kids", "age-appropriate", "adatto ai bambini", "per fascia d'età",
        "fasce d'età", "altersgerecht", "activités pour enfants", "programma per bambini",
        "laboratori per bambini",
    ]},
    SignalDef { key: "safety", weight: 8, patterns: &[
        "recinzione piscina", "pool fence", "bagnino", "lifeguard", "sicurezza bambini",
        "ambiente sicuro", "child safe", "kindersicher", "copri prese",
    ]},
    SignalDef { key: "reviews", weight: 6, patterns: &[] }, // futuro: sentiment recensioni genitori
];

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
    for def in SIGNALS {
        let mut found: Option<(String, String)> = None;
        if !def.patterns.is_empty() {
            for (sent, url) in &tagged {
                let sl = sent.to_lowercase();
                if def.patterns.iter().any(|p| sl.contains(p)) && verify_verbatim(sent, pages) {
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
            key: def.key.to_string(),
            weight: def.weight,
            present,
            quote,
            url,
        });
    }
    (score, signals)
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
    let lower = html.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut out: Vec<String> = Vec::new();
    let mut start = 0;
    while let Some(pos) = lower[start..].find("href") {
        let mut j = start + pos + 4;
        while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'=') {
            j += 1;
        }
        if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
            let q = bytes[j];
            j += 1;
            let s = j;
            while j < bytes.len() && bytes[j] != q {
                j += 1;
            }
            if s <= j && j <= html.len() {
                let href = &html[s..j];
                let href_l = &lower[s..j];
                if FAMILY_HREF_HINTS.iter().any(|h| href_l.contains(h)) {
                    if let Ok(abs) = base.join(href) {
                        if abs.host_str() == base.host_str() {
                            let a = abs.to_string();
                            if a != base.as_str() && !out.contains(&a) {
                                out.push(a);
                            }
                        }
                    }
                }
            }
            start = j + 1;
        } else {
            start = j;
        }
    }
    out.truncate(3);
    out
}

async fn gather_pages(client: &reqwest::Client, base_url: &str) -> Vec<(String, String)> {
    let mut pages = Vec::new();
    let base = match reqwest::Url::parse(base_url) {
        Ok(u) => u,
        Err(_) => return pages,
    };
    if robots_blocks_root(client, &base).await {
        return pages;
    }
    if let Some(home) = fetch(client, base.as_str()).await {
        let links = extract_family_links(&home, &base);
        pages.push((base.to_string(), html_to_text(&home)));
        for l in links.into_iter().take(2) {
            if let Some(h) = fetch(client, &l).await {
                pages.push((l, html_to_text(&h)));
            }
        }
    }
    pages
}

fn absent_signals() -> Vec<SignalResult> {
    SIGNALS
        .iter()
        .map(|d| SignalResult {
            key: d.key.to_string(),
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
    let client = http_client()?;
    let pages = gather_pages(&client, &website).await;
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
    }

    Ok(EnrichResult {
        website_ok,
        pages_fetched: pages.len() as u32,
        family_fit_score: score,
        signals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // 22 + 18 + 14 + 12 = 66
        assert_eq!(score, 66);
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
                let pages = gather_pages(&c, url).await;
                let chars: usize = pages.iter().map(|(_, t)| t.chars().count()).sum();
                let (score, signals) = score_pages(&pages);
                let present: Vec<&str> =
                    signals.iter().filter(|s| s.present).map(|s| s.key.as_str()).collect();
                println!(
                    "{:<30} score={:>3} pagine={} testo={:>6} segnali={:?}",
                    name, score, pages.len(), chars, present
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
