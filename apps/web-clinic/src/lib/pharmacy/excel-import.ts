// =============================================================================
// Firma Excel fakturasini o'qish — bitta fayl bilan prixod
// =============================================================================
// Real fakturalarda tepada rekvizitlar (firma, STIR, sana) turadi, sarlavha
// 1-qatorda bo'lmaydi, ustunlar ruscha/o'zbekcha, sonlar "1 250,50" ko'rinishida,
// oxirida "Итого/Jami" qatori bor. Bu modul:
//   1) sarlavha qatorini avtomatik topadi;
//   2) ustunlarni nomi bo'yicha aniqlaydi (UZ/RU/EN sinonimlar);
//   3) son va sanalarni har xil formatdan o'qiydi;
//   4) yakuniy (jami) qatorlarni tashlaydi, jami summani tekshiruv uchun oladi.
// Ustun moslashuvi firma bo'yicha serverda eslab qolinadi (keyingi safar 0 bosish).
// =============================================================================

export type ImportField =
  | 'name'
  | 'strength'
  | 'form'
  | 'manufacturer'
  | 'quantity'
  | 'unit'
  | 'cost'
  | 'total'
  | 'vat'
  | 'barcode'
  | 'mxik'
  | 'batch'
  | 'expiry'
  | 'mfg_date'
  | 'sale_price'
  | 'supplier_code';

export const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nomi',
  strength: 'Dozasi',
  form: 'Shakli',
  manufacturer: 'Ishlab chiqaruvchi',
  quantity: 'Soni',
  unit: "O'lchov birligi",
  cost: 'Narxi (tannarx)',
  total: 'Summa',
  vat: 'QQS',
  barcode: 'Shtrix-kod',
  mxik: 'MXIK (IKPU)',
  batch: 'Seriya',
  expiry: 'Yaroqlilik muddati',
  mfg_date: 'Ishlab chiqarilgan sana',
  sale_price: 'Sotuv narxi',
  supplier_code: 'Firma kodi',
};

/** Sinonimlar (normallashgan: kichik harf, tinish belgisiz). Tartib — ustuvorlik. */
const ALIASES: Record<ImportField, string[]> = {
  name: [
    'наименование товаров',
    'наименование товара',
    'наименование',
    'название',
    'товар',
    'nomi',
    'nom',
    'tovar nomi',
    'mahsulot nomi',
    'mahsulot',
    'dori',
    'preparat',
    'name',
    'product',
    'item',
    'description',
    'препарат',
  ],
  strength: ['дозировка', 'доза', 'dozasi', 'doza', 'strength', 'mg'],
  form: ['лекарственная форма', 'форма выпуска', 'форма', 'shakli', 'form'],
  manufacturer: [
    'производитель',
    'изготовитель',
    'страна производитель',
    'ishlab chiqaruvchi',
    'manufacturer',
    'brand',
    'завод',
  ],
  quantity: [
    'количество',
    'кол во',
    'колво',
    'кол',
    'soni',
    'miqdori',
    'miqdor',
    'qty',
    'quantity',
    'count',
  ],
  unit: [
    'единица измерения',
    'ед изм',
    'ед',
    'единица',
    'o lchov',
    'olchov',
    'birlik',
    'unit',
    'uom',
  ],
  cost: [
    'цена с ндс',
    'цена за единицу',
    'цена за ед',
    'цена',
    'narxi',
    'narx',
    'birlik narxi',
    'tannarx',
    'price',
    'unit price',
    'cost',
  ],
  total: [
    'сумма с ндс',
    'стоимость с ндс',
    'итого с ндс',
    'сумма',
    'стоимость',
    'summa',
    'jami summa',
    'total',
    'amount',
  ],
  vat: ['ставка ндс', 'ндс', 'qqs', 'vat'],
  barcode: ['штрих код', 'штрихкод', 'штрих', 'shtrix kod', 'shtrix', 'barcode', 'ean', 'gtin'],
  mxik: [
    'код икпу',
    'икпу код',
    'код мхик',
    'mxik kodi',
    'ikpu kodi',
    'икпу',
    'мхик',
    'mxik',
    'ikpu',
    'идентификационный код',
    'код каталога',
    'catalog code',
  ],
  batch: ['серия', 'партия', 'seriya', 'partiya', 'batch', 'lot'],
  expiry: [
    'срок годности',
    'годен до',
    'срок',
    'yaroqlilik',
    'amal qilish muddati',
    'muddati',
    'expiry',
    'exp',
  ],
  mfg_date: [
    'дата производства',
    'дата изготовления',
    'ishlab chiqarilgan',
    'mfg',
    'production date',
  ],
  sale_price: ['розничная цена', 'отпускная цена', 'sotuv narxi', 'retail price', 'sale price'],
  supplier_code: ['артикул', 'код товара', 'код', 'kod', 'sku', 'code'],
};

const TOTAL_ROW = /^(итого|всего|jami|total|итог|барча|umumiy)/i;

export function normHeader(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/['`ʻʼ‘’"«»]/g, ' ')
    .replace(/[.,:;()\\/№#*_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bitta sarlavha katagi qaysi maydon (va ishonch darajasi: 3 aniq, 2 boshi, 1 ichida). */
export function matchHeader(cell: unknown): { field: ImportField; score: number } | null {
  const h = normHeader(cell);
  if (!h) return null;
  // "Сумма НДС" / "Ставка НДС" — bu QQS, mahsulot summasi emas
  if (/(сумма|ставка)\s*ндс|ндс\s*(сумма|ставка)|qqs (summasi|stavkasi)/.test(h)) {
    return { field: 'vat', score: 3 };
  }
  let best: { field: ImportField; score: number; len: number } | null = null;
  for (const field of Object.keys(ALIASES) as ImportField[]) {
    for (const a of ALIASES[field]) {
      let score = 0;
      if (h === a) score = 3;
      else if (h.startsWith(a + ' ') || h.startsWith(a)) score = 2;
      else if (a.length >= 4 && h.includes(a)) score = 1;
      if (
        score > 0 &&
        (!best || score > best.score || (score === best.score && a.length > best.len))
      ) {
        best = { field, score, len: a.length };
      }
    }
  }
  return best ? { field: best.field, score: best.score } : null;
}

export type ColumnMapping = Partial<Record<ImportField, number>>;

/** Sarlavha qatorini topadi: eng ko'p maydon mos kelgan qator (nom + soni/narx shart). */
export function detectHeader(
  rows: unknown[][],
  scanRows = 40,
): { headerRow: number; mapping: ColumnMapping; confidence: number } {
  let best = { headerRow: 0, mapping: {} as ColumnMapping, confidence: 0 };
  const limit = Math.min(rows.length, scanRows);
  for (let r = 0; r < limit; r++) {
    const mapping = mapColumns(rows[r] ?? []);
    const fields = Object.keys(mapping) as ImportField[];
    const has = (f: ImportField) => mapping[f] !== undefined;
    if (!has('name') || !(has('quantity') || has('cost') || has('total'))) continue;
    const conf = fields.length;
    if (conf > best.confidence) best = { headerRow: r, mapping, confidence: conf };
  }
  return best;
}

/** Sarlavha qatoridan ustun moslashuvi (har maydon bir marta, eng aniq moslik g'olib). */
export function mapColumns(header: unknown[]): ColumnMapping {
  const cands: Array<{ col: number; field: ImportField; score: number }> = [];
  header.forEach((cell, col) => {
    const m = matchHeader(cell);
    if (m) cands.push({ col, ...m });
  });
  // QQS bilan narx/summa ustunlari ustun (dorixona QQS bilan to'laydi)
  const withVat = (col: number) =>
    /(^|\s)(с ндс|qqs bilan|with vat|incl)/.test(normHeader(header[col]));
  cands.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.field === 'cost' || a.field === 'total') && a.field === b.field) {
      return Number(withVat(b.col)) - Number(withVat(a.col));
    }
    return a.col - b.col;
  });
  const out: ColumnMapping = {};
  const usedCols = new Set<number>();
  for (const c of cands) {
    if (out[c.field] !== undefined || usedCols.has(c.col)) continue;
    // "ставка ндс" (foiz) va "сумма ндс" (summa) ni QQS ustuni deb olamiz; summa emas
    if (c.field === 'total' && /^ндс|^qqs/.test(normHeader(header[c.col]))) continue;
    out[c.field] = c.col;
    usedCols.add(c.col);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Son va sana
// -----------------------------------------------------------------------------

/** "1 250,50" · "1,250.50" · "1.250,50" · 1250.5 → 1250.5. O'qib bo'lmasa null. */
export function parseNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v)
    .replace(/[\s  ']/g, '')
    .replace(/(so['ʻ`]?m|сум|uzs)$/i, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Oxirgisi — o'nlik ajratgich
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    const commas = (s.match(/,/g) ?? []).length;
    s = commas === 1 && tail > 0 && tail <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const tail = s.length - lastDot - 1;
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1 || (tail === 3 && dots === 1 && /^\d{1,3}\.\d{3}$/.test(s)))
      s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > lastDayOfMonth(y, m)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Sana: Date, Excel seriya raqami, "31.12.2027", "31/12/27", "2027-12-31",
 * "12.2027" / "12/27" / "2027-12" (oy oxiri — dori muddati odatda shunday).
 */
export function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Excel sanalari mahalliy yarim tunda keladi — UTC'ga siljimasin
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{1,2})[-./](\d{2,4})$/);
  if (m) {
    const y = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    const mo = Number(m[1]);
    return iso(y, mo, lastDayOfMonth(y, mo));
  }
  m = s.match(/^(\d{4})[-./](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return iso(y, mo, lastDayOfMonth(y, mo));
  }
  return null;
}

/**
 * O'lchov birligi: qadoq yoki dona.
 * ⚠️ "шт" / "dona" / "pcs" distributor fakturasida odatda QUTI degani — shuning
 * uchun aniqlanmaydi (null → qadoq standart). Faqat tabletka/kapsula/ampula/
 * blister aniq yozilgandagina dona deb olinadi — aks holda 10 talik qutidagi
 * 5 quti 5 tabletka bo'lib kirib qolardi.
 */
export function parseUnitKind(v: unknown): 'pack' | 'unit' | null {
  const s = normHeader(v);
  if (!s) return null;
  if (/^(уп|упак|упаковка|кор|короб|qadoq|quti|pack|box|pkg|флак|фл|fl|flakon|бут)/.test(s))
    return 'pack';
  if (/^(таб|tab|amp|амп|капс|kaps|блис|blist)/.test(s)) return 'unit';
  return null;
}

// -----------------------------------------------------------------------------
// Qatorlarni ajratish
// -----------------------------------------------------------------------------
export interface ImportedRow {
  /** Fayldagi qator raqami (1 dan, Excel'dagi kabi). */
  row: number;
  name: string;
  strength?: string;
  form?: string;
  manufacturer?: string;
  quantity: number | null;
  unit_kind: 'pack' | 'unit' | null;
  cost: number | null;
  total: number | null;
  vat?: number | null;
  barcode?: string;
  mxik?: string;
  batch?: string;
  expiry?: string | null;
  mfg_date?: string | null;
  sale_price?: number | null;
  supplier_code?: string;
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return parseDate(v) ?? '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function codeStr(v: unknown): string {
  // Shtrix-kod Excel'da son bo'lib qolishi mumkin (4.78E+12) — butun songa
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v).toString();
  return cellStr(v).replace(/\s+/g, '');
}

export function extractRows(
  rows: unknown[][],
  headerRow: number,
  mapping: ColumnMapping,
): { rows: ImportedRow[]; fileTotal: number | null } {
  const get = (r: unknown[], f: ImportField) =>
    mapping[f] !== undefined ? r[mapping[f]!] : undefined;
  const out: ImportedRow[] = [];
  let fileTotal: number | null = null;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => c == null || String(c).trim() === '')) continue;
    const name = cellStr(get(r, 'name'));
    const firstText = r.map(cellStr).find((c) => c) ?? '';
    // "Итого / Jami" qatori — jami summani eslab qolamiz, mahsulot emas
    if (TOTAL_ROW.test(name) || (!name && TOTAL_ROW.test(firstText))) {
      const t = parseNumber(get(r, 'total'));
      if (t != null) fileTotal = t;
      continue;
    }
    if (!name) continue;
    // Raqamlangan sarlavha qatori (1 2 3 4 ...) — tashlaymiz
    if (/^\d+$/.test(name) && parseNumber(get(r, 'quantity')) === Number(name) + 1) continue;
    const quantity = parseNumber(get(r, 'quantity'));
    let cost = parseNumber(get(r, 'cost'));
    const total = parseNumber(get(r, 'total'));
    if ((cost == null || cost === 0) && total != null && quantity)
      cost = Math.round((total / quantity) * 100) / 100;
    out.push({
      row: i + 1,
      name,
      strength: cellStr(get(r, 'strength')) || undefined,
      form: cellStr(get(r, 'form')) || undefined,
      manufacturer: cellStr(get(r, 'manufacturer')) || undefined,
      quantity,
      unit_kind: parseUnitKind(get(r, 'unit')),
      cost,
      total,
      vat: parseNumber(get(r, 'vat')),
      barcode: codeStr(get(r, 'barcode')) || undefined,
      mxik: codeStr(get(r, 'mxik')) || undefined,
      batch: cellStr(get(r, 'batch')) || undefined,
      expiry: parseDate(get(r, 'expiry')),
      mfg_date: parseDate(get(r, 'mfg_date')),
      sale_price: parseNumber(get(r, 'sale_price')),
      supplier_code: cellStr(get(r, 'supplier_code')) || undefined,
    });
  }
  return { rows: out, fileTotal };
}

// -----------------------------------------------------------------------------
// Fayl
// -----------------------------------------------------------------------------
export interface Spreadsheet {
  fileName: string;
  fileHash: string;
  sheets: Array<{ name: string; rows: unknown[][] }>;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export async function readSpreadsheet(file: File): Promise<Spreadsheet> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const isCsv = /\.(csv|txt)$/i.test(file.name);
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buf), {
        type: 'string',
        cellDates: true,
        raw: false,
      })
    : XLSX.read(buf, { type: 'array', cellDates: true });
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name]!, {
      header: 1,
      defval: '',
      raw: true,
    }) as unknown[][],
  })).filter((s) => s.rows.length > 0);
  return { fileName: file.name, fileHash: await sha256Hex(buf), sheets };
}

/** Eng ko'p mahsulot qatori chiqqan varaqni tanlaydi. */
export function pickSheet(sheets: Spreadsheet['sheets']) {
  let best: { index: number; header: ReturnType<typeof detectHeader>; count: number } | null = null;
  sheets.forEach((s, index) => {
    const header = detectHeader(s.rows);
    if (header.confidence === 0) return;
    const count = extractRows(s.rows, header.headerRow, header.mapping).rows.length;
    if (!best || count > best.count) best = { index, header, count };
  });
  return best as { index: number; header: ReturnType<typeof detectHeader>; count: number } | null;
}

/** Clipboard'dan (Excel'dan nusxa) TSV matnni qatorlarga ajratadi. */
export function parseTsv(text: string): unknown[][] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => l.split('\t'));
}
