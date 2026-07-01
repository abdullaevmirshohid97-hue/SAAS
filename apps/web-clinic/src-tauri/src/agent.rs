// =============================================================================
// Faza 4 — Brauzer print-agent. Tauri ilova ichida kichik HTTP server
// (127.0.0.1:7777). Maqsad: klinika app.clary.uz'ni BRAUZERDA ochsa ham, agar
// Clary desktop ilovasi o'rnatilgan/ishlab tursa — chek/A4/label SILENT chiqadi
// (brauzer print dialogi ko'rinmaydi).
//
// ⚠ XAVFSIZLIK (deep):
//  - FAQAT 127.0.0.1 bind — tashqi tarmoqdan (LAN/internet) kirib bo'lmaydi.
//  - Origin allowlist — faqat clary.uz domenlari chaqira oladi (boshqa sayt yo'q).
//  - Body hajmi cheklovi — katta PDF bilan DoS oldini olish.
//  - Faqat print buyruqlari (thermal/pdf). fs/shell/process yo'q.
//  - Xatolar yutiladi — agent ishlamasa ilova ishlashda davom etadi (fallback).
// =============================================================================

use std::io::Read;

use tiny_http::{Header, Method, Request, Response, Server};

use crate::printing::{self, ThermalContent};

const PORT: u16 = 7777;
const MAX_BODY: usize = 24 * 1024 * 1024; // 24MB — A4 PDF uchun yetarli

/// Faqat shu originlar agentni chaqira oladi.
fn origin_allowed(origin: &str) -> bool {
    matches!(
        origin,
        "https://app.clary.uz"
            | "https://clary.uz"
            | "https://www.clary.uz"
            // Desktop webview o'zi (odatda to'g'ridan invoke ishlatadi, ehtiyot uchun).
            | "tauri://localhost"
            | "http://tauri.localhost"
    )
}

/// Agent'ni fon oqimida ishga tushirish. Bind bo'lmasa (port band) — jim chiqadi.
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[agent] 127.0.0.1:{PORT} bind bo'lmadi (ehtimol band): {e}");
                return;
            }
        };
        eprintln!("[agent] print-agent 127.0.0.1:{PORT} da tinglayapti");
        for req in server.incoming_requests() {
            handle(&app, req);
        }
    });
}

fn header_value(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn json_ct() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()
}

fn cors_headers(origin: &str) -> Vec<Header> {
    vec![
        Header::from_bytes(b"Access-Control-Allow-Origin".as_ref(), origin.as_bytes()).unwrap(),
        Header::from_bytes(b"Access-Control-Allow-Methods".as_ref(), b"GET, POST, OPTIONS".as_ref())
            .unwrap(),
        Header::from_bytes(b"Access-Control-Allow-Headers".as_ref(), b"Content-Type".as_ref())
            .unwrap(),
        // Chrome Private Network Access (public sayt → localhost) uchun.
        Header::from_bytes(b"Access-Control-Allow-Private-Network".as_ref(), b"true".as_ref())
            .unwrap(),
    ]
}

type Body = std::io::Cursor<Vec<u8>>;

fn json_response(origin: &str, status: u16, body: String) -> Response<Body> {
    let mut resp = Response::from_string(body).with_status_code(status).with_header(json_ct());
    if origin_allowed(origin) {
        for h in cors_headers(origin) {
            resp.add_header(h);
        }
    }
    resp
}

fn handle(app: &tauri::AppHandle, mut req: Request) {
    let origin = header_value(&req, "Origin").unwrap_or_default();
    let url = req.url().to_string();
    let method = req.method().clone();

    // CORS preflight.
    if method == Method::Options {
        let mut resp = Response::empty(204);
        if origin_allowed(&origin) {
            for h in cors_headers(&origin) {
                resp.add_header(h);
            }
        }
        let _ = req.respond(resp);
        return;
    }

    // Health — brauzer agent bor-yo'qligini tekshiradi.
    if method == Method::Get && url.starts_with("/health") {
        let _ = req.respond(json_response(
            &origin,
            200,
            r#"{"ok":true,"app":"clary-desktop"}"#.to_string(),
        ));
        return;
    }

    // Bundan keyin — faqat ruxsat etilgan origin.
    if !origin_allowed(&origin) {
        let _ = req.respond(json_response(&origin, 403, r#"{"ok":false,"error":"forbidden"}"#.to_string()));
        return;
    }
    if method != Method::Post {
        let _ = req.respond(json_response(&origin, 405, r#"{"ok":false,"error":"method"}"#.to_string()));
        return;
    }

    // Body (cheklangan hajm).
    let mut body = String::new();
    {
        let mut limited = req.as_reader().take(MAX_BODY as u64);
        if limited.read_to_string(&mut body).is_err() {
            let _ = req.respond(json_response(&origin, 400, r#"{"ok":false,"error":"body"}"#.to_string()));
            return;
        }
    }

    let result = if url.starts_with("/print/thermal") {
        do_thermal(&body)
    } else if url.starts_with("/print/pdf") {
        do_pdf(app, &body)
    } else {
        let _ = req.respond(json_response(&origin, 404, r#"{"ok":false,"error":"not found"}"#.to_string()));
        return;
    };

    let resp = match result {
        Ok(()) => json_response(&origin, 200, r#"{"ok":true}"#.to_string()),
        Err(e) => json_response(
            &origin,
            500,
            serde_json::json!({ "ok": false, "error": e }).to_string(),
        ),
    };
    let _ = req.respond(resp);
}

/// Printer nomi bo'sh bo'lsa — tizim standart printeriga tushamiz.
fn resolve_printer(name: String) -> String {
    if !name.is_empty() {
        return name;
    }
    printers::get_printers()
        .into_iter()
        .find(|p| p.is_default)
        .map(|p| p.name)
        .unwrap_or_default()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThermalReq {
    #[serde(default)]
    printer_name: String,
    content: ThermalContent,
    #[serde(default = "default_width")]
    paper_width: String,
}

fn default_width() -> String {
    "80mm".to_string()
}

fn do_thermal(body: &str) -> Result<(), String> {
    let r: ThermalReq = serde_json::from_str(body).map_err(|e| format!("JSON xato: {e}"))?;
    printing::print_thermal(resolve_printer(r.printer_name), r.content, r.paper_width)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfReq {
    #[serde(default)]
    printer_name: String,
    pdf_base64: String,
}

fn do_pdf(app: &tauri::AppHandle, body: &str) -> Result<(), String> {
    let r: PdfReq = serde_json::from_str(body).map_err(|e| format!("JSON xato: {e}"))?;
    printing::print_pdf(app.clone(), resolve_printer(r.printer_name), r.pdf_base64)
}
