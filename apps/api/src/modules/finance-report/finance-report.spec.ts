import { describe, expect, it } from 'vitest';

import {
  buildReconChecks,
  buildTotals,
  financeReportText,
  REPORT_SECTIONS,
  type BalanceSet,
  type FinanceReport,
  type PeriodFlows,
} from './finance-report.builder';

// =============================================================================
// SVERTKA MATEMATIKASI — "1 gina xato millionlab zarar berishi mumkin"
// =============================================================================
// Bu yerdagi formulalar hisobotning ISHONCHLILIK DALILI: boshlang'ich qoldiq
// va aylanma IKKI MUSTAQIL manbadan keladi (`finance_balances_asof` va
// `finance_period_flows`), ular mos kelmasa ma'lumotda muammo bor.
// Bitta noto'g'ri ishora (masalan inkasatsiyani kirim deb hisoblash) butun
// hisobotni yolg'on qiladi — shuning uchun har formula alohida qoplangan.
// =============================================================================

const ZERO_FLOWS: PeriodFlows = {
  rev_cash: 0,
  rev_card: 0,
  rev_transfer: 0,
  rev_other: 0,
  ref_cash: 0,
  ref_card: 0,
  ref_transfer: 0,
  ref_other: 0,
  ref_total: 0,
  rev_total: 0,
  exp_cash: 0,
  exp_safe: 0,
  exp_noncash: 0,
  exp_total: 0,
  pay_cash: 0,
  pay_safe: 0,
  pay_noncash: 0,
  pay_total: 0,
  encashed: 0,
  settled_bank: 0,
  settled_safe: 0,
  safe_deposit: 0,
  safe_out_tx: 0,
  adj_cash: 0,
  commission: 0,
  pharm_profit: 0,
  debt: 0,
};

const bal = (p: Partial<BalanceSet>): BalanceSet => ({
  cash: 0,
  safe: 0,
  pending: 0,
  bank: 0,
  total: 0,
  ...p,
});

const acc = (checks: ReturnType<typeof buildReconChecks>, name: string) => {
  const c = checks.find((x) => x.account.startsWith(name));
  if (!c) throw new Error(`hisob topilmadi: ${name}`);
  return c;
};

describe('buildReconChecks — kassa (naqd)', () => {
  it('naqd tushum qoldiqni oshiradi', () => {
    const f = { ...ZERO_FLOWS, rev_cash: 1_000_000 };
    const checks = buildReconChecks(bal({ cash: 200_000 }), bal({ cash: 1_200_000 }), f);
    const c = acc(checks, 'Kassa');
    expect(c.computed_closing).toBe(1_200_000);
    expect(c.ok).toBe(true);
  });

  it('inkasatsiya kassadan CHIQIM (daromad emas)', () => {
    const f = { ...ZERO_FLOWS, rev_cash: 1_000_000, encashed: 700_000 };
    const checks = buildReconChecks(bal({}), bal({ cash: 300_000 }), f);
    const c = acc(checks, 'Kassa');
    expect(c.outflow).toBe(700_000);
    expect(c.computed_closing).toBe(300_000);
    expect(c.ok).toBe(true);
  });

  it('vozvrat, naqd rasxot va naqd maosh kassadan ayriladi', () => {
    const f = {
      ...ZERO_FLOWS,
      rev_cash: 5_000_000,
      ref_cash: 300_000,
      exp_cash: 450_000,
      pay_cash: 1_250_000,
    };
    const checks = buildReconChecks(bal({ cash: 100_000 }), bal({ cash: 3_100_000 }), f);
    const c = acc(checks, 'Kassa');
    expect(c.outflow).toBe(2_000_000);
    expect(c.computed_closing).toBe(3_100_000);
    expect(c.ok).toBe(true);
  });

  it('musbat tuzatish kirimda, manfiy tuzatish chiqimda (ishora chalkashmaydi)', () => {
    const plus = buildReconChecks(bal({}), bal({ cash: 50_000 }), {
      ...ZERO_FLOWS,
      adj_cash: 50_000,
    });
    expect(acc(plus, 'Kassa').inflow).toBe(50_000);
    expect(acc(plus, 'Kassa').outflow).toBe(0);

    const minus = buildReconChecks(bal({}), bal({ cash: -50_000 }), {
      ...ZERO_FLOWS,
      adj_cash: -50_000,
    });
    expect(acc(minus, 'Kassa').inflow).toBe(0);
    expect(acc(minus, 'Kassa').outflow).toBe(50_000);
    expect(acc(minus, 'Kassa').ok).toBe(true);
  });

  it('seyfdan to‘langan rasxot kassaga TEGMAYDI', () => {
    const f = { ...ZERO_FLOWS, rev_cash: 1_000_000, exp_safe: 900_000 };
    const checks = buildReconChecks(bal({}), bal({ cash: 1_000_000 }), f);
    expect(acc(checks, 'Kassa').ok).toBe(true);
  });
});

describe('buildReconChecks — seyf', () => {
  it('inkasatsiya seyfga KIRIM (kassadagi chiqimning narigi tomoni)', () => {
    const f = { ...ZERO_FLOWS, encashed: 700_000 };
    const checks = buildReconChecks(bal({ safe: 300_000 }), bal({ safe: 1_000_000 }), f);
    expect(acc(checks, 'Seyf').inflow).toBe(700_000);
    expect(acc(checks, 'Seyf').ok).toBe(true);
  });

  it('naqdsiz pul seyfga olinsa — seyf kirimi', () => {
    const f = { ...ZERO_FLOWS, settled_safe: 2_000_000, safe_deposit: 500_000 };
    const checks = buildReconChecks(bal({}), bal({ safe: 2_500_000 }), f);
    expect(acc(checks, 'Seyf').ok).toBe(true);
  });

  it('seyfdan vozvrat/rasxot/maosh — seyf chiqimi', () => {
    const f = { ...ZERO_FLOWS, safe_out_tx: 100_000, exp_safe: 200_000, pay_safe: 700_000 };
    const checks = buildReconChecks(bal({ safe: 1_000_000 }), bal({}), f);
    expect(acc(checks, 'Seyf').outflow).toBe(1_000_000);
    expect(acc(checks, 'Seyf').computed_closing).toBe(0);
    expect(acc(checks, 'Seyf').ok).toBe(true);
  });
});

describe("buildReconChecks — yo'ldagi pul va bank", () => {
  it('naqdsiz tushum yo‘ldagi pulni oshiradi, olinganda kamayadi', () => {
    const f = {
      ...ZERO_FLOWS,
      rev_card: 3_000_000,
      rev_transfer: 1_000_000,
      rev_other: 500_000,
      ref_card: 200_000,
      settled_bank: 3_000_000,
      settled_safe: 800_000,
    };
    const checks = buildReconChecks(bal({ pending: 0 }), bal({ pending: 500_000 }), f);
    const c = acc(checks, "Yo'ldagi");
    expect(c.inflow).toBe(4_500_000);
    expect(c.outflow).toBe(4_000_000);
    expect(c.ok).toBe(true);
  });

  it('BANKKA olingani bank qoldig‘ini oshiradi, SEYFGA olingani oshirmaydi', () => {
    const f = { ...ZERO_FLOWS, settled_bank: 3_000_000, settled_safe: 5_000_000 };
    const checks = buildReconChecks(bal({}), bal({ bank: 3_000_000 }), f);
    expect(acc(checks, 'Bank').inflow).toBe(3_000_000);
    expect(acc(checks, 'Bank').ok).toBe(true);
  });

  it('naqdsiz rasxot va maosh bankdan ayriladi', () => {
    const f = {
      ...ZERO_FLOWS,
      settled_bank: 5_000_000,
      exp_noncash: 1_000_000,
      pay_noncash: 2_000_000,
    };
    const checks = buildReconChecks(bal({}), bal({ bank: 2_000_000 }), f);
    expect(acc(checks, 'Bank').ok).toBe(true);
  });
});

describe('buildReconChecks — nomuvofiqlikni ANIQLAYDI', () => {
  it('qoldiq aylanmaga mos kelmasa ok=false va farq ko‘rsatiladi', () => {
    // Kassada 1 000 000 tushum bo'lgan, lekin yakuniy qoldiq 900 000 —
    // demak hisobga olinmagan 100 000 so'mlik chiqim bor.
    const f = { ...ZERO_FLOWS, rev_cash: 1_000_000 };
    const checks = buildReconChecks(bal({}), bal({ cash: 900_000 }), f);
    const c = acc(checks, 'Kassa');
    expect(c.ok).toBe(false);
    expect(c.diff).toBe(-100_000);
  });

  it('barcha hisoblar tekshiriladi (4 ta)', () => {
    expect(buildReconChecks(bal({}), bal({}), ZERO_FLOWS)).toHaveLength(4);
  });
});

describe('buildTotals', () => {
  const f: PeriodFlows = {
    ...ZERO_FLOWS,
    rev_total: 10_000_000,
    ref_total: 500_000,
    exp_total: 2_000_000,
    pay_total: 3_000_000,
    commission: 2_500_000,
    pharm_profit: 400_000,
    debt: 1_200_000,
  };

  it('sof tushum = tushum − vozvrat', () => {
    const t = buildTotals(bal({}), bal({}), f, { income: 0, outflow: 0 });
    expect(t.gross_revenue_uzs).toBe(9_500_000);
  });

  it('operatsion natija maosh TO‘LOVINI ayiradi (kassa asosi)', () => {
    const t = buildTotals(bal({}), bal({}), f, { income: 0, outflow: 0 });
    expect(t.operating_net_uzs).toBe(9_500_000 - 2_000_000 - 3_000_000);
  });

  it('accrual foyda ishlangan komissiya + dorixona ustamasi bilan', () => {
    const t = buildTotals(bal({}), bal({}), f, { income: 0, outflow: 0 });
    expect(t.accrual_profit_uzs).toBe(9_500_000 - 2_000_000 - 2_500_000 + 400_000);
  });

  it('qarzga berilgan xizmat tushumga KIRMAYDI', () => {
    const t = buildTotals(bal({}), bal({}), f, { income: 0, outflow: 0 });
    expect(t.debt_issued_uzs).toBe(1_200_000);
    expect(t.gross_revenue_uzs).toBe(9_500_000); // qarz qo'shilmagan
  });

  it('pul o‘sishi = to‘rt hisob jamining farqi', () => {
    const t = buildTotals(bal({ total: 5_000_000 }), bal({ total: 8_000_000 }), f, {
      income: 0,
      outflow: 0,
    });
    expect(t.money_delta_uzs).toBe(3_000_000);
  });
});

describe('financeReportText — Telegram xulosasi', () => {
  const rep: FinanceReport = {
    period: { from: '2026-07-11', to: '2026-08-10', register: 'reception', days: 31 },
    generated_at: '2026-08-10T12:00:00.000Z',
    clinic: { id: 'c1', name: 'MAGNUS' },
    sections: [...REPORT_SECTIONS],
    opening: bal({ cash: 100_000, safe: 5_000_000, total: 5_100_000 }),
    closing: bal({ cash: 0, safe: 9_000_000, total: 9_000_000 }),
    lines: [
      {
        key: 'rev_cash',
        group: 'income',
        label: 'Naqd savdo',
        amount_uzs: 12_000_000,
        count: null,
        drill: null,
      },
      {
        key: 'expenses',
        group: 'outflow',
        label: 'Rasxotlar',
        amount_uzs: -2_000_000,
        count: 14,
        drill: null,
      },
    ],
    totals: buildTotals(
      bal({ total: 5_100_000 }),
      bal({ total: 9_000_000 }),
      { ...ZERO_FLOWS, rev_total: 12_000_000, exp_total: 2_000_000 },
      { income: 12_000_000, outflow: -2_000_000 },
    ),
    checks: buildReconChecks(bal({}), bal({}), ZERO_FLOWS),
    warnings: [],
    closed: null,
    flows: {},
    payroll_by_person: [],
  };

  it('davr, klinika va qoldiqlarni ko‘rsatadi', () => {
    const t = financeReportText(rep);
    expect(t).toContain('2026-07-11');
    expect(t).toContain('2026-08-10');
    expect(t).toContain('MAGNUS');
    expect(t).toContain('QOLDIQLAR');
  });

  it('svertka toza bo‘lsa tasdiq beradi, xato bo‘lsa ogohlantiradi', () => {
    expect(financeReportText(rep)).toContain('Svertka to‘g‘ri');
    const bad = { ...rep, warnings: ['⚠ Kassa: farq 100 000'] };
    const t = financeReportText(bad);
    expect(t).toContain('TEKSHIRING');
    expect(t).not.toContain('Svertka to‘g‘ri');
  });

  it('yopilgan davrni belgilaydi', () => {
    const closed = { ...rep, closed: { id: 'x', closed_at: '2026-08-10T15:00:00.000Z' } };
    expect(financeReportText(closed)).toContain('Bu davr yopilgan');
  });
});
