// =============================================================================
// Silent termal print — tizim/USB printerga to'g'ridan-to'g'ri ESC/POS yuborish.
// Brauzer print dialogi YO'Q. Frontend `printReceiptHybrid` (Tauri ichida) shu
// buyruqni chaqiradi.
//
// ⚠ BUILD ESLATMASI: `send_raw_to_printer()` `printers` crate'iga bog'liq —
// crate versiyasi API'si farq qilsa, FAQAT shu funksiyani moslang. Qolgan
// kod (ESC/POS yasash) sof va o'zgarmaydi.
// =============================================================================

use serde::Deserialize;

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
