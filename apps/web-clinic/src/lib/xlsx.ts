/**
 * Excel/CSV import/export helpers for pharmacy goods receipt.
 *
 * Lazy-loaded `xlsx` to keep the main bundle slim — the import only
 * fires when the user actually uses Excel-related buttons.
 */

export interface ImportedReceiptRow {
  name: string;
  strength?: string;
  quantity: number;
  unit_cost_uzs: number;
  batch_no?: string;
  expiry_date?: string; // ISO YYYY-MM-DD
}

const HEADER_ALIASES: Record<keyof ImportedReceiptRow, string[]> = {
  name: ['nom', 'name', 'dori', 'preparat', 'наименование', 'название'],
  strength: ['mg', 'strength', 'doza', 'дозировка'],
  quantity: ['soni', 'qty', 'quantity', 'miqdor', 'количество', 'кол-во'],
  unit_cost_uzs: ['narx', 'price', 'cost', 'sotib_olish', 'narxi', 'цена', 'себестоимость'],
  batch_no: ['seriya', 'batch', 'lot', 'partiya', 'серия'],
  expiry_date: ['sana', 'expiry', 'expiry_date', 'amal_qilish', 'срок_годности', 'годен_до'],
};

function normalizeHeader(h: string): string {
  return h.toString().trim().toLowerCase().replace(/[\s_-]+/g, '_');
}

function detectColumns(headers: string[]): Record<keyof ImportedReceiptRow, number> {
  const map: Partial<Record<keyof ImportedReceiptRow, number>> = {};
  const normalized = headers.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [keyof ImportedReceiptRow, string[]]
  >) {
    for (const alias of aliases) {
      const idx = normalized.findIndex((h) => h === alias || h.includes(alias));
      if (idx >= 0) {
        map[field] = idx;
        break;
      }
    }
  }
  return map as Record<keyof ImportedReceiptRow, number>;
}

function parseExcelDate(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    // Excel serial date — converted by xlsx with cellDates:true, but fallback:
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : undefined;
  }
  const s = String(value).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD.MM.YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const year = yyyy!.length === 2 ? `20${yyyy}` : yyyy;
    return `${year}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
  }
  return undefined;
}

export async function parseReceiptFile(file: File): Promise<ImportedReceiptRow[]> {
  // @ts-expect-error xlsx types installed at server build time
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  if (aoa.length < 2) return [];

  const headers = (aoa[0] as unknown[]).map((c) => String(c ?? ''));
  const cols = detectColumns(headers);

  const rows: ImportedReceiptRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    if (!row || row.every((c) => c === '' || c == null)) continue;

    const name = cols.name != null ? String(row[cols.name] ?? '').trim() : '';
    if (!name) continue;

    const quantity = cols.quantity != null ? Number(row[cols.quantity]) : 0;
    const unit_cost_uzs = cols.unit_cost_uzs != null ? Number(row[cols.unit_cost_uzs]) : 0;
    const strength =
      cols.strength != null ? String(row[cols.strength] ?? '').trim() || undefined : undefined;
    const batch_no =
      cols.batch_no != null ? String(row[cols.batch_no] ?? '').trim() || undefined : undefined;
    const expiry_date =
      cols.expiry_date != null ? parseExcelDate(row[cols.expiry_date]) : undefined;

    rows.push({
      name,
      strength,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit_cost_uzs: Number.isFinite(unit_cost_uzs) ? unit_cost_uzs : 0,
      batch_no,
      expiry_date,
    });
  }
  return rows;
}

export async function exportReceiptTemplate(): Promise<void> {
  // @ts-expect-error xlsx types installed at server build time
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['nom', 'mg', 'soni', 'narx', 'seriya', 'sana'],
    ['Paracetamol', '500', 100, 1500, 'B-2025-01', '2027-12-31'],
    ['Amoxicillin', '250', 50, 8000, 'B-2025-02', '2026-08-15'],
  ]);
  ws['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Prixod');
  XLSX.writeFile(wb, 'clary-prixod-shablon.xlsx');
}

export interface MedicationRow {
  name: string;
  strength?: string | null;
  unit?: string | null;
  price_uzs?: number | null;
  stock?: number | null;
  barcode?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
}

export async function exportMedications(rows: MedicationRow[], fileName = 'clary-dorilar.xlsx'): Promise<void> {
  // @ts-expect-error xlsx types installed at server build time
  const XLSX = await import('xlsx');
  const aoa: (string | number)[][] = [
    ['nom', 'mg', 'birlik', 'narx', 'soni', 'barcode', 'seriya', 'sana'],
  ];
  for (const r of rows) {
    aoa.push([
      r.name,
      r.strength ?? '',
      r.unit ?? '',
      r.price_uzs ?? 0,
      r.stock ?? 0,
      r.barcode ?? '',
      r.batch_no ?? '',
      r.expiry_date ?? '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
    { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dorilar');
  XLSX.writeFile(wb, fileName);
}
