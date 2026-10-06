// =============================================================================
// Davlat reestri (uzpharm-control.uz) Excel faylini o'qish
// =============================================================================
// Reestr saytda "Yuklab olish" (captcha) orqali Excel bo'lib keladi. Ustun nomlari
// ruscha/o'zbekcha/inglizcha bo'lishi mumkin va vaqt o'tib o'zgaradi — shuning
// uchun sarlavha qatori va ustunlar NOMI bo'yicha topiladi, super admin esa
// noto'g'ri topilgan ustunni sahifada qo'lda tuzatadi.
// =============================================================================

import type { DrugRegistryRowBody } from '@clary/api-client';

export type RegistryField =
  | 'reg_number'
  | 'trade_name'
  | 'generic_name'
  | 'atc_code'
  | 'manufacturer'
  | 'country'
  | 'product_type'
  | 'status'
  | 'reg_date'
  | 'valid_until'
  | 'rx'
  | 'release_form'
  | 'dosage';

export const REGISTRY_FIELDS: Array<{ key: RegistryField; label: string; required?: boolean }> = [
  { key: 'trade_name', label: 'Savdo nomi', required: true },
  { key: 'reg_number', label: 'Ro‘yxat raqami' },
  { key: 'manufacturer', label: 'Ishlab chiqaruvchi' },
  { key: 'country', label: 'Mamlakat' },
  { key: 'generic_name', label: 'MNN (xalqaro nomi)' },
  { key: 'atc_code', label: 'ATX kodi' },
  { key: 'release_form', label: 'Shakli' },
  { key: 'dosage', label: 'Dozasi' },
  { key: 'product_type', label: 'Turi (dori / tibbiy buyum)' },
  { key: 'status', label: 'Holati (amalda / muddati o‘tgan)' },
  { key: 'reg_date', label: 'Ro‘yxat sanasi' },
  { key: 'valid_until', label: 'Amal qilish muddati' },
  { key: 'rx', label: 'Retsept bilan' },
];

/** Normallashgan sarlavha sinonimlari. Tartib — ustuvorlik (aniqrog'i oldin). */
const ALIASES: Record<RegistryField, string[]> = {
  reg_number: [
    'reg number',
    'номер регистрационного удостоверения',
    'регистрационный номер',
    'номер регистрации',
    'рег номер',
    'номер ру',
    'ру',
    'registration number',
    'royxat raqami',
    'royxatdan otkazish raqami',
    'qayd raqami',
  ],
  trade_name: [
    'trade name',
    'торговое наименование',
    'торговое название',
    'наименование лекарственного средства',
    'наименование препарата',
    'наименование',
    'название',
    'savdo nomi',
    'nomi',
  ],
  generic_name: [
    'inn',
    'мнн',
    'международное непатентованное наименование',
    'xalqaro nomi',
    'халқаро номи',
  ],
  atc_code: ['atc code', 'atc', 'атх', 'код атх', 'атс'],
  manufacturer: [
    'main manufacturer name',
    'производитель',
    'фирма производитель',
    'завод производитель',
    'manufacturer',
    'ishlab chiqaruvchi',
  ],
  country: [
    'main manufacturer country',
    'страна производителя',
    'страна',
    'country',
    'mamlakat',
    'davlat',
  ],
  product_type: ['drug type', 'тип продукции', 'тип', 'вид', 'type', 'turi'],
  status: ['is active', 'статус', 'состояние', 'status', 'holati', 'holat'],
  reg_date: ['reg date', 'дата регистрации', 'registration date', 'royxat sanasi'],
  valid_until: [
    'срок действия',
    'действительно до',
    'действует до',
    'дата окончания',
    'дата истечения',
    'valid until',
    'amal qilish muddati',
  ],
  rx: [
    'is prescription',
    'отпуск по рецепту',
    'условия отпуска',
    'рецептурный',
    'по рецепту',
    'prescription',
    'retsept',
  ],
  release_form: [
    'release form',
    'лекарственная форма',
    'форма выпуска',
    'форма',
    'chiqarilish shakli',
    'shakli',
  ],
  dosage: ['dosage', 'дозировка', 'doza', 'dozasi'],
};

export function normHeader(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[ʻʼ‘’'`]/g, '')
    .replace(/[_\-./№#()[\]:,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(header: string, alias: string): number {
  if (!header) return 0;
  if (header === alias) return 3;
  if (header.startsWith(alias + ' ') || header.endsWith(' ' + alias)) return 2;
  // qisqa sinonimlar ("ру", "inn", "тип") faqat to'liq so'z sifatida
  if (alias.length >= 5 && header.includes(alias)) return 1;
  return 0;
}

export type ColumnMap = Partial<Record<RegistryField, number>>;

/** Sarlavha qatori bo'yicha ustunlarni aniqlaydi (har ustun bitta maydonga). */
export function detectColumns(header: unknown[]): ColumnMap {
  const heads = header.map(normHeader);
  const candidates: Array<{ field: RegistryField; col: number; s: number; rank: number }> = [];
  for (const field of Object.keys(ALIASES) as RegistryField[]) {
    ALIASES[field].forEach((alias, rank) => {
      heads.forEach((h, col) => {
        const s = score(h, alias);
        if (s > 0) candidates.push({ field, col, s, rank });
      });
    });
  }
  candidates.sort((a, b) => b.s - a.s || a.rank - b.rank || a.col - b.col);
  const map: ColumnMap = {};
  const used = new Set<number>();
  for (const c of candidates) {
    if (map[c.field] !== undefined || used.has(c.col)) continue;
    map[c.field] = c.col;
    used.add(c.col);
  }
  return map;
}

/** Birinchi 30 qatordan eng ko'p ustun tanilgan qator — sarlavha. */
export function findHeaderRow(matrix: unknown[][]): number {
  let best = -1;
  let bestN = 0;
  for (let i = 0; i < Math.min(30, matrix.length); i++) {
    const map = detectColumns(matrix[i] ?? []);
    const n = Object.keys(map).length;
    if (map.trade_name !== undefined && n > bestN) {
      best = i;
      bestN = n;
    }
  }
  return best;
}

function iso(y: number, m: number, d: number): string | null {
  if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim();
  if (/бессроч|muddatsiz|indefinite/i.test(s)) return null;
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** "Действующий" / "Аннулирован" / true / "amalda" … → boolean | null. */
export function toActive(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (
    /недейств|не действ|истек|аннул|отозван|приостан|inactive|expired|false|muddati o|bekor/.test(s)
  )
    return false;
  if (/действ|актив|active|true|amalda|valid|faol|^да$|^yes$|^1$/.test(s)) return true;
  return null;
}

/** "По рецепту" / "Без рецепта" / true … → boolean | null. */
export function toRx(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/без|otc|false|^нет$|^no$|^0$|yo.?q|retseptsiz/.test(s)) return false;
  if (/рецепт|retsept|true|^да$|^yes$|^1$|^ha$|rx/.test(s)) return true;
  return null;
}

export function toProductType(v: unknown): 'drug' | 'device' | null {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/^ми$|мед.*изд|изделие|device|tibbiy buyum|instrument/.test(s)) return 'device';
  if (/^лс$|лек|drug|dori|препарат/.test(s)) return 'drug';
  return null;
}

function text(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = (v instanceof Date ? (toIsoDate(v) ?? '') : String(v)).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

export interface RegistryParseResult {
  headerRow: number;
  header: string[];
  columns: ColumnMap;
  rows: DrugRegistryRowBody[];
  skipped: number;
}

/** Jadval (qatorlar massivi) → reestr qatorlari. `columns` berilsa — qo'lda moslangan. */
export function parseRegistryMatrix(
  matrix: unknown[][],
  columns?: ColumnMap,
  headerRow?: number,
): RegistryParseResult {
  const hr = headerRow ?? findHeaderRow(matrix);
  if (hr < 0) return { headerRow: -1, header: [], columns: {}, rows: [], skipped: 0 };
  const header = (matrix[hr] ?? []).map((h) => String(h ?? '').trim());
  const cols = columns ?? detectColumns(matrix[hr] ?? []);
  const get = (row: unknown[], f: RegistryField) => {
    const c = cols[f];
    return c === undefined ? undefined : row[c];
  };
  const rows: DrugRegistryRowBody[] = [];
  let skipped = 0;
  for (let i = hr + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const trade = text(get(row, 'trade_name'), 500);
    if (!trade) {
      if (row.some((c) => c != null && String(c).trim() !== '')) skipped++;
      continue;
    }
    rows.push({
      trade_name: trade,
      reg_number: text(get(row, 'reg_number'), 100),
      generic_name: text(get(row, 'generic_name'), 300),
      atc_code: text(get(row, 'atc_code'), 10)?.toUpperCase() ?? null,
      manufacturer: text(get(row, 'manufacturer'), 300),
      country: text(get(row, 'country'), 100),
      release_form: text(get(row, 'release_form'), 300),
      dosage: text(get(row, 'dosage'), 200),
      product_type: toProductType(get(row, 'product_type')),
      is_active: toActive(get(row, 'status')),
      reg_date: toIsoDate(get(row, 'reg_date')),
      valid_until: toIsoDate(get(row, 'valid_until')),
      rx_required: toRx(get(row, 'rx')),
    });
  }
  return { headerRow: hr, header, columns: cols, rows, skipped };
}

/** Excel/CSV faylni jadvalga o'qish (eng ko'p qatorli varaq). */
export async function readSpreadsheetMatrix(file: File): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  let best: unknown[][] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const m = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    if (m.length > best.length) best = m;
  }
  return best;
}
