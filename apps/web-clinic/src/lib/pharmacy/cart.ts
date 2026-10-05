// =============================================================================
// POS savati — sof hisob-kitob (React'siz, testlanadi)
// =============================================================================
// Ombor DONADA yuritiladi; savat qatori esa tanlangan birlikda (qadoq /
// blister / dona). Narx, koeffitsient va ruxsat etilgan birliklar
// @clary/utils pharmacy-units.ts dan — server (pharmacy_sell_v2) bilan bir xil.
// =============================================================================

import {
  allowedUnitKinds,
  defaultUnitKind,
  unitFactor,
  unitPrice,
  type MedUnitInfo,
  type UnitKind,
} from '@clary/utils';

export type CartMed = MedUnitInfo & {
  medication_id: string;
  name: string;
  strength?: string | null;
  form?: string | null;
  qty_sellable: number;
  requires_prescription?: boolean | null;
  earliest_sellable_expiry?: string | null;
  mxik_code?: string | null;
};

export type DiscountKind = 'sum' | 'pct';

export interface CartLine {
  key: string;
  med: CartMed;
  unit_kind: UnitKind;
  qty: number;
  /** DataMatrix'dan o'qilgan partiya (avval shundan yechiladi). */
  preferred_batch_no?: string | null;
  /**
   * Qator chegirmasi: 'sum' — butun qator uchun so'm, 'pct' — foiz (son
   * o'zgarsa chegirma ham mos o'zgaradi). Serverga jami chegirma bo'lib ketadi.
   */
  disc_kind?: DiscountKind;
  disc_value?: number;
}

export interface LinePatch {
  qty?: number;
  unit_kind?: UnitKind;
  disc_kind?: DiscountKind;
  disc_value?: number;
}

export function lineFactor(l: CartLine): number {
  return unitFactor(l.med, l.unit_kind);
}

export function linePrice(l: CartLine): number {
  return unitPrice(l.med, l.unit_kind);
}

export function lineTotal(l: CartLine): number {
  return linePrice(l) * l.qty;
}

export function lineBaseQty(l: CartLine): number {
  return l.qty * lineFactor(l);
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((a, l) => a + lineTotal(l), 0);
}

/** Chegirma summasi (so'm): foiz yoki summa — qator summasidan oshmaydi. */
export function discountAmount(gross: number, kind: DiscountKind | undefined, value: number) {
  const v = Math.max(0, Number(value) || 0);
  if (!v || gross <= 0) return 0;
  const d = kind === 'pct' ? Math.round((gross * Math.min(100, v)) / 100) : Math.round(v);
  return Math.min(gross, d);
}

export function lineDiscount(l: CartLine): number {
  return discountAmount(lineTotal(l), l.disc_kind, l.disc_value ?? 0);
}

/** Chegirmadan keyingi qator summasi. */
export function lineNet(l: CartLine): number {
  return lineTotal(l) - lineDiscount(l);
}

export function cartDiscount(lines: CartLine[]): number {
  return lines.reduce((a, l) => a + lineDiscount(l), 0);
}

/** Chegirmasi bor qatorlardan chegirmani olib tashlaydi (ruxsati yo'q operator). */
export function stripDiscounts(lines: CartLine[]): CartLine[] {
  return lines.some((l) => l.disc_value)
    ? lines.map((l) => (l.disc_value ? { ...l, disc_kind: undefined, disc_value: undefined } : l))
    : lines;
}

/** Shu doriga savatdagi BOSHQA qatorlar band qilgan donalar. */
function usedByOthers(lines: CartLine[], medId: string, exceptKey?: string): number {
  return lines
    .filter((l) => l.med.medication_id === medId && l.key !== exceptKey)
    .reduce((a, l) => a + lineBaseQty(l), 0);
}

/** Qatorga qo'yish mumkin bo'lgan maksimal son (tanlangan birlikda). */
export function maxQtyFor(lines: CartLine[], line: CartLine): number {
  const free = Math.max(
    0,
    line.med.qty_sellable - usedByOthers(lines, line.med.medication_id, line.key),
  );
  return Math.floor(free / lineFactor(line));
}

/** Shu dori + birlik + partiya savatda bormi va unga yana nechta sig'adi. */
export function roomFor(
  lines: CartLine[],
  med: CartMed,
  kind: UnitKind,
  batch: string | null = null,
): { existing: CartLine | null; room: number } {
  const existing =
    lines.find(
      (l) =>
        l.med.medication_id === med.medication_id &&
        l.unit_kind === kind &&
        (l.preferred_batch_no ?? null) === batch,
    ) ?? null;
  if (existing) {
    return { existing, room: Math.max(0, maxQtyFor(lines, existing) - existing.qty) };
  }
  const draft: CartLine = { key: '', med, unit_kind: kind, qty: 0, preferred_batch_no: batch };
  return { existing: null, room: maxQtyFor(lines, draft) };
}

let seq = 0;
function newKey(): string {
  seq += 1;
  return `l${Date.now().toString(36)}${seq}`;
}

/**
 * Dori qo'shish: shu dori + birlik + partiya qatori bo'lsa — soni oshadi.
 * Qoldiqdan oshsa mumkin bo'lgancha qo'yiladi; `added` haqiqatda qo'shilgan son.
 */
export function addToCart(
  lines: CartLine[],
  med: CartMed,
  opts: {
    qty?: number;
    unit_kind?: UnitKind;
    preferred_batch_no?: string | null;
    /** Berilsa — qator chegirmasi shu bo'ladi (mavjud qatorniki almashadi). */
    disc_kind?: DiscountKind;
    disc_value?: number;
  } = {},
): { lines: CartLine[]; added: number; key: string | null } {
  const kinds = allowedUnitKinds(med);
  const kind =
    opts.unit_kind && kinds.includes(opts.unit_kind) ? opts.unit_kind : defaultUnitKind(med);
  const want = Math.max(1, Math.floor(opts.qty ?? 1));
  const batch = opts.preferred_batch_no ?? null;
  const disc =
    opts.disc_kind !== undefined
      ? { disc_kind: opts.disc_kind, disc_value: Math.max(0, opts.disc_value ?? 0) }
      : {};
  const ix = lines.findIndex(
    (l) =>
      l.med.medication_id === med.medication_id &&
      l.unit_kind === kind &&
      (l.preferred_batch_no ?? null) === batch,
  );
  if (ix >= 0) {
    const cur = lines[ix]!;
    const room = maxQtyFor(lines, cur) - cur.qty;
    const add = Math.max(0, Math.min(want, room));
    if (add === 0) return { lines, added: 0, key: cur.key };
    const next = [...lines];
    next[ix] = { ...cur, med, qty: cur.qty + add, ...disc };
    return { lines: next, added: add, key: cur.key };
  }
  const draft: CartLine = {
    key: newKey(),
    med,
    unit_kind: kind,
    qty: 0,
    preferred_batch_no: batch,
    ...disc,
  };
  const room = maxQtyFor(lines, draft);
  const add = Math.min(want, room);
  if (add <= 0) return { lines, added: 0, key: null };
  return { lines: [...lines, { ...draft, qty: add }], added: add, key: draft.key };
}

export function setLineQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  return lines.map((l) => {
    if (l.key !== key) return l;
    const max = maxQtyFor(lines, l);
    return { ...l, qty: Math.max(0, Math.min(Math.floor(qty) || 0, max)) };
  });
}

/** Birlikni almashtirish (qadoq ⇄ dona): son qoldiqqa sig'adigan qilib moslanadi. */
export function setLineUnit(lines: CartLine[], key: string, kind: UnitKind): CartLine[] {
  return lines.map((l) => {
    if (l.key !== key) return l;
    if (!allowedUnitKinds(l.med).includes(kind)) return l;
    const moved: CartLine = { ...l, unit_kind: kind };
    const max = maxQtyFor(lines, moved);
    return { ...moved, qty: Math.max(1, Math.min(l.qty, max)) };
  });
}

/**
 * Miqdor oynasidan: birlik, son va chegirmani bir yo'la o'zgartiradi.
 * Son qoldiqqa sig'adigan qilib qisqartiriladi (kamida 1).
 */
export function updateLine(lines: CartLine[], key: string, patch: LinePatch): CartLine[] {
  return lines.map((l) => {
    if (l.key !== key) return l;
    const kind =
      patch.unit_kind && allowedUnitKinds(l.med).includes(patch.unit_kind)
        ? patch.unit_kind
        : l.unit_kind;
    const moved: CartLine = {
      ...l,
      unit_kind: kind,
      ...(patch.disc_kind !== undefined
        ? { disc_kind: patch.disc_kind, disc_value: Math.max(0, patch.disc_value ?? 0) }
        : {}),
    };
    const max = maxQtyFor(lines, moved);
    const want = Math.floor(patch.qty ?? l.qty) || 1;
    return { ...moved, qty: Math.max(1, Math.min(want, max)) };
  });
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key);
}

/** Katalog yangilanganda qatorlardagi dori ma'lumotini (narx/qoldiq) yangilaydi. */
export function refreshMeds(lines: CartLine[], byId: Map<string, CartMed>): CartLine[] {
  return lines.map((l) => {
    const m = byId.get(l.med.medication_id);
    return m ? { ...l, med: m } : l;
  });
}

// -----------------------------------------------------------------------------
// To'lov
// -----------------------------------------------------------------------------
export type PayMethod = 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'uzum';

export interface PaymentLeg {
  method: PayMethod;
  amount: number;
}

export function totalAfterDiscount(subtotal: number, discount: number): number {
  return Math.max(0, subtotal - Math.max(0, Math.min(discount, subtotal)));
}

/** Naqd berilgan puldan qaytim (naqd to'lanishi kerak bo'lgan qismga nisbatan). */
export function changeFor(cashDue: number, received: number): number {
  return Math.max(0, Math.round(received) - Math.max(0, Math.round(cashDue)));
}

/**
 * Tez summa tugmalari: aniq summa va undan katta "dumaloq" kupyuralar.
 * Masalan 37 400 → 37 400 · 38 000 · 40 000 · 50 000 · 100 000
 */
export function quickCashAmounts(due: number): number[] {
  const d = Math.max(0, Math.round(due));
  if (d === 0) return [];
  const out = new Set<number>([d]);
  for (const step of [1_000, 5_000, 10_000, 50_000, 100_000, 200_000]) {
    const v = Math.ceil(d / step) * step;
    if (v > d) out.add(v);
    if (out.size >= 5) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

/** Bo'lib to'lashda qolgan summa. */
export function remainingDue(total: number, debt: number, legs: PaymentLeg[]): number {
  const paid = legs.reduce((a, l) => a + Math.max(0, Math.round(l.amount)), 0);
  return Math.max(0, total - debt - paid);
}
