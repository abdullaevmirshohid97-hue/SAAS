// =============================================================================
// Desktop (Tauri) — SO'ROVSIZ chop etish yadrosi
// =============================================================================
// Chek, A4 hujjat va hisobotlar printer dialogisiz chiqadi:
//   • chek  → termal printer: rasm (ESC/POS raster, print_raw) — kirill, QR,
//             shrift ekrandagidek. Eski qobiqda (0.2.0, print_raw yo'q) —
//             matnli ESC/POS, kirill lotinga o'giriladi.
//           → termal printer yo'q: chek PDF bo'lib A4/standart printerdan.
//   • A4    → PDF (html2canvas + jsPDF) → print_pdf (SumatraPDF, silent).
// Printer avtomatik tanlanadi (desktop-printer.ts) — hech narsa so'ralmaydi.
// Har bir funksiya muvaffaqiyatsizlikda `false` qaytaradi: chaqiruvchi keyingi
// yo'lga (LAN / brauzer) o'tadi. Brauzerda (isTauri=false) ishlatilmaydi.
// =============================================================================

import { toast } from 'sonner';

import {
  ensureDesktopA4Printer,
  ensureDesktopReceiptPrinter,
  isThermalName,
  receiptPaperWidth,
} from './desktop-printer';
import { bytesToBase64, canvasToEscPos, renderHtmlDocument, toPrinterAscii } from './escpos-raster';
import type { PaperWidth } from './escpos-raster';
import { isTauri } from './platform';
import { agentPrintRaw } from './print-agent';
import type { ThermalReceiptContent } from './print-receipt';
import { layoutThermalContent } from './receipt-layout';
import { htmlToThermalContent } from './receipt-text';

/** printReceipt'ning tayyor HTML hujjati (CSS + tana). */
export interface ReceiptDoc {
  html: string;
  paper: PaperWidth;
  /** body kengligi (mm) — 80mm qog'ozda 72, 58mm'da 48. */
  contentMm: number;
  /** Rasm/QR yuklanishi uchun kutish (ms). */
  waitMs: number;
}

const MM_PX = 96 / 25.4;

async function invoke<T = unknown>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

// print_raw 0.2.1 qobig'ida qo'shildi. Eski qobiqda (0.2.0) "not found / not allowed".
let rawSupported: boolean | null = null;
const isMissingCommand = (e: unknown) => /not found|not allowed|unknown command/i.test(String(e));

/**
 * print_raw bormi — bo'sh ma'lumot bilan arzon so'rov (Rust uni printerga
 * yubormay "Bo'sh chek" deb qaytaradi). Rasm chizishdan OLDIN aniqlanadi.
 */
async function rawAvailable(printerName: string): Promise<boolean> {
  if (rawSupported !== null) return rawSupported;
  try {
    await invoke('print_raw', { printerName, dataBase64: '' });
    rawSupported = true;
  } catch (e) {
    rawSupported = !isMissingCommand(e);
  }
  return rawSupported;
}

function errText(e: unknown): string {
  return String((e as Error)?.message ?? e).slice(0, 200);
}

/** Chek qaysi printerga va qanday ketdi (sinov tugmalari ko'rsatadi). */
export type DesktopPrintMode = 'raster' | 'text' | 'pdf';
export interface DesktopPrintJob {
  printer: string;
  mode: DesktopPrintMode;
}

/**
 * Matnli ESC/POS uchun TAYYOR chek: kirill → lotin, keyin barcha qatorlar web
 * tomonda o'raladi/tekislanadi (receipt-layout.ts). Eski qobiq (0.2.0) maketi
 * uzun nom va summani buzib chiqarardi — endi u faqat tayyor qatorni bosadi.
 */
export function thermalTextContent(
  c: ThermalReceiptContent,
  paper: PaperWidth,
): ThermalReceiptContent {
  return layoutThermalContent(asciiContent(c), paper);
}

/** Matnli ESC/POS uchun: kirill → lotin, printer bilmaydigan belgilar olib tashlanadi. */
export function asciiContent(c: ThermalReceiptContent): ThermalReceiptContent {
  const t = (s?: string) => (s == null ? s : toPrinterAscii(s));
  return {
    ...c,
    header: t(c.header),
    subheader: t(c.subheader),
    title: t(c.title),
    footer: t(c.footer),
    lines: c.lines?.map((l) => ({ ...l, text: toPrinterAscii(l.text) })),
    items: c.items?.map((it) => ({ ...it, name: toPrinterAscii(it.name) })),
  };
}

/**
 * Chekni kompyuterdagi CHEK printeriga yuboradi:
 *   • 0.2.1+ qobiq — rasm (print_raw), kirill/QR ekrandagidek;
 *   • 0.2.0 qobiq  — matnli ESC/POS (print_thermal). Tuzilgan `content` berilmasa
 *     chek HTML'idan qatorlar yasaladi (avval bunday chek termal printerga
 *     bormay, A4 printerga ketib qolardi — sinov cheki "chiqmasdi");
 *   • chek printeri sifatida oddiy (A4) printer tanlangan — PDF o'sha printerga.
 * Printer topilmasa yoki xato bo'lsa `null`.
 */
export async function desktopThermalJob(
  doc: ReceiptDoc | null,
  content?: ThermalReceiptContent,
): Promise<DesktopPrintJob | null> {
  if (!isTauri()) return null;
  const printerName = await ensureDesktopReceiptPrinter();
  if (!printerName) return null;
  const paper = doc?.paper ?? receiptPaperWidth();
  // Chek printeri sifatida oddiy (A4/inkjet) printer tanlangan bo'lsa ESC/POS
  // baytlari unda "axlat" varaq bo'lib chiqadi — chek drayver orqali (PDF) ketadi.
  if (!isThermalName(printerName)) {
    return doc ? desktopReceiptOfficeJob(doc, printerName) : null;
  }

  try {
    if (doc && (await rawAvailable(printerName))) {
      const canvas = await renderHtmlDocument(
        doc.html,
        Math.round(doc.contentMm * MM_PX),
        paper === '58mm' ? 384 : 576,
        doc.waitMs,
      );
      const bytes = canvasToEscPos(canvas, paper);
      try {
        await invoke('print_raw', { printerName, dataBase64: bytesToBase64(bytes) });
        return { printer: printerName, mode: 'raster' };
      } catch (e) {
        if (!isMissingCommand(e)) throw e;
        rawSupported = false;
      }
    }
    const text = content ?? (doc ? htmlToThermalContent(doc.html, paper) : null);
    if (!text) return null;
    await invoke('print_thermal', {
      printerName,
      content: thermalTextContent(text, paper),
      paperWidth: paper,
    });
    return { printer: printerName, mode: 'text' };
  } catch (e) {
    console.warn('[print] termal printer xatosi', e);
    toast.error(`"${printerName}" chek printeriga yuborilmadi`, {
      description: `${errText(e)} — printer yoqilgani va qog'ozi borligini tekshiring.`,
    });
    return null;
  }
}

/** `desktopThermalJob` — faqat muvaffaqiyat belgisi. */
export async function desktopPrintThermal(
  doc: ReceiptDoc | null,
  content?: ThermalReceiptContent,
): Promise<boolean> {
  return (await desktopThermalJob(doc, content)) !== null;
}

/**
 * Canvas'ni PDF (base64) ga aylantiradi. Uzun hujjat sahifalarga BO'LIB
 * qo'yiladi (har sahifada chet bo'sh qoladi, qatorlar takrorlanmaydi).
 */
async function canvasToPdfBase64(
  canvas: HTMLCanvasElement,
  page: { widthMm: number; heightMm: number | 'fit'; imgWidthMm: number; marginMm?: number },
): Promise<string> {
  const jspdfMod = await import('jspdf');
  const JsPDF = (jspdfMod as { jsPDF: new (o?: unknown) => import('jspdf').jsPDF }).jsPDF;
  const m = page.marginMm ?? 0;
  const imgW = page.imgWidthMm;
  const pxPerMm = canvas.width / imgW;
  const fullH = canvas.height / pxPerMm;
  const pageH = page.heightMm === 'fit' ? Math.max(30, fullH + 2 * m + 4) : page.heightMm;
  const orientation = page.widthMm > pageH ? 'landscape' : 'portrait';
  const pdf = new JsPDF({ unit: 'mm', format: [page.widthMm, pageH], orientation, compress: true });
  const x = (page.widthMm - imgW) / 2;
  const slicePx = Math.max(1, Math.floor((pageH - 2 * m) * pxPerMm));
  for (let y = 0, i = 0; y < canvas.height; y += slicePx, i++) {
    const h = Math.min(slicePx, canvas.height - y);
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = h;
    const ctx = part.getContext('2d');
    if (!ctx) throw new Error('canvas 2d yo‘q');
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (i > 0) pdf.addPage([page.widthMm, pageH], orientation);
    pdf.addImage(part.toDataURL('image/png'), 'PNG', x, m, imgW, h / pxPerMm);
  }
  return pdf.output('datauristring').split(',')[1] ?? '';
}

async function printPdf(printerName: string, pdfBase64: string): Promise<void> {
  await invoke('print_pdf', { printerName, pdfBase64 });
}

/**
 * Termal printer yo'q (yoki ishlamadi) — chekni PDF qilib A4/standart printerdan
 * chiqaradi (dialogsiz).
 */
export async function desktopPrintReceiptOnOffice(
  doc: ReceiptDoc,
  printer?: string,
): Promise<boolean> {
  return (await desktopReceiptOfficeJob(doc, printer)) !== null;
}

/** `desktopPrintReceiptOnOffice` — qaysi printerga ketganini ham qaytaradi. */
export async function desktopReceiptOfficeJob(
  doc: ReceiptDoc,
  printer?: string,
): Promise<DesktopPrintJob | null> {
  if (!isTauri()) return null;
  const printerName = printer || (await ensureDesktopA4Printer());
  if (!printerName) return null;
  try {
    const cssW = Math.round(doc.contentMm * MM_PX);
    const canvas = await renderHtmlDocument(doc.html, cssW, cssW * 3, doc.waitMs);
    const paperMm = doc.paper === '58mm' ? 58 : 80;
    const base64 = await canvasToPdfBase64(canvas, {
      widthMm: paperMm,
      heightMm: 'fit',
      imgWidthMm: doc.contentMm,
      marginMm: 2,
    });
    if (!base64) return null;
    await printPdf(printerName, base64);
    return { printer: printerName, mode: 'pdf' };
  } catch (e) {
    console.warn('[print] chek A4 printerga chiqmadi', e);
    toast.error(`"${printerName}" printeriga yuborilmadi`, { description: errText(e) });
    return null;
  }
}

/**
 * To'liq A4 HTML hujjatni (head'dagi CSS bilan) A4 printerga dialogsiz chop etadi.
 * @param printerName berilmasa — A4 printer avtomatik tanlanadi.
 */
export async function desktopPrintA4Html(
  documentHtml: string,
  printerName?: string | null,
): Promise<boolean> {
  if (!isTauri()) return false;
  const name = printerName || (await ensureDesktopA4Printer());
  if (!name) return false;
  try {
    // A4 kenglik ≈ 794px (@96dpi), chetlar hujjat CSS'ida (body padding).
    const canvas = await renderHtmlDocument(documentHtml, 794, 794 * 2, 300);
    const base64 = await canvasToPdfBase64(canvas, {
      widthMm: 210,
      heightMm: 297,
      imgWidthMm: 194,
      marginMm: 8,
    });
    if (!base64) return false;
    await printPdf(name, base64);
    return true;
  } catch (e) {
    console.warn('[print] A4 desktop print xato', e);
    toast.error(`"${name}" printeriga yuborilmadi`, { description: errText(e) });
    return false;
  }
}

/**
 * Hisobot oynalari (window.open + print) uchun: desktop'da oyna va dialog
 * o'rniga hujjat to'g'ridan-to'g'ri printerga ketadi; chiqmasa `fallback`
 * (eski oyna yo'li). `true` — desktop yo'li olindi, chaqiruvchi to'xtasin.
 */
export function printOnDesktopInstead(
  documentHtml: string,
  format: 'a4' | PaperWidth,
  fallback: () => void,
): boolean {
  if (!isTauri()) return false;
  void desktopPrintFullHtml(documentHtml, format).then((ok) => {
    if (!ok) fallback();
  });
  return true;
}

/**
 * Hisobot/varaqa oynalari (window.open + print) uchun: desktop'da yangi oyna va
 * dialog o'rniga to'g'ridan-to'g'ri printerga. `format` — hujjat qaysi qog'ozga
 * mo'ljallangan.
 */
export async function desktopPrintFullHtml(
  documentHtml: string,
  format: 'a4' | PaperWidth = 'a4',
): Promise<boolean> {
  if (!isTauri()) return false;
  // Ekrandagi "Chop etish" tugmalari qog'ozga chiqmasin.
  const html = documentHtml.replace(
    '</head>',
    '<style>.no-print,.print-btn{display:none!important}</style></head>',
  );
  if (format === 'a4') return desktopPrintA4Html(html);
  const doc: ReceiptDoc = {
    html,
    paper: format,
    contentMm: format === '58mm' ? 48 : 72,
    waitMs: 300,
  };
  return (await desktopPrintThermal(doc)) || (await desktopPrintReceiptOnOffice(doc));
}

/**
 * Brauzer + Clary desktop agent (0.2.1+): chekni rasm qilib agent'ga yuboradi.
 * Eski agent'da /print/raw yo'q (404) — `false`, chaqiruvchi matnli yo'lga o'tadi.
 */
export async function agentPrintReceiptRaster(
  printerName: string,
  doc: ReceiptDoc,
): Promise<boolean> {
  try {
    const canvas = await renderHtmlDocument(
      doc.html,
      Math.round(doc.contentMm * MM_PX),
      doc.paper === '58mm' ? 384 : 576,
      doc.waitMs,
    );
    const bytes = canvasToEscPos(canvas, doc.paper);
    return await agentPrintRaw(printerName, bytesToBase64(bytes));
  } catch (e) {
    console.warn('[print] agent raster xato', e);
    return false;
  }
}
