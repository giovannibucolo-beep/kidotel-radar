mod db;
mod engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            engine::discover,
            engine::enrich_hotel,
            db::list_hotels,
            db::export_backup,
            db::import_backup,
            db::write_text_file,
            db::open_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
