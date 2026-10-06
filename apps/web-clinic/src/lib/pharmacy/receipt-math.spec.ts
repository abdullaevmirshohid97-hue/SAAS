import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLICY,
  emptyLine,
  lineBaseQty,
  lineCostTotal,
  lineIssues,
  lineSale,
  receiptTotals,
  toApiItem,
  type ReceiptMed,
} from './receipt-math';

const med: ReceiptMed = {
  id: 'm2',
  name: 'Seftriakson 1g',
  strength: '1g',
  pack_qty: 20,
  price_uzs: 1300,
  pack_price_uzs: 26000,
  unit_name: 'flakon',
};
const today = new Date('2026-10-04T10:00:00');

describe('prixod qatori', () => {
  it('qadoqda kiritilgan qator donaga o‘tadi, jami — fakturadagidek', () => {
    const l = emptyLine({
      medication_id: 'm2',
      med,
      unit_kind: 'pack',
      qty: 5,
      cost: 20000,
      markup: 30,
    });
    expect(lineBaseQty(l)).toBe(100);
    expect(lineCostTotal(l)).toBe(100000);
    expect(lineSale(l, DEFAULT_POLICY)).toBe(26000);
    const api = toApiItem(l, DEFAULT_POLICY);
    expect(api.quantity).toBe(5);
    expect(api.unit_kind).toBe('pack');
    expect(api.pack_price_uzs).toBe(26000);
    expect(api.sale_price_uzs).toBe(1300);
  });

  it('tekshiruvlar: bog‘lanmagan, muddati o‘tgan, zararga sotish', () => {
    const l = emptyLine({ qty: 1, cost: 10000, sale: 9000, expiry: '2026-01-01' });
    const texts = lineIssues(l, DEFAULT_POLICY, today).map((i) => i.text);
    expect(texts).toContain('Dori tanlanmagan — bog‘lang yoki yangi yarating');
    expect(texts).toContain('Muddati o‘tgan');
    expect(texts).toContain('Sotuv narxi tannarxdan past');
  });

  it('qo‘lda kiritilgan yangi dori: nomi bor — kirimni to‘xtatmaydi, nomsiz — xato', () => {
    const named = emptyLine({
      match: 'new',
      qty: 3,
      cost: 5000,
      markup: 20,
      expiry: '2028-01-31',
      new_med: { name: 'Analgin 500', pack_qty: 10 },
    });
    const issues = lineIssues(named, DEFAULT_POLICY, today);
    expect(issues.every((i) => i.level !== 'error')).toBe(true);
    expect(issues.map((i) => i.text)).toContain('Yangi dori — kirimda bazaga qo‘shiladi');
    expect(lineBaseQty(named)).toBe(30); // 3 qadoq × 10

    const blank = emptyLine({ match: 'new', qty: 1, new_med: { name: '  ', pack_qty: 1 } });
    expect(lineIssues(blank, DEFAULT_POLICY, today).map((i) => i.text)).toContain(
      'Yangi dori nomini kiriting',
    );
  });

  it('odatdagidan 10 baravar ko‘p — ogohlantirish (×10 xato)', () => {
    const l = emptyLine({
      medication_id: 'm2',
      med,
      qty: 500,
      cost: 20000,
      expiry: '2028-01-31',
      last: { qty: 400, unit_cost_uzs: 1000, entered_qty: 20, unit_kind: 'pack', at: '2026-09-01' },
    });
    const issues = lineIssues(l, DEFAULT_POLICY, today);
    expect(issues.some((i) => i.level === 'warn' && i.text.startsWith('Soni odatdagidan'))).toBe(
      true,
    );
    expect(issues.every((i) => i.level !== 'error')).toBe(true);
  });

  it('ishlab chiqarilgan sana: kelajakda — ogohlantirish, muddatdan keyin — xato', () => {
    const base = { medication_id: 'm2', med, qty: 1, cost: 1000, markup: 20 };
    const future = lineIssues(
      emptyLine({ ...base, mfg_date: '2026-12-01', expiry: '2028-01-31' }),
      DEFAULT_POLICY,
      today,
    );
    expect(future.some((i) => i.level === 'warn' && i.text.includes('kelajakda'))).toBe(true);
    const after = lineIssues(
      emptyLine({ ...base, mfg_date: '2028-02-01', expiry: '2028-01-31' }),
      DEFAULT_POLICY,
      today,
    );
    expect(after.some((i) => i.level === 'error' && i.text.includes('muddatidan keyin'))).toBe(
      true,
    );
  });

  it('reestr muddati o‘tgan va skanerlanmagan shtrix — ogohlantirish', () => {
    const l = emptyLine({
      medication_id: 'm2',
      med: { ...med, reg_active: false },
      qty: 1,
      cost: 1000,
      expiry: '2028-01-31',
      needs_code: true,
    });
    const off = lineIssues(l, DEFAULT_POLICY, today).map((i) => i.text);
    expect(off).toContain('Davlat reestrida ro‘yxatdan o‘tish muddati tugagan');
    expect(off).not.toContain('Shtrix-kod skanerlanmagan');
    const on = lineIssues(l, { ...DEFAULT_POLICY, scanOnly: true }, today).map((i) => i.text);
    expect(on).toContain('Shtrix-kod skanerlanmagan');
    const scanned = lineIssues(
      { ...l, gtin: '04780086540633' },
      { ...DEFAULT_POLICY, scanOnly: true },
      today,
    );
    expect(scanned.map((i) => i.text)).not.toContain('Shtrix-kod skanerlanmagan');
  });

  it('"donalab sotiladi" faqat o‘zgarganda yuboriladi', () => {
    const l = emptyLine({ medication_id: 'm2', med, qty: 1, cost: 20000 });
    expect(toApiItem(l, DEFAULT_POLICY).sell_by_unit).toBeUndefined();
    expect(toApiItem({ ...l, sell_by_unit: true }, DEFAULT_POLICY).sell_by_unit).toBe(true);
    expect(
      toApiItem({ ...l, med: { ...med, sell_by_unit: true }, sell_by_unit: true }, DEFAULT_POLICY)
        .sell_by_unit,
    ).toBeUndefined();
    // qadoqda 1 dona — belgi ma'nosiz
    expect(
      toApiItem({ ...l, med: { ...med, pack_qty: 1 }, sell_by_unit: true }, DEFAULT_POLICY)
        .sell_by_unit,
    ).toBeUndefined();
  });

  it('jami ko‘rsatkichlar', () => {
    const a = emptyLine({ medication_id: 'm2', med, qty: 2, cost: 20000, markup: 25 });
    const t = receiptTotals([a], DEFAULT_POLICY);
    expect(t.cost_total).toBe(40000);
    expect(t.sale_total).toBe(50000);
    expect(t.profit).toBe(10000);
    expect(t.base_qty).toBe(40);
  });
});
