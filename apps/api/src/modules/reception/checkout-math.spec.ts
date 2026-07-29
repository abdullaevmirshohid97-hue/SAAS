import { describe, expect, it } from 'vitest';

import {
  computeDebtAmount,
  computeItemTotals,
  isCoverageSufficient,
  pickServiceName,
  resolvePayment,
  type CheckoutServiceRow,
} from './checkout-math';

const svc = (over: Partial<CheckoutServiceRow> = {}): CheckoutServiceRow => ({
  price_uzs: 100_000,
  cost_uzs: 30_000,
  name_i18n: { 'uz-Latn': 'Konsultatsiya', ru: 'Консультация' },
  ...over,
});

const map = (entries: Record<string, CheckoutServiceRow>) =>
  new Map(Object.entries(entries)) as ReadonlyMap<string, CheckoutServiceRow>;

// ── pickServiceName ──────────────────────────────────────────────────────────
describe('pickServiceName', () => {
  it('uz-Latn ni birinchi tanlaydi', () => {
    expect(pickServiceName({ 'uz-Latn': 'Tahlil', ru: 'Анализ' })).toBe('Tahlil');
  });

  it('uz-Latn yo‘q bo‘lsa ru ga tushadi', () => {
    expect(pickServiceName({ ru: 'Анализ' })).toBe('Анализ');
  });

  it('ikkalasi ham yo‘q bo‘lsa birinchi mavjud qiymatni oladi', () => {
    expect(pickServiceName({ en: 'Lab test' })).toBe('Lab test');
  });

  it('bo‘sh yoki null bo‘lsa "service" qaytaradi', () => {
    expect(pickServiceName({})).toBe('service');
    expect(pickServiceName(null)).toBe('service');
    expect(pickServiceName(undefined)).toBe('service');
  });
});

// ── computeItemTotals ────────────────────────────────────────────────────────
describe('computeItemTotals', () => {
  it('oddiy holat: narx × miqdor', () => {
    const { total, itemRows } = computeItemTotals(
      [{ service_id: 's1', quantity: 2, unit_price_uzs: 50_000 }],
      map({ s1: svc() }),
    );
    expect(total).toBe(100_000);
    expect(itemRows[0]!.final_amount_uzs).toBe(100_000);
    expect(itemRows[0]!.service_price_snapshot).toBe(50_000);
  });

  // REGRESSIYA: frontend 0 yuborsa gross 0 bo'lib, shifokor komissiyasi
  // ham 0 dan hisoblanardi.
  it('unit_price_uzs 0 bo‘lsa jadvaldagi narxni ishlatadi', () => {
    const { total, itemRows } = computeItemTotals(
      [{ service_id: 's1', quantity: 1, unit_price_uzs: 0 }],
      map({ s1: svc({ price_uzs: 250_000 }) }),
    );
    expect(total).toBe(250_000);
    expect(itemRows[0]!.service_price_snapshot).toBe(250_000);
  });

  it('unit_price_uzs umuman berilmasa ham jadvaldagi narxni ishlatadi', () => {
    const { total } = computeItemTotals(
      [{ service_id: 's1', quantity: 3 }],
      map({ s1: svc({ price_uzs: 40_000 }) }),
    );
    expect(total).toBe(120_000);
  });

  it('chegirmani jami’dan ayiradi va snapshot yozadi', () => {
    const { total, itemRows } = computeItemTotals(
      [{ service_id: 's1', quantity: 1, unit_price_uzs: 100_000, discount_uzs: 20_000 }],
      map({ s1: svc() }),
    );
    expect(total).toBe(80_000);
    expect(itemRows[0]!.discount_snapshot).toEqual({ amount: 20_000 });
  });

  it('chegirma 0 bo‘lsa snapshot null bo‘ladi', () => {
    const { itemRows } = computeItemTotals(
      [{ service_id: 's1', quantity: 1, unit_price_uzs: 100_000, discount_uzs: 0 }],
      map({ s1: svc() }),
    );
    expect(itemRows[0]!.discount_snapshot).toBeNull();
  });

  it('bir nechta satrni qo‘shadi', () => {
    const { total, itemRows } = computeItemTotals(
      [
        { service_id: 's1', quantity: 1, unit_price_uzs: 100_000 },
        { service_id: 's2', quantity: 2, unit_price_uzs: 30_000 },
      ],
      map({ s1: svc(), s2: svc() }),
    );
    expect(total).toBe(160_000);
    expect(itemRows).toHaveLength(2);
  });

  it('tannarxni miqdorga ko‘paytiradi', () => {
    const { itemRows } = computeItemTotals(
      [{ service_id: 's1', quantity: 3, unit_price_uzs: 10_000 }],
      map({ s1: svc({ cost_uzs: 4_000 }) }),
    );
    expect(itemRows[0]!.cost_snapshot_uzs).toBe(12_000);
  });

  it('cost_uzs null bo‘lsa 0 deb hisoblaydi', () => {
    const { itemRows } = computeItemTotals(
      [{ service_id: 's1', quantity: 2, unit_price_uzs: 10_000 }],
      map({ s1: svc({ cost_uzs: null }) }),
    );
    expect(itemRows[0]!.cost_snapshot_uzs).toBe(0);
  });

  it('xizmat topilmasa xato tashlaydi', () => {
    expect(() => computeItemTotals([{ service_id: 'yoq', quantity: 1 }], map({}))).toThrow(
      /service yoq not available/,
    );
  });

  it('satrlar bo‘sh bo‘lsa jami 0', () => {
    const { total, itemRows } = computeItemTotals([], map({}));
    expect(total).toBe(0);
    expect(itemRows).toEqual([]);
  });
});

// ── resolvePayment ───────────────────────────────────────────────────────────
describe('resolvePayment', () => {
  it('oyoq yo‘q: paid_amount_uzs va berilgan usul ishlatiladi', () => {
    const r = resolvePayment(undefined, 150_000, 'cash');
    expect(r.paidAmount).toBe(150_000);
    expect(r.effectiveMethod).toBe('cash');
    expect(r.isMixed).toBe(false);
  });

  it('bitta oyoq: o‘sha usul, summa oyoqdan olinadi', () => {
    const r = resolvePayment([{ method: 'card', amount_uzs: 90_000 }], 999_999, 'cash');
    expect(r.paidAmount).toBe(90_000);
    expect(r.effectiveMethod).toBe('card');
    expect(r.isMixed).toBe(false);
  });

  it('ikkita oyoq: mixed va yig‘indi', () => {
    const r = resolvePayment(
      [
        { method: 'cash', amount_uzs: 120_000 },
        { method: 'card', amount_uzs: 80_000 },
      ],
      0,
      'cash',
    );
    expect(r.paidAmount).toBe(200_000);
    expect(r.effectiveMethod).toBe('mixed');
    expect(r.isMixed).toBe(true);
  });

  it('nol summali oyoqlarni hisobga olmaydi', () => {
    const r = resolvePayment(
      [
        { method: 'cash', amount_uzs: 50_000 },
        { method: 'card', amount_uzs: 0 },
      ],
      0,
      'cash',
    );
    expect(r.legs).toHaveLength(1);
    expect(r.paidAmount).toBe(50_000);
    expect(r.isMixed).toBe(false);
    expect(r.effectiveMethod).toBe('cash');
  });

  it('hamma oyoq nol bo‘lsa eski xulqqa qaytadi', () => {
    const r = resolvePayment([{ method: 'card', amount_uzs: 0 }], 70_000, 'transfer');
    expect(r.paidAmount).toBe(70_000);
    expect(r.effectiveMethod).toBe('transfer');
  });
});

// ── isCoverageSufficient ─────────────────────────────────────────────────────
describe('isCoverageSufficient', () => {
  it('paid jami’ni qoplasa true', () => {
    expect(isCoverageSufficient(100_000, 100_000, 0, 0)).toBe(true);
  });

  it('paid + qarz qoplasa true', () => {
    expect(isCoverageSufficient(100_000, 60_000, 40_000, 0)).toBe(true);
  });

  it('paid + sug‘urta qoplasa true', () => {
    expect(isCoverageSufficient(100_000, 30_000, 0, 70_000)).toBe(true);
  });

  it('yetmasa false', () => {
    expect(isCoverageSufficient(100_000, 60_000, 10_000, 0)).toBe(false);
  });

  it('ortiqcha to‘lov ham true (qaytim kassada)', () => {
    expect(isCoverageSufficient(100_000, 150_000, 0, 0)).toBe(true);
  });
});

// ── computeDebtAmount ────────────────────────────────────────────────────────
describe('computeDebtAmount', () => {
  it('oddiy qarz: qoldiqqa teng', () => {
    const r = computeDebtAmount(200_000, 150_000, 0, 50_000);
    expect(r.remainingOwed).toBe(50_000);
    expect(r.debtAmount).toBe(50_000);
  });

  // REGRESSIYA: operator ortiqcha nol kiritganda qarz 10 barobar yozilardi.
  it('so‘ralgan qarz qoldiqdan oshsa qisiladi (270 000 → 2 700 000 typo)', () => {
    const r = computeDebtAmount(300_000, 30_000, 0, 2_700_000);
    expect(r.remainingOwed).toBe(270_000);
    expect(r.debtAmount).toBe(270_000);
  });

  it('to‘liq to‘langan bo‘lsa qarz 0', () => {
    const r = computeDebtAmount(100_000, 100_000, 0, 50_000);
    expect(r.remainingOwed).toBe(0);
    expect(r.debtAmount).toBe(0);
  });

  it('sug‘urta qoplagan qismni qoldiqdan chiqaradi', () => {
    const r = computeDebtAmount(200_000, 50_000, 120_000, 100_000);
    expect(r.remainingOwed).toBe(30_000);
    expect(r.debtAmount).toBe(30_000);
  });

  it('manfiy qarz so‘ralsa 0 ga qisiladi', () => {
    const r = computeDebtAmount(100_000, 0, 0, -5_000);
    expect(r.debtAmount).toBe(0);
  });

  it('qarz berilmasa 0', () => {
    const r = computeDebtAmount(100_000, 40_000, 0, undefined);
    expect(r.debtAmount).toBe(0);
    expect(r.remainingOwed).toBe(60_000);
  });

  it('ortiqcha to‘lovda qoldiq manfiy bo‘lmaydi', () => {
    const r = computeDebtAmount(100_000, 150_000, 0, 10_000);
    expect(r.remainingOwed).toBe(0);
    expect(r.debtAmount).toBe(0);
  });
});
