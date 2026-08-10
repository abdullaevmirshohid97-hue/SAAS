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

/** Maosh — xodim kesimi ("kim qancha oldi"). */
export type PayrollPerson = {
  person_id: string | null;
  person_name: string;
  person_role: string;
  payouts_count: number;
  net_uzs: number;
  cash_uzs: number;
  safe_uzs: number;
  noncash_uzs: number;
  first_paid_at: string | null;
  last_paid_at: string | null;
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
  /** Faqat "Maoshlar" bo'limi tanlanganda to'ladi. */
  payroll_by_person: PayrollPerson[];
  /** YAKUN — arifmetikasi ko'rinadigan ko'rinishda (veb/PDF/Telegram bir xil). */
  summary_blocks: SummaryBlock[];
};

/** Yakun qatori: `add` qo'shiladi, `sub` ayriladi, `total` — natija. */
export type SummaryRow = {
  key: string;
  label: string;
  amount_uzs: number;
  kind: 'add' | 'sub' | 'total';
  note?: string;
};

export type SummaryBlock = {
  key: string;
  title: string;
  note: string;
  rows: SummaryRow[];
};

/**
 * YAKUNni ikkita ALOHIDA blokka ajratadi.
 *
 * ⚠️ Nega bu kerak: ilgari yakunda ikkita "foyda" yonma-yon turardi —
 * «Operatsion natija 28 210 500» va «Foyda 31 689 000». Farqi 3.5 mln, sababi
 * esa hech qayerda yozilmagan edi. Aslida ular BIR XIL davrni ikki xil MEHNAT
 * XARAJATI bilan o'lchaydi:
 *   • kassa asosi — davr ichida TO'LANGAN maosh (pul chindan chiqdi);
 *   • accrual     — davr ichida ISHLANGAN komissiya (xizmat ko'rsatilganda).
 * Ikkalasi ham to'g'ri, lekin ular boshqa savolga javob beradi. Shuning uchun
 * endi har biri o'z blokida, arifmetikasi ochiq ko'rinadi.
 */
export function buildSummaryBlocks(
  totals: FinanceReport['totals'],
  f: Pick<PeriodFlows, 'commission' | 'pharm_profit'>,
): SummaryBlock[] {
  const cash: SummaryBlock = {
    key: 'cash_basis',
    title: 'Kassa asosida — davr ichida pul qancha harakat qildi',
    note: "Maoshning DAVR ICHIDA TO'LANGAN qismi hisobga olinadi.",
    rows: [
      {
        key: 'revenue',
        label: 'Sof tushum (vozvratdan keyin)',
        amount_uzs: totals.gross_revenue_uzs,
        kind: 'add',
      },
      { key: 'expense', label: 'Rasxotlar', amount_uzs: totals.total_expense_uzs, kind: 'sub' },
      {
        key: 'payroll',
        label: "Maosh — to'langan",
        amount_uzs: totals.total_payroll_uzs,
        kind: 'sub',
      },
      {
        key: 'operating',
        label: 'OPERATSION NATIJA',
        amount_uzs: totals.operating_net_uzs,
        kind: 'total',
      },
    ],
  };

  const accrual: SummaryBlock = {
    key: 'accrual_basis',
    title: 'Hisoblangan asosda — davr ichida qancha ishlab topildi',
    note: "To'langan maosh o'rniga DAVR ICHIDA ISHLANGAN komissiya olinadi.",
    rows: [
      {
        key: 'revenue2',
        label: 'Sof tushum (vozvratdan keyin)',
        amount_uzs: totals.gross_revenue_uzs,
        kind: 'add',
      },
      { key: 'expense2', label: 'Rasxotlar', amount_uzs: totals.total_expense_uzs, kind: 'sub' },
      {
        key: 'commission',
        label: 'Shifokor komissiyasi — ishlangan',
        amount_uzs: f.commission,
        kind: 'sub',
      },
      {
        key: 'pharm',
        label: 'Dorixona ustamasi',
        amount_uzs: f.pharm_profit,
        kind: 'add',
      },
      { key: 'profit', label: 'FOYDA', amount_uzs: totals.accrual_profit_uzs, kind: 'total' },
    ],
  };

  return [cash, accrual];
}

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

// `+ 0` — manfiy nolni yo'q qiladi: Intl `-0` ni «-0» deb chizadi va hisobotda
// «Rasxot: -0 so'm» degan bema'ni qator paydo bo'ladi.
const fmt = (v: number) => (Number(v ?? 0) + 0).toLocaleString('ru-RU');
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

  // Maosh — xodim kesimi. Telegram xabari cheklangan, shuning uchun eng ko'p
  // olgan 10 tasi; qolgani bitta qatorga yig'iladi (jami PDF bilan mos qolsin).
  if (rep.payroll_by_person.length > 0) {
    lines.push('👥 <b>MAOSH — KIM QANCHA OLDI</b>');
    const top = rep.payroll_by_person.slice(0, 10);
    for (const p of top) {
      lines.push(`${p.person_name}: <b>${fmt(p.net_uzs)}</b> (${p.payouts_count} ta to‘lov)`);
    }
    if (rep.payroll_by_person.length > top.length) {
      const rest = rep.payroll_by_person.slice(top.length);
      const restSum = rest.reduce((s, p) => s + p.net_uzs, 0);
      lines.push(`…yana ${rest.length} xodim: ${fmt(restSum)}`);
    }
    lines.push('');
  }

  // YAKUN — arifmetikasi ko'rinadigan bloklar (veb/PDF bilan bir xil).
  for (const b of rep.summary_blocks) {
    lines.push(`📊 <b>${b.title.toUpperCase()}</b>`);
    for (const r of b.rows) {
      const sign = r.kind === 'sub' ? '−' : r.kind === 'total' ? '=' : ' ';
      const val = fmt(r.amount_uzs);
      lines.push(
        r.kind === 'total' ? `${sign} <b>${r.label}: ${val}</b>` : `${sign} ${r.label}: ${val}`,
      );
    }
    lines.push(`<i>${b.note}</i>`);
    lines.push('');
  }
  lines.push(`💼 Pul o‘sishi (4 hisob jami): <b>${fmt(t.money_delta_uzs)}</b>`);
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

  // YAKUN — arifmetikasi ko'rinadigan ikkita blok. Ilgari PDF'da faqat
  // natijalar turardi va «Operatsion natija» bilan «Foyda» nega farq qilishi
  // hech qayerda yozilmagan edi.
  const summaryTables: PdfTable[] = rep.summary_blocks.map((b) => ({
    title: `${b.title}`,
    columns: [
      { header: 'Modda', width: 353 },
      { header: 'Summa', width: 170, numeric: true },
    ],
    rows: [
      ...b.rows.map((r) => [
        r.kind === 'sub' ? `−  ${r.label}` : r.kind === 'total' ? `=  ${r.label}` : `   ${r.label}`,
        r.kind === 'sub' ? -r.amount_uzs : r.amount_uzs,
      ]),
      ['', ''],
      [b.note, ''],
    ],
  }));

  const groupTitle: Record<ReportLine['group'], string> = {
    income: 'Tushum',
    outflow: 'Chiqim',
    // Yig'indisi ko'rsatilmaydi: inkasatsiya + hisob-kitob + seyf kirimini
    // qo'shishning ma'nosi yo'q — ular turli hisoblar orasidagi ko'chirma.
    transfer: 'Ichki ko‘chirma — pul o‘z hisoblarimiz orasida ko‘chdi (daromad EMAS)',
    info: "Ma'lumot uchun (yakunga kirmaydi)",
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

  // Maosh — xodim kesimi. Egasi eng ko'p shuni so'raydi: "kim qancha oldi".
  // Ustunlar yig'indisi 523 (A4 ish maydoni).
  const payrollTable: PdfTable[] =
    rep.payroll_by_person.length > 0
      ? [
          {
            title: `Maosh — xodimlar kesimida (${rep.period.from} — ${rep.period.to})`,
            columns: [
              { header: 'Xodim', width: 173 },
              { header: 'To‘lov', width: 55, numeric: true },
              { header: 'Naqd', width: 80, numeric: true },
              { header: 'Seyfdan', width: 80, numeric: true },
              { header: 'Naqdsiz', width: 80, numeric: true },
              { header: 'JAMI', width: 55, numeric: true },
            ],
            rows: rep.payroll_by_person.map((p) => [
              p.person_name,
              p.payouts_count,
              p.cash_uzs,
              p.safe_uzs,
              p.noncash_uzs,
              p.net_uzs,
            ]),
            maxRows: 200,
          },
        ]
      : [];

  const tables: PdfTable[] = [
    balanceTable,
    ...summaryTables,
    ...movementTables,
    ...payrollTable,
    reconTable,
  ];

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
      { label: 'Maosh to‘langan', value: fmtSum(t.total_payroll_uzs) },
      { label: 'Operatsion natija', value: fmtSum(t.operating_net_uzs) },
      { label: 'Pul o‘sishi', value: fmtSum(t.money_delta_uzs) },
    ],
    tables,
  });
}
