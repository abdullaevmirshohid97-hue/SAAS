// =============================================================================
// Dorixona birliklari: qadoq ⇄ blister ⇄ dona
// =============================================================================
// Ombor har doim ENG KICHIK birlikda (dona/tabletka/ampula) yuritiladi.
// `pack_qty` — bitta qadoqdagi donalar soni. pack_qty = 1 bo'lsa qadoq = dona
// (eski dorilar shunday — hech narsa o'zgarmaydi).
//
// Narx:
//   price_uzs          — 1 dona narxi (bazadagi asosiy narx, sotuv RPC shundan)
//   pack_price_uzs     — qadoq narxi (bo'sh → price_uzs × pack_qty)
//   blister_price_uzs  — blister narxi (bo'sh → price_uzs × blister_qty)
//
// ⚠️ Bazadagi `pharmacy_sell_v2` xuddi shu qoidalar bilan hisoblaydi.
// =============================================================================

export type UnitKind = 'unit' | 'blister' | 'pack';

export interface MedUnitInfo {
  pack_qty?: number | null;
  blister_qty?: number | null;
  price_uzs?: number | null;
  pack_price_uzs?: number | null;
  blister_price_uzs?: number | null;
  sell_by_unit?: boolean | null;
  unit_name?: string | null;
}

export function packQty(m: MedUnitInfo): number {
  const n = Number(m.pack_qty ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function blisterQty(m: MedUnitInfo): number | null {
  const n = Number(m.blister_qty ?? 0);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/** Bitta `kind` birligida nechta dona bor. */
export function unitFactor(m: MedUnitInfo, kind: UnitKind): number {
  if (kind === 'pack') return packQty(m);
  if (kind === 'blister') return blisterQty(m) ?? 1;
  return 1;
}

/** Shu dorini qaysi birliklarda sotish mumkin (birinchisi — standart). */
export function allowedUnitKinds(m: MedUnitInfo): UnitKind[] {
  const pq = packQty(m);
  if (pq <= 1) return ['unit'];
  const kinds: UnitKind[] = ['pack'];
  if (m.sell_by_unit) {
    if (blisterQty(m) && blisterQty(m)! < pq) kinds.push('blister');
    kinds.push('unit');
  }
  return kinds;
}

export function defaultUnitKind(m: MedUnitInfo): UnitKind {
  return allowedUnitKinds(m)[0] ?? 'unit';
}

/** Bitta `kind` birligining narxi (so'm). */
export function unitPrice(m: MedUnitInfo, kind: UnitKind): number {
  const base = Math.max(0, Math.round(Number(m.price_uzs ?? 0)));
  if (kind === 'pack') {
    const pp = Number(m.pack_price_uzs ?? 0);
    return pp > 0 ? Math.round(pp) : base * packQty(m);
  }
  if (kind === 'blister') {
    const bp = Number(m.blister_price_uzs ?? 0);
    return bp > 0 ? Math.round(bp) : Math.round(base * (blisterQty(m) ?? 1));
  }
  return base;
}

export function unitLabel(kind: UnitKind, m?: MedUnitInfo): string {
  if (kind === 'pack') return 'qadoq';
  if (kind === 'blister') return 'blister';
  const n = (m?.unit_name ?? '').trim();
  return n || 'dona';
}

/**
 * Qoldiqni o'qilishi oson ko'rinishda: "3 qadoq + 5 dona".
 * pack_qty = 1 bo'lsa oddiy "15 dona".
 */
export function formatStock(baseQty: number, m: MedUnitInfo): string {
  const q = Math.max(0, Math.floor(Number(baseQty) || 0));
  const pq = packQty(m);
  const uname = unitLabel('unit', m);
  if (pq <= 1) return `${q.toLocaleString('uz-UZ')} ${uname}`;
  const packs = Math.floor(q / pq);
  const rest = q % pq;
  if (packs === 0) return `${rest} ${uname}`;
  return rest === 0 ? `${packs} qadoq` : `${packs} qadoq + ${rest} ${uname}`;
}

/** Narxni yaxlitlash: `step` ga karrali qilib YUQORIGA (100, 500, 1000...). */
export function roundPriceUp(value: number, step: number): number {
  const v = Math.max(0, Number(value) || 0);
  if (!step || step <= 1) return Math.round(v);
  return Math.ceil(v / step) * step;
}

/** Tannarx + ustama % → sotuv narxi (ixtiyoriy yaxlitlash bilan). */
export function salePriceFromCost(cost: number, markupPercent: number, step = 0): number {
  const raw = (Number(cost) || 0) * (1 + (Number(markupPercent) || 0) / 100);
  return roundPriceUp(raw, step);
}

/** Sotuv narxidan ustama foizi (ko'rsatish uchun). */
export function markupPercentOf(cost: number, price: number): number {
  const c = Number(cost) || 0;
  if (c <= 0) return 0;
  return Math.round(((Number(price) - c) / c) * 1000) / 10;
}
