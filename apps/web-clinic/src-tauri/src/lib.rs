mod agent;
mod printing;

use tauri::Manager;

/// Interfeys serverdan (https://app.clary.uz) yuklanadi. Oyna shu domendan
/// boshqa saytga o'tib ketmasin — tashqi havolalar (to'lov, hujjat, sayt)
/// tizim brauzerida ochiladi. tauri://, blob:, data: va dev localhost — ruxsat.
fn allow_in_app(url: &tauri::Url) -> bool {
    match url.scheme() {
        "http" | "https" => matches!(
            url.host_str(),
            Some("app.clary.uz") | Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")
        ),
        _ => true,
    }
}

fn nav_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("clary-nav-guard")
        .on_navigation(|_webview, url| {
            if allow_in_app(url) {
                return true;
            }
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            false
        })
        .build()
}

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
        // Faqat app.clary.uz oynada; boshqa havolalar — tizim brauzerida.
        .plugin(nav_guard())
        .setup(|app| {
            // Dev'da (installer ishga tushmagan) scheme'ni runtime'da ro'yxatga olish.
            // Prod (NSIS) allaqachon ro'yxatga oladi — bu zararsiz.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
                // Faza 4 — brauzer print-agent (127.0.0.1:7777) fon oqimida.
                agent::start(app.handle().clone());
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
