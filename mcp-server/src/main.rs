// Server MCP (stdio, JSON-RPC 2.0) per Kidotel Radar.
// Espone a Cowork/Claude il database SQLite dell'app: interroga hotel e scrive i voti AI,
// senza passare file a mano. Legge lo stesso DB dell'app (override con env KIDOTEL_DB).
//
// Solo JSON-RPC su stdout; eventuali log su stderr. Messaggi delimitati da newline.

use rusqlite::Connection;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY, osm_type TEXT NOT NULL, osm_id INTEGER NOT NULL,
    name TEXT NOT NULL, city TEXT, country TEXT, website TEXT, phone TEXT,
    lat REAL, lon REAL, source TEXT, family_fit_score INTEGER,
    score_breakdown TEXT, enrichment TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT,
    UNIQUE(osm_type, osm_id));";

fn db_path() -> String {
    if let Ok(p) = std::env::var("KIDOTEL_DB") {
        return p;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    format!("{home}/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite")
}

fn open() -> Result<Connection, String> {
    let c = Connection::open(db_path()).map_err(|e| e.to_string())?;
    c.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(c)
}

fn tools_def() -> Value {
    json!([
        {
            "name": "kidotel_stats",
            "description": "Statistiche del database: hotel totali, con sito, valutati, family hotel (>=70).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kidotel_get_unscored",
            "description": "Hotel con sito web e senza voto family-fit, da valutare. Restituisce id, name, website, city, country.",
            "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer", "description": "max risultati (default 50)" } } }
        },
        {
            "name": "kidotel_query_hotels",
            "description": "Hotel gia valutati, ordinati per family-fit decrescente.",
            "inputSchema": { "type": "object", "properties": { "min_score": { "type": "integer" }, "limit": { "type": "integer" } } }
        },
        {
            "name": "kidotel_set_score",
            "description": "Scrive il voto family-fit (0-100) di un hotel, con breakdown opzionale [{key,present,quote,url}]. id = 'osm_type/osm_id'.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "family_fit_score": { "type": "integer" },
                    "breakdown": { "type": "array" }
                },
                "required": ["id", "family_fit_score"]
            }
        }
    ])
}

fn rows_to_json(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql], cols: &[&str]) -> Result<Value, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let n = cols.len();
    let rows = stmt
        .query_map(params, |row| {
            let mut obj = serde_json::Map::new();
            for (i, c) in cols.iter().enumerate() {
                let v = row.get_ref(i).map_err(|_| rusqlite::Error::InvalidQuery)?;
                let jv = match v {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(x) => json!(x),
                    rusqlite::types::ValueRef::Real(x) => json!(x),
                    rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t).to_string()),
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                obj.insert(c.to_string(), jv);
            }
            let _ = n;
            Ok(Value::Object(obj))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(Value::Array(out))
}

fn call_tool(name: &str, args: &Value) -> Result<Value, String> {
    let conn = open()?;
    match name {
        "kidotel_stats" => {
            let mut stmt = conn
                .prepare("SELECT COUNT(*), SUM(website IS NOT NULL AND website<>''), SUM(family_fit_score IS NOT NULL), SUM(family_fit_score>=70) FROM hotels")
                .map_err(|e| e.to_string())?;
            let row = stmt
                .query_row([], |r| {
                    Ok(json!({
                        "totali": r.get::<_, i64>(0)?,
                        "con_sito": r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                        "valutati": r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                        "family_hotel_ge70": r.get::<_, Option<i64>>(3)?.unwrap_or(0)
                    }))
                })
                .map_err(|e| e.to_string())?;
            Ok(row)
        }
        "kidotel_get_unscored" => {
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(50);
            rows_to_json(
                &conn,
                "SELECT (osm_type || '/' || osm_id) AS id, name, website, city, country FROM hotels
                 WHERE website IS NOT NULL AND website<>'' AND family_fit_score IS NULL
                 ORDER BY name COLLATE NOCASE LIMIT ?1",
                &[&limit],
                &["id", "name", "website", "city", "country"],
            )
        }
        "kidotel_query_hotels" => {
            let min = args.get("min_score").and_then(|v| v.as_i64()).unwrap_or(0);
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(100);
            rows_to_json(
                &conn,
                "SELECT (osm_type || '/' || osm_id) AS id, name, website, city, country, family_fit_score FROM hotels
                 WHERE family_fit_score IS NOT NULL AND family_fit_score>=?1
                 ORDER BY family_fit_score DESC, name COLLATE NOCASE LIMIT ?2",
                &[&min, &limit],
                &["id", "name", "website", "city", "country", "family_fit_score"],
            )
        }
        "kidotel_set_score" => {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("manca 'id'")?;
            let (otype, oid) = id.split_once('/').ok_or("id non valido (atteso 'osm_type/osm_id')")?;
            let oid: i64 = oid.parse().map_err(|_| "osm_id non numerico".to_string())?;
            let score = args.get("family_fit_score").and_then(|v| v.as_i64()).unwrap_or(0).clamp(0, 100);
            let breakdown = args.get("breakdown").cloned().unwrap_or_else(|| json!([])).to_string();
            let enrichment = json!({ "website_ok": true, "source": "ai-mcp" }).to_string();
            let changed = conn
                .execute(
                    "UPDATE hotels SET family_fit_score=?3, score_breakdown=?4, enrichment=?5, updated_at=datetime('now')
                     WHERE osm_type=?1 AND osm_id=?2",
                    rusqlite::params![otype, oid, score, breakdown, enrichment],
                )
                .map_err(|e| e.to_string())?;
            Ok(json!({ "updated": changed, "id": id, "family_fit_score": score }))
        }
        other => Err(format!("tool sconosciuto: {other}")),
    }
}

fn send(v: Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{}", v);
    let _ = out.flush();
}

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let id = req.get("id").cloned();

        // notifiche (senza id): non rispondere
        if id.is_none() {
            continue;
        }
        let id = id.unwrap();

        match method {
            "initialize" => {
                let pv = req
                    .get("params")
                    .and_then(|p| p.get("protocolVersion"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("2024-11-05")
                    .to_string();
                send(json!({
                    "jsonrpc": "2.0", "id": id,
                    "result": {
                        "protocolVersion": pv,
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": "kidotel-radar", "version": "0.1.0" }
                    }
                }));
            }
            "ping" => send(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
            "tools/list" => send(json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tools_def() } })),
            "tools/call" => {
                let params = req.get("params").cloned().unwrap_or(json!({}));
                let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match call_tool(name, &args) {
                    Ok(data) => send(json!({
                        "jsonrpc": "2.0", "id": id,
                        "result": { "content": [ { "type": "text", "text": data.to_string() } ], "isError": false }
                    })),
                    Err(e) => send(json!({
                        "jsonrpc": "2.0", "id": id,
                        "result": { "content": [ { "type": "text", "text": format!("Errore: {e}") } ], "isError": true }
                    })),
                }
            }
            _ => send(json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": -32601, "message": format!("metodo non supportato: {method}") }
            })),
        }
    }
}
