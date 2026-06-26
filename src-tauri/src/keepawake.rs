// «Tieni sveglio» durante una scansione. Problema: i cicli di scansione girano nella WebView; quando lo
// schermo va in screen saver la finestra viene occlusa e macOS la mette sotto App Nap / throttling → il
// ciclo si ferma e la scansione non finisce di notte. Soluzione: mentre una scansione è attiva teniamo
// sveglio il Mac con `caffeinate` (incl. `-u` = utente attivo → niente screen saver), così la finestra
// resta visibile e i cicli continuano. L'asserzione si rilascia appena tutte le scansioni finiscono.
//
// È best-effort e solo macOS: se `caffeinate` non c'è o fallisce, la scansione prosegue comunque.
use std::process::Child;
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct KeepAwake(Mutex<Option<Child>>);

#[tauri::command]
pub fn keep_awake_start(state: State<KeepAwake>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(()); // già attivo
    }
    #[cfg(target_os = "macos")]
    {
        // -d display, -i idle sistema, -m disco, -s sistema (AC), -u utente attivo (blocca lo screen saver),
        // -t 24h (ri-armato a ogni nuova scansione). `.ok()`: se fallisce, niente assertion ma si prosegue.
        *guard = std::process::Command::new("caffeinate")
            .args(["-dimsu", "-t", "86400"])
            .spawn()
            .ok();
    }
    Ok(())
}

#[tauri::command]
pub fn keep_awake_stop(state: State<KeepAwake>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
