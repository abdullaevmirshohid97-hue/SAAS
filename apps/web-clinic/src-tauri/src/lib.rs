mod printing;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance BIRINCHI bo'lishi shart. Deep-link (clary://) ochilganda
        // ishlab turgan instansiyaga yuboradi (yangi oyna ochilmaydi), oynani fokus qiladi.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        // Deep-link (Google OAuth qaytishi: clary://auth-callback#access_token=...).
        .plugin(tauri_plugin_deep_link::init())
        // Tashqi havolalarni tizim brauzerida ochish (webview ichida emas) + OAuth URL.
        .plugin(tauri_plugin_opener::init())
        // Imzolangan auto-update (latest.json + ed25519).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Auto-update qo'llanganda qayta ishga tushirish.
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Dev'da (installer ishga tushmagan) scheme'ni runtime'da ro'yxatga olish.
            // Prod (NSIS) allaqachon ro'yxatga oladi — bu zararsiz.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        // Faqat kerakli native buyruqlar (printer). fs/shell/process IPC YO'Q.
        .invoke_handler(tauri::generate_handler![
            printing::list_printers,
            printing::list_printers_detailed,
            printing::print_thermal,
            printing::print_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("Clary desktop ilovasini ishga tushirishda xato");
}
