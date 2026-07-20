// =============================================================================
// Silent termal print — tizim/USB printerga to'g'ridan-to'g'ri ESC/POS yuborish.
// Brauzer print dialogi YO'Q. Frontend `printReceiptHybrid` (Tauri ichida) shu
// buyruqni chaqiradi.
//
// ⚠ BUILD ESLATMASI: `send_raw_to_printer()` `printers` crate'iga bog'liq —
// crate versiyasi API'si farq qilsa, FAQAT shu funksiyani moslang. Qolgan
// kod (ESC/POS yasash) sof va o'zgarmaydi.
// =============================================================================

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct ReceiptLine {
    pub text: String,
    #[serde(default)]
    pub align: Option<String>, // "left" | "center" | "right"
    #[serde(default)]
    pub bold: Option<bool>,
    #[serde(default)]
    pub double: Option<bool>,
}

#[derive(Deserialize)]
pub struct ReceiptItem {
    pub name: String,
    #[serde(default)]
    pub qty: Option<f64>,
    #[serde(default)]
    pub amount: Option<f64>,
}

// Frontend `ThermalReceiptContent` bilan mos (JSON kalitlari aynan bir xil).
#[derive(Deserialize)]
pub struct ThermalContent {
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub subheader: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub lines: Option<Vec<ReceiptLine>>,
    #[serde(default)]
    pub items: Option<Vec<ReceiptItem>>,
    #[serde(default)]
    pub total_uzs: Option<f64>,
    #[serde(default)]
    pub paid_uzs: Option<f64>,
    #[serde(default)]
    pub debt_uzs: Option<f64>,
    #[serde(default)]
    pub footer: Option<String>,
    #[serde(default)]
    pub qr: Option<String>,
    #[serde(default)]
    pub cut: Option<bool>,
}

// ─── ESC/POS baytlari ────────────────────────────────────────────────────────
const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

fn align_code(a: &Option<String>) -> u8 {
    match a.as_deref() {
        Some("center") => 1,
        Some("right") => 2,
        _ => 0,
    }
}

fn push_line(buf: &mut Vec<u8>, text: &str, align: u8, bold: bool, double: bool) {
    buf.extend_from_slice(&[ESC, b'a', align]); // hizalash
    buf.extend_from_slice(&[ESC, b'E', if bold { 1 } else { 0 }]); // qalin
    buf.extend_from_slice(&[GS, b'!', if double { 0x11 } else { 0x00 }]); // ikki barobar
    buf.extend_from_slice(text.as_bytes());
    buf.push(b'\n');
    // qalin/double'ni qaytarish
    buf.extend_from_slice(&[ESC, b'E', 0, GS, b'!', 0x00]);
}

fn fmt_money(n: f64) -> String {
    // 1 234 567 ko'rinishida (mingliklar bo'sh joy bilan)
    let s = format!("{}", n.round() as i64);
    let neg = s.starts_with('-');
    let digits: Vec<char> = s.trim_start_matches('-').chars().collect();
    let mut out = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(' ');
        }
        out.push(*c);
    }
    if neg {
        format!("-{out}")
    } else {
        out
    }
}

fn build_escpos(content: &ThermalContent, width: usize) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::new();
    buf.extend_from_slice(&[ESC, b'@']); // init

    if let Some(h) = &content.header {
        push_line(&mut buf, h, 1, true, true);
    }
    if let Some(s) = &content.subheader {
        push_line(&mut buf, s, 1, false, false);
    }
    if let Some(t) = &content.title {
        push_line(&mut buf, "", 0, false, false);
        push_line(&mut buf, t, 1, true, false);
    }

    if let Some(lines) = &content.lines {
        for l in lines {
            push_line(
                &mut buf,
                &l.text,
                align_code(&l.align),
                l.bold.unwrap_or(false),
                l.double.unwrap_or(false),
            );
        }
    }

    if let Some(items) = &content.items {
        push_line(&mut buf, &"-".repeat(width), 0, false, false);
        for it in items {
            let qty = it.qty.unwrap_or(1.0);
            let amount = it.amount.unwrap_or(0.0);
            let left = if qty > 1.0 {
                format!("{} x{}", it.name, qty as i64)
            } else {
                it.name.clone()
            };
            let right = fmt_money(amount);
            push_line(&mut buf, &pad_row(&left, &right, width), 0, false, false);
        }
        push_line(&mut buf, &"-".repeat(width), 0, false, false);
    }

    if let Some(total) = content.total_uzs {
        push_line(&mut buf, &pad_row("JAMI", &format!("{} so'm", fmt_money(total)), width), 0, true, false);
    }
    if let Some(paid) = content.paid_uzs {
        push_line(&mut buf, &pad_row("To'landi", &fmt_money(paid), width), 0, false, false);
    }
    if let Some(debt) = content.debt_uzs {
        if debt.abs() > 0.5 {
            push_line(&mut buf, &pad_row("Qarz", &fmt_money(debt), width), 0, true, false);
        }
    }

    // QR (GS ( k — model 2). Chekdagi havola: bemor skaner qilib chekni onlayn
    // ochadi. Eski printerlar QR buyrug'ini bilmasa e'tiborsiz qoldiradi.
    if let Some(qr) = &content.qr {
        let data = qr.as_bytes();
        let store_len = data.len() + 3;
        buf.push(b'\n');
        buf.extend_from_slice(&[ESC, b'a', 1]); // markazga
        buf.extend_from_slice(&[GS, b'(', b'k', 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); // model 2
        buf.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x43, 0x06]); // module size 6
        buf.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x45, 0x31]); // EC level M
        buf.extend_from_slice(&[
            GS, b'(', b'k',
            (store_len & 0xff) as u8,
            ((store_len >> 8) & 0xff) as u8,
            0x31, 0x50, 0x30,
        ]);
        buf.extend_from_slice(data);
        buf.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x51, 0x30]); // print
        push_line(&mut buf, "Chekni onlayn tekshirish: QR skaner qiling", 1, false, false);
        buf.extend_from_slice(&[ESC, b'a', 0]);
    }

    if let Some(f) = &content.footer {
        push_line(&mut buf, "", 0, false, false);
        push_line(&mut buf, f, 1, false, false);
    }

    // qog'oz uzatish
    buf.extend_from_slice(&[b'\n', b'\n', b'\n']);
    // kesish (full cut)
    if content.cut.unwrap_or(true) {
        buf.extend_from_slice(&[GS, b'V', 0x00]);
    }
    buf
}

// Chap matn + o'ng matn — kenglikka qarab bo'shliq bilan to'ldirish.
fn pad_row(left: &str, right: &str, width: usize) -> String {
    let used = left.chars().count() + right.chars().count();
    if used >= width {
        format!("{left} {right}")
    } else {
        let gap = width - used;
        format!("{left}{}{right}", " ".repeat(gap))
    }
}

// ─── Native buyruqlar ────────────────────────────────────────────────────────

/// Tizimdagi printerlar ro'yxati (sozlamada tanlash uchun).
#[tauri::command]
pub fn list_printers() -> Vec<String> {
    printers::get_printers()
        .into_iter()
        .map(|p| p.name)
        .collect()
}

/// Printer holati (Faza 2b — monitoring). `online` = OFFLINE emas (Windows
/// drayverlar ko'pincha UNKNOWN qaytaradi — u ONLINE deb qaraladi, aks holda
/// hamma printer "offline" ko'rinardi). `state`: ready|printing|paused|offline|unknown.
#[derive(Serialize)]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
    pub online: bool,
    pub state: String,
}

/// Printerlar + holati (online/offline, default). Sozlamada nuqta ko'rsatish uchun.
#[tauri::command]
pub fn list_printers_detailed() -> Vec<PrinterInfo> {
    use printers::common::base::printer::PrinterState;
    printers::get_printers()
        .into_iter()
        .map(|p| {
            let state = match p.state {
                PrinterState::READY => "ready",
                PrinterState::PRINTING => "printing",
                PrinterState::PAUSED => "paused",
                PrinterState::OFFLINE => "offline",
                PrinterState::UNKNOWN => "unknown",
            };
            PrinterInfo {
                name: p.name,
                is_default: p.is_default,
                online: !matches!(p.state, PrinterState::OFFLINE),
                state: state.to_string(),
            }
        })
        .collect()
}

/// Chekni tanlangan printerga ESC/POS sifatida yuborish (silent, dialogsiz).
#[tauri::command]
pub fn print_thermal(
    printer_name: String,
    content: ThermalContent,
    paper_width: String,
) -> Result<(), String> {
    // 58mm ≈ 32 belgi, 80mm ≈ 48 belgi (oddiy shrift uchun).
    let width = if paper_width.starts_with("58") { 32 } else { 48 };
    let bytes = build_escpos(&content, width);
    send_raw_to_printer(&printer_name, &bytes)
}

/// ⚠ `printers` crate'ga bog'liq yagona joy — versiya farq qilsa shu funksiyani moslang.
fn send_raw_to_printer(name: &str, bytes: &[u8]) -> Result<(), String> {
    let printer = printers::get_printer_by_name(name)
        .ok_or_else(|| format!("Printer topilmadi: {name}"))?;
    printer
        .print(bytes, printers::common::base::job::PrinterJobOptions::none())
        .map(|_| ())
        .map_err(|e| format!("Chop etishda xato: {e:?}"))
}

// ─── A4 / PDF silent print ───────────────────────────────────────────────────

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// A4/PDF hujjatni tanlangan printerga SILENT chop etish (dialogsiz, previewsiz).
/// Frontend base64 PDF yuboradi (html2canvas + jsPDF). Windows: bundlangan
/// SumatraPDF (`-print-to -silent`); mac/Linux: `lp -d` (CUPS).
#[tauri::command]
pub fn print_pdf(
    app: tauri::AppHandle,
    printer_name: String,
    pdf_base64: String,
) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pdf_base64.trim())
        .map_err(|e| format!("PDF dekod xato: {e}"))?;

    let mut path = std::env::temp_dir();
    path.push(format!("clary-print-{}-{}.pdf", std::process::id(), now_millis()));
    std::fs::write(&path, &bytes).map_err(|e| format!("Vaqtinchalik fayl xato: {e}"))?;
    let file = path.to_string_lossy().to_string();

    let result = do_print_pdf(&app, &printer_name, &file);
    let _ = std::fs::remove_file(&path);
    result
}

#[cfg(target_os = "windows")]
fn do_print_pdf(app: &tauri::AppHandle, printer: &str, file: &str) -> Result<(), String> {
    use tauri::Manager;
    let sumatra = app
        .path()
        .resolve("resources/SumatraPDF.exe", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("SumatraPDF topilmadi: {e}"))?;
    let status = std::process::Command::new(&sumatra)
        .args(["-print-to", printer, "-silent", "-exit-when-done", file])
        .status()
        .map_err(|e| format!("SumatraPDF ishga tushmadi: {e}"))?;
    if !status.success() {
        return Err("SumatraPDF chop eta olmadi".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn do_print_pdf(_app: &tauri::AppHandle, printer: &str, file: &str) -> Result<(), String> {
    let status = std::process::Command::new("lp")
        .args(["-d", printer, file])
        .status()
        .map_err(|e| format!("lp ishga tushmadi: {e}"))?;
    if !status.success() {
        return Err("lp chop eta olmadi".into());
    }
    Ok(())
}
