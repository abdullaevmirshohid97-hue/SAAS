import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const CostCenterSchema = z.object({ code: z.string().min(1), name: z.string().min(1), sort_order: z.number().int().optional() });
const BudgetSchema = z.object({
  period_year: z.number().int().min(2000).max(2100),
  period_month: z.number().int().min(1).max(12),
  account_code: z.string().min(1),
  planned_uzs: z.number().int().nonnegative(),
});
const ManualJournalSchema = z.object({
  journal_date: z.string().optional(),
  memo: z.string().min(1),
  lines: z.array(z.object({
    code: z.string().min(1),
    debit: z.number().int().nonnegative().default(0),
    credit: z.number().int().nonnegative().default(0),
    cost_center_id: z.string().uuid().optional(),
    department_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
  })).min(2),
});

// =============================================================================
// Accounting Spine (Pillar 1) — double-entry General Ledger hisobotlari.
// Trial Balance / P&L / Cash Flow / Jurnal. GL = manba jadvallarning proeksiyasi
// (trigger-driven). Cash-basis (accrual = v2).
// =============================================================================

function rangeFor(preset?: string, fromArg?: string, toArg?: string): { from: string; to: string } {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  if (fromArg && toArg) return { from: fromArg, to: toArg };
  switch (preset) {
    case 'today': break;
    case 'week': start.setDate(start.getDate() - 6); break;
    case 'year': start.setMonth(0, 1); break;
    case 'all': start.setFullYear(2000, 0, 1); break;
    case 'month':
    default: start.setDate(1); break;
  }
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

interface ActivityRow { code: string; name: string; type: string; debit: number; credit: number }

@Injectable()
export class AccountingService {
  constructor(private readonly supabase: SupabaseService) {}

  private async activity(clinicId: string, from: string, to: string): Promise<ActivityRow[]> {
    const { data, error } = await this.supabase
      .admin()
      .rpc('gl_account_activity', { p_clinic: clinicId, p_from: from, p_to: to });
    if (error) throw new Error(error.message);
    return ((data ?? []) as ActivityRow[]).map((r) => ({
      ...r, debit: Number(r.debit ?? 0), credit: Number(r.credit ?? 0),
    }));
  }

  async trialBalance(clinicId: string, from: string, to: string) {
    const rows = await this.activity(clinicId, from, to);
    const total_debit = rows.reduce((s, r) => s + r.debit, 0);
    const total_credit = rows.reduce((s, r) => s + r.credit, 0);
    return { accounts: rows, total_debit, total_credit, balanced: total_debit === total_credit };
  }

  async pnl(clinicId: string, from: string, to: string) {
    const rows = await this.activity(clinicId, from, to);
    const income = rows.filter((r) => r.type === 'income').map((r) => ({ code: r.code, name: r.name, amount: r.credit - r.debit }));
    const expense = rows.filter((r) => r.type === 'expense').map((r) => ({ code: r.code, name: r.name, amount: r.debit - r.credit }));
    const total_income = income.reduce((s, r) => s + r.amount, 0);
    const total_expense = expense.reduce((s, r) => s + r.amount, 0);
    return { income, expense, total_income, total_expense, net_profit: total_income - total_expense };
  }

  async cashFlow(clinicId: string, from: string, to: string) {
    const rows = await this.activity(clinicId, from, to);
    const cash = rows
      .filter((r) => ['1010', '1020', '1030'].includes(r.code))
      .map((r) => ({ code: r.code, name: r.name, inflow: r.debit, outflow: r.credit, net: r.debit - r.credit }));
    const net = cash.reduce((s, r) => s + r.net, 0);
    return { accounts: cash, net };
  }

  async balanceSheet(clinicId: string, asOf: string) {
    // Balans — boshidan asOf gacha kumulyativ (cash-basis). Assets = Liab + Equity.
    const rows = await this.activity(clinicId, '2000-01-01', asOf);
    const assets = rows.filter((r) => r.type === 'asset').map((r) => ({ code: r.code, name: r.name, balance: r.debit - r.credit }));
    const liabilities = rows.filter((r) => r.type === 'liability').map((r) => ({ code: r.code, name: r.name, balance: r.credit - r.debit }));
    const equityAccts = rows.filter((r) => r.type === 'equity').map((r) => ({ code: r.code, name: r.name, balance: r.credit - r.debit }));
    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + (r.credit - r.debit), 0);
    const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + (r.debit - r.credit), 0);
    const retained_earnings = income - expense;
    const total_assets = assets.reduce((s, r) => s + r.balance, 0);
    const total_liabilities = liabilities.reduce((s, r) => s + r.balance, 0);
    const total_equity = equityAccts.reduce((s, r) => s + r.balance, 0) + retained_earnings;
    return {
      as_of: asOf,
      assets, liabilities,
      equity: [...equityAccts, { code: '3900', name: 'Taqsimlanmagan foyda', balance: retained_earnings }],
      retained_earnings,
      total_assets, total_liabilities, total_equity,
      balanced: total_assets === total_liabilities + total_equity,
    };
  }

  async chart(clinicId: string) {
    const r = rangeFor('all');
    const rows = await this.activity(clinicId, r.from, r.to);
    // Hisob balansi: asset/expense = debit−credit; income/liability/equity = credit−debit
    return rows.map((a) => ({
      ...a,
      balance: ['asset', 'expense'].includes(a.type) ? a.debit - a.credit : a.credit - a.debit,
    }));
  }

  // Pillar 1 v2b — hibrid accrual: AR/AP aging (yordamchi kitob) + QQS hisoboti.
  async arAging(clinicId: string, asOf: string) {
    const { data, error } = await this.supabase.admin().rpc('ar_aging', { p_clinic: clinicId, p_as_of: asOf });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ total_owed: number; b0_30: number; b31_60: number; b61_90: number; b90_plus: number }>;
    const totals = rows.reduce(
      (a, r) => ({
        total_owed: a.total_owed + Number(r.total_owed ?? 0),
        b0_30: a.b0_30 + Number(r.b0_30 ?? 0), b31_60: a.b31_60 + Number(r.b31_60 ?? 0),
        b61_90: a.b61_90 + Number(r.b61_90 ?? 0), b90_plus: a.b90_plus + Number(r.b90_plus ?? 0),
      }),
      { total_owed: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
    );
    return { rows, totals };
  }

  async apAging(clinicId: string, asOf: string) {
    const { data, error } = await this.supabase.admin().rpc('ap_aging', { p_clinic: clinicId, p_as_of: asOf });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ total_owed: number; b0_30: number; b31_60: number; b61_90: number; b90_plus: number }>;
    const totals = rows.reduce(
      (a, r) => ({
        total_owed: a.total_owed + Number(r.total_owed ?? 0),
        b0_30: a.b0_30 + Number(r.b0_30 ?? 0), b31_60: a.b31_60 + Number(r.b31_60 ?? 0),
        b61_90: a.b61_90 + Number(r.b61_90 ?? 0), b90_plus: a.b90_plus + Number(r.b90_plus ?? 0),
      }),
      { total_owed: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
    );
    return { rows, totals };
  }

  async qqsReport(clinicId: string, from: string, to: string) {
    const { data, error } = await this.supabase.admin().rpc('qqs_report', { p_clinic: clinicId, p_from: from, p_to: to });
    if (error) throw new Error(error.message);
    const r = ((data ?? [])[0] ?? {}) as { taxable_base?: number; output_vat?: number; input_vat?: number; net_payable?: number };
    return {
      from, to,
      taxable_base: Number(r.taxable_base ?? 0),
      output_vat: Number(r.output_vat ?? 0),
      input_vat: Number(r.input_vat ?? 0),
      net_payable: Number(r.net_payable ?? 0),
    };
  }

  // F3 — CFO/Executive dashboard: GL balanslaridan bitta oynalik KPI
  async executiveDashboard(clinicId: string, from: string, to: string) {
    const admin = this.supabase.admin();
    const [period, cumulative, expRes] = await Promise.all([
      this.activity(clinicId, from, to),
      this.activity(clinicId, '2000-01-01', to),
      admin.from('expenses')
        .select('description, amount_uzs, category:expense_categories(name_i18n)')
        .eq('clinic_id', clinicId).eq('is_void', false)
        .gte('expense_date', from).lte('expense_date', to)
        .order('amount_uzs', { ascending: false }).limit(5),
    ]);
    const debBal = (code: string) => { const r = cumulative.find((a) => a.code === code); return r ? r.debit - r.credit : 0; };
    const credBal = (code: string) => { const r = cumulative.find((a) => a.code === code); return r ? r.credit - r.debit : 0; };

    const revenue = period.filter((a) => a.type === 'income').reduce((s, a) => s + (a.credit - a.debit), 0);
    const expense = period.filter((a) => a.type === 'expense').reduce((s, a) => s + (a.debit - a.credit), 0);
    const depreciation = period.filter((a) => a.code === '5300').reduce((s, a) => s + (a.debit - a.credit), 0);
    const profit = revenue - expense;

    // davr oylar soni (cash burn run-rate uchun)
    const months = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / (30 * 86400000));

    return {
      from, to,
      kpis: {
        cash: debBal('1010') + debBal('1020') + debBal('1030'),
        patient_ar: debBal('1200'),
        insurer_ar: debBal('1210'),
        inventory_value: debBal('1400'),
        accounts_payable: credBal('2100'),
        revenue, expense, profit,
        ebitda: profit + depreciation, // + foiz + soliq (kelajak fazalarda)
        cash_burn: Math.round(expense / months), // oylik xarajat run-rate
      },
      top_expenses: ((expRes.data ?? []) as unknown as Array<{ description: string | null; amount_uzs: number; category: { name_i18n: Record<string, string> } | { name_i18n: Record<string, string> }[] | null }>)
        .map((e) => {
          const cat = Array.isArray(e.category) ? e.category[0] : e.category;
          const n = cat?.name_i18n;
          return {
            label: e.description || (n?.['uz-Latn'] ?? n?.ru ?? 'Xarajat'),
            amount_uzs: Number(e.amount_uzs ?? 0),
          };
        }),
    };
  }

  // E5 — Tax Center (estimate: QQS + foyda/aylanma + ijtimoiy soliq)
  async getTaxSettings(clinicId: string) {
    const { data } = await this.supabase.admin().from('tax_settings').select('*').eq('clinic_id', clinicId).maybeSingle();
    return data ?? { clinic_id: clinicId, regime: 'qqs_profit', qqs_pct: 12, profit_tax_pct: 15, turnover_tax_pct: 4, social_tax_pct: 12 };
  }

  async updateTaxSettings(clinicId: string, body: Record<string, unknown>) {
    const allowed = ['regime', 'qqs_pct', 'profit_tax_pct', 'turnover_tax_pct', 'social_tax_pct'];
    const patch: Record<string, unknown> = { clinic_id: clinicId, updated_at: new Date().toISOString() };
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    await this.supabase.admin().from('tax_settings').upsert(patch, { onConflict: 'clinic_id' });
    return this.getTaxSettings(clinicId);
  }

  async taxReport(clinicId: string, from: string, to: string) {
    const [activity, qqs, settings] = await Promise.all([
      this.activity(clinicId, from, to),
      this.qqsReport(clinicId, from, to),
      this.getTaxSettings(clinicId),
    ]);
    const s = settings as { regime: string; profit_tax_pct: number; turnover_tax_pct: number; social_tax_pct: number };
    const revenue = activity.filter((a) => a.type === 'income').reduce((x, a) => x + (a.credit - a.debit), 0);
    const expense = activity.filter((a) => a.type === 'expense').reduce((x, a) => x + (a.debit - a.credit), 0);
    const profit = revenue - expense;
    const payrollRow = activity.find((a) => a.code === '5400');
    const payroll = payrollRow ? payrollRow.debit - payrollRow.credit : 0;

    const social_tax = Math.round((payroll * Number(s.social_tax_pct)) / 100);
    let qqs_payable = 0, profit_tax = 0, turnover_tax = 0;
    if (s.regime === 'qqs_profit') {
      qqs_payable = qqs.output_vat;
      profit_tax = Math.round((Math.max(0, profit) * Number(s.profit_tax_pct)) / 100);
    } else {
      turnover_tax = Math.round((revenue * Number(s.turnover_tax_pct)) / 100);
    }
    return {
      from, to, regime: s.regime, revenue, profit, payroll,
      qqs_payable, profit_tax, turnover_tax, social_tax,
      total_estimated: qqs_payable + profit_tax + turnover_tax + social_tax,
    };
  }

  // E3 — Budget & Variance (reja vs fakt)
  async budgetReport(clinicId: string, year: number, month: number) {
    const mm = String(month).padStart(2, '0');
    const days = new Date(year, month, 0).getDate();
    const from = `${year}-${mm}-01`;
    const to = `${year}-${mm}-${String(days).padStart(2, '0')}`;
    const [actual, budgetRes] = await Promise.all([
      this.activity(clinicId, from, to),
      this.supabase.admin().from('budgets')
        .select('account_code, planned_uzs')
        .eq('clinic_id', clinicId).eq('period_year', year).eq('period_month', month),
    ]);
    const planMap = new Map<string, number>();
    for (const b of (budgetRes.data ?? []) as Array<{ account_code: string; planned_uzs: number }>) planMap.set(b.account_code, Number(b.planned_uzs));

    const rows = actual.filter((a) => a.type === 'income' || a.type === 'expense').map((a) => {
      const actualVal = a.type === 'income' ? a.credit - a.debit : a.debit - a.credit;
      const planned = planMap.get(a.code) ?? 0;
      // favorable variance: income fakt>reja yaxshi; expense fakt<reja yaxshi
      const variance = a.type === 'income' ? actualVal - planned : planned - actualVal;
      return { code: a.code, name: a.name, type: a.type, planned, actual: actualVal, variance, achieved_pct: planned > 0 ? Math.round((actualVal / planned) * 100) : null };
    }).filter((r) => r.planned !== 0 || r.actual !== 0);

    const sum = (t: string, f: 'planned' | 'actual') => rows.filter((r) => r.type === t).reduce((s, r) => s + r[f], 0);
    return {
      year, month, rows,
      summary: {
        planned_income: sum('income', 'planned'), actual_income: sum('income', 'actual'),
        planned_expense: sum('expense', 'planned'), actual_expense: sum('expense', 'actual'),
      },
    };
  }

  async setBudget(clinicId: string, body: z.infer<typeof BudgetSchema>) {
    const { error } = await this.supabase.admin().from('budgets').upsert(
      { clinic_id: clinicId, period_year: body.period_year, period_month: body.period_month, account_code: body.account_code, planned_uzs: body.planned_uzs, updated_at: new Date().toISOString() },
      { onConflict: 'clinic_id,period_year,period_month,account_code' },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  // F1 — Cost centers (dimension) + qo'lda provodka (manual journal)
  async listCostCenters(clinicId: string) {
    const { data } = await this.supabase.admin()
      .from('cost_centers').select('*').eq('clinic_id', clinicId)
      .order('sort_order').order('name');
    return data ?? [];
  }

  async createCostCenter(clinicId: string, body: z.infer<typeof CostCenterSchema>) {
    const { data, error } = await this.supabase.admin()
      .from('cost_centers')
      .insert({ clinic_id: clinicId, code: body.code, name: body.name, sort_order: body.sort_order ?? 0 })
      .select('id').single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id };
  }

  async updateCostCenter(clinicId: string, id: string, body: Partial<z.infer<typeof CostCenterSchema>> & { is_active?: boolean }) {
    await this.supabase.admin().from('cost_centers').update(body).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async postManualJournal(clinicId: string, body: z.infer<typeof ManualJournalSchema>) {
    const debit = body.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = body.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (debit !== credit) throw new Error(`Balans xato: debit ${debit} ≠ credit ${credit}`);
    if (debit === 0) throw new Error('Bo\'sh provodka');
    const { data, error } = await this.supabase.admin().rpc('post_journal', {
      p_clinic: clinicId, p_type: 'manual',
      p_date: body.journal_date ?? new Date().toISOString().slice(0, 10),
      p_source_table: null, p_source_id: null, p_memo: body.memo,
      p_lines: body.lines.map((l) => ({
        code: l.code, debit: l.debit ?? 0, credit: l.credit ?? 0,
        cost_center_id: l.cost_center_id ?? '', department_id: l.department_id ?? '', project_id: l.project_id ?? '',
      })),
    });
    if (error) throw new Error(error.message);
    return { journal_id: data };
  }

  async journals(clinicId: string, from: string, to: string, limit = 100) {
    const { data, error } = await this.supabase
      .admin()
      .from('gl_journals')
      .select('id, journal_date, type, memo, source_table, source_id, lines:gl_lines(debit_uzs, credit_uzs, account:chart_of_accounts(code, name))')
      .eq('clinic_id', clinicId)
      .gte('journal_date', from)
      .lte('journal_date', to)
      .order('journal_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}

@ApiTags('accounting')
@Controller({ path: 'accounting', version: '1' })
class AccountingController {
  constructor(private readonly svc: AccountingService) {}

  @Get('chart')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  chart(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.chart(u.clinicId);
  }

  @Get('trial-balance')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  trialBalance(@CurrentUser() u: { clinicId: string | null }, @Query('preset') p?: string, @Query('from') f?: string, @Query('to') t?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(p, f, t);
    return this.svc.trialBalance(u.clinicId, from, to);
  }

  @Get('pnl')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  pnl(@CurrentUser() u: { clinicId: string | null }, @Query('preset') p?: string, @Query('from') f?: string, @Query('to') t?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(p, f, t);
    return this.svc.pnl(u.clinicId, from, to);
  }

  @Get('cash-flow')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  cashFlow(@CurrentUser() u: { clinicId: string | null }, @Query('preset') p?: string, @Query('from') f?: string, @Query('to') t?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(p, f, t);
    return this.svc.cashFlow(u.clinicId, from, to);
  }

  @Get('balance-sheet')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  balanceSheet(@CurrentUser() u: { clinicId: string | null }, @Query('as_of') asOf?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const as = asOf || new Date().toISOString().slice(0, 10);
    return this.svc.balanceSheet(u.clinicId, as);
  }

  @Get('journals')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  journals(@CurrentUser() u: { clinicId: string | null }, @Query('preset') p?: string, @Query('from') f?: string, @Query('to') t?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(p, f, t);
    return this.svc.journals(u.clinicId, from, to);
  }

  @Get('ar-aging')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  arAging(@CurrentUser() u: { clinicId: string | null }, @Query('as_of') asOf?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.arAging(u.clinicId, asOf || new Date().toISOString().slice(0, 10));
  }

  @Get('ap-aging')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  apAging(@CurrentUser() u: { clinicId: string | null }, @Query('as_of') asOf?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.apAging(u.clinicId, asOf || new Date().toISOString().slice(0, 10));
  }

  @Get('qqs-report')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  qqsReport(@CurrentUser() u: { clinicId: string | null }, @Query('preset') p?: string, @Query('from') f?: string, @Query('to') t?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(p, f, t);
    return this.svc.qqsReport(u.clinicId, from, to);
  }

  @Get('executive')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  executive(@CurrentUser() u: { clinicId: string | null }, @Query('preset') p?: string, @Query('from') f?: string, @Query('to') t?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(p, f, t);
    return this.svc.executiveDashboard(u.clinicId, from, to);
  }

  // --- E5: Tax Center ---
  @Get('tax/settings')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  taxSettings(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getTaxSettings(u.clinicId);
  }

  @Post('tax/settings')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  setTaxSettings(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateTaxSettings(u.clinicId, (body ?? {}) as Record<string, unknown>);
  }

  @Get('tax/report')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  taxReport(@CurrentUser() u: { clinicId: string | null }, @Query('preset') p?: string, @Query('from') f?: string, @Query('to') t?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const { from, to } = rangeFor(p, f, t);
    return this.svc.taxReport(u.clinicId, from, to);
  }

  // --- E3: Budget ---
  @Get('budget')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  budget(@CurrentUser() u: { clinicId: string | null }, @Query('year') year?: string, @Query('month') month?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    const now = new Date();
    return this.svc.budgetReport(u.clinicId, year ? Number(year) : now.getFullYear(), month ? Number(month) : now.getMonth() + 1);
  }

  @Post('budget')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  setBudget(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.setBudget(u.clinicId, BudgetSchema.parse(body));
  }

  // --- F1: Cost centers + qo'lda provodka ---
  @Get('cost-centers')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  costCenters(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listCostCenters(u.clinicId);
  }

  @Post('cost-centers')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  createCostCenter(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createCostCenter(u.clinicId, CostCenterSchema.parse(body));
  }

  @Post('cost-centers/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  updateCostCenter(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateCostCenter(u.clinicId, id, (body ?? {}) as { name?: string; is_active?: boolean });
  }

  @Post('journals')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  postJournal(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.postManualJournal(u.clinicId, ManualJournalSchema.parse(body));
  }
}

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, SupabaseService],
})
export class AccountingModule {}
