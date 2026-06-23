// Motore di scoperta: Nominatim (bounding box del luogo) -> Overpass (hotel da OpenStreetMap).
// Copertura mondiale, gratuita. I dati family verranno derivati in v0.2 dal sito ufficiale,
// con citazione verbatim verificata (vedi MASTER.md §5).

use serde::Serialize;
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
        .build()
        .map_err(|e| e.to_string())
}

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

async fn overpass_hotels(client: &reqwest::Client, b: &Bbox) -> Result<Vec<Hotel>, String> {
    let q = format!(
        "[out:json][timeout:90];(node[\"tourism\"=\"hotel\"]({s},{w},{n},{e});way[\"tourism\"=\"hotel\"]({s},{w},{n},{e});relation[\"tourism\"=\"hotel\"]({s},{w},{n},{e}););out center tags;",
        s = b.s, w = b.w, n = b.n, e = b.e
    );
    let resp = client
        .post("https://overpass-api.de/api/interpreter")
        .form(&[("data", q.as_str())])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let elements = v
        .get("elements")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();

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
