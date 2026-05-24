// =============================================================================
// Termal chek chop etish — 2 yo'l:
//
// 1) LAN ESC/POS (silent) — sozlanagan tarmoq printer'ga server orqali raw
//    bytes yuborish. Brauzer dialog YO'Q.
// 2) Brauzer print (fallback) — iframe ichida window.print(). Dialog
//    ko'rinadi, lekin USB/Windows printerlar uchun yagona yo'l.
//
// printReceiptHybrid(content, fallbackHtml) — avval LAN'ga uringan, kerak
// bo'lsa brauzerga tushadi.
// =============================================================================

import { api } from './api';

// Backend kutadigan content tuzilmasi (api-client tipi bilan mos).
export type ThermalReceiptContent = {
  header?: string;
  subheader?: string;
  title?: string;
  lines?: Array<{ text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; double?: boolean }>;
  items?: Array<{ name: string; qty?: number; amount?: number }>;
  total_uzs?: number;
  paid_uzs?: number;
  debt_uzs?: number;
  footer?: string;
  qr?: string;
  cut?: boolean;
};

/**
 * Hybrid print: avval LAN ESC/POS bilan urinib ko'r (silent), agar printer
 * yo'q yoki xato bo'lsa, brauzer iframe orqali print qiladi (dialog bilan).
 *
 * @returns true — LAN orqali yuborildi, false — brauzer fallback ishlatildi
 */
export async function printReceiptHybrid(
  content: ThermalReceiptContent,
  fallbackHtml: string,
  kind: 'queue_ticket' | 'receipt' | 'other' = 'receipt',
): Promise<{ method: 'lan' | 'browser'; jobId?: string }> {
  // 1) LAN printer borligini tekshirish (silent)
  try {
    const printers = await api.printers.list();
    const hasDefaultLan = (printers ?? []).some(
      (p) => p.is_default && p.is_active && p.connection_type === 'lan' && p.ip_address,
    );
    if (hasDefaultLan) {
      // Backend ESC/POS bytes yaratadi va default LAN printer'ga yuboradi
      const result = await api.printers.print({ kind, content });
      // Server muvaffaqiyatli yuborgan bo'lsa, brauzer dialogi ko'rinmaydi
      return { method: 'lan', jobId: (result as { job_id?: string })?.job_id };
    }
  } catch (e) {
    // LAN xatosi — silent fail, brauzerga tushamiz
    console.warn('[print] LAN print failed, fallback to browser:', e);
  }

  // 2) Fallback — brauzer iframe orqali
  printReceipt(fallbackHtml);
  return { method: 'browser' };
}

// =============================================================================
// Termal chek chop etish — 58mm / 80mm qog'oz (brauzer iframe).
// Dialog ko'rinadi — bu USB/Windows printerlar uchun yagona yo'l.
// =============================================================================

export type ReceiptWidth = '58mm' | '80mm';

// 12 ta font stili (chek printerlarda ham raster mos keladi)
export type ReceiptFontFamily =
  | 'mono_courier'      // Courier (klassik chek)
  | 'mono_jetbrains'    // JetBrains Mono (zamonaviy mono)
  | 'mono_roboto'       // Roboto Mono
  | 'mono_consolas'     // Consolas (Windows)
  | 'sans_inter'        // Inter (zamonaviy sans-serif)
  | 'sans_arial'        // Arial (klassik sans)
  | 'sans_helvetica'    // Helvetica
  | 'sans_verdana'      // Verdana (o'qilishi qulay)
  | 'sans_tahoma'       // Tahoma
  | 'serif_times'       // Times New Roman (klassik kitobiy)
  | 'serif_georgia'     // Georgia (zamonaviy serif)
  | 'serif_garamond';   // Garamond (elegant)

export type ReceiptFontWeight = 'light' | 'normal' | 'medium' | 'bold';
export type ReceiptFontStyle = 'normal' | 'italic';

// Klinika tomonidan sozlanadigan chek printer ko'rinishi.
export type ReceiptSettings = {
  paper_width: ReceiptWidth;
  font_family: ReceiptFontFamily;
  font_size: number; // 8 - 24
  font_weight: ReceiptFontWeight;
  font_style: ReceiptFontStyle;
  line_height: number; // 1.0 - 2.0 (matnlar orasidagi masofa)
  brand_name: string | null;
  slogan: string | null;
  qr_text: string | null;
  qr_enabled: boolean;
  qr_size_mm: number; // QR o'lchami millimetrda (10 - 50)
  show_transaction_id: boolean;
  footer_note: string | null;
};

const DEFAULT_SETTINGS: ReceiptSettings = {
  paper_width: '80mm',
  font_family: 'mono_courier',
  font_size: 12,
  font_weight: 'normal',
  font_style: 'normal',
  line_height: 1.4,
  brand_name: null,
  slogan: null,
  qr_text: null,
  qr_enabled: false,
  qr_size_mm: 25,
  show_transaction_id: false,
  footer_note: "Rahmat! Sog'ligingizga shifo tilaymiz!",
};

// Font CSS xaritasi (12 ta variant)
export const RECEIPT_FONT_FAMILY_CSS: Record<ReceiptFontFamily, string> = {
  mono_courier: "'Courier New', Courier, monospace",
  mono_jetbrains: "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
  mono_roboto: "'Roboto Mono', 'Source Code Pro', monospace",
  mono_consolas: "Consolas, 'Lucida Console', monospace",
  sans_inter: "'Inter', 'Segoe UI', sans-serif",
  sans_arial: "Arial, 'Helvetica Neue', sans-serif",
  sans_helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  sans_verdana: "Verdana, Geneva, sans-serif",
  sans_tahoma: "Tahoma, 'Trebuchet MS', sans-serif",
  serif_times: "'Times New Roman', Times, serif",
  serif_georgia: "Georgia, 'Times New Roman', serif",
  serif_garamond: "Garamond, 'EB Garamond', serif",
};

export const RECEIPT_FONT_FAMILY_LABELS: Record<ReceiptFontFamily, string> = {
  mono_courier: 'Courier (klassik chek)',
  mono_jetbrains: 'JetBrains Mono',
  mono_roboto: 'Roboto Mono',
  mono_consolas: 'Consolas',
  sans_inter: 'Inter (zamonaviy)',
  sans_arial: 'Arial',
  sans_helvetica: 'Helvetica',
  sans_verdana: "Verdana (o'qish qulay)",
  sans_tahoma: 'Tahoma',
  serif_times: 'Times New Roman',
  serif_georgia: 'Georgia',
  serif_garamond: 'Garamond (elegant)',
};

export const RECEIPT_FONT_WEIGHT_CSS: Record<ReceiptFontWeight, number> = {
  light: 300,
  normal: 400,
  medium: 500,
  bold: 700,
};

export const RECEIPT_FONT_WEIGHT_LABELS: Record<ReceiptFontWeight, string> = {
  light: 'Yengil',
  normal: 'Oddiy',
  medium: "O'rta",
  bold: 'Qalin',
};

const WIDTH_KEY = 'clary_receipt_width';
const SETTINGS_KEY = 'clary_receipt_settings';

/** Klinika tanlagan qog'oz kengligini localStorage'dan o'qiydi (default 80mm). */
export function getReceiptWidth(): ReceiptWidth {
  const v = localStorage.getItem(WIDTH_KEY);
  return v === '58mm' ? '58mm' : '80mm';
}

/** Qog'oz kengligini saqlaydi — keyingi safar esda qoladi. */
export function setReceiptWidth(w: ReceiptWidth): void {
  localStorage.setItem(WIDTH_KEY, w);
}

/** Klinika sozlamalarini localStorage'ga keshlash (api'dan kelganda). */
export function setReceiptSettingsCache(s: Partial<ReceiptSettings>): void {
  const merged = { ...getReceiptSettings(), ...s };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  if (merged.paper_width) setReceiptWidth(merged.paper_width);
}

/** Hozirgi sozlamalarni qaytaradi (cache yoki default). */
export function getReceiptSettings(): ReceiptSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, paper_width: getReceiptWidth() };
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

/**
 * QR kod uchun SVG generator — Google Chart API ishlatadi
 * (eng oddiy, offline ishlamaydi, lekin print uchun yetadi).
 * Alternative: qrcode kutubxonasi (paket yuklash kerak).
 */
function qrImgTag(text: string, sizePx = 80): string {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx * 2}x${sizePx * 2}&data=${encodeURIComponent(text)}`;
  return `<img src="${esc(url)}" width="${sizePx}" height="${sizePx}" style="display:block;margin:6px auto" alt="QR" />`;
}

/**
 * Chekni alohida iframe'da chop etadi.
 * Hech qanday dialog ko'rsatmaydi — sozlamalar avtomatik qo'llanadi.
 */
export function printReceipt(
  bodyHtml: string,
  settingsOverride?: Partial<ReceiptSettings>,
): void {
  const settings = { ...getReceiptSettings(), ...settingsOverride };
  const width = settings.paper_width;
  const contentMm = width === '58mm' ? 48 : 72;
  const baseSize = settings.font_size || 12;

  // Yangi font tizimi (12 ta variant)
  const fontFamily =
    RECEIPT_FONT_FAMILY_CSS[settings.font_family as ReceiptFontFamily] ??
    RECEIPT_FONT_FAMILY_CSS.mono_courier;
  const fontWeight = RECEIPT_FONT_WEIGHT_CSS[settings.font_weight as ReceiptFontWeight] ?? 400;
  const fontStyle = settings.font_style ?? 'normal';
  const lineHeight = settings.line_height ?? 1.4;

  const css = `
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      width: ${contentMm}mm;
      /* top right bottom left — chap tomonda ko'proq joy (matn kesilmasin) */
      padding: 3mm 3mm 3mm 6mm;
      font-family: ${fontFamily};
      font-size: ${baseSize}px;
      font-weight: ${fontWeight};
      font-style: ${fontStyle};
      line-height: ${lineHeight};
      color: #000;
      background: #fff;
    }
    .center { text-align: center; }
    .big { font-size: ${baseSize + 14}px; font-weight: 900; }
    .bold { font-weight: 700; }
    .muted { color: #444; }
    .small { font-size: ${Math.max(8, baseSize - 2)}px; }
    .line { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
    .row .label { color: #444; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    .r { text-align: right; }
    .brand { font-size: ${baseSize + 4}px; font-weight: 900; letter-spacing: 1px; }
    .slogan { font-style: italic; }
    @media print {
      body { padding: 2mm 2mm 2mm 6mm; }
      .no-print { display: none !important; }
    }
  `;

  // Brand sarlavhasi (klinika tanlasa)
  const brandHtml = settings.brand_name
    ? `<div class="center brand">${esc(settings.brand_name)}</div>`
    : '';
  const sloganHtml = settings.slogan
    ? `<div class="center muted slogan small">${esc(settings.slogan)}</div>`
    : '';
  // QR o'lcham mm dan px ga (1mm ≈ 3.78px @96dpi)
  const qrSizeMm = settings.qr_size_mm ?? 25;
  const qrSizePx = Math.round(qrSizeMm * 3.78);
  const qrHtml =
    settings.qr_enabled && settings.qr_text
      ? `<div class="line"></div>${qrImgTag(settings.qr_text, qrSizePx)}`
      : '';
  const footerHtml = settings.footer_note
    ? `<div class="center muted small">${esc(settings.footer_note)}</div>`
    : '';

  const finalHtml = `${brandHtml}${sloganHtml}${bodyHtml}${qrHtml}${footerHtml}`;

  // Yashirin iframe — pop-up bloklanmaydi, hech qanday dialog yo'q.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* ignore */
      }
    }, 1000);
  };

  const doPrint = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      requestAnimationFrame(() => {
        // QR rasmni yuklash uchun biroz uzunroq kutamiz
        const delay = settings.qr_enabled ? 800 : 250;
        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch (e) {
            console.error('Print xato:', e);
            alert("Chop etish xato berdi. Brauzeringizdan Ctrl+P bilan urinib ko'ring.");
          } finally {
            cleanup();
          }
        }, delay);
      });
    } catch (e) {
      console.error(e);
      cleanup();
    }
  };

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    alert("Chop etish ramkasi yaratilmadi.");
    return;
  }

  iframe.onload = doPrint;
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Chek</title><style>${css}</style></head><body>${finalHtml}</body></html>`,
  );
  doc.close();

  setTimeout(() => {
    if (iframe.parentNode) doPrint();
  }, 2000);
}

/** Navbat cheki HTML — navbat oynasi uchun. */
export function queueTicketHtml(d: {
  clinicName: string;
  ticketNo: string;
  date: string;
  time: string;
  patientName: string;
  doctorName: string;
  doctorRole: string;
  serviceName?: string;
}): string {
  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="line"></div>
    <div class="center big">${esc(d.ticketNo)}</div>
    <div class="center muted small">NAVBAT RAQAMI</div>
    <div class="line"></div>
    <div class="row"><span class="label">Sana:</span><span>${esc(d.date)}</span></div>
    <div class="row"><span class="label">Vaqt:</span><span>${esc(d.time)}</span></div>
    <div class="line"></div>
    <div class="row"><span class="label">Bemor:</span><span>${esc(d.patientName || '—')}</span></div>
    <div class="line"></div>
    <div class="row"><span class="label">Shifokor:</span><span>${esc(d.doctorName)}</span></div>
    <div class="row"><span class="label">Soha:</span><span>${esc(d.doctorRole)}</span></div>
    ${d.serviceName && d.serviceName !== '—' ? `<div class="row"><span class="label">Xizmat:</span><span>${esc(d.serviceName)}</span></div>` : ''}
    <div class="line"></div>
  `;
}

/** To'lov cheki HTML — qabulxona checkout uchun. */
export function paymentReceiptHtml(d: {
  clinicName: string;
  ticketNo: string | null;
  date: string;
  patientName: string;
  items: Array<{ name: string; qty: number; amount: number }>;
  totalUzs: number;
  paidUzs: number;
  debtUzs: number;
  paymentMethod: string;
  transactionId: string;
}): string {
  const settings = getReceiptSettings();
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  const itemRows = d.items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</td><td class="r">${fmt(it.amount)}</td></tr>`,
    )
    .join('');
  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="center muted small">TO'LOV CHEKI</div>
    <div class="line"></div>
    <div class="row"><span class="label">Sana:</span><span>${esc(d.date)}</span></div>
    <div class="row"><span class="label">Bemor:</span><span>${esc(d.patientName || '—')}</span></div>
    ${d.ticketNo ? `<div class="row"><span class="label">Navbat:</span><span class="bold">${esc(d.ticketNo)}</span></div>` : ''}
    <div class="line"></div>
    <table>${itemRows}</table>
    <div class="line"></div>
    <div class="row bold"><span>JAMI:</span><span>${fmt(d.totalUzs)} so'm</span></div>
    <div class="row"><span class="label">To'landi:</span><span>${fmt(d.paidUzs)} so'm</span></div>
    ${d.debtUzs > 0 ? `<div class="row"><span class="label">Qarz:</span><span>${fmt(d.debtUzs)} so'm</span></div>` : ''}
    <div class="row"><span class="label">To'lov usuli:</span><span>${esc(d.paymentMethod)}</span></div>
    ${settings.show_transaction_id ? `<div class="line"></div><div class="center muted small">№ ${esc(d.transactionId)}</div>` : ''}
  `;
}
