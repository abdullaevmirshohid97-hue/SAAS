// =============================================================================
// Label / barcode chop etish — dori, laboratoriya namuna, bemor bilaguzugi.
// Silent: desktop (Tauri) → tanlangan label printer → PDF (print_pdf). Label
// printer yo'q → A4 → brauzer iframe. QR = qrcode.react, Code128 = jsbarcode.
// Reuses: printing.rs `print_pdf` (Faza 1).
// =============================================================================
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import JsBarcode from 'jsbarcode';

import { isTauri } from './platform';

const DESKTOP_PRINTER_KEY = 'clary.desktop.printer';
const DESKTOP_A4_PRINTER_KEY = 'clary.desktop.printer.a4';
const DESKTOP_LABEL_PRINTER_KEY = 'clary.desktop.printer.label';

export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

// ─── Barcode / QR SVG (label HTML ichiga joylash uchun) ──────────────────────

/** QR kod SVG. `value` — skanerlanadigan matn (ID, PINFL, rx). */
export function qrSvg(value: string, size = 64): string {
  return renderToStaticMarkup(createElement(QRCodeSVG, { value, size, level: 'M' }));
}

/** Code128 chiziqli barcode SVG (1D skaner uchun). Xatoda matn qaytaradi. */
export function barcodeSvg(
  value: string,
  opts?: { height?: number; width?: number; fontSize?: number; displayValue?: boolean },
): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, {
      format: 'CODE128',
      height: opts?.height ?? 40,
      width: opts?.width ?? 1.4,
      fontSize: opts?.fontSize ?? 12,
      displayValue: opts?.displayValue ?? true,
      margin: 4,
    });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return `<div style="font-family:monospace;font-size:11px">${escapeHtml(value)}</div>`;
  }
}

// ─── Print ───────────────────────────────────────────────────────────────────

function getLabelPrinter(): string {
  try {
    return (
      localStorage.getItem(DESKTOP_LABEL_PRINTER_KEY) ||
      localStorage.getItem(DESKTOP_A4_PRINTER_KEY) ||
      localStorage.getItem(DESKTOP_PRINTER_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

/**
 * Label chop etish. Desktop (Tauri) + label printer tanlangan bo'lsa — HTML→PDF
 * (custom o'lcham)→`print_pdf` silent. Aks holda brauzer iframe (dialog). REGRESS
 * YO'Q: printer/buyruq yo'q → fallback.
 */
export async function printLabel(bodyHtml: string, size: LabelSize): Promise<void> {
  const printerName = getLabelPrinter();
  if (isTauri() && printerName) {
    let holder: HTMLDivElement | null = null;
    try {
      const pxWidth = Math.round(size.widthMm * 3.78); // mm → px @96dpi
      holder = document.createElement('div');
      holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${pxWidth}px;background:#fff`;
      holder.innerHTML = bodyHtml;
      document.body.appendChild(holder);

      const [{ default: html2canvas }, jspdfMod] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const JsPDF = (jspdfMod as { jsPDF: new (o?: unknown) => import('jspdf').jsPDF }).jsPDF;
      const canvas = await html2canvas(holder, { scale: 3, backgroundColor: '#ffffff' });
      const pdf = new JsPDF({
        unit: 'mm',
        format: [size.widthMm, size.heightMm],
        orientation: size.widthMm >= size.heightMm ? 'landscape' : 'portrait',
        compress: true,
      });
      const imgW = size.widthMm;
      const imgH = (canvas.height * imgW) / canvas.width;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgW, Math.min(imgH, size.heightMm));
      const base64 = pdf.output('datauristring').split(',')[1] ?? '';
      if (base64) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('print_pdf', { printerName, pdfBase64: base64 });
        return;
      }
    } catch (e) {
      console.warn('[label] desktop print failed, fallback:', e);
    } finally {
      if (holder && holder.parentNode) {
        try { document.body.removeChild(holder); } catch { /* ignore */ }
      }
    }
  }
  printLabelBrowser(bodyHtml, size);
}

function printLabelBrowser(bodyHtml: string, size: LabelSize): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `@page{size:${size.widthMm}mm ${size.heightMm}mm;margin:0}` +
      `*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif}</style></head>` +
      `<body>${bodyHtml}</body></html>`,
  );
  doc.close();
  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* ignore */
      } finally {
        setTimeout(() => {
          try { document.body.removeChild(iframe); } catch { /* ignore */ }
        }, 1000);
      }
    }, 200);
  };
}

// ─── Shablonlar (label HTML) ─────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const WRAP = (inner: string, mm: LabelSize) =>
  `<div style="width:${mm.widthMm}mm;height:${mm.heightMm}mm;padding:2mm;overflow:hidden;font-family:Arial,sans-serif">${inner}</div>`;

/** Dori yorlig'i — ~50x30mm. barcode = dori barcode yoki sotuv id. */
export const MED_LABEL_SIZE: LabelSize = { widthMm: 50, heightMm: 30 };
export function medicationLabelHtml(d: {
  medName: string;
  dosage?: string | null;
  patientName?: string | null;
  date: string;
  barcodeValue: string;
  clinicName?: string;
}): string {
  return WRAP(
    `<div style="font-size:8px;color:#555">${escapeHtml(d.clinicName ?? 'Clary')}</div>` +
      `<div style="font-size:13px;font-weight:700;line-height:1.15">${escapeHtml(d.medName)}</div>` +
      (d.dosage ? `<div style="font-size:10px">${escapeHtml(d.dosage)}</div>` : '') +
      (d.patientName ? `<div style="font-size:9px;color:#333">${escapeHtml(d.patientName)}</div>` : '') +
      `<div style="font-size:8px;color:#777">${escapeHtml(d.date)}</div>` +
      `<div style="margin-top:1mm">${barcodeSvg(d.barcodeValue, { height: 28, fontSize: 10 })}</div>`,
    MED_LABEL_SIZE,
  );
}

/** Laboratoriya namuna yorlig'i — ~40x25mm. */
export const LAB_LABEL_SIZE: LabelSize = { widthMm: 40, heightMm: 25 };
export function labSampleLabelHtml(d: {
  patientName: string;
  sampleId: string;
  testName?: string | null;
  date: string;
}): string {
  return WRAP(
    `<div style="font-size:11px;font-weight:700;line-height:1.1">${escapeHtml(d.patientName)}</div>` +
      (d.testName ? `<div style="font-size:9px;color:#333">${escapeHtml(d.testName)}</div>` : '') +
      `<div style="font-size:8px;color:#777">${escapeHtml(d.date)}</div>` +
      `<div style="margin-top:0.5mm">${barcodeSvg(d.sampleId, { height: 24, fontSize: 9 })}</div>`,
    LAB_LABEL_SIZE,
  );
}

/** Bemor bilaguzugi — ~90x25mm (uzun tor). QR + ma'lumot. */
export const WRISTBAND_SIZE: LabelSize = { widthMm: 90, heightMm: 25 };
export function wristbandLabelHtml(d: {
  patientName: string;
  patientId: string;
  room?: string | null;
  dob?: string | null;
  clinicName?: string;
}): string {
  return WRAP(
    `<div style="display:flex;gap:2mm;align-items:center;height:100%">` +
      `<div style="flex-shrink:0">${qrSvg(d.patientId, 64)}</div>` +
      `<div style="min-width:0">` +
      `<div style="font-size:8px;color:#555">${escapeHtml(d.clinicName ?? 'Clary')}</div>` +
      `<div style="font-size:13px;font-weight:700;line-height:1.15">${escapeHtml(d.patientName)}</div>` +
      (d.dob ? `<div style="font-size:9px;color:#333">DOB: ${escapeHtml(d.dob)}</div>` : '') +
      (d.room ? `<div style="font-size:9px;color:#333">Palata: ${escapeHtml(d.room)}</div>` : '') +
      `<div style="font-size:8px;color:#777">ID: ${escapeHtml(d.patientId)}</div>` +
      `</div></div>`,
    WRISTBAND_SIZE,
  );
}
