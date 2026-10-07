// =============================================================================
// Prixod qatori — sof hisob-kitob va tekshiruvlar (testlanadi)
// =============================================================================
// Qator kiritilgan birlikda (qadoq yoki dona): soni, tannarx, sotuv narxi.
// Server (pharmacy_receive) donaga o'tkazadi: dona = soni × qadoqdagi dona,
// dona tannarxi = kiritilgan tannarx / qadoqdagi dona. Jami summa fakturadagi
// kabi (soni × kiritilgan narx) — yaxlitlash farqi bo'lmaydi.
// =============================================================================

import type {
  DrugReferenceHit,
  PharmacyImportMatch,
  PharmacyReceiptItemBody,
} from '@clary/api-client';
import { salePriceFromCost } from '@clary/utils';

export type MatchKind =
  | 'barcode'
  | 'alias'
  | 'mxik'
  | 'name'
  | 'manual'
  | 'new'
  | 'suggested'
  /** Davlat katalogidan (MXIK) qo'shilgan. */
  | 'reference'
  | null;

export interface ReceiptMed {
  id: string;
  name: string;
  strength: string | null;
  pack_qty: number;
  price_uzs: number;
  pack_price_uzs: number | null;
  unit_name: string | null;
  manufacturer?: string | null;
  /** Hozir "donalab sotiladi" belgisi. */
  sell_by_unit?: boolean;
  /** Davlat reestri: false — ro'yxatdan o'tish muddati tugagan. */
  reg_active?: boolean | null;
  mxik_code?: string | null;
}

export interface NewMedDraft {
  name: string;
  strength?: string;
  form?: string;
  manufacturer?: string;
  barcode?: string;
  mxik_code?: string;
  pack_qty?: number;
  /** Davlat katalogidagi mos dori (MXIK) — kirimda shu katalog yozuvidan yaratiladi. */
  ref_mxik?: string;
}

export interface ReceiptLine {
  key: string;
  /** Fakturadagi nom (yoki dori nomi) — alias xotirasi uchun. */
  source_name: string;
  source_row?: number;
  medication_id: string | null;
  med: ReceiptMed | null;
  match: MatchKind;
  score?: number | null;
  candidates?: PharmacyImportMatch['candidates'];
  new_med?: NewMedDraft | null;
  unit_kind: 'pack' | 'unit';
  qty: number;
  /** Kiritilgan birlik tannarxi. */
  cost: number;
  markup: number;
  /** Kiritilgan birlik sotuv narxi; null → ustamadan hisoblanadi. */
  sale: number | null;
  batch_no: string;
  expiry: string;
  mfg_date: string;
  manufacturer: string;
  gtin: string;
  mxik: string;
  doctor_share_kind: 'percent' | 'bonus';
  doctor_share_value: number;
  /** Tekshirish rejimi: skanerlangan qutilar. */
  checked?: number;
  serials?: string[];
  last?: PharmacyImportMatch['last'];
  file_total?: number | null;
  /** Dorining shtrix-kodi bazada yo'q — qutini skanerlash kutilmoqda. */
  needs_code?: boolean;
  /** "Donalab sotiladi" belgisi (undefined — o'zgarmaydi). */
  sell_by_unit?: boolean;
  /** O'z bazadagi dori uchun umumiy bazadan taklif (nomi bo'yicha topilgan). */
  ref_suggest?: DrugReferenceHit | null;
  /** Taklif qilingan variantlar soni (1 dan ko'p — tanlash kerak). */
  ref_variants?: number;
}

export interface ReceiptPolicy {
  rounding: number;
  keepHigher: boolean;
  requireExpiry: boolean;
  nearExpiryDays: number;
  /** Shtrix-kod faqat skaner bilan (qo'lda yozilmaydi); skanerlanmagan qator — ogohlantirish. */
  scanOnly?: boolean;
}

export const DEFAULT_POLICY: ReceiptPolicy = {
  rounding: 100,
  keepHigher: false,
  requireExpiry: false,
  nearExpiryDays: 90,
  scanOnly: false,
};

let seq = 0;
export function newLineKey(): string {
  seq += 1;
  return `r${Date.now().toString(36)}${seq}`;
}

export function emptyLine(partial: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    key: newLineKey(),
    source_name: '',
    medication_id: null,
    med: null,
    match: null,
    unit_kind: 'pack',
    qty: 1,
    cost: 0,
    markup: 0,
    sale: null,
    batch_no: '',
    expiry: '',
    mfg_date: '',
    manufacturer: '',
    gtin: '',
    mxik: '',
    doctor_share_kind: 'percent',
    doctor_share_value: 0,
    ...partial,
  };
}

export function lineFactor(l: ReceiptLine): number {
  return l.unit_kind === 'pack' ? Math.max(1, l.med?.pack_qty ?? l.new_med?.pack_qty ?? 1) : 1;
}

export function lineBaseQty(l: ReceiptLine): number {
  return l.qty * lineFactor(l);
}

export function lineCostTotal(l: ReceiptLine): number {
  return Math.round((Number(l.qty) || 0) * (Number(l.cost) || 0));
}

/** Kiritilgan birlik uchun sotuv narxi (qo'lda yoki ustamadan). */
export function lineSale(l: ReceiptLine, policy: ReceiptPolicy): number {
  if (l.sale != null && l.sale > 0) return Math.round(l.sale);
  return salePriceFromCost(l.cost, l.markup, policy.rounding);
}

/** Hozirgi (eski) narx — kiritilgan birlikda. */
export function currentSale(l: ReceiptLine): number | null {
  if (!l.med) return null;
  if (l.unit_kind === 'pack' && l.med.pack_qty > 1) {
    return l.med.pack_price_uzs ?? l.med.price_uzs * l.med.pack_qty;
  }
  return l.med.price_uzs;
}

export type Issue = { level: 'error' | 'warn'; text: string };

function daysUntil(isoDate: string, today: Date): number {
  const d = new Date(`${isoDate}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

export function lineIssues(l: ReceiptLine, policy: ReceiptPolicy, today = new Date()): Issue[] {
  const out: Issue[] = [];
  if (!l.medication_id) {
    if (l.match !== 'suggested' && l.new_med?.name.trim()) {
      // Qo'lda kiritilgan yangi dori — kirim paytida bazaga avtomatik qo'shiladi
      out.push({ level: 'warn', text: 'Yangi dori — kirimda bazaga qo‘shiladi' });
    } else {
      out.push({
        level: 'error',
        text:
          l.match === 'suggested'
            ? 'O‘xshash dori topildi — tasdiqlang'
            : l.new_med
              ? 'Yangi dori nomini kiriting'
              : 'Dori tanlanmagan — bog‘lang yoki yangi yarating',
      });
    }
  }
  if (!(l.qty > 0)) out.push({ level: 'error', text: 'Soni kiritilmagan' });
  else if (!Number.isInteger(Math.round(lineBaseQty(l) * 1000) / 1000)) {
    out.push({ level: 'error', text: 'Soni butun dona bo‘lishi kerak' });
  }
  if (l.cost < 0) out.push({ level: 'error', text: 'Tannarx manfiy' });
  else if (l.cost === 0) out.push({ level: 'warn', text: 'Tannarx 0' });
  const sale = lineSale(l, policy);
  if (l.cost > 0 && sale < l.cost)
    out.push({ level: 'error', text: 'Sotuv narxi tannarxdan past' });
  if (!l.expiry) {
    out.push({
      level: policy.requireExpiry ? 'error' : 'warn',
      text: 'Yaroqlilik muddati kiritilmagan',
    });
  } else {
    const days = daysUntil(l.expiry, today);
    if (days < 0) out.push({ level: 'error', text: 'Muddati o‘tgan' });
    else if (days < policy.nearExpiryDays)
      out.push({ level: 'warn', text: `Muddati yaqin (${days} kun)` });
  }
  if (l.mfg_date) {
    if (daysUntil(l.mfg_date, today) > 0) {
      out.push({ level: 'warn', text: 'Ishlab chiqarilgan sana kelajakda' });
    }
    if (l.expiry && l.mfg_date >= l.expiry) {
      out.push({ level: 'error', text: 'Ishlab chiqarilgan sana yaroqlilik muddatidan keyin' });
    }
  }
  if (l.med?.reg_active === false) {
    out.push({ level: 'warn', text: 'Davlat reestrida ro‘yxatdan o‘tish muddati tugagan' });
  }
  if (policy.scanOnly && l.needs_code && !l.gtin) {
    out.push({ level: 'warn', text: 'Shtrix-kod skanerlanmagan' });
  }
  const last = l.last;
  if (last && l.medication_id) {
    const lastEntered = last.entered_qty ?? last.qty;
    const sameUnit = (last.unit_kind ?? 'unit') === l.unit_kind;
    if (sameUnit && lastEntered > 0 && l.qty > lastEntered * 10) {
      out.push({ level: 'warn', text: `Soni odatdagidan ancha ko‘p (oldin ${lastEntered})` });
    }
    const baseCost = l.cost / lineFactor(l);
    if (last.unit_cost_uzs > 0 && baseCost > 0) {
      const ratio = baseCost / last.unit_cost_uzs;
      if (ratio > 1.5 || ratio < 0.5) {
        out.push({
          level: 'warn',
          text: `Tannarx oldingidan ${Math.round((ratio - 1) * 100)}% farq qiladi`,
        });
      }
    }
  }
  if (l.checked != null && l.checked < l.qty) {
    out.push({ level: 'warn', text: `Kam keldi: ${l.qty - l.checked} ta` });
  }
  if (l.checked != null && l.checked > l.qty) {
    out.push({ level: 'warn', text: `Fakturadan ko‘p: +${l.checked - l.qty}` });
  }
  if (l.file_total != null && l.file_total > 0) {
    const diff = Math.abs(l.file_total - lineCostTotal(l));
    if (diff > Math.max(10, l.file_total * 0.005)) {
      out.push({ level: 'warn', text: 'Qator summasi fakturadagidan farq qiladi' });
    }
  }
  return out;
}

export function toApiItem(l: ReceiptLine, policy: ReceiptPolicy): PharmacyReceiptItemBody {
  const sale = lineSale(l, policy);
  const pack = Math.max(1, l.med?.pack_qty ?? 1);
  const isPack = l.unit_kind === 'pack' && pack > 1;
  return {
    medication_id: l.medication_id!,
    quantity: l.qty,
    unit_kind: l.unit_kind,
    unit_cost_uzs: l.cost,
    profit_percent: l.markup || 0,
    sale_price_uzs: isPack ? Math.round(sale / pack) : sale,
    pack_price_uzs: isPack ? sale : undefined,
    keep_higher_price: policy.keepHigher,
    doctor_share_percent: l.doctor_share_kind === 'percent' ? l.doctor_share_value || 0 : 0,
    doctor_share_bonus_uzs:
      l.doctor_share_kind === 'bonus'
        ? Math.round((l.doctor_share_value || 0) / (isPack ? pack : 1))
        : 0,
    manufacturer: l.manufacturer || undefined,
    manufacture_date: l.mfg_date || undefined,
    batch_no: l.batch_no || undefined,
    expiry_date: l.expiry || undefined,
    gtin: l.gtin || undefined,
    mxik_code: l.mxik || undefined,
    source_name: l.source_name && l.source_name !== l.med?.name ? l.source_name : undefined,
    sell_by_unit:
      l.sell_by_unit !== undefined && pack > 1 && l.sell_by_unit !== !!l.med?.sell_by_unit
        ? l.sell_by_unit
        : undefined,
  };
}

export function receiptTotals(lines: ReceiptLine[], policy: ReceiptPolicy) {
  let cost = 0;
  let sale = 0;
  let base = 0;
  for (const l of lines) {
    cost += lineCostTotal(l);
    sale += Math.round(lineSale(l, policy) * l.qty);
    base += lineBaseQty(l);
  }
  return {
    positions: lines.length,
    base_qty: base,
    cost_total: cost,
    sale_total: sale,
    profit: sale - cost,
  };
}
