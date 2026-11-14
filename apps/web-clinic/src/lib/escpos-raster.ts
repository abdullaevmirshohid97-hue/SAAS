// =============================================================================
// Chek HTML → termal printer RASMI (ESC/POS raster, `GS v 0`)
// =============================================================================
// Matnli ESC/POS (print_thermal) UTF-8 yuboradi — termal printerlar kirill
// harflarni bilmaydi ("УЗИ общий" → "Ð£Ð—Ð˜"). Rasm sifatida yuborsak chek
// aynan ekrandagidek chiqadi: kirill/lotin, shrift sozlamalari, QR, logotip.
// Printer kengligi: 58mm → 384 nuqta, 80mm → 576 nuqta (203 dpi).
// =============================================================================

export type PaperWidth = '58mm' | '80mm';

const DOTS: Record<PaperWidth, number> = { '58mm': 384, '80mm': 576 };
/** Bir `GS v 0` buyrug'idagi qatorlar (ba'zi printer buferi katta rasmni sig'dirmaydi). */
const BAND_ROWS = 256;

function waitImages(doc: Document, timeoutMs: number): Promise<void> {
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = pending.length;
    const t = window.setTimeout(resolve, timeoutMs);
    const one = () => {
      left -= 1;
      if (left <= 0) {
        window.clearTimeout(t);
        resolve();
      }
    };
    for (const img of pending) {
      img.addEventListener('load', one, { once: true });
      img.addEventListener('error', one, { once: true });
    }
  });
}

/**
 * To'liq HTML hujjatni (head'dagi CSS bilan) yashirin iframe'da chizib,
 * `targetWidthPx` kenglikdagi canvas qaytaradi.
 */
export async function renderHtmlDocument(
  documentHtml: string,
  cssWidthPx: number,
  targetWidthPx: number,
  waitMs = 300,
): Promise<HTMLCanvasElement> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-20000px;top:0;width:${cssWidthPx}px;height:200px;border:0;visibility:hidden`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('iframe yaratilmadi');
    doc.open();
    doc.write(documentHtml);
    doc.close();
    await new Promise((r) => window.setTimeout(r, waitMs));
    await waitImages(doc, 3000);
    const { default: html2canvas } = await import('html2canvas');
    const body = doc.body;
    const width = Math.max(1, body.scrollWidth || cssWidthPx);
    return await html2canvas(body, {
      scale: targetWidthPx / width,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width,
      windowWidth: width,
    });
  } finally {
    iframe.remove();
  }
}

/** Canvas → 1-bit ESC/POS raster baytlari (oxiridagi bo'sh qatorlar kesiladi). */
export function canvasToEscPos(
  source: HTMLCanvasElement,
  paper: PaperWidth,
  opts: { cut?: boolean; feedLines?: number } = {},
): Uint8Array {
  const dots = DOTS[paper];
  const scale = dots / source.width;
  const height = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement('canvas');
  c.width = dots;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d yo‘q');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dots, height);
  ctx.drawImage(source, 0, 0, dots, height);
  const px = ctx.getImageData(0, 0, dots, height).data;

  const rowBytes = dots / 8;
  const bits = new Uint8Array(rowBytes * height);
  let lastInk = -1;
  for (let y = 0; y < height; y++) {
    let rowHasInk = false;
    for (let x = 0; x < dots; x++) {
      const i = (y * dots + x) * 4;
      const a = px[i + 3]! / 255;
      // Shaffof joy — oq. Yorug'lik 0.299R+0.587G+0.114B.
      const lum = (0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!) * a + 255 * (1 - a);
      if (lum < 165) {
        bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
        rowHasInk = true;
      }
    }
    if (rowHasInk) lastInk = y;
  }
  const rows = Math.max(1, lastInk + 1);

  const out: number[] = [0x1b, 0x40]; // ESC @ — init
  for (let y0 = 0; y0 < rows; y0 += BAND_ROWS) {
    const h = Math.min(BAND_ROWS, rows - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, h & 0xff, h >> 8);
    const slice = bits.subarray(y0 * rowBytes, (y0 + h) * rowBytes);
    for (let k = 0; k < slice.length; k++) out.push(slice[k]!);
  }
  out.push(0x1b, 0x64, opts.feedLines ?? 4); // ESC d n — qog'oz uzatish
  if (opts.cut ?? true) out.push(0x1d, 0x56, 0x00); // GS V 0 — kesish
  return Uint8Array.from(out);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// Matnli ESC/POS uchun (eski qobiq): kirill → lotin. Server LAN yo'li ham shuni ishlatadi.
export { toPrinterAscii } from '@clary/utils';
