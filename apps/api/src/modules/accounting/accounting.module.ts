import { Controller, ForbiddenException, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

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
}

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, SupabaseService],
})
export class AccountingModule {}
