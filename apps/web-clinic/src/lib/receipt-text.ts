// =============================================================================
// Chek HTML → matnli ESC/POS qatorlari
// =============================================================================
// Desktop 0.2.1+ chekni RASM qilib yuboradi (print_raw). Eski qobiqda (0.2.0 —
// mijozlarda o'rnatilgani) print_raw yo'q: faqat matnli `print_thermal` bor.
// Tuzilgan `ThermalReceiptContent` berilmagan cheklar (sinov tugmalari,
// dorixona, agent ulushi) shu yerda HTML'dan qatorlarga aylantiriladi — aks holda
// ular termal printerga umuman bormay, A4 printerga ketib qolardi.
//   • .row / ikki ustunli <tr>  → "chap ........ o'ng" (qog'oz kengligiga to'ldiriladi)
//   • .line / <hr>              → "------"
//   • .center / .r, .bold / .big → hizalash, qalin, ikki barobar
// Matn kirill → lotin (printer kodlash jadvali kirillni bilmaydi).
// =============================================================================

import { toPrinterAscii } from '@clary/utils';

import type { PaperWidth } from './escpos-raster';
import type { ThermalReceiptContent } from './print-receipt';

type Line = NonNullable<ThermalReceiptContent['lines']>[number];
type Align = NonNullable<Line['align']>;

interface Style {
  align: Align;
  bold: boolean;
  double: boolean;
}

/** Oddiy shriftda bir qatordagi belgilar (printing.rs bilan bir xil). */
export function receiptCharsPerLine(paper: PaperWidth): number {
  return paper === '58mm' ? 32 : 48;
}

/** Chap + o'ng matn: oradagi bo'shliq qatorni kenglikka to'ldiradi. */
export function padRow(left: string, right: string, width: number): string {
  if (!left) return right;
  if (!right) return left;
  const gap = width - left.length - right.length;
  return gap >= 1 ? `${left}${' '.repeat(gap)}${right}` : `${left} ${right}`;
}

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'HEAD',
  'TITLE',
  'IMG',
  'SVG',
  'CANVAS',
  'VIDEO',
  'IFRAME',
  'BUTTON',
  'INPUT',
  'SELECT',
]);

const INLINE_TAGS = new Set([
  'SPAN',
  'B',
  'STRONG',
  'I',
  'EM',
  'SMALL',
  'BIG',
  'U',
  'S',
  'SUB',
  'SUP',
  'A',
  'LABEL',
  'CODE',
  'MARK',
  'FONT',
  'ABBR',
  'TIME',
]);

const clean = (s: string) => toPrinterAscii(s.replace(/\s+/g, ' ')).replace(/ {2,}/g, ' ');

function hasClass(el: Element, ...names: string[]): boolean {
  const list = el.classList;
  return names.some((n) => list.contains(n));
}

function isHidden(el: Element): boolean {
  if (hasClass(el, 'no-print', 'print-btn', 'sr-only', 'hidden')) return true;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') ?? '');
}

function styleOf(el: Element, parent: Style): Style {
  const css = (el.getAttribute('style') ?? '').toLowerCase();
  const alignAttr = (el.getAttribute('align') ?? '').toLowerCase();
  let align = parent.align;
  if (
    hasClass(el, 'center', 'text-center') ||
    el.tagName === 'CENTER' ||
    alignAttr === 'center' ||
    /text-align\s*:\s*center/.test(css)
  ) {
    align = 'center';
  } else if (
    hasClass(el, 'r', 'right', 'text-right') ||
    alignAttr === 'right' ||
    /text-align\s*:\s*right/.test(css)
  ) {
    align = 'right';
  } else if (
    hasClass(el, 'text-left') ||
    alignAttr === 'left' ||
    /text-align\s*:\s*left/.test(css)
  ) {
    align = 'left';
  }
  const bold =
    parent.bold ||
    hasClass(el, 'bold', 'brand', 'big', 'total', 'font-bold') ||
    /^(B|STRONG|TH|H[1-4])$/.test(el.tagName) ||
    /font-weight\s*:\s*(bold|[6-9]00)/.test(css);
  const double = parent.double || hasClass(el, 'big') || el.tagName === 'H1';
  return { align, bold, double };
}

/** Elementning ko'rinadigan matni (yashirin/rasm bolalarsiz). */
function visibleText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  if (SKIP_TAGS.has(el.tagName) || isHidden(el)) return '';
  if (el.tagName === 'BR') return ' ';
  let out = '';
  el.childNodes.forEach((c) => {
    out += visibleText(c);
  });
  return out;
}

function elementChildren(el: Element): Element[] {
  return Array.from(el.children).filter((c) => !SKIP_TAGS.has(c.tagName) && !isHidden(c));
}

/**
 * Chek HTML'ini (to'liq hujjat yoki tana bo'lagi) termal printer qatorlariga
 * aylantiradi. Natija `print_thermal` ga to'g'ridan-to'g'ri beriladi.
 */
export function htmlToThermalContent(html: string, paper: PaperWidth): ThermalReceiptContent {
  const width = receiptCharsPerLine(paper);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines: Line[] = [];

  // Joriy (inline) qator bo'laklari.
  let buf = '';
  let bufStyle: Style | null = null;
  let bufAllBold = true;

  const push = (text: string, s: Style, bold = s.bold) => {
    // Boshidagi bo'shliq saqlanadi (o'ngga surilgan summa qatori).
    const t = text.trim() ? text.replace(/\s+$/, '') : '';
    if (!t && (lines.length === 0 || lines[lines.length - 1]!.text === '')) return;
    const line: Line = { text: t };
    if (t && s.align !== 'left') line.align = s.align;
    if (t && bold) line.bold = true;
    if (t && s.double) line.double = true;
    lines.push(line);
  };

  const flush = () => {
    if (bufStyle && buf.trim()) push(clean(buf).trim(), bufStyle, bufStyle.bold || bufAllBold);
    buf = '';
    bufStyle = null;
    bufAllBold = true;
  };

  const append = (text: string, block: Style, inline: Style) => {
    if (!text) return;
    if (!bufStyle) bufStyle = block;
    if (text.trim()) bufAllBold = bufAllBold && inline.bold;
    buf += text;
  };

  const row = (cells: Element[], s: Style) => {
    const w = s.double ? Math.floor(width / 2) : width;
    const texts = cells.map((c) => clean(visibleText(c)).trim());
    const right = texts.length > 1 ? texts[texts.length - 1]! : '';
    const left = texts
      .slice(0, texts.length > 1 ? -1 : undefined)
      .filter(Boolean)
      .join(' ');
    const bold = s.bold || cells.every((c) => styleOf(c, s).bold);
    const ls = { ...s, align: 'left' as const };
    if (left && right && left.length + right.length + 1 > w) {
      // Uzun nom — summa keyingi qatorda o'ng chetda (printer o'zi bo'lib yubormasin).
      push(left, ls, bold);
      push(right.padStart(w), ls, bold);
      return;
    }
    push(padRow(left, right, w), ls, bold);
  };

  const walk = (el: Element, block: Style, inline: Style) => {
    el.childNodes.forEach((node) => {
      if (node.nodeType === 3) {
        append(node.textContent ?? '', block, inline);
        return;
      }
      if (node.nodeType !== 1) return;
      const child = node as Element;
      const tag = child.tagName;
      if (SKIP_TAGS.has(tag) || isHidden(child)) return;
      if (tag === 'BR') {
        flush();
        return;
      }
      const s = styleOf(child, inline);
      if (INLINE_TAGS.has(tag)) {
        walk(child, block, s);
        return;
      }

      // Blok element — oldingi inline matn alohida qator bo'ladi.
      flush();
      if (tag === 'HR' || (hasClass(child, 'line', 'divider') && !visibleText(child).trim())) {
        push('-'.repeat(width), s);
        return;
      }
      if (tag === 'TR') {
        const cells = elementChildren(child).filter(
          (c) => c.tagName === 'TD' || c.tagName === 'TH',
        );
        if (cells.length > 0) row(cells, s);
        return;
      }
      if (hasClass(child, 'row')) {
        const cells = elementChildren(child);
        if (cells.length >= 2) {
          row(cells, s);
          return;
        }
      }
      walk(child, s, s);
      flush();
    });
  };

  const base: Style = { align: 'left', bold: false, double: false };
  if (doc.body) walk(doc.body, base, base);
  flush();
  while (lines.length && lines[lines.length - 1]!.text === '') lines.pop();
  return { lines, cut: true };
}
