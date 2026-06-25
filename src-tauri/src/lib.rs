mod db;
mod engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            engine::discover,
            engine::osm_hotel_count,
            engine::list_subareas,
            engine::discover_area,
            engine::enrich_hotel,
            engine::enrich_batch,
            engine::translate,
            db::list_hotels,
            db::count_hotels,
            db::areas_scanned_within,
            db::osm_counts,
            db::get_reviews,
            db::review_counts,
            db::import_reviews,
            engine::backfill_stars,
            db::count_select,
            db::select_hotels,
            db::score_stats,
            db::score_histogram,
            db::list_unscored,
            db::coverage_by_country,
            db::set_contact,
            db::contact_stats,
            db::export_backup,
            db::import_backup,
            db::write_text_file,
            db::read_text_file,
            db::import_ai_scores,
            db::open_report,
            db::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
