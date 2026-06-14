mod printing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Tashqi havolalarni tizim brauzerida ochish (webview ichida emas).
        .plugin(tauri_plugin_opener::init())
        // Imzolangan auto-update (latest.json + ed25519).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Faqat kerakli native buyruqlar (printer). fs/shell/process YO'Q.
        .invoke_handler(tauri::generate_handler![
            printing::list_printers,
            printing::print_thermal,
        ])
        .run(tauri::generate_context!())
        .expect("Clary desktop ilovasini ishga tushirishda xato");
}
