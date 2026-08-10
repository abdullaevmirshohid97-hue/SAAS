import { buildDailyReportPdf, type PdfTable } from '../telegram-reports/report-pdf';

// =============================================================================
// Moliyaviy hisobot — umumiy TIPLAR va ko'rinishlar (veb / Telegram / PDF)
// =============================================================================
// Bitta manba: hisobotning tuzilishi shu yerda. Veb ekrani, Telegram xabari va
// PDF AYNAN shu obyektdan yasaladi — shuning uchun uchalasi hech qachon turli
// raqam ko'rsatmaydi. (Ilgari kunlik digest matni va PDF alohida hisoblanardi.)
// =============================================================================

/** Hisobotga kiritiladigan bo'limlar — UI'dagi galochkalar. */
export const REPORT_SECTIONS = [
  'cash',
  'card',
  'transfer',
  'other',
  'refunds',
  'debt',
  'expenses',
  'payroll',
  'transfers',
  'pharmacy',
  'commission',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const SECTION_LABELS: Record<ReportSection, string> = {
  cash: 'Naqd savdo',
  card: 'Plastik savdo',
  transfer: "O'tkazma savdo",
  other: 'Boshqa naqdsiz (Click/Payme)',
  refunds: 'Vozvratlar',
  debt: 'Qarzga berilgan',
  expenses: 'Rasxotlar',
  payroll: 'Maoshlar',
  transfers: 'Ichki ko‘chirmalar (inkasatsiya/bank/seyf)',
  pharmacy: 'Dorixona',
  commission: 'Shifokor komissiyasi',
};

export type ReportLine = {
  key: string;
  /** income — daromad tomoni; outflow — chiqim; transfer — ichki ko'chirma; info — ma'lumot. */
  group: 'income' | 'outflow' | 'transfer' | 'info';
  label: string;
  amount_uzs: number;
  count: number | null;
  drill: { section: string; method_class: string } | null;
};

export type BalanceSet = {
  cash: number;
  safe: number;
  pending: number;
  bank: number;
  total: number;
};

export type ReconCheck = {
  account: string;
  opening: number;
  inflow: number;
  outflow: number;
  computed_closing: number;
  actual_closing: number;
  diff: number;
  ok: boolean;
};

export type FinanceReport = {
  period: { from: string; to: string; register: string; days: number };
  generated_at: string;
  clinic: { id: string; name: string };
  sections: ReportSection[];
  opening: BalanceSet;
  closing: BalanceSet;
  lines: ReportLine[];
  totals: {
    income_uzs: number;
    outflow_uzs: number;
    net_selected_uzs: number;
    gross_revenue_uzs: number;
    total_expense_uzs: number;
    total_payroll_uzs: number;
    operating_net_uzs: number;
    accrual_profit_uzs: number;
    debt_issued_uzs: number;
    money_delta_uzs: number;
  };
  checks: ReconCheck[];
  warnings: string[];
  closed: { id: string; closed_at: string } | null;
  flows: Record<string, number>;
};

/** `finance_period_flows` RPC qaytaradigan aylanma (API'da nomlari qisqartirilgan). */
export type PeriodFlows = {
  rev_cash: number;
  rev_card: number;
  rev_transfer: number;
  rev_other: number;
  ref_cash: number;
  ref_card: number;
  ref_transfer: number;
  ref_other: number;
  ref_total: number;
  rev_total: number;
  exp_cash: number;
  exp_safe: number;
  exp_noncash: number;
  exp_total: number;
  pay_cash: number;
  pay_safe: number;
  pay_noncash: number;
  pay_total: number;
  encashed: number;
  settled_bank: number;
  settled_safe: number;
  safe_deposit: number;
  safe_out_tx: number;
  adj_cash: number;
  commission: number;
  pharm_profit: number;
  debt: number;
};

/**
 * SVERTKA — hisobotning ishonchlilik dalili.
 *
 * Bank ko'chirmasidagi "control total": har hisob uchun
 *     boshlang'ich qoldiq + kirim − chiqim = yakuniy qoldiq.
 * Chap tomon `finance_period_flows` (aylanma) dan, o'ng tomon
 * `finance_balances_asof` (qoldiq) dan MUSTAQIL hisoblanadi. Ikkalasi mos
 * kelmasa — ma'lumotda muammo bor va buni YASHIRMASLIK kerak.
 *
 * Sof funksiya: aynan shu formulalar test bilan qoplangan (bitta noto'g'ri
 * ishora millionlab so'mga adashtiradi).
 */
export function buildReconChecks(
  opening: BalanceSet,
  closing: BalanceSet,
  f: PeriodFlows,
): ReconCheck[] {
  const raw: Array<Omit<ReconCheck, 'computed_closing' | 'diff' | 'ok'>> = [
    {
      account: 'Kassa (naqd)',
      opening: opening.cash,
      // Naqd tuzatish ishorali: musbati kirim, manfiysi chiqim tomonda.
      inflow: f.rev_cash + Math.max(f.adj_cash, 0),
      outflow: f.ref_cash + f.exp_cash + f.pay_cash + f.encashed + Math.max(-f.adj_cash, 0),
      actual_closing: closing.cash,
    },
    {
      account: 'Seyf',
      opening: opening.safe,
      inflow: f.encashed + f.safe_deposit + f.settled_safe,
      outflow: f.safe_out_tx + f.exp_safe + f.pay_safe,
      actual_closing: closing.safe,
    },
    {
      account: "Yo'ldagi pul (terminal)",
      opening: opening.pending,
      inflow: f.rev_card + f.rev_transfer + f.rev_other,
      outflow: f.ref_card + f.ref_transfer + f.ref_other + f.settled_bank + f.settled_safe,
      actual_closing: closing.pending,
    },
    {
      account: 'Bank hisobi',
      opening: opening.bank,
      inflow: f.settled_bank,
      outflow: f.exp_noncash + f.pay_noncash,
      actual_closing: closing.bank,
    },
  ];
  return raw.map((c) => {
    const computed = c.opening + c.inflow - c.outflow;
    const diff = c.actual_closing - computed;
    return { ...c, computed_closing: computed, diff, ok: diff === 0 };
  });
}

/** Davr yakunlari — tanlangan bo'limlardan QAT'I NAZAR to'liq manzara. */
export function buildTotals(
  opening: BalanceSet,
  closing: BalanceSet,
  f: PeriodFlows,
  selected: { income: number; outflow: number },
) {
  const grossRevenue = f.rev_total - f.ref_total;
  return {
    income_uzs: selected.income,
    outflow_uzs: selected.outflow,
    net_selected_uzs: selected.income + selected.outflow,
    gross_revenue_uzs: grossRevenue,
    total_expense_uzs: f.exp_total,
    total_payroll_uzs: f.pay_total,
    // Kassa asosidagi natija: kelgan pul − rasxot − to'langan maosh.
    operating_net_uzs: grossRevenue - f.exp_total - f.pay_total,
    // Accrual: maosh TO'LOVI emas, ishlangan komissiya + dorixona ustamasi.
    // (Kassa moduli `month_profit` bilan bir xil mantiq.)
    accrual_profit_uzs: grossRevenue - f.exp_total - f.commission + f.pharm_profit,
    debt_issued_uzs: f.debt,
    money_delta_uzs: closing.total - opening.total,
  };
}

const fmt = (v: number) => Number(v ?? 0).toLocaleString('ru-RU');
const fmtSum = (v: number) => `${fmt(v)} so‘m`;

const ACCOUNT_LABELS: Array<{ key: keyof BalanceSet; label: string }> = [
  { key: 'cash', label: 'Kassa (naqd)' },
  { key: 'safe', label: 'Seyf' },
  { key: 'pending', label: 'Yo‘ldagi pul (terminal)' },
  { key: 'bank', label: 'Bank hisobi' },
  { key: 'total', label: 'JAMI PUL' },
];

/**
 * Hisobotning MATNLI xulosasi — Telegram xabari uchun (HTML parse_mode).
 * PDF bilan bir xil raqamlar, faqat qisqartirilgan ko'rinish.
 */
export function financeReportText(rep: FinanceReport): string {
  const t = rep.totals;
  const lines: string[] = [];
  lines.push(`📑 <b>Moliyaviy hisobot</b>`);
  lines.push(`<b>${rep.period.from} — ${rep.period.to}</b> (${rep.period.days} kun)`);
  lines.push(`${rep.clinic.name}`);
  lines.push('');

  // Qoldiqlar — bank ko'chirmasining birinchi bo'limi.
  lines.push('🏦 <b>QOLDIQLAR</b>');
  for (const a of ACCOUNT_LABELS) {
    const o = rep.opening[a.key];
    const c = rep.closing[a.key];
    const d = c - o;
    const sign = d > 0 ? '+' : '';
    lines.push(
      `${a.key === 'total' ? '<b>' : ''}${a.label}: ${fmt(o)} → ${fmt(c)}` +
        `${a.key === 'total' ? '</b>' : ''} (${sign}${fmt(d)})`,
    );
  }
  lines.push('');

  const grouped = (g: ReportLine['group']) => rep.lines.filter((l) => l.group === g);
  const section = (title: string, g: ReportLine['group']) => {
    const rows = grouped(g);
    if (rows.length === 0) return;
    lines.push(title);
    for (const l of rows) {
      lines.push(
        `${l.label}: <b>${fmt(l.amount_uzs)}</b>${l.count != null ? ` (${l.count} ta)` : ''}`,
      );
    }
    lines.push('');
  };
  section('💰 <b>TUSHUM</b>', 'income');
  section('🧾 <b>CHIQIM</b>', 'outflow');
  section('🔁 <b>ICHKI KO‘CHIRMA</b>', 'transfer');
  section('ℹ️ <b>MA’LUMOT</b>', 'info');

  lines.push('📊 <b>YAKUN</b>');
  lines.push(`Sof tushum (vozvratdan keyin): <b>${fmt(t.gross_revenue_uzs)}</b>`);
  lines.push(`Rasxot: ${fmt(t.total_expense_uzs)}`);
  lines.push(`Maosh to‘lovi: ${fmt(t.total_payroll_uzs)}`);
  lines.push(`<b>Operatsion natija: ${fmt(t.operating_net_uzs)} so‘m</b>`);
  lines.push(`Pul o‘sishi (barcha hisoblar): ${fmt(t.money_delta_uzs)}`);
  if (t.debt_issued_uzs > 0) lines.push(`Qarzga berilgan: ${fmt(t.debt_issued_uzs)}`);

  if (rep.warnings.length > 0) {
    lines.push('');
    lines.push('⚠️ <b>TEKSHIRING</b>');
    for (const w of rep.warnings) lines.push(w.replace(/^⚠\s*/, '• '));
  } else {
    lines.push('');
    lines.push('✅ Svertka to‘g‘ri: boshlang‘ich + aylanma = yakuniy qoldiq');
  }
  if (rep.closed) {
    lines.push('');
    lines.push(`🔒 Bu davr yopilgan: ${new Date(rep.closed.closed_at).toLocaleString('uz-UZ')}`);
  }
  return lines.join('\n');
}

/**
 * A4 PDF — veb va Telegram bir xil faylni oladi (server tomonida yasaladi).
 * Ustun kengliklari yig'indisi 523 bo'lishi SHART (A4 ish maydoni).
 */
export function buildFinanceReportPdf(rep: FinanceReport): Promise<Buffer> {
  const t = rep.totals;

  const balanceTable: PdfTable = {
    title: 'Hisob qoldiqlari — davr boshi va oxiri',
    columns: [
      { header: 'Hisob', width: 175 },
      { header: 'Davr boshida', width: 116, numeric: true },
      { header: 'Davr oxirida', width: 116, numeric: true },
      { header: 'O‘zgarish', width: 116, numeric: true },
    ],
    rows: ACCOUNT_LABELS.map((a) => [
      a.label,
      rep.opening[a.key],
      rep.closing[a.key],
      rep.closing[a.key] - rep.opening[a.key],
    ]),
  };

  const groupTitle: Record<ReportLine['group'], string> = {
    income: 'Tushum',
    outflow: 'Chiqim',
    transfer: 'Ichki ko‘chirma (daromad emas)',
    info: "Ma'lumot uchun",
  };
  const movementTables: PdfTable[] = (
    ['income', 'outflow', 'transfer', 'info'] as Array<ReportLine['group']>
  )
    .map((g) => ({
      title: groupTitle[g],
      columns: [
        { header: 'Modda', width: 313 },
        { header: 'Soni', width: 90, numeric: true },
        { header: 'Summa', width: 120, numeric: true },
      ] as PdfTable['columns'],
      // `null` — "son yo'q" degani; `formatCell` uni «—» qilib chizadi.
      // Ilgari bu yerda `?? ''` turardi va PDF uni «0» deb ko'rsatardi.
      rows: rep.lines.filter((l) => l.group === g).map((l) => [l.label, l.count, l.amount_uzs]),
    }))
    .filter((tbl) => tbl.rows.length > 0);

  // SVERTKA — hisobotning ishonchlilik dalili. Bank ko'chirmasida bu "control
  // total" deyiladi: mos kelmasa hujjat qabul qilinmaydi.
  const reconTable: PdfTable = {
    title: 'Svertka: boshlang‘ich + kirim − chiqim = yakuniy',
    columns: [
      { header: 'Hisob', width: 125 },
      { header: 'Boshi', width: 78, numeric: true },
      { header: 'Kirim', width: 78, numeric: true },
      { header: 'Chiqim', width: 78, numeric: true },
      { header: 'Hisoblangan', width: 82, numeric: true },
      { header: 'Farq', width: 82, numeric: true },
    ],
    rows: rep.checks.map((c) => [
      `${c.ok ? '✓ ' : '✗ '}${c.account}`,
      c.opening,
      c.inflow,
      c.outflow,
      c.computed_closing,
      c.diff,
    ]),
  };

  const tables: PdfTable[] = [balanceTable, ...movementTables, reconTable];

  if (rep.warnings.length > 0) {
    tables.push({
      title: '⚠ Tekshirilishi kerak',
      columns: [{ header: 'Ogohlantirish', width: 523 }],
      rows: rep.warnings.map((w) => [w]),
    });
  }

  const sectionNote =
    rep.sections.length === REPORT_SECTIONS.length
      ? 'Barcha bo‘limlar'
      : `Bo‘limlar: ${rep.sections.map((s) => SECTION_LABELS[s]).join(', ')}`;

  return buildDailyReportPdf({
    day: `${rep.period.from} — ${rep.period.to}`,
    generatedAt: new Date(rep.generated_at),
    title: 'Moliyaviy hisobot',
    subtitle: rep.clinic.name,
    footerNote: `${rep.clinic.name} · ${sectionNote} · Clary Care`,
    kpis: [
      { label: 'Sof tushum', value: fmtSum(t.gross_revenue_uzs) },
      { label: 'Rasxot', value: fmtSum(t.total_expense_uzs) },
      { label: 'Maosh', value: fmtSum(t.total_payroll_uzs) },
      { label: 'Operatsion natija', value: fmtSum(t.operating_net_uzs) },
      { label: 'Pul o‘sishi', value: fmtSum(t.money_delta_uzs) },
    ],
    tables,
  });
}
