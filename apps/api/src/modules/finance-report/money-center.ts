// =============================================================================
// PUL MARKAZI (A1) — rahbar uchun bitta oynada: pul hozir qayerda, kim kimga
// qarzdor, davrda nima bo'ldi va o'tgan davr bilan farq.
// =============================================================================
// Hamma raqam mavjud yagona manbalardan (oylik hisobot bilan BIR xil):
//   • qoldiqlar — finance_balances_asof (kassa/seyf/yo'ldagi/bank);
//   • yo'ldagi naqdsiz usul bo'yicha — cashier_noncash_pending_by_method;
//   • aylanma — finance_period_flows (qabulxona + statsionar);
//   • bemor qarzi — finance_debt_flows (patient_ledger);
//   • xodim/agentga to'lanmagan — doctor_commissions / referral_accruals.
// Bu faylda faqat SOF hisob (test qilinadi); I/O — finance-report.module.ts.
// =============================================================================

export type Balances = { cash: number; safe: number; pending: number; bank: number; total: number };

export type FlowsLite = {
  rev_cash: number;
  rev_card: number;
  rev_transfer: number;
  rev_other: number;
  rev_total: number;
  ref_total: number;
  exp_total: number;
  pay_total: number;
  commission: number;
  pharm_revenue: number;
  pharm_profit: number;
};

export type MoneyCenterInput = {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  balances: { reception: Balances; inpatient: Balances };
  pendingByMethod: Array<{ method: string; pending_uzs: number; cnt: number }>;
  flows: { reception: FlowsLite; inpatient: FlowsLite };
  prevFlows: { reception: FlowsLite; inpatient: FlowsLite };
  debt: {
    given_uzs: number;
    collected_uzs: number;
    outstanding_end_uzs: number;
    debtors_end: number;
  } | null;
  unpaidCommissions: number;
  unpaidReferrals: number;
  expensesByCategory: Array<{ category: string; amount_uzs: number }>;
};

const sumB = (a: Balances, b: Balances): Balances => ({
  cash: a.cash + b.cash,
  safe: a.safe + b.safe,
  pending: a.pending + b.pending,
  bank: a.bank + b.bank,
  total: a.total + b.total,
});

/** Foiz o'zgarish: avvalgi 0 bo'lsa — null (cheksiz/aniqlanmagan). */
export function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/** Davr ko'rsatkichlari (ikki registr birga). */
export function periodTotals(f: { reception: FlowsLite; inpatient: FlowsLite }) {
  const r = f.reception;
  const i = f.inpatient;
  // Tushum = kassaga tushgan − vozvrat (rev_total allaqachon vozvratsiz; ref_total alohida).
  const revenue = r.rev_total + i.rev_total - (r.ref_total + i.ref_total);
  const expenses = r.exp_total + i.exp_total;
  const payroll = r.pay_total + i.pay_total;
  const cashProfit = revenue - expenses - payroll;
  return {
    revenue,
    revenue_reception: r.rev_total - r.ref_total,
    revenue_inpatient: i.rev_total - i.ref_total,
    by_method: {
      cash: r.rev_cash + i.rev_cash,
      card: r.rev_card + i.rev_card,
      transfer: r.rev_transfer + i.rev_transfer,
      other: r.rev_other + i.rev_other,
    },
    refunds: r.ref_total + i.ref_total,
    expenses,
    payroll,
    commission_accrued: r.commission + i.commission,
    pharmacy_revenue: r.pharm_revenue + i.pharm_revenue,
    pharmacy_profit: r.pharm_profit + i.pharm_profit,
    cash_profit: cashProfit,
    profit_with_pharmacy: cashProfit + r.pharm_profit + i.pharm_profit,
  };
}

export function buildMoneyCenter(x: MoneyCenterInput) {
  const now = sumB(x.balances.reception, x.balances.inpatient);
  const cur = periodTotals(x.flows);
  const prev = periodTotals(x.prevFlows);
  const receivable = x.debt?.outstanding_end_uzs ?? 0;
  const payable = x.unpaidCommissions + x.unpaidReferrals;
  return {
    period: { from: x.from, to: x.to, prev_from: x.prevFrom, prev_to: x.prevTo },
    /** Pul hozir qayerda (bugungi holat). */
    now: {
      ...now,
      by_register: x.balances,
      pending_by_method: x.pendingByMethod
        .filter((p) => p.pending_uzs !== 0)
        .sort((a, b) => b.pending_uzs - a.pending_uzs),
    },
    /** Kimdan olinadi / kimga beriladi. */
    obligations: {
      patients_owe: receivable,
      debtors: x.debt?.debtors_end ?? 0,
      staff_unpaid_commission: x.unpaidCommissions,
      agents_unpaid: x.unpaidReferrals,
      we_owe_total: payable,
      /** Kassadagi + seyfdagi + bankdagi + yo'ldagi + bemorlardan − xodim/agentlarga. */
      net_position: now.total + receivable - payable,
    },
    current: cur,
    previous: prev,
    delta_pct: {
      revenue: deltaPct(cur.revenue, prev.revenue),
      expenses: deltaPct(cur.expenses, prev.expenses),
      payroll: deltaPct(cur.payroll, prev.payroll),
      cash_profit: deltaPct(cur.cash_profit, prev.cash_profit),
    },
    debt: x.debt,
    expenses_by_category: x.expensesByCategory
      .filter((e) => e.amount_uzs > 0)
      .sort((a, b) => b.amount_uzs - a.amount_uzs),
  };
}

export type MoneyCenter = ReturnType<typeof buildMoneyCenter>;

/** Oldingi teng uzunlikdagi davr (masalan 11.10–10.11 → 11.09–10.10 kun soni bo'yicha). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const day = 86_400_000;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const len = Math.max(1, Math.round((b - a) / day) + 1);
  const prevTo = new Date(a - day).toISOString().slice(0, 10);
  const prevFrom = new Date(a - len * day).toISOString().slice(0, 10);
  return { from: prevFrom, to: prevTo };
}
