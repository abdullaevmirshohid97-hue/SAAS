import { existsSync } from 'node:fs';
import { join } from 'node:path';

import PDFDocument from 'pdfkit';

// =============================================================================
// Kunlik hisobot PDF — serverda (bosh brauzersiz) yasaladi.
// =============================================================================
// Nega pdfkit: API'da headless brauzer yo'q va uni o'rnatish VPS'ga ~300 MB
// yuk bo'lardi. pdfkit sof JS, TTF shriftni o'zi joylashtiradi.
//
// Shrift: Roboto (Apache-2.0). Standart PDF shriftlari (Helvetica/WinAnsi)
// kirillni ham, o'zbekcha `ʻ` (U+02BB) belgisini ham ko'rsata olmaydi —
// shuning uchun TTF majburiy. Qamrov src/assets/fonts da tekshirilgan.
// Fayllar nest-cli "assets" orqali dist/assets/fonts ga ko'chiriladi.
// =============================================================================

/**
 * Shrift papkasi. Ikki nomzod tekshiriladi:
 *   1) dist/assets/fonts — prod (build copy-assets.mjs bilan ko'chiradi)
 *   2) src/assets/fonts  — dev (nest start) va build nusxasi yo'qolgan holat
 * Ilgari faqat (1) edi va build assets'ni ko'chirmay qolganda prod'da
 * ENOENT bilan yiqilardi.
 */
function resolveFontDir(): string {
  // Hammasi __dirname'ga nisbatan — cwd qayerda bo'lishidan qat'i nazar ishlaydi
  // (pm2 turli papkadan ishga tushirishi mumkin).
  const candidates = [
    // dist/modules/telegram-reports → dist/assets/fonts (prod)
    // src/modules/telegram-reports  → src/assets/fonts  (dev)
    join(__dirname, '..', '..', 'assets', 'fonts'),
    // dist/modules/telegram-reports → src/assets/fonts (build nusxasi yo'qolgan)
    join(__dirname, '..', '..', '..', 'src', 'assets', 'fonts'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'Roboto-Regular.ttf'))) return dir;
  }
  throw new Error(
    `PDF shrifti topilmadi. Qidirilgan joylar: ${candidates.join(', ')}. ` +
      "Yechim: apps/api'da `pnpm build` qayta ishga tushirilsin.",
  );
}

const INK = '#12100e';
const MUTED = '#7c7364';
const GOLD = '#b08d4f';
const LINE = '#e2ddd4';
const ZEBRA = '#faf8f4';

/** Bitta ustun ta'rifi. */
export type PdfColumn = {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  /** Raqamli ustunlar uchun — 1 234 567 ko'rinishida formatlanadi. */
  numeric?: boolean;
};

export type PdfTable = {
  title: string;
  columns: PdfColumn[];
  rows: Array<Array<string | number | null | undefined>>;
  /** Ko'p qatorli jadval kesiladi — PDF 100 betga cho'zilib ketmasin. */
  maxRows?: number;
  emptyText?: string;
};

export type PdfReportInput = {
  day: string;
  generatedAt: Date;
  kpis: Array<{ label: string; value: string }>;
  tables: PdfTable[];
  /** Sarlavha (default "Kunlik hisobot"). */
  title?: string;
  /** Sarlavha ostidagi qator — klinika hisobotida klinika nomi. */
  subtitle?: string;
  footerNote?: string;
};

const fmtNum = (v: unknown) => Number(v ?? 0).toLocaleString('ru-RU');

/**
 * A4 hisobot yasaydi va Buffer qaytaradi (Telegram'ga to'g'ridan yuboriladi —
 * diskka yozilmaydi).
 */
export function buildDailyReportPdf(input: PdfReportInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    // bufferPages — oxirida barcha betlarga raqam qo'yish uchun SHART
    // (busiz switchToPage ishlamaydi).
    bufferPages: true,
    margins: { top: 40, bottom: 44, left: 36, right: 36 },
    info: {
      Title: `Clary hisobot ${input.day}`,
      Author: 'Clary Care',
      Creator: 'Clary Care API',
    },
  });

  const fontDir = resolveFontDir();
  doc.registerFont('r', join(fontDir, 'Roboto-Regular.ttf'));
  doc.registerFont('m', join(fontDir, 'Roboto-Medium.ttf'));
  doc.font('r');

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usable = right - left;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  // --- Sarlavha ------------------------------------------------------------
  doc.font('m').fontSize(19).fillColor(INK).text('CLARY', left, 40, { characterSpacing: 3 });
  doc
    .font('r')
    .fontSize(7)
    .fillColor(MUTED)
    .text('HEALTHCARE ERP', left, doc.y + 1, { characterSpacing: 2 });

  const genStr = input.generatedAt.toLocaleString('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc
    .font('m')
    .fontSize(13)
    .fillColor(INK)
    .text(`${input.title ?? 'Kunlik hisobot'} — ${input.day}`, left, 44, {
      width: usable,
      align: 'right',
    });
  if (input.subtitle) {
    doc
      .font('m')
      .fontSize(10)
      .fillColor(GOLD)
      .text(input.subtitle, left, 61, { width: usable, align: 'right' });
  }
  doc
    .font('r')
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Shakllantirildi: ${genStr}`, left, input.subtitle ? 75 : 62, {
      width: usable,
      align: 'right',
    });

  let y = input.subtitle ? 96 : 86;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(GOLD).stroke();
  y += 16;

  // --- KPI qatori ----------------------------------------------------------
  if (input.kpis.length > 0) {
    const cardW = usable / input.kpis.length;
    for (let i = 0; i < input.kpis.length; i++) {
      const k = input.kpis[i]!;
      const x = left + i * cardW;
      doc
        .font('r')
        .fontSize(7)
        .fillColor(MUTED)
        .text(k.label.toUpperCase(), x, y, { width: cardW - 8, characterSpacing: 1 });
      doc
        .font('m')
        .fontSize(13)
        .fillColor(INK)
        .text(k.value, x, y + 11, { width: cardW - 8 });
    }
    y += 38;
  }

  // --- Jadvallar -----------------------------------------------------------
  const HEADER_H = 16;
  const ROW_H = 14;

  const drawColumnHeaders = (t: PdfTable, atY: number): number => {
    doc.rect(left, atY, usable, HEADER_H).fillColor('#f3efe7').fill();
    let x = left;
    for (const c of t.columns) {
      doc
        .font('m')
        .fontSize(7)
        .fillColor(MUTED)
        .text(c.header.toUpperCase(), x + 4, atY + 5, {
          width: c.width - 8,
          align: c.align ?? 'left',
          lineBreak: false,
        });
      x += c.width;
    }
    return atY + HEADER_H;
  };

  for (const t of input.tables) {
    // Sarlavha + ustun boshi bir betda qolsin (yolg'iz sarlavha chirkin).
    if (y + HEADER_H + ROW_H * 2 + 26 > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    doc.font('m').fontSize(10).fillColor(INK).text(t.title, left, y);
    y += 16;
    y = drawColumnHeaders(t, y);

    const limit = t.maxRows ?? 250;
    const shown = t.rows.slice(0, limit);

    if (shown.length === 0) {
      doc
        .font('r')
        .fontSize(8)
        .fillColor(MUTED)
        .text(t.emptyText ?? "Ma'lumot yo‘q", left + 4, y + 4);
      y += ROW_H + 12;
      continue;
    }

    for (let i = 0; i < shown.length; i++) {
      if (y + ROW_H > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        y = drawColumnHeaders(t, y);
      }
      if (i % 2 === 1) doc.rect(left, y, usable, ROW_H).fillColor(ZEBRA).fill();

      let x = left;
      const row = shown[i]!;
      for (let ci = 0; ci < t.columns.length; ci++) {
        const c = t.columns[ci]!;
        const raw = row[ci];
        const text = c.numeric ? fmtNum(raw) : String(raw ?? '');
        doc
          .font('r')
          .fontSize(7.5)
          .fillColor(INK)
          .text(text, x + 4, y + 4, {
            width: c.width - 8,
            align: c.align ?? (c.numeric ? 'right' : 'left'),
            lineBreak: false,
            ellipsis: true,
          });
        x += c.width;
      }
      doc
        .moveTo(left, y + ROW_H)
        .lineTo(right, y + ROW_H)
        .lineWidth(0.4)
        .strokeColor(LINE)
        .stroke();
      y += ROW_H;
    }

    if (t.rows.length > shown.length) {
      doc
        .font('r')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `…va yana ${t.rows.length - shown.length} ta qator — to‘liq ro‘yxat CSV faylda`,
          left + 4,
          y + 4,
        );
      y += ROW_H;
    }
    y += 14;
  }

  // --- Bet raqamlari (barcha betlarga) -------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font('r')
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `${input.footerNote ?? 'Clary Care — avtomatik hisobot'}   ·   ${i - range.start + 1}/${range.count}`,
        left,
        doc.page.height - 32,
        { width: usable, align: 'center' },
      );
  }

  doc.end();
  return done;
}
