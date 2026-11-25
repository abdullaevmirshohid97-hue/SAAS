// =============================================================================
// Matnli chek (ESC/POS text) — qatorlarni WEB tomonda tayyorlash
// =============================================================================
// Mijozlardagi desktop qobig'i 0.2.0 chekni faqat MATN qilib chiqaradi
// (`print_thermal`). Uning ichidagi Rust maketi qo'pol edi:
//   • uzun xizmat nomi + summa sig'masa "nom summa" bitta bo'shliq bilan
//     yopishtirilardi → printer qatorni ixtiyoriy joyidan bo'lib, summa keyingi
//     qatorning boshiga tushardi (ustun buzilardi);
//   • 2x shriftdagi klinika nomi 24 belgidan uzun bo'lsa so'z o'rtasidan
//     bo'linardi; pastki yozuv (footer) ham shunday.
// Qobiqni yangilamasdan tuzatish uchun HAMMA qatorni shu yerda tayyorlaymiz va
// Rust'ga faqat `lines` (+ QR, footer) beramiz — u ularni shunchaki chop etadi.
// Shu sababli tuzatish web deploy bilan barcha klinikalarga darhol yetadi.
// =============================================================================

import type { PaperWidth } from './escpos-raster';
import type { ThermalReceiptContent } from './print-receipt';
import { padRow, receiptCharsPerLine } from './receipt-text';

type Line = NonNullable<ThermalReceiptContent['lines']>[number];

/** 1234567 → "1 234 567" (printing.rs fmt_money bilan bir xil). */
export function fmtMoney(n: number): string {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return v < 0 ? `-${s}` : s;
}

/**
 * Matnni `width` belgidan oshmaydigan qatorlarga SO'Z bo'yicha bo'ladi.
 * So'zning o'zi uzun bo'lsa (masalan, ID) — majburan bo'linadi.
 */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (let word of words) {
    while (word.length > w) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(word.slice(0, w));
      word = word.slice(w);
    }
    if (!word) continue;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= w) cur += ` ${word}`;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Chap matn + o'ng summa. Sig'masa: chap matn so'z bo'yicha o'raladi, summa
 * oxirgi qatorning o'ng chetiga (joy bo'lmasa — alohida qatorda o'ngga).
 */
export function columnRows(left: string, right: string, width: number): string[] {
  if (!right) return wrapText(left, width);
  if (!left) return [right.padStart(width)];
  if (left.length + 1 + right.length <= width) return [padRow(left, right, width)];
  const wrapped = wrapText(left, width);
  const last = wrapped[wrapped.length - 1] ?? '';
  if (last.length + 1 + right.length <= width) {
    wrapped[wrapped.length - 1] = padRow(last, right, width);
    return wrapped;
  }
  return [...wrapped, right.padStart(width)];
}

/**
 * Tuzilgan chek (`header/items/total…`) → tayyor qatorlar. Natijada `items` va
 * summa maydonlari YO'Q (Rust ularni qayta chizmasin), QR va footer saqlanadi.
 * Kirish matni allaqachon ASCII bo'lsin (asciiContent) — uzunlik shunga qarab.
 */
export function layoutThermalContent(
  c: ThermalReceiptContent,
  paper: PaperWidth,
): ThermalReceiptContent {
  const width = receiptCharsPerLine(paper);
  const half = Math.floor(width / 2);
  const lines: Line[] = [];
  const sep = () => lines.push({ text: '-'.repeat(width) });

  if (c.header) {
    for (const t of wrapText(c.header, half)) {
      lines.push({ text: t, align: 'center', bold: true, double: true });
    }
  }
  if (c.subheader) {
    for (const t of wrapText(c.subheader, width)) lines.push({ text: t, align: 'center' });
  }
  if (c.title) {
    lines.push({ text: '' });
    for (const t of wrapText(c.title, width)) lines.push({ text: t, align: 'center', bold: true });
  }

  for (const l of c.lines ?? []) {
    const w = l.double ? half : width;
    if (!l.text.trim()) {
      lines.push({ text: '' });
      continue;
    }
    // Oldindan to'ldirilgan qator (chap ...... o'ng) sig'sa — tegmaymiz.
    if (l.text.length <= w) {
      lines.push(l);
      continue;
    }
    for (const t of wrapText(l.text, w)) lines.push({ ...l, text: t });
  }

  if (c.items && c.items.length > 0) {
    sep();
    for (const it of c.items) {
      const qty = Number(it.qty ?? 1);
      const name = qty > 1 ? `${it.name} x${qty}` : it.name;
      for (const t of columnRows(name, fmtMoney(it.amount ?? 0), width)) lines.push({ text: t });
    }
    sep();
  }

  if (c.total_uzs != null) {
    for (const t of columnRows('JAMI', `${fmtMoney(c.total_uzs)} so'm`, width)) {
      lines.push({ text: t, bold: true });
    }
  }
  if (c.paid_uzs != null) {
    for (const t of columnRows("To'landi", fmtMoney(c.paid_uzs), width)) lines.push({ text: t });
  }
  if (c.debt_uzs != null && Math.abs(c.debt_uzs) > 0.5) {
    for (const t of columnRows('Qarz', fmtMoney(c.debt_uzs), width)) {
      lines.push({ text: t, bold: true });
    }
  }

  while (lines.length && !lines[lines.length - 1]!.text.trim()) lines.pop();

  return {
    lines,
    // Footer markazda — Rust uni bitta qator qilib yozadi; ko'p qatorni "\n"
    // bilan beramiz (ESC a 1 hizalash keyingi qatorlarga ham amal qiladi).
    footer: c.footer ? wrapText(c.footer, width).join('\n') : undefined,
    qr: c.qr,
    cut: c.cut ?? true,
  };
}
