// Database locale SQLite (bundled). Nessun server, nessun cloud.
// Il backup = un singolo file .sqlite esportabile/importabile (vedi MASTER.md §8).

use crate::engine::Hotel;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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

#[tauri::command]
pub fn import_backup(app: AppHandle, path: String) -> Result<(), String> {
    let dst = db_path(&app)?;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&path, &dst).map_err(|e| e.to_string())?;
    Ok(())
}
