import { describe, expect, it } from 'vitest';

import { buildMoneyCenter, deltaPct, periodTotals, previousPeriod } from './money-center';

const zeroFlows = {
  rev_cash: 0,
  rev_card: 0,
  rev_transfer: 0,
  rev_other: 0,
  rev_total: 0,
  ref_total: 0,
  exp_total: 0,
  pay_total: 0,
  commission: 0,
  pharm_revenue: 0,
  pharm_profit: 0,
};
const bal = (cash: number, safe = 0, pending = 0, bank = 0) => ({
  cash,
  safe,
  pending,
  bank,
  total: cash + safe + pending + bank,
});

describe('Pul markazi — sof hisob', () => {
  it('oldingi teng davr', () => {
    expect(previousPeriod('2026-10-11', '2026-11-10')).toEqual({
      from: '2026-09-10',
      to: '2026-10-10',
    });
    expect(previousPeriod('2026-11-25', '2026-11-25')).toEqual({
      from: '2026-11-24',
      to: '2026-11-24',
    });
  });

  it('foiz o‘zgarish; avvalgi 0 — null', () => {
    expect(deltaPct(110, 100)).toBe(10);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(10, 0)).toBeNull();
  });

  it('tushum = ikki registr, vozvrat ayirilgan; kassa foydasi = tushum − rasxot − maosh', () => {
    const t = periodTotals({
      reception: {
        ...zeroFlows,
        rev_cash: 40,
        rev_card: 10,
        rev_total: 50,
        ref_total: 5,
        exp_total: 20,
        pay_total: 10,
        pharm_profit: 3,
      },
      inpatient: { ...zeroFlows, rev_cash: 30, rev_total: 30, exp_total: 4 },
    });
    expect(t.revenue).toBe(75);
    expect(t.revenue_reception).toBe(45);
    expect(t.revenue_inpatient).toBe(30);
    expect(t.by_method.cash).toBe(70);
    expect(t.cash_profit).toBe(75 - 24 - 10);
    expect(t.profit_with_pharmacy).toBe(t.cash_profit + 3);
  });

  it('pul qayerda + majburiyatlar + sof holat (MAGNUS-ga o‘xshash)', () => {
    const mc = buildMoneyCenter({
      from: '2026-10-11',
      to: '2026-11-10',
      prevFrom: '2026-09-10',
      prevTo: '2026-10-10',
      balances: {
        reception: bal(1_000_000, 5_000_000, 2_000_000, 40_000_000),
        inpatient: bal(200_000),
      },
      pendingByMethod: [
        { method: 'card', pending_uzs: 1_500_000, cnt: 10 },
        { method: 'transfer', pending_uzs: 500_000, cnt: 3 },
        { method: 'click', pending_uzs: 0, cnt: 0 },
      ],
      flows: {
        reception: {
          ...zeroFlows,
          rev_total: 54_105_000,
          rev_cash: 46_370_000,
          exp_total: 19_938_000,
          pay_total: 28_182_500,
        },
        inpatient: zeroFlows,
      },
      prevFlows: { reception: { ...zeroFlows, rev_total: 50_000_000 }, inpatient: zeroFlows },
      debt: {
        given_uzs: 475_000,
        collected_uzs: 70_000,
        outstanding_end_uzs: 1_430_001,
        debtors_end: 22,
      },
      unpaidCommissions: 107_500,
      unpaidReferrals: 0,
      expensesByCategory: [
        { category: 'Ijara', amount_uzs: 10_000_000 },
        { category: 'Kommunal', amount_uzs: 2_000_000 },
        { category: 'Bo‘sh', amount_uzs: 0 },
      ],
    });
    expect(mc.now.total).toBe(48_200_000);
    expect(mc.now.pending_by_method.map((p) => p.method)).toEqual(['card', 'transfer']);
    expect(mc.obligations.patients_owe).toBe(1_430_001);
    expect(mc.obligations.net_position).toBe(48_200_000 + 1_430_001 - 107_500);
    expect(mc.current.cash_profit).toBe(54_105_000 - 19_938_000 - 28_182_500);
    expect(mc.delta_pct.revenue).toBe(8.2);
    expect(mc.expenses_by_category).toHaveLength(2);
  });
});
