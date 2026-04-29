import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------
const ExpenseSchema = z.object({
  category_id: z.string().uuid().optional(),
  amount_uzs: z.number().int().positive(),
  description: z.string().optional(),
  supplier_id: z.string().uuid().optional(),
  payment_method: z
    .enum(['cash', 'card', 'transfer', 'click', 'payme', 'uzum', 'kaspi', 'humo', 'uzcard'])
    .optional(),
  expense_date: z.string().optional(),
  receipt_url: z.string().url().optional(),
});

const EXPENSE_METHODS = [
  'cash',
  'card',
  'transfer',
  'click',
  'payme',
  'uzum',
  'kaspi',
  'humo',
  'uzcard',
] as const;

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------
@Injectable()
export class CashierService {
  constructor(private readonly supabase: SupabaseService) {}

  // KPIs for today / yesterday / this month — used on the cashier dashboard.
  async kpis(clinicId: string) {
    const admin = this.supabase.admin();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [todayRows, yesterdayRows, monthRows, monthExpenses, openShifts] = await Promise.all([
      admin
        .from('transactions')
        .select('amount_uzs, kind, payment_method, is_void')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', todayStart.toISOString()),
      admin
        .from('transactions')
        .select('amount_uzs, kind, is_void')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', yesterdayStart.toISOString())
        .lt('created_at', todayStart.toISOString()),
      admin
        .from('transactions')
        .select('amount_uzs, kind, is_void')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', monthStart.toISOString()),
      admin
        .from('expenses')
        .select('amount_uzs')
        .eq('clinic_id', clinicId)
        .gte('expense_date', monthStart.toISOString().slice(0, 10)),
      admin
        .from('shifts')
        .select('id')
        .eq('clinic_id', clinicId)
        .is('closed_at', null),
    ]);

    const sum = (rows: unknown[] | null | undefined) => {
      let total = 0;
      const byMethod: Record<string, number> = {};
      for (const r of rows ?? []) {
        const row = r as { amount_uzs: number; kind: string; payment_method?: string };
        const sign = row.kind === 'refund' ? -1 : 1;
        const v = sign * Number(row.amount_uzs ?? 0);
        total += v;
        if (row.payment_method) byMethod[row.payment_method] = (byMethod[row.payment_method] ?? 0) + v;
      }
      return { total, byMethod };
    };

    const today = sum(todayRows.data);
    const yesterday = sum(yesterdayRows.data);
    const month = sum(monthRows.data);
    const monthExpTotal = (monthExpenses.data ?? []).reduce(
      (a: number, r: { amount_uzs: number }) => a + Number(r.amount_uzs ?? 0),
      0,
    );

    return {
      today: today.total,
      yesterday: yesterday.total,
      month_revenue: month.total,
      month_expenses: monthExpTotal,
      month_profit: month.total - monthExpTotal,
      by_payment_method_today: today.byMethod,
      open_shifts: (openShifts.data ?? []).length,
    };
  }

  // Transactions list with filter + pagination
  async transactions(
    clinicId: string,
    params: { from?: string; to?: string; method?: string; kind?: string; limit?: number } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('transactions')
      .select(
        '*, patient:patients(id, full_name), items:transaction_items(id, service_name_snapshot, quantity, final_amount_uzs)',
      )
      .eq('clinic_id', clinicId)
      .eq('is_void', false)
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 200);
    if (params.from) q = q.gte('created_at', params.from);
    if (params.to) q = q.lte('created_at', params.to);
    if (params.method && params.method !== 'undefined') q = q.eq('payment_method', params.method);
    if (params.kind) q = q.eq('kind', params.kind);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Expenses list
  async expenses(
    clinicId: string,
    params: { from?: string; to?: string; category?: string; limit?: number } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('expenses')
      .select('*, category:expense_categories(id, name_i18n, icon, color)')
      .eq('clinic_id', clinicId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 200);
    if (params.from) q = q.gte('expense_date', params.from);
    if (params.to) q = q.lte('expense_date', params.to);
    if (params.category) q = q.eq('category_id', params.category);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createExpense(clinicId: string, userId: string, input: z.infer<typeof ExpenseSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('expenses')
      .insert({
        clinic_id: clinicId,
        category_id: input.category_id ?? null,
        amount_uzs: input.amount_uzs,
        description: input.description ?? null,
        supplier_id: input.supplier_id ?? null,
        payment_method: input.payment_method ?? 'cash',
        receipt_url: input.receipt_url ?? null,
        expense_date: input.expense_date ?? new Date().toISOString().slice(0, 10),
        recorded_by: userId,
      })
      .select('*, category:expense_categories(id, name_i18n, icon, color)')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async voidExpense(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('expenses')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Shift reconciliation breakdown
  async shiftBreakdown(clinicId: string, shiftId: string) {
    const admin = this.supabase.admin();
    const { data: trx } = await admin
      .from('transactions')
      .select('amount_uzs, kind, payment_method, is_void')
      .eq('clinic_id', clinicId)
      .eq('shift_id', shiftId)
      .eq('is_void', false);
    const { data: exp } = await admin
      .from('expenses')
      .select('amount_uzs, payment_method')
      .eq('clinic_id', clinicId)
      .eq('shift_id', shiftId);

    const breakdown: Record<string, { in: number; out: number; net: number }> = {};
    for (const r of (trx as Array<{ amount_uzs: number; kind: string; payment_method: string }> | null) ?? []) {
      const m = r.payment_method;
      breakdown[m] ??= { in: 0, out: 0, net: 0 };
      const v = Number(r.amount_uzs ?? 0);
      if (r.kind === 'refund') {
        breakdown[m]!.out += v;
      } else {
        breakdown[m]!.in += v;
      }
      breakdown[m]!.net = breakdown[m]!.in - breakdown[m]!.out;
    }
    for (const r of (exp as Array<{ amount_uzs: number; payment_method: string }> | null) ?? []) {
      const m = r.payment_method ?? 'cash';
      breakdown[m] ??= { in: 0, out: 0, net: 0 };
      breakdown[m]!.out += Number(r.amount_uzs ?? 0);
      breakdown[m]!.net = breakdown[m]!.in - breakdown[m]!.out;
    }
    return breakdown;
  }
}

// -----------------------------------------------------------------------------
// Controller
// -----------------------------------------------------------------------------
@ApiTags('cashier')
@Controller({ path: 'cashier', version: '1' })
class CashierController {
  constructor(private readonly svc: CashierService) {}

  @Get('kpis')
  kpis(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.kpis(u.clinicId);
  }

  @Get('transactions')
  transactions(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method?: string,
    @Query('kind') kind?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.transactions(u.clinicId, { from, to, method, kind });
  }

  @Get('expenses')
  expenses(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.expenses(u.clinicId, { from, to, category });
  }

  @Post('expenses')
  @Audit({ action: 'expense.created', resourceType: 'expenses' })
  createExpense(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createExpense(u.clinicId, u.userId, ExpenseSchema.parse(body));
  }

  @Patch('expenses/:id/void')
  @Audit({ action: 'expense.voided', resourceType: 'expenses' })
  voidExpense(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.voidExpense(u.clinicId, id);
  }

  @Get('shifts/:id/breakdown')
  breakdown(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.shiftBreakdown(u.clinicId, id);
  }
}

@Module({
  controllers: [CashierController],
  providers: [CashierService, SupabaseService],
  exports: [CashierService],
})
export class CashierModule {}
