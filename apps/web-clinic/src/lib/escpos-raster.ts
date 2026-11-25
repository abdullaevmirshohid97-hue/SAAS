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

/**
 * Yorug'lik chegarasi: shundan qora — nuqta bosiladi. 180: ingichka shrift
 * chiziqlarining antialias chetlari ham qoladi (165 da Courier "uzilib"
 * chiqardi), och fon (#eee, #f3f4f6) esa oq qoladi.
 */
export const INK_THRESHOLD = 180;

/** Canvas → 1-bit matritsa (ESC/POS ham, sozlamadagi "qog'ozda" ko'rinish ham shundan). */
export function canvasToBits(
  source: HTMLCanvasElement,
  dots: number,
): { bits: Uint8Array; rowBytes: number; rows: number; dots: number } {
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
      if (lum < INK_THRESHOLD) {
        bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
        rowHasInk = true;
      }
    }
    if (rowHasInk) lastInk = y;
  }
  return { bits, rowBytes, rows: Math.max(1, lastInk + 1), dots };
}

/**
 * "Qog'ozda shunday chiqadi" — 1-bit rasmni PNG dataURL qilib qaytaradi
 * (Sozlamalar → Chek ko'rinishi; ekrandagi HTML emas, printerga ketadigan rasm).
 */
export function bitsToDataUrl(b: {
  bits: Uint8Array;
  rowBytes: number;
  rows: number;
  dots: number;
}): string {
  const c = document.createElement('canvas');
  c.width = b.dots;
  c.height = b.rows;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(b.dots, b.rows);
  for (let y = 0; y < b.rows; y++) {
    for (let x = 0; x < b.dots; x++) {
      const on = (b.bits[y * b.rowBytes + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
      const i = (y * b.dots + x) * 4;
      const v = on ? 0 : 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Canvas → 1-bit ESC/POS raster baytlari (oxiridagi bo'sh qatorlar kesiladi). */
export function canvasToEscPos(
  source: HTMLCanvasElement,
  paper: PaperWidth,
  opts: { cut?: boolean; feedLines?: number; dots?: number } = {},
): Uint8Array {
  const dots = opts.dots && opts.dots % 8 === 0 ? opts.dots : DOTS[paper];
  const { bits, rowBytes, rows } = canvasToBits(source, dots);

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

/** Kalibrlash: sinab ko'riladigan rasm kengliklari (nuqta). */
export const CALIBRATION_DOTS = [384, 512, 576] as const;

/**
 * Kalibrlash rasmi: `dots` kenglikdagi qora chiziq, har 64 nuqtada belgi va
 * yozuv. Printer kengligidan katta rasm kesiladi yoki buziladi — foydalanuvchi
 * qaysi chiziq TO'LIQ (chetdan chetga, yozuvi butun) chiqqanini tanlaydi.
 */
export function calibrationCanvas(dots: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = dots;
  c.height = 96;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d yo‘q');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, dots, c.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 8, dots, 16); // to'liq chiziq
  for (let x = 0; x < dots; x += 64) ctx.fillRect(x, 24, 4, 16); // belgilar
  ctx.fillRect(dots - 4, 24, 4, 16); // o'ng chet
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText(`${dots} nuqta`, 8, 76);
  return c;
}

/** Matnli kalibrlash: 32/42/48 belgili o'lchov qatorlari (qaysi biri bitta qatorga sig'adi). */
export function calibrationRulerLines(): string[] {
  const ruler = (n: number) => {
    let s = '';
    for (let i = 1; i <= n; i++) s += String(i % 10);
    return s;
  };
  return [32, 42, 48].flatMap((n) => [`${n}:`, ruler(n)]);
}

/** Bir nechta raster bo'lagini bitta ESC/POS oqimiga (init bir marta, oxirida kesish). */
export function concatEscPos(parts: Uint8Array[]): Uint8Array {
  const out: number[] = [];
  parts.forEach((p, i) => {
    // har bo'lak: ESC @ ... ESC d n [GS V 0]. Oxirgisidan boshqalarida kesishni olib tashlaymiz.
    let arr = Array.from(p);
    if (i < parts.length - 1 && arr.slice(-3).join() === [0x1d, 0x56, 0x00].join()) {
      arr = arr.slice(0, -3);
    }
    out.push(...arr);
  });
  return Uint8Array.from(out);
}
