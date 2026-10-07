fn main() {
    // Ilova buyruqlari uchun ACL: interfeys masofadan (https://app.clary.uz)
    // yuklanadi — Tauri masofaviy sahifaga faqat capabilities'da aniq ruxsat
    // berilgan buyruqlarni ochadi (allow-<buyruq>, capabilities/default.json).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_printers",
            "list_printers_detailed",
            "print_thermal",
            "print_pdf",
        ]),
    ))
    .expect("tauri-build xatosi");
}
