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
  // Xodim ma'lumotlari ko'rinish toggles
  show_doctor: boolean;            // Shifokor ismi
  show_doctor_specialty: boolean;  // Shifokor mutaxassisligi
  show_cashier: boolean;           // Kassir ismi
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
  show_doctor: true,
  show_doctor_specialty: true,
  show_cashier: false,
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
  // Xodim ma'lumotlari — sozlamadan toggle bilan ko'rinadi/yashiriladi
  doctorName?: string | null;
  doctorSpecialty?: string | null;
  cashierName?: string | null;
}): string {
  const settings = getReceiptSettings();
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  const itemRows = d.items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</td><td class="r">${fmt(it.amount)}</td></tr>`,
    )
    .join('');

  // Xodim qatorlari (sozlamadan boshqariladi)
  const staffLines: string[] = [];
  if (settings.show_doctor && d.doctorName) {
    staffLines.push(
      `<div class="row"><span class="label">Shifokor:</span><span>${esc(d.doctorName)}</span></div>`,
    );
  }
  if (settings.show_doctor_specialty && d.doctorSpecialty) {
    staffLines.push(
      `<div class="row"><span class="label">Mutaxassislik:</span><span>${esc(d.doctorSpecialty)}</span></div>`,
    );
  }
  if (settings.show_cashier && d.cashierName) {
    staffLines.push(
      `<div class="row"><span class="label">Kassir:</span><span>${esc(d.cashierName)}</span></div>`,
    );
  }
  const staffBlock = staffLines.length
    ? `<div class="line"></div>${staffLines.join('')}`
    : '';

  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="center muted small">TO'LOV CHEKI</div>
    <div class="line"></div>
    <div class="row"><span class="label">Sana:</span><span>${esc(d.date)}</span></div>
    <div class="row"><span class="label">Bemor:</span><span>${esc(d.patientName || '—')}</span></div>
    ${d.ticketNo ? `<div class="row"><span class="label">Navbat:</span><span class="bold">${esc(d.ticketNo)}</span></div>` : ''}
    ${staffBlock}
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

// =============================================================================
// A4 hujjat chop etish — to'liq varaq (repchek / rasmiy chek uchun).
// printReceipt'ga o'xshash yashirin iframe, lekin @page A4.
// =============================================================================
export function printA4Document(bodyHtml: string, title = 'Chek'): void {
  const css = `
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    .muted { color: #666; }
    .small { font-size: 11px; }
    .right { text-align: right; }
    .center { text-align: center; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
    .line { border-top: 1px solid #000; margin: 10px 0; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 8px 0 14px; }
    .meta .k { color: #666; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f3f4f6; font-size: 12px; }
    td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
    .totals { margin-top: 12px; margin-left: auto; width: 280px; }
    .totals .row { display: flex; justify-content: space-between; padding: 3px 0; }
    .totals .grand { font-weight: 700; border-top: 1px solid #000; margin-top: 4px; padding-top: 6px; }
    .foot { margin-top: 28px; color: #666; font-size: 11px; }
  `;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const cleanup = () => setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 1000);
  const doPrint = () => {
    const win = iframe.contentWindow;
    if (!win) { cleanup(); return; }
    setTimeout(() => {
      try { win.focus(); win.print(); }
      catch (e) { console.error('A4 print xato:', e); alert("Chop etish xato. Ctrl+P bilan urinib ko'ring."); }
      finally { cleanup(); }
    }, 250);
  };
  const doc = iframe.contentDocument;
  if (!doc) { document.body.removeChild(iframe); return; }
  iframe.onload = doPrint;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => { if (iframe.parentNode) doPrint(); }, 2000);
}

/** Tranzaksiya cheki — A4 hujjat HTML (repchek). */
export function transactionReceiptA4Html(d: {
  clinicName: string;
  date: string;
  patientName: string;
  patientPhone?: string | null;
  doctorName?: string | null;
  cashierName?: string | null;
  paymentMethod?: string | null;
  transactionId: string;
  items: Array<{ name: string; qty: number; unitPrice: number; discount: number; amount: number }>;
  totalUzs: number;
  paidUzs: number;
  debtUzs: number;
}): string {
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  const rows = d.items
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${esc(it.name)}</td><td class="r">${it.qty}</td><td class="r">${fmt(it.unitPrice)}</td><td class="r">${fmt(it.discount)}</td><td class="r">${fmt(it.amount)}</td></tr>`,
    )
    .join('');
  return `
    <div class="head">
      <div><h1>${esc(d.clinicName)}</h1><div class="muted small">TO'LOV CHEKI (nusxa)</div></div>
      <div class="right small muted">№ ${esc(d.transactionId)}<br/>${esc(d.date)}</div>
    </div>
    <div class="meta">
      <div><span class="k">Bemor:</span> <b>${esc(d.patientName || '—')}</b></div>
      ${d.patientPhone ? `<div><span class="k">Telefon:</span> ${esc(d.patientPhone)}</div>` : '<div></div>'}
      ${d.doctorName ? `<div><span class="k">Shifokor:</span> ${esc(d.doctorName)}</div>` : ''}
      ${d.cashierName ? `<div><span class="k">Kassir:</span> ${esc(d.cashierName)}</div>` : ''}
      ${d.paymentMethod ? `<div><span class="k">To'lov usuli:</span> ${esc(d.paymentMethod)}</div>` : ''}
    </div>
    <table>
      <thead><tr><th>#</th><th>Xizmat</th><th class="r">Soni</th><th class="r">Narx</th><th class="r">Chegirma</th><th class="r">Summa</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Jami:</span><span>${fmt(d.totalUzs)} so'm</span></div>
      <div class="row"><span>To'langan:</span><span>${fmt(d.paidUzs)} so'm</span></div>
      ${d.debtUzs > 0 ? `<div class="row"><span>Qarz:</span><span>${fmt(d.debtUzs)} so'm</span></div>` : ''}
      <div class="row grand"><span>Yakuniy:</span><span>${fmt(d.totalUzs)} so'm</span></div>
    </div>
    <div class="foot">Bu hujjat chek nusxasi sifatida qayta chop etilgan. Sana: ${esc(d.date)}</div>
  `;
}

/** Statsionar chiqish cheki HTML — yakuniy hisob-kitob (ovqat/qarovchi alohida). */
export function inpatientDischargeReceiptHtml(d: {
  clinicName: string;
  date: string;
  patientName: string;
  roomLabel?: string | null;
  doctorName?: string | null;
  days: number;
  roomDailyUzs?: number;
  mealDailyUzs?: number;
  attendantDailyUzs?: number;
  totalRoomUzs?: number;
  totalMealUzs?: number;
  totalAttendantUzs?: number;
  attendantName?: string | null;
  totalDailyUzs: number;
  totalServicesUzs: number;
  totalDepositedUzs: number;
  balanceUzs: number; // + depozit qoldig'i, − qarz
}): string {
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  const debt = d.balanceUzs < 0 ? Math.abs(d.balanceUzs) : 0;
  const deposit = d.balanceUzs > 0 ? d.balanceUzs : 0;
  const meal = Number(d.totalMealUzs ?? 0);
  const attendant = Number(d.totalAttendantUzs ?? 0);
  const room = Number(d.totalRoomUzs ?? 0);
  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="center muted small">STATSIONAR — CHIQISH CHEKI</div>
    <div class="line"></div>
    <div class="row"><span class="label">Sana:</span><span>${esc(d.date)}</span></div>
    <div class="row"><span class="label">Bemor:</span><span>${esc(d.patientName || '—')}</span></div>
    ${d.roomLabel ? `<div class="row"><span class="label">Xona:</span><span>${esc(d.roomLabel)}</span></div>` : ''}
    ${d.doctorName ? `<div class="row"><span class="label">Shifokor:</span><span>${esc(d.doctorName)}</span></div>` : ''}
    <div class="row"><span class="label">Davolangan kun:</span><span>${d.days} kun</span></div>
    <div class="line"></div>
    ${room > 0 ? `<div class="row"><span class="label">Xona (${d.days} kun):</span><span>${fmt(room)}</span></div>` : ''}
    ${meal > 0 ? `<div class="row"><span class="label">Ovqat (${d.days} kun):</span><span>${fmt(meal)}</span></div>` : ''}
    ${attendant > 0 ? `<div class="row"><span class="label">Qarovchi${d.attendantName ? ' (' + esc(d.attendantName) + ')' : ''}:</span><span>${fmt(attendant)}</span></div>` : ''}
    ${d.totalServicesUzs > 0 ? `<div class="row"><span class="label">Qo'shimcha xizmatlar:</span><span>${fmt(d.totalServicesUzs)}</span></div>` : ''}
    <div class="line"></div>
    <div class="row bold"><span>Kunlik to'lovlar jami:</span><span>${fmt(d.totalDailyUzs)}</span></div>
    <div class="row"><span class="label">To'langan (depozit):</span><span>${fmt(d.totalDepositedUzs)}</span></div>
    <div class="line"></div>
    ${
      debt > 0
        ? `<div class="row bold"><span>JAMI TO'LOV (QARZ):</span><span>${fmt(debt)} so'm</span></div>`
        : `<div class="row bold"><span>QOLDIQ:</span><span>${fmt(deposit)} so'm</span></div>`
    }
  `;
}
