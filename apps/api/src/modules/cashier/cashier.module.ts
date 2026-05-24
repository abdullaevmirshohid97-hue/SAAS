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

const PAYMENT_METHOD = z.enum([
  'cash', 'card', 'transfer', 'click', 'payme', 'humo', 'uzcard', 'uzum', 'kaspi',
]);

// Vozvrat (mijozga pul qaytarish — bemorga emas, masalan, xizmat berilmadi)
const RefundSchema = z.object({
  patient_id: z.string().uuid(),
  amount_uzs: z.number().int().positive(),
  payment_method: PAYMENT_METHOD,
  reason: z.string().min(1).max(500),
  // Asl tranzaksiya (qaysi tx uchun refund) — ixtiyoriy
  refund_of_transaction_id: z.string().uuid().optional(),
});

// Bemor depozitidan naqd pul chiqarish (depozit qoldig'ini qaytarish)
const DepositWithdrawSchema = z.object({
  patient_id: z.string().uuid(),
  amount_uzs: z.number().int().positive(),
  payment_method: PAYMENT_METHOD,
  reason: z.string().max(500).optional(),
});

// Qarz to'lash — qarzdor bemor pul keltirdi
const DebtPaymentSchema = z.object({
  patient_id: z.string().uuid(),
  amount_uzs: z.number().int().positive(),
  payment_method: PAYMENT_METHOD,
  notes: z.string().max(500).optional(),
});

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

    // Faol smena — bugungi kassa shu smena bo'yicha hisoblanadi. Smena
    // yopilganda kassa avtomatik 0 ga tushadi (yangi smena ochilmaguncha).
    const { data: activeShiftRow } = await admin
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const activeShiftId = (activeShiftRow as { id?: string } | null)?.id ?? null;

    // todayRows — faqat faol smena tranzaksiyalari. Smena yo'q bo'lsa bo'sh.
    const todayQuery = activeShiftId
      ? admin
          .from('transactions')
          .select('amount_uzs, kind, payment_method, is_void')
          .eq('clinic_id', clinicId)
          .eq('is_void', false)
          .eq('shift_id', activeShiftId)
      : null;

    const [todayRows, yesterdayRows, monthRows, monthExpenses, openShifts] = await Promise.all([
      todayQuery ?? Promise.resolve({ data: [] as Array<{ amount_uzs: number; kind: string; payment_method: string }> }),
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
        .eq('is_void', false)
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

    const admin2 = this.supabase.admin();
    const [{ data: pharmDebtRows }, { data: ledgerDebtRows }] = await Promise.all([
      admin2
        .from('pharmacy_sales')
        .select('debt_uzs')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gt('debt_uzs', 0),
      admin2
        .from('patient_ledger')
        .select('patient_id, amount_uzs')
        .eq('clinic_id', clinicId),
    ]);

    const pharmacy_debt = (pharmDebtRows ?? []).reduce(
      (a: number, r: { debt_uzs: number }) => a + Number(r.debt_uzs ?? 0),
      0,
    );

    // Group ledger by patient, sum amounts; negative balance = debt
    const patientBalances = new Map<string, number>();
    for (const r of (ledgerDebtRows ?? []) as Array<{ patient_id: string; amount_uzs: number }>) {
      patientBalances.set(r.patient_id, (patientBalances.get(r.patient_id) ?? 0) + Number(r.amount_uzs));
    }
    const inpatient_debt = Array.from(patientBalances.values())
      .filter((b) => b < 0)
      .reduce((a, b) => a + Math.abs(b), 0);

    return {
      today: today.total,
      yesterday: yesterday.total,
      month_revenue: month.total,
      month_expenses: monthExpTotal,
      month_profit: month.total - monthExpTotal,
      by_payment_method_today: today.byMethod,
      open_shifts: (openShifts.data ?? []).length,
      pharmacy_debt,
      inpatient_debt,
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
      .eq('is_void', false)
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

  async voidExpense(clinicId: string, userId: string, id: string) {
    // Soft-delete — audit izi saqlansin (transactions.is_void patterni).
    const { error } = await this.supabase
      .admin()
      .from('expenses')
      .update({ is_void: true, voided_at: new Date().toISOString(), voided_by: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .eq('is_void', false);
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
      .eq('shift_id', shiftId)
      .eq('is_void', false);

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

  // ===========================================================================
  // VOZVRAT — mijozga pul qaytarish (xizmat berilmadi yoki sifatsiz)
  // ===========================================================================
  async refund(clinicId: string, userId: string, input: z.infer<typeof RefundSchema>) {
    const admin = this.supabase.admin();
    // Aktiv smenani topish (vozvrat shu smenadan minus bo'ladi)
    const { data: shift } = await admin
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 1) transactions ga refund yozish (amount NEGATIVE — bu kassadan chiqim)
    const { data: trx, error } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        cashier_id: userId,
        shift_id: (shift as { id: string } | null)?.id ?? null,
        kind: 'refund',
        amount_uzs: -Math.abs(input.amount_uzs),
        payment_method: input.payment_method,
        notes: `Vozvrat: ${input.reason}${input.refund_of_transaction_id ? ` (tx: ${input.refund_of_transaction_id})` : ''}`,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return { id: (trx as { id: string }).id };
  }

  // ===========================================================================
  // DEPOZIT QAYTARISH — bemor depozitidan naqd pul chiqarish (statsionar)
  // patient_ledger.refund yoziladi (ledger balansi kamayadi), va kassadan chiqim
  // (transactions.refund) ham yoziladi.
  // ===========================================================================
  async depositWithdraw(
    clinicId: string,
    userId: string,
    input: z.infer<typeof DepositWithdrawSchema>,
  ) {
    const admin = this.supabase.admin();

    // 1) Bemor depozit balansi (patient_ledger sum) yetarlimi tekshir
    const { data: ledger } = await admin
      .from('patient_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('patient_id', input.patient_id);
    const balance = (ledger ?? []).reduce(
      (s: number, r: { amount_uzs: number }) => s + Number(r.amount_uzs ?? 0),
      0,
    );
    if (balance < input.amount_uzs) {
      throw new BadRequestException(
        `Bemor depozit balansi yetarli emas: ${balance} so'm bor, ${input.amount_uzs} so'm so'raldi`,
      );
    }

    // 2) Aktiv smena
    const { data: shift } = await admin
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3) Transactions refund (kassadan chiqim)
    const { data: trx, error: trxErr } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        cashier_id: userId,
        shift_id: (shift as { id: string } | null)?.id ?? null,
        kind: 'refund',
        amount_uzs: -Math.abs(input.amount_uzs),
        payment_method: input.payment_method,
        notes: `Depozit qaytarish${input.reason ? `: ${input.reason}` : ''}`,
      })
      .select('id')
      .single();
    if (trxErr) throw new BadRequestException(trxErr.message);
    const trxId = (trx as { id: string }).id;

    // 4) patient_ledger ga refund (negativ — balans kamayadi)
    await admin.from('patient_ledger').insert({
      clinic_id: clinicId,
      patient_id: input.patient_id,
      transaction_id: trxId,
      entry_kind: 'refund',
      amount_uzs: -Math.abs(input.amount_uzs),
      description: `Depozit qaytarish${input.reason ? `: ${input.reason}` : ''}`,
      recorded_by: userId,
    });

    return { id: trxId, new_balance_uzs: balance - input.amount_uzs };
  }

  // ===========================================================================
  // QARZDORLAR RO'YXATI — patient_ledger balansi MANFIY bo'lgan bemorlar
  // (qarz = ledger.sum < 0). Statsionar va boshqa qarzlar shu yerda jamlanadi.
  // ===========================================================================
  async debtors(clinicId: string) {
    const admin = this.supabase.admin();
    const { data: ledger } = await admin
      .from('patient_ledger')
      .select('patient_id, amount_uzs')
      .eq('clinic_id', clinicId);

    // Per-patient balance
    const balances = new Map<string, number>();
    for (const r of (ledger ?? []) as Array<{ patient_id: string; amount_uzs: number }>) {
      balances.set(r.patient_id, (balances.get(r.patient_id) ?? 0) + Number(r.amount_uzs ?? 0));
    }
    const debtorIds = Array.from(balances.entries())
      .filter(([, bal]) => bal < 0)
      .map(([pid]) => pid);

    if (debtorIds.length === 0) return [];

    // Bemor ma'lumotini olish
    const { data: patients } = await admin
      .from('patients')
      .select('id, full_name, phone, dob')
      .eq('clinic_id', clinicId)
      .in('id', debtorIds);

    return ((patients ?? []) as Array<{
      id: string;
      full_name: string;
      phone: string | null;
      dob: string | null;
    }>)
      .map((p) => ({
        ...p,
        debt_uzs: Math.abs(balances.get(p.id) ?? 0),
      }))
      .sort((a, b) => b.debt_uzs - a.debt_uzs);
  }

  // ===========================================================================
  // QARZ TO'LASH — qarzdor bemor pul keltirdi
  // transactions(payment) + patient_ledger(deposit) — balans + ga ko'tariladi
  // ===========================================================================
  async debtPayment(clinicId: string, userId: string, input: z.infer<typeof DebtPaymentSchema>) {
    const admin = this.supabase.admin();

    const { data: shift } = await admin
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 1) Transactions payment (kassaga kirim)
    const { data: trx, error: trxErr } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        cashier_id: userId,
        shift_id: (shift as { id: string } | null)?.id ?? null,
        kind: 'payment',
        amount_uzs: input.amount_uzs,
        payment_method: input.payment_method,
        notes: `Qarz to'lash${input.notes ? `: ${input.notes}` : ''}`,
      })
      .select('id')
      .single();
    if (trxErr) throw new BadRequestException(trxErr.message);
    const trxId = (trx as { id: string }).id;

    // 2) patient_ledger deposit (musbat — balans yaxshilanadi)
    await admin.from('patient_ledger').insert({
      clinic_id: clinicId,
      patient_id: input.patient_id,
      transaction_id: trxId,
      entry_kind: 'deposit',
      amount_uzs: input.amount_uzs,
      description: `Qarz to'lash${input.notes ? `: ${input.notes}` : ''}`,
      recorded_by: userId,
    });

    return { id: trxId };
  }

  // ===========================================================================
  // Bemor balansi (depozit qoldig'i ko'rsatish uchun)
  // ===========================================================================
  async patientBalance(clinicId: string, patientId: string) {
    const { data } = await this.supabase
      .admin()
      .from('patient_ledger')
      .select('amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId);
    const balance = (data ?? []).reduce(
      (s: number, r: { amount_uzs: number }) => s + Number(r.amount_uzs ?? 0),
      0,
    );
    return { patient_id: patientId, balance_uzs: balance };
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
  voidExpense(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.voidExpense(u.clinicId, u.userId, id);
  }

  @Get('shifts/:id/breakdown')
  breakdown(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.shiftBreakdown(u.clinicId, id);
  }

  @Post('refund')
  @Audit({ action: 'cashier.refund', resourceType: 'transactions' })
  refund(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.refund(u.clinicId, u.userId, RefundSchema.parse(body));
  }

  @Post('deposit-withdraw')
  @Audit({ action: 'cashier.deposit_withdraw', resourceType: 'patient_ledger' })
  depositWithdraw(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.depositWithdraw(u.clinicId, u.userId, DepositWithdrawSchema.parse(body));
  }

  @Get('debtors')
  debtors(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.debtors(u.clinicId);
  }

  @Post('debt-payment')
  @Audit({ action: 'cashier.debt_payment', resourceType: 'transactions' })
  debtPayment(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.debtPayment(u.clinicId, u.userId, DebtPaymentSchema.parse(body));
  }

  @Get('patients/:id/balance')
  patientBalance(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.patientBalance(u.clinicId, id);
  }
}

@Module({
  controllers: [CashierController],
  providers: [CashierService, SupabaseService],
  exports: [CashierService],
})
export class CashierModule {}
