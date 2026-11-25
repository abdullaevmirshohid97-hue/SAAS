// =============================================================================
// Chek va A4 hujjat chop etish:
//
// 0) Desktop (Tauri) — kompyuter printerlariga DIALOGSIZ (desktop-print.ts).
// 1) LAN ESC/POS (silent) — sozlanagan tarmoq printer'ga server orqali raw
//    bytes yuborish. Brauzer dialog YO'Q.
// 2) Brauzer print (fallback) — iframe ichida window.print(). Dialog
//    ko'rinadi (brauzerda boshqa yo'l yo'q).
//
// printReceiptHybrid(content, fallbackHtml) — yo'llarni shu tartibda sinaydi.
// =============================================================================

import { api } from './api';
import { isTauri } from './platform';
import { barcodeSvg } from './labels';
import { agentHealthy, agentPrintThermal, agentPrintPdf } from './print-agent';
import {
  agentPrintReceiptRaster,
  thermalTextContent,
  printerGeometry,
  desktopPrintA4Html,
  desktopPrintReceiptOnOffice,
  desktopPrintThermal,
  desktopReceiptOfficeJob,
  desktopThermalJob,
  type DesktopPrintJob,
  type ReceiptDoc,
} from './desktop-print';
import { isThermalName } from './desktop-printer';

// Bemor portali — chekdagi QR skaner qilinganda public chek shu yerda ochiladi
// (lab natija /r/<token> bilan bir xil pattern, chek uchun /t/<token>).
const PATIENT_PORTAL_URL =
  (import.meta.env.VITE_PATIENT_URL as string | undefined) ?? 'https://patient.clary.uz';

/**
 * Tranzaksiya uchun public chek havolasi (patient.clary.uz/t/<token>).
 * Chekka QR sifatida bosiladi — bemor telefonida skaner qilib chekni onlayn
 * ochadi va to'lov/qarz holatini keyin ham tekshiraveradi.
 * Xato/ruxsat yo'q bo'lsa null — chek QR'siz chiqaveradi (fail-soft).
 */
export async function fetchReceiptPublicUrl(transactionId: string): Promise<string | null> {
  try {
    const { token } = await api.transactions.publicToken(transactionId);
    return token ? `${PATIENT_PORTAL_URL}/t/${token}` : null;
  } catch {
    return null;
  }
}

/**
 * QR'ni lokal inline SVG sifatida chizish — internet/rasm yuklashsiz, print
 * uchun ishonchli (html2canvas/A4 CORS muammosi ham yo'q). qrcode.react
 * komponentini statik markup'ga aylantiramiz (lazy chunk).
 */
async function qrSvgHtml(text: string, sizePx: number): Promise<string> {
  const [{ QRCodeSVG }, { renderToStaticMarkup }, React] = await Promise.all([
    import('qrcode.react'),
    import('react-dom/server'),
    import('react'),
  ]);
  return renderToStaticMarkup(
    React.createElement(QRCodeSVG, { value: text, size: sizePx, level: 'M', marginSize: 1 }),
  );
}

/**
 * Chek pastiga qo'shiladigan "onlayn tekshirish" QR bloki (HTML).
 * Havola olinmasa yoki QR chizilmasa bo'sh satr — chek buzilmaydi.
 */
export async function receiptQrBlockHtml(transactionId: string, sizePx = 96): Promise<string> {
  const url = await fetchReceiptPublicUrl(transactionId);
  // Bot satri QR'dan MUSTAQIL chiqadi: havola olinmasa ham bemor botni topsin.
  const bot = patientBotLineHtml();
  if (!url) return bot;
  try {
    const svg = await qrSvgHtml(url, sizePx);
    return (
      `<div style="margin-top:10px;text-align:center">${svg}` +
      `<div style="font-size:10px;color:#444;margin-top:2px">Chekni onlayn tekshirish: QR skaner qiling</div></div>` +
      bot
    );
  } catch {
    return bot;
  }
}

/**
 * Chek tagidagi bemor boti satri.
 *
 * NEGA QR EMAS, matn: chekdagi QR allaqachon onlayn chek sahifasiga ketadi va
 * uni botga burish "loginsiz chekni ko'rish" imkonini yo'q qilardi. Ikkita QR
 * esa termal chekda joy yeydi. Bot manzili yozilganda bemor uni qidiruvdan
 * topadi va telefon raqamini ulashadi — bot raqam bo'yicha o'zi qaysi
 * klinikalarda kartasi borligini topib bog'laydi, ya'ni deep-link shart emas.
 */
export function patientBotLineHtml(): string {
  const bot = (import.meta.env.VITE_PATIENT_BOT as string | undefined) ?? 'Clary_app_bot';
  if (!bot) return '';
  return (
    `<div style="margin-top:8px;text-align:center;font-size:10px;color:#222;line-height:1.35">` +
    `<b>Telegram: t.me/${bot}</b><br/>` +
    `Tahlil javobi · online navbat · davolanish tarixi` +
    `</div>`
  );
}

// Backend kutadigan content tuzilmasi (api-client tipi bilan mos).
export type ThermalReceiptContent = {
  header?: string;
  subheader?: string;
  title?: string;
  lines?: Array<{
    text: string;
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    double?: boolean;
  }>;
  items?: Array<{ name: string; qty?: number; amount?: number }>;
  total_uzs?: number;
  paid_uzs?: number;
  debt_uzs?: number;
  /** Jami ostidagi qatorlar (to'lov usuli va h.k.). */
  after?: Array<{
    text: string;
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    double?: boolean;
  }>;
  footer?: string;
  qr?: string;
  cut?: boolean;
};

/**
 * Hybrid print — printer dialogisiz yo'llar ketma-ket sinaladi:
 *   0) Desktop (Tauri): kompyuterdagi termal printer (rasm/ESC/POS);
 *   0b) Brauzer + Clary desktop print-agent (127.0.0.1:7777);
 *   1) LAN printer (server ESC/POS);
 *   2) Desktop: termal printer yo'q — chek A4/standart printerdan (PDF);
 *   3) oxirgi chora — brauzer iframe (dialog).
 */
// Brauzer + agent yo'li uchun tanlangan printer nomlari (Sozlamalar → Termal printerlar).
const DESKTOP_PRINTER_KEY = 'clary.desktop.printer';
const DESKTOP_A4_PRINTER_KEY = 'clary.desktop.printer.a4';

/** A4 hujjat CSS'i — brauzer chop etish va desktop silent yo'li uchun bir xil. */
const A4_CSS = `
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

function a4DocumentHtml(bodyHtml: string, title: string, screenPadding = false): string {
  // Silent yo'lda HTML ekranda chiziladi — @page chetlari ishlamaydi, shuning uchun
  // body'ga ichki chet beriladi (PDF'da sahifa chetlari alohida qo'yiladi).
  const extra = screenPadding ? 'body { padding: 6mm 8mm; width: 794px; }' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${A4_CSS}${extra}</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * A4 hujjatni dialogsiz chop etish: desktop (Tauri) — A4 printer avtomatik
 * tanlanadi; brauzer + desktop agent — agent orqali. Aks holda `false`.
 */
async function tryDesktopPrintA4(bodyHtml: string, title: string): Promise<boolean> {
  const docHtml = a4DocumentHtml(bodyHtml, title, true);
  if (isTauri()) return desktopPrintA4Html(docHtml);
  if (!(await agentHealthy())) return false;
  try {
    const printerName =
      localStorage.getItem(DESKTOP_A4_PRINTER_KEY) ??
      localStorage.getItem(DESKTOP_PRINTER_KEY) ??
      '';
    const [{ renderHtmlDocument }, jspdfMod] = await Promise.all([
      import('./escpos-raster'),
      import('jspdf'),
    ]);
    const canvas = await renderHtmlDocument(docHtml, 794, 794 * 2, 300);
    const JsPDF = (jspdfMod as { jsPDF: new (o?: unknown) => import('jspdf').jsPDF }).jsPDF;
    const pdf = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
    const imgW = 194;
    const imgH = (canvas.height * imgW) / canvas.width;
    const dataUrl = canvas.toDataURL('image/png');
    let heightLeft = imgH;
    pdf.addImage(dataUrl, 'PNG', 8, 8, imgW, imgH);
    heightLeft -= 281;
    while (heightLeft > 0) {
      pdf.addPage();
      pdf.addImage(dataUrl, 'PNG', 8, 8 - (imgH - heightLeft), imgW, imgH);
      heightLeft -= 281;
    }
    const base64 = pdf.output('datauristring').split(',')[1] ?? '';
    return !!base64 && (await agentPrintPdf(printerName, base64));
  } catch (e) {
    console.warn('[print] agent A4 print failed, fallback to browser:', e);
    return false;
  }
}

export async function printReceiptHybrid(
  content: ThermalReceiptContent,
  fallbackHtml: string,
  kind: 'queue_ticket' | 'receipt' | 'other' = 'receipt',
  fallbackSettings?: Partial<ReceiptSettings>,
  opts?: { transactionId?: string },
): Promise<{ method: 'tauri' | 'lan' | 'browser'; jobId?: string }> {
  // Chek QR — bemor telefonida onlayn tekshiradigan havola. Fail-soft: havola
  // olinmasa chek QR'siz chiqaveradi (chop etish hech qachon bloklanmaydi).
  if (opts?.transactionId && !content.qr) {
    const url = await fetchReceiptPublicUrl(opts.transactionId);
    if (url) {
      content = { ...content, qr: url };
      const mm = fallbackSettings?.qr_size_mm ?? getReceiptSettings().qr_size_mm ?? 25;
      try {
        const svg = await qrSvgHtml(url, Math.round(mm * 3.78));
        fallbackHtml +=
          `<div class="line"></div><div class="center">${svg}</div>` +
          `<div class="center muted small">Chekni onlayn tekshirish: QR skaner qiling</div>`;
      } catch {
        /* QR chizilmasa chek baribir chiqadi */
      }
    }
  }

  const doc = buildReceiptDoc(fallbackHtml, fallbackSettings);

  // 0) Desktop (Tauri) — kompyuterdagi termal printer (silent, dialogsiz)
  if (isTauri() && (await desktopPrintThermal(doc, content))) return { method: 'tauri' };

  // 0b) Brauzer + Clary desktop print-agent (127.0.0.1:7777) — silent (Faza 4).
  //     Foydalanuvchi app.clary.uz'ni brauzerda ochgan, lekin desktop ilova ishlab tursa.
  //     Faqat chek printeri ANIQ tanlangan bo'lsa: bo'sh nom = Windows standart
  //     printeri, u A4 bo'lsa ESC/POS baytlari varaq-varaq "axlat" bo'lib chiqardi.
  if (!isTauri() && (await agentHealthy())) {
    let printerName = '';
    try {
      printerName = localStorage.getItem(DESKTOP_PRINTER_KEY) ?? '';
    } catch {
      /* ignore */
    }
    if (printerName && isThermalName(printerName)) {
      if (await agentPrintReceiptRaster(printerName, doc)) return { method: 'tauri' };
      const { cols } = printerGeometry(printerName, doc.paper);
      if (
        await agentPrintThermal(
          printerName,
          thermalTextContent(content, doc.paper, cols),
          doc.paper,
        )
      ) {
        return { method: 'tauri' };
      }
    }
  }

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

  // 2) Desktop — termal printer yo'q: chek A4/standart printerdan (dialogsiz)
  if (isTauri() && (await desktopPrintReceiptOnOffice(doc))) return { method: 'tauri' };

  // 3) Oxirgi chora — brauzer iframe orqali (profil sozlamalari bilan)
  printReceiptDocInIframe(doc);
  return { method: 'browser' };
}

// =============================================================================
// Termal chek chop etish — 58mm / 80mm qog'oz (brauzer iframe).
// Dialog ko'rinadi — bu USB/Windows printerlar uchun yagona yo'l.
// =============================================================================

export type ReceiptWidth = '58mm' | '80mm';

// 12 ta font stili (chek printerlarda ham raster mos keladi)
export type ReceiptFontFamily =
  | 'mono_courier' // Courier (klassik chek)
  | 'mono_jetbrains' // JetBrains Mono (zamonaviy mono)
  | 'mono_roboto' // Roboto Mono
  | 'mono_consolas' // Consolas (Windows)
  | 'sans_inter' // Inter (zamonaviy sans-serif)
  | 'sans_arial' // Arial (klassik sans)
  | 'sans_helvetica' // Helvetica
  | 'sans_verdana' // Verdana (o'qilishi qulay)
  | 'sans_tahoma' // Tahoma
  | 'serif_times' // Times New Roman (klassik kitobiy)
  | 'serif_georgia' // Georgia (zamonaviy serif)
  | 'serif_garamond'; // Garamond (elegant)

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
  show_doctor: boolean; // Shifokor ismi
  show_doctor_specialty: boolean; // Shifokor mutaxassisligi
  show_cashier: boolean; // Kassir ismi
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
  sans_verdana: 'Verdana, Geneva, sans-serif',
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

// ---------------------------------------------------------------------------
// DORIXONA chek profili — alohida (lokal). Sozlanmagan bo'lsa klinika
// sozlamalariga tushadi (default identik). Dorixona savdosi shu profil bilan
// chop etadi; sozlamalar /settings/pharmacy-printer sahifasida.
// ---------------------------------------------------------------------------
const PHARMACY_SETTINGS_KEY = 'clary_receipt_settings_pharmacy';

/** Dorixona chek sozlamalari (lokal profil ustiga klinika sozlamasi asos). */
export function getPharmacyReceiptSettings(): ReceiptSettings {
  const base = getReceiptSettings();
  try {
    const raw = localStorage.getItem(PHARMACY_SETTINGS_KEY);
    if (raw) return { ...base, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return base;
}

/** Dorixona chek profilini lokal saqlash. */
export function setPharmacyReceiptSettings(s: Partial<ReceiptSettings>): void {
  const merged = { ...getPharmacyReceiptSettings(), ...s };
  localStorage.setItem(PHARMACY_SETTINGS_KEY, JSON.stringify(merged));
}

/** Dorixona profili lokal sozlanganmi (yo'q bo'lsa klinikaga tayanadi). */
export function hasPharmacyReceiptOverride(): boolean {
  return !!localStorage.getItem(PHARMACY_SETTINGS_KEY);
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

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
 * Chek HTML hujjati (klinika chek sozlamalari bilan). Brauzer iframe ham,
 * desktop silent yo'li ham AYNAN shu hujjatni chizadi.
 */
export function buildReceiptDoc(
  bodyHtml: string,
  settingsOverride?: Partial<ReceiptSettings>,
): ReceiptDoc {
  const settings = { ...getReceiptSettings(), ...settingsOverride };
  const width: ReceiptWidth = settings.paper_width === '58mm' ? '58mm' : '80mm';
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
    .no-print { display: none !important; }
    /* Yangi chek dizayni (2026-11) — fonsiz (brauzer chop etishda fon tushib
       qoladi), faqat qalin chiziq va shrift bilan ajratiladi. */
    .clinic { font-size: ${baseSize + 6}px; font-weight: 900; line-height: 1.15; }
    .doc-title { letter-spacing: 1px; font-weight: 700; }
    .ticket { border: 2px solid #000; border-radius: 4px; margin: 6px auto; padding: 2px 0;
              text-align: center; width: 70%; }
    .ticket .num { font-size: ${baseSize + 16}px; font-weight: 900; line-height: 1.1; }
    .item { margin: 3px 0; }
    .item .name { font-weight: 700; }
    .item .sub { display: flex; justify-content: space-between; gap: 8px; }
    .item.one { display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; }
    .item.one .name { flex: 1; }
    .amt, .nowrap { white-space: nowrap; }
    .total { display: flex; justify-content: space-between; gap: 8px; margin: 6px 0 4px;
             padding: 4px 0; border-top: 2px solid #000; border-bottom: 2px solid #000;
             font-size: ${baseSize + 4}px; font-weight: 900; }
    .debtbox { border: 2px solid #000; margin: 6px 0; padding: 3px 4px; text-align: center;
               font-weight: 900; font-size: ${baseSize + 2}px; }
    /* Rasm (raster) rejimi: printer o'zi chetsiz bosadi — brauzerdagi 6 mm chap
       chet kerak emas (matn o'ngga surilardi). */
    body.raster { padding: 1.5mm 1mm 2mm 1mm; }
    @media print {
      body { padding: 2mm 2mm 2mm 6mm; }
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
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Chek</title><style>${css}</style></head><body>${finalHtml}</body></html>`,
    paper: width,
    contentMm,
    // QR rasmni yuklash uchun biroz uzunroq kutamiz
    waitMs: settings.qr_enabled ? 800 : 250,
  };
}

/**
 * Chekni chop etadi. Desktop'da — dialogsiz (termal printer, bo'lmasa A4/standart
 * printer); brauzerda — yashirin iframe (window.print).
 */
export function printReceipt(bodyHtml: string, settingsOverride?: Partial<ReceiptSettings>): void {
  void printReceiptAsync(bodyHtml, settingsOverride);
}

export type ReceiptPrintResult =
  | ({ method: 'desktop' } & DesktopPrintJob)
  | { method: 'browser' }
  | { method: 'failed' };

/**
 * `printReceipt` — natijasi bilan (sinov tugmalari qaysi printerga ketganini
 * ko'rsatadi). `onlyReceiptPrinter`: chek printeriga chiqmasa A4 printerga yoki
 * brauzer oynasiga O'TMAYDI — sinov aynan chek printerini tekshiradi.
 */
export async function printReceiptAsync(
  bodyHtml: string,
  settingsOverride?: Partial<ReceiptSettings>,
  opts?: { onlyReceiptPrinter?: boolean },
): Promise<ReceiptPrintResult> {
  const doc = buildReceiptDoc(bodyHtml, settingsOverride);
  if (isTauri()) {
    const job =
      (await desktopThermalJob(doc)) ??
      (opts?.onlyReceiptPrinter ? null : await desktopReceiptOfficeJob(doc));
    if (job) return { method: 'desktop', ...job };
    if (opts?.onlyReceiptPrinter) return { method: 'failed' };
  }
  printReceiptDocInIframe(doc);
  return { method: 'browser' };
}

function printReceiptDocInIframe(receipt: ReceiptDoc): void {
  // Yashirin iframe — pop-up bloklanmaydi.
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

  // onload va zaxira taymer ikkalasi chaqiradi — dialog faqat BIR marta
  let started = false;
  const doPrint = () => {
    if (started) return;
    started = true;
    try {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      requestAnimationFrame(() => {
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
        }, receipt.waitMs);
      });
    } catch (e) {
      console.error(e);
      cleanup();
    }
  };

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    alert('Chop etish ramkasi yaratilmadi.');
    return;
  }

  iframe.onload = doPrint;
  doc.open();
  doc.write(receipt.html);
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
    <div class="center" style="margin:4px 0">${barcodeSvg(d.ticketNo, { height: 32, fontSize: 10 })}</div>
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

// =============================================================================
// TO'LOV CHEKI — YAGONA MODEL (2026-11). Bitta ma'lumotdan ikki ko'rinish:
//   • paymentReceiptHtml   → rasm (raster), PDF va brauzer chop etish;
//   • paymentReceiptContent → matnli ESC/POS (eski desktop qobig'i, LAN printer).
// Ilgari har sahifa (qabulxona, kassa, jurnal, qarzdorlar, lab, statsionar)
// matnli variantni QO'LDA yasardi: shifokor/kassir sozlamasi, to'lov usuli va
// pastki yozuv unda hisobga olinmasdi — qog'ozdagi chek ekrandagidan farq qilardi.
// =============================================================================
export type PaymentReceiptData = {
  clinicName: string;
  /** Sarlavha: "TO'LOV CHEKI" (default), "QARZ TO'LOV CHEKI", "TO'LOV CHEKI (nusxa)"… */
  title?: string;
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
  /** Qo'shimcha qatorlar (masalan "Qolgan qarz", "Depozit"). */
  extraRows?: Array<{ label: string; value: string }>;
};

const DEFAULT_TITLE = "TO'LOV CHEKI";
const fmtSum = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

/** Chek raqami — tranzaksiya ID'sining boshidan 8 belgi (qisqa, o'qiladi). */
export function receiptNo(transactionId: string | null | undefined): string {
  return (transactionId ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** Sozlamaga ko'ra ko'rinadigan xodim qatorlari (HTML va matn uchun bir xil). */
function staffRows(d: PaymentReceiptData, settings: ReceiptSettings) {
  const rows: Array<{ label: string; value: string }> = [];
  if (settings.show_doctor && d.doctorName) rows.push({ label: 'Shifokor', value: d.doctorName });
  if (settings.show_doctor_specialty && d.doctorSpecialty) {
    rows.push({ label: 'Mutaxassislik', value: d.doctorSpecialty });
  }
  if (settings.show_cashier && d.cashierName) rows.push({ label: 'Kassir', value: d.cashierName });
  return rows;
}

/** To'lov cheki HTML — qabulxona checkout va boshqa barcha to'lov cheklari. */
export function paymentReceiptHtml(
  d: PaymentReceiptData,
  settingsOverride?: Partial<ReceiptSettings>,
): string {
  // Override — Sozlamalar sahifasidagi SAQLANMAGAN qiymatlar bilan ko'rinish.
  const settings = { ...getReceiptSettings(), ...settingsOverride };
  const no = receiptNo(d.transactionId);
  const row = (label: string, value: string, cls = '') =>
    `<div class="row ${cls}"><span class="label">${esc(label)}:</span><span>${esc(value)}</span></div>`;

  const items = d.items
    .map((it) => {
      const qty = Number(it.qty ?? 1);
      const unit = qty > 0 ? Math.round(Number(it.amount ?? 0) / qty) : Number(it.amount ?? 0);
      // 1 dona — nom va summa bitta qatorda (summa oxirgi qator o'ng chetida);
      // ko'p dona — ostida "2 × 40 000 ........ 80 000".
      if (qty <= 1) {
        return `<div class="item one"><span class="name">${esc(it.name)}</span><span class="amt">${fmtSum(it.amount)}</span></div>`;
      }
      return `<div class="item"><div class="name">${esc(it.name)}</div><div class="sub"><span class="muted">${qty} × ${fmtSum(unit)}</span><span class="amt">${fmtSum(it.amount)}</span></div></div>`;
    })
    .join('');

  const staff = staffRows(d, settings);
  return `
    <div class="center clinic">${esc(d.clinicName)}</div>
    <div class="center small doc-title">${esc(d.title ?? DEFAULT_TITLE)}${no ? ` <span class="nowrap">№ ${esc(no)}</span>` : ''}</div>
    <div class="line"></div>
    ${row('Sana', d.date)}
    ${row('Bemor', d.patientName || '—')}
    ${d.ticketNo ? `<div class="ticket"><div class="small">NAVBAT</div><div class="num">${esc(d.ticketNo)}</div></div>` : ''}
    ${staff.length ? `<div class="line"></div>${staff.map((r) => row(r.label, r.value)).join('')}` : ''}
    <div class="line"></div>
    ${items}
    <div class="total"><span>JAMI</span><span>${fmtSum(d.totalUzs)} so'm</span></div>
    ${row("To'landi", `${fmtSum(d.paidUzs)} so'm`)}
    ${row("To'lov usuli", d.paymentMethod)}
    ${(d.extraRows ?? []).map((r) => row(r.label, r.value)).join('')}
    ${d.debtUzs > 0 ? `<div class="debtbox">QARZ: ${fmtSum(d.debtUzs)} so'm</div>` : ''}
    ${settings.show_transaction_id ? `<div class="line"></div><div class="center muted small">ID ${esc(d.transactionId)}</div>` : ''}
  `;
}

/**
 * Xuddi shu chek — matnli printer uchun (header/qatorlar/xizmatlar/jami).
 * Qatorlarni o'rash va tekislash keyin `layoutThermalContent` da.
 */
export function paymentReceiptContent(
  d: PaymentReceiptData,
  settingsOverride?: Partial<ReceiptSettings>,
): ThermalReceiptContent {
  const settings = { ...getReceiptSettings(), ...settingsOverride };
  const no = receiptNo(d.transactionId);
  const lines: NonNullable<ThermalReceiptContent['lines']> = [
    { text: `Sana: ${d.date}` },
    { text: `Bemor: ${d.patientName || '—'}` },
  ];
  if (d.ticketNo)
    lines.push({ text: `NAVBAT: ${d.ticketNo}`, align: 'center', bold: true, double: true });
  const staff = staffRows(d, settings);
  if (staff.length) lines.push(...staff.map((r) => ({ text: `${r.label}: ${r.value}` })));
  const extra = [
    { text: `To'lov usuli: ${d.paymentMethod}` },
    ...(d.extraRows ?? []).map((r) => ({ text: `${r.label}: ${r.value}` })),
  ];
  return {
    header: settings.brand_name || d.clinicName,
    subheader: settings.brand_name ? d.clinicName : settings.slogan || undefined,
    title: `${d.title ?? DEFAULT_TITLE}${no ? ` № ${no}` : ''}`,
    lines,
    items: d.items.map((i) => ({ name: i.name, qty: i.qty, amount: i.amount })),
    total_uzs: d.totalUzs,
    paid_uzs: d.paidUzs,
    debt_uzs: d.debtUzs > 0 ? d.debtUzs : undefined,
    // To'lov usuli va qo'shimchalar jami ostida (layout ularni summa qatorlaridan keyin qo'shadi)
    after: extra,
    footer: settings.footer_note || undefined,
    cut: true,
  };
}

/**
 * To'lov chekini chop etish — barcha sahifalar shu bitta funksiyani chaqiradi.
 * QR (bemor telefonida onlayn chek) tranzaksiya bo'lsa avtomatik qo'shiladi.
 */
export function printPaymentReceipt(
  d: PaymentReceiptData,
  opts: { qr?: boolean } = {},
): Promise<{ method: 'tauri' | 'lan' | 'browser'; jobId?: string }> {
  return printReceiptHybrid(
    paymentReceiptContent(d),
    paymentReceiptHtml(d),
    'receipt',
    undefined,
    opts.qr === false || !d.transactionId ? undefined : { transactionId: d.transactionId },
  );
}

// =============================================================================
// A4 hujjat chop etish — to'liq varaq (repchek / rasmiy chek uchun).
// =============================================================================
/**
 * A4 hujjat chop etish. Desktop'da — dialogsiz (A4 printer avtomatik tanlanadi,
 * PDF→print_pdf); brauzerda — yashirin iframe (dialog).
 * Fire-and-forget: chaqiruvchilar o'zgarmaydi.
 */
export function printA4Document(bodyHtml: string, title = 'Chek'): void {
  void tryDesktopPrintA4(bodyHtml, title).then((silent) => {
    if (!silent) printA4Browser(bodyHtml, title);
  });
}

// Brauzer fallback — yashirin iframe + window.print (dialog).
function printA4Browser(bodyHtml: string, title = 'Chek'): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const cleanup = () =>
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* ignore */
      }
    }, 1000);
  // onload va zaxira taymer ikkalasi chaqiradi — dialog faqat BIR marta
  let started = false;
  const doPrint = () => {
    if (started) return;
    started = true;
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch (e) {
        console.error('A4 print xato:', e);
        alert("Chop etish xato. Ctrl+P bilan urinib ko'ring.");
      } finally {
        cleanup();
      }
    }, 250);
  };
  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  iframe.onload = doPrint;
  doc.open();
  doc.write(a4DocumentHtml(bodyHtml, title));
  doc.close();
  setTimeout(() => {
    if (iframe.parentNode) doPrint();
  }, 2000);
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
  // "Onlayn tekshirish" QR bloki — receiptQrBlockHtml() natijasi (ixtiyoriy).
  qrHtml?: string;
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
    ${d.qrHtml ?? ''}
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

// =============================================================================
// Agent / yo'llanma shifokoriga to'lov cheki (kassa chiqimi) — imzo qatori bilan.
// =============================================================================
export function referralPayoutReceiptHtml(d: {
  clinicName: string;
  date: string;
  partnerName: string;
  partnerRole: 'agent' | 'doctor';
  partnerPhone?: string | null;
  amountUzs: number;
  stays?: number;
  method: string;
  paidBy?: string | null;
}): string {
  const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
  return `
    <div class="center bold">${esc(d.clinicName)}</div>
    <div class="center muted small">${d.partnerRole === 'doctor' ? "YO'LLANMA ULUSHI" : 'AGENT ULUSHI'} — CHIQIM</div>
    <div class="line"></div>
    <div class="row"><span class="label">Sana:</span><span>${esc(d.date)}</span></div>
    <div class="row"><span class="label">${d.partnerRole === 'doctor' ? 'Shifokor' : 'Agent'}:</span><span>${esc(d.partnerName)}</span></div>
    ${d.partnerPhone ? `<div class="row"><span class="label">Telefon:</span><span>${esc(d.partnerPhone)}</span></div>` : ''}
    ${d.stays ? `<div class="row"><span class="label">Bemorlar:</span><span>${d.stays}</span></div>` : ''}
    <div class="row"><span class="label">To'lov usuli:</span><span>${esc(d.method)}</span></div>
    ${d.paidBy ? `<div class="row"><span class="label">Kassir:</span><span>${esc(d.paidBy)}</span></div>` : ''}
    <div class="line"></div>
    <div class="row bold"><span>BERILDI:</span><span>${fmt(d.amountUzs)} so'm</span></div>
    <div class="line"></div>
    <div class="row"><span class="label">Oldim (imzo):</span><span>________________</span></div>
  `;
}
