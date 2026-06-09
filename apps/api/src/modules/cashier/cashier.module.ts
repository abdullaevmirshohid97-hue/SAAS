import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------
// Pul manbai — kassa drawer (bugungi tushum) yoki seyf (encashment qoldig'i).
// Default cash_drawer eski xulq saqlash uchun.
const CASHIER_SOURCE = z.enum(['cash_drawer', 'safe']);
export type CashierSource = z.infer<typeof CASHIER_SOURCE>;

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
  source: CASHIER_SOURCE.optional(),
  register: z.enum(['reception', 'inpatient']).optional(),
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
  source: CASHIER_SOURCE.optional(),
});

// Bemor depozitidan naqd pul chiqarish (depozit qoldig'ini qaytarish)
const DepositWithdrawSchema = z.object({
  patient_id: z.string().uuid(),
  amount_uzs: z.number().int().positive(),
  payment_method: PAYMENT_METHOD,
  reason: z.string().max(500).optional(),
  source: CASHIER_SOURCE.optional(),
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
  async kpis(clinicId: string, register: string = 'reception') {
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
          .from('transaction_payment_legs')
          .select('amount_uzs, kind, method, is_void')
          .eq('clinic_id', clinicId)
          .eq('register', register)
          .eq('is_void', false)
          .eq('shift_id', activeShiftId)
      : null;

    // Bugungi va kechagi tushum kun bo'yicha (smena ahamiyatsiz) — dashboard
    // 'Bugungi tushum' karti shu raqamlarni ko'rsatadi. Smenadagi tushum
    // alohida `today` da (cashier.tsx sahifasi uchun).
    const [todayRows, yesterdayRows, monthRows, monthExpenses, openShifts, todayTotalRows, yesterdayTotalRows, monthPayoutRows] = await Promise.all([
      todayQuery ?? Promise.resolve({ data: [] as Array<{ amount_uzs: number; kind: string; payment_method: string }> }),
      // Kechagi kun (legacy `yesterday` — smena ahamiyatsiz, mavjud cashier.tsx bilan
      // backward-compat). Yangi `yesterday_total` ham xuddi shu — ikkalasi bir xil
      // ma'lumotni qaytaradi.
      admin
        .from('transactions')
        .select('amount_uzs, kind, is_void')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .gte('created_at', yesterdayStart.toISOString())
        .lt('created_at', todayStart.toISOString()),
      admin
        .from('transactions')
        .select('amount_uzs, kind, is_void')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .gte('created_at', monthStart.toISOString()),
      admin
        .from('expenses')
        .select('amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .gte('expense_date', monthStart.toISOString().slice(0, 10)),
      admin
        .from('shifts')
        .select('id')
        .eq('clinic_id', clinicId)
        .is('closed_at', null),
      // today_total — kun bo'yicha jami (smena ahamiyatsiz), legs view (mixed split).
      admin
        .from('transaction_payment_legs')
        .select('amount_uzs, kind, method, is_void')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .gte('created_at', todayStart.toISOString()),
      // yesterday_total — kechagi kun jami
      admin
        .from('transactions')
        .select('amount_uzs, kind, is_void')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .gte('created_at', yesterdayStart.toISOString())
        .lt('created_at', todayStart.toISOString()),
      // Oylik maosh to'lovi (paid payouts) — sof foydadan ayriladi. Maosh
      // klinika darajasida (reception kassasidan), shuning uchun faqat reception
      // registri uchun. (Kassa/seyf cashOnHand/safeBalance allaqachon ayiradi;
      // bu yerda FOYDA hisobiga qo'shyapmiz — avval payout foydaga kirmasdi.)
      register === 'reception'
        ? admin
            .from('doctor_payouts')
            .select('net_uzs')
            .eq('clinic_id', clinicId)
            .eq('status', 'paid')
            .gte('paid_at', monthStart.toISOString())
        : Promise.resolve({ data: [] as Array<{ net_uzs: number }> }),
    ]);

    const sum = (rows: unknown[] | null | undefined) => {
      let total = 0;
      const byMethod: Record<string, number> = {};
      for (const r of rows ?? []) {
        const row = r as { amount_uzs: number; kind: string; payment_method?: string; method?: string };
        // DAROMAD = faqat to'lov (payment) − vozvrat (refund). Inkasatsiya/tuzatish
        // (kind='adjustment') ICHKI naqd ko'chirish — daromad EMAS, hisobga olinmaydi.
        // (Seyfga pul olinsa "tushum"/"foyda" kamayib ketmasligi uchun.)
        if (row.kind === 'adjustment') continue;
        const sign = row.kind === 'refund' ? -1 : 1;
        const v = sign * Number(row.amount_uzs ?? 0);
        total += v;
        // View'da 'method', transactions'da 'payment_method' (mixed → legs).
        const pm = row.payment_method ?? row.method;
        if (pm) byMethod[pm] = (byMethod[pm] ?? 0) + v;
      }
      return { total, byMethod };
    };

    const today = sum(todayRows.data);
    const yesterday = sum(yesterdayRows.data);
    const month = sum(monthRows.data);
    const todayTotal = sum(todayTotalRows.data);
    const yesterdayTotal = sum(yesterdayTotalRows.data);
    const monthExpTotal = (monthExpenses.data ?? []).reduce(
      (a: number, r: { amount_uzs: number }) => a + Number(r.amount_uzs ?? 0),
      0,
    );
    const monthPayroll = (monthPayoutRows.data ?? []).reduce(
      (a: number, r: { net_uzs: number }) => a + Number(r.net_uzs ?? 0),
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
      // Smena bo'yicha (legacy — cashier.tsx ishlatadi)
      today: today.total,
      yesterday: yesterday.total,
      // Kun bo'yicha jami (dashboard.tsx 'Bugungi tushum' ishlatadi)
      today_total: todayTotal.total,
      yesterday_total: yesterdayTotal.total,
      month_revenue: month.total,
      month_expenses: monthExpTotal,
      month_payroll: monthPayroll,
      month_profit: month.total - monthExpTotal - monthPayroll,
      by_payment_method_today: today.byMethod,
      by_payment_method_today_total: todayTotal.byMethod,
      open_shifts: (openShifts.data ?? []).length,
      pharmacy_debt,
      inpatient_debt,
    };
  }

  // Cash flow report — har payment_method bo'yicha kirim/chiqim balansi.
  // Kirim: payment kind tx
  // Chiqim: refund kind tx + adjustment (manfiy) + expenses cash
  async cashFlow(clinicId: string, from: string, to: string, register: string = 'reception') {
    const admin = this.supabase.admin();
    const [txRes, expRes] = await Promise.all([
      // Aralash to'lovlarni usul bo'yicha to'g'ri ko'rsatish uchun legs view'idan.
      admin
        .from('transaction_payment_legs')
        .select('method, kind, amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .gte('created_at', from)
        .lte('created_at', to),
      admin
        .from('expenses')
        .select('payment_method, amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .gte('expense_date', from.slice(0, 10))
        .lte('expense_date', to.slice(0, 10)),
    ]);

    const methods: Record<
      string,
      { method: string; in_uzs: number; out_uzs: number; net_uzs: number }
    > = {};
    const m = (key: string) => {
      if (!methods[key]) {
        methods[key] = { method: key, in_uzs: 0, out_uzs: 0, net_uzs: 0 };
      }
      return methods[key]!;
    };

    for (const r of (txRes.data ?? []) as Array<{
      method: string;
      kind: string;
      amount_uzs: number;
    }>) {
      const amount = Number(r.amount_uzs ?? 0);
      const row = m(r.method);
      if (r.kind === 'refund' || amount < 0) {
        row.out_uzs += Math.abs(amount);
      } else {
        row.in_uzs += amount;
      }
    }
    for (const r of (expRes.data ?? []) as Array<{
      payment_method: string | null;
      amount_uzs: number;
    }>) {
      const row = m(r.payment_method ?? 'cash');
      row.out_uzs += Number(r.amount_uzs ?? 0);
    }
    for (const row of Object.values(methods)) {
      row.net_uzs = row.in_uzs - row.out_uzs;
    }
    return Object.values(methods).sort((a, b) => b.in_uzs - a.in_uzs);
  }

  // Seyf yozuvlari to'liq ro'yxat — kirim (encashment + manual deposit) va
  // chiqim (source='safe' bo'lgan tx/expense). Har yozuv: sana, summa,
  // sabab, kim qildi, edit/delete uchun ref_id.
  async safeEntries(clinicId: string, params: { limit?: number; register?: string } = {}) {
    const admin = this.supabase.admin();
    const limit = params.limit ?? 200;
    const register = params.register ?? 'reception';

    const [encashRes, txOutRes, expOutRes, manualDepRes, payoutOutRes] = await Promise.all([
      // 1) Encashment kirim — kassadan seyfga (notes LIKE 'Inkasatsiya%')
      admin
        .from('transactions')
        .select(
          'id, amount_uzs, notes, created_at, kind, payment_method, ' +
            'cashier:profiles!transactions_cashier_id_fkey(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .eq('kind', 'adjustment')
        .eq('payment_method', 'cash')
        .lt('amount_uzs', 0)
        .order('created_at', { ascending: false })
        .limit(limit),
      // 2) Seyfdan chiqim — source='safe' transactions
      admin
        .from('transactions')
        .select(
          'id, amount_uzs, kind, notes, created_at, payment_method, ' +
            'patient:patients(id, full_name), ' +
            'cashier:profiles!transactions_cashier_id_fkey(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .eq('source', 'safe')
        .order('created_at', { ascending: false })
        .limit(limit),
      // 3) Seyfdan chiqim — source='safe' expenses
      admin
        .from('expenses')
        .select(
          'id, amount_uzs, description, created_at, expense_date, payment_method, ' +
            'category:expense_categories(id, name_i18n), ' +
            'recorder:profiles!expenses_recorded_by_fkey(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .eq('source', 'safe')
        .order('created_at', { ascending: false })
        .limit(limit),
      // 4) Manual deposit — safe_deposits jadvali (yangi)
      admin
        .from('safe_deposits')
        .select(
          'id, amount_uzs, reason, created_at, ' +
            'recorder:profiles!safe_deposits_recorded_by_fkey(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .order('created_at', { ascending: false })
        .limit(limit),
      // 5) Payroll payouts seyfdan — faqat reception registriga.
      register === 'reception'
        ? admin
            .from('doctor_payouts')
            .select(
              'id, net_uzs, paid_at, method, doctor:profiles!doctor_payouts_doctor_id_fkey(full_name), payer:profiles!doctor_payouts_paid_by_fkey(full_name)',
            )
            .eq('clinic_id', clinicId)
            .eq('source', 'safe')
            .eq('status', 'paid')
            .order('paid_at', { ascending: false })
            .limit(limit)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    type Entry = {
      id: string;
      ref_type:
        | 'encashment'
        | 'manual_deposit'
        | 'safe_refund'
        | 'safe_expense'
        | 'safe_adjustment'
        | 'safe_payroll';
      ref_id: string;
      direction: 'in' | 'out';
      amount_uzs: number;
      reason: string;
      created_at: string;
      author: string | null;
      editable: boolean;
    };

    const entries: Entry[] = [];

    // Encashment kirim (notes LIKE 'Inkasatsiya')
    for (const r of (encashRes.data ?? []) as unknown as Array<{
      id: string;
      amount_uzs: number;
      notes: string | null;
      created_at: string;
      cashier: { full_name: string } | null;
    }>) {
      if ((r.notes ?? '').toLowerCase().includes('inkasatsiya')) {
        entries.push({
          id: `enc-${r.id}`,
          ref_type: 'encashment',
          ref_id: r.id,
          direction: 'in',
          amount_uzs: Math.abs(Number(r.amount_uzs ?? 0)),
          reason: r.notes ?? 'Inkasatsiya',
          created_at: r.created_at,
          author: r.cashier?.full_name ?? null,
          editable: true,
        });
      }
    }

    // Seyfdan chiqim — refund/adjustment
    for (const r of (txOutRes.data ?? []) as unknown as Array<{
      id: string;
      amount_uzs: number;
      kind: string;
      notes: string | null;
      created_at: string;
      payment_method: string;
      patient: { id: string; full_name: string } | null;
      cashier: { full_name: string } | null;
    }>) {
      const amt = Number(r.amount_uzs ?? 0);
      const refType = r.kind === 'refund' ? 'safe_refund' : 'safe_adjustment';
      entries.push({
        id: `tx-${r.id}`,
        ref_type: refType,
        ref_id: r.id,
        direction: 'out',
        amount_uzs: Math.abs(amt),
        reason:
          r.notes ?? (r.patient?.full_name ? `Vozvrat: ${r.patient.full_name}` : 'Chiqim'),
        created_at: r.created_at,
        author: r.cashier?.full_name ?? null,
        editable: true,
      });
    }

    // Seyfdan chiqim — expenses
    for (const r of (expOutRes.data ?? []) as unknown as Array<{
      id: string;
      amount_uzs: number;
      description: string | null;
      created_at: string;
      category: { name_i18n: Record<string, string> } | null;
      recorder: { full_name: string } | null;
    }>) {
      const catName =
        r.category?.name_i18n?.['uz-Latn'] ?? r.category?.name_i18n?.['en'] ?? 'Rasxot';
      entries.push({
        id: `exp-${r.id}`,
        ref_type: 'safe_expense',
        ref_id: r.id,
        direction: 'out',
        amount_uzs: Number(r.amount_uzs ?? 0),
        reason: r.description ? `${catName}: ${r.description}` : catName,
        created_at: r.created_at,
        author: r.recorder?.full_name ?? null,
        editable: true,
      });
    }

    // Manual deposit kirim
    for (const r of (manualDepRes.data ?? []) as unknown as Array<{
      id: string;
      amount_uzs: number;
      reason: string | null;
      created_at: string;
      recorder: { full_name: string } | null;
    }>) {
      entries.push({
        id: `dep-${r.id}`,
        ref_type: 'manual_deposit',
        ref_id: r.id,
        direction: 'in',
        amount_uzs: Number(r.amount_uzs ?? 0),
        reason: r.reason ?? 'Seyfga pul qo\'shish',
        created_at: r.created_at,
        author: r.recorder?.full_name ?? null,
        editable: true,
      });
    }

    // Payroll seyfdan to'langan
    for (const r of (payoutOutRes.data ?? []) as unknown as Array<{
      id: string;
      net_uzs: number;
      paid_at: string;
      method: string | null;
      doctor: { full_name: string } | null;
      payer: { full_name: string } | null;
    }>) {
      entries.push({
        id: `pay-${r.id}`,
        ref_type: 'safe_payroll',
        ref_id: r.id,
        direction: 'out',
        amount_uzs: Number(r.net_uzs ?? 0),
        reason: `Maosh: ${r.doctor?.full_name ?? '—'}`,
        created_at: r.paid_at,
        author: r.payer?.full_name ?? null,
        editable: false,
      });
    }

    // Vaqt bo'yicha sortlash (yangi birinchi)
    entries.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return entries.slice(0, limit);
  }

  // Seyfga qo'lda pul qo'shish (encashment'dan tashqari).
  // Masalan, klinika egasi eski naqd pulni seyfga qo'yadi.
  async addSafeDeposit(
    clinicId: string,
    userId: string,
    body: { amount_uzs: number; reason: string; register?: string },
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('safe_deposits')
      .insert({
        clinic_id: clinicId,
        amount_uzs: body.amount_uzs,
        reason: body.reason,
        register: body.register ?? 'reception',
        recorded_by: userId,
      })
      .select('id, amount_uzs, reason, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Manual deposit edit (sabab/summa o'zgartirish)
  async updateSafeDeposit(
    clinicId: string,
    id: string,
    body: { amount_uzs?: number; reason?: string },
  ) {
    const patch: Record<string, unknown> = {};
    if (body.amount_uzs != null) patch.amount_uzs = body.amount_uzs;
    if (body.reason != null) patch.reason = body.reason;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Hech narsa o\'zgartirilmadi');
    }
    const { error } = await this.supabase
      .admin()
      .from('safe_deposits')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Manual deposit delete (soft — is_void=true)
  async deleteSafeDeposit(clinicId: string, userId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('safe_deposits')
      .update({
        is_void: true,
        voided_at: new Date().toISOString(),
        voided_by: userId,
      })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Seyf balansi — encashment yig'indisi minus seyfdan chiqarilgan
  // (refund/expense source='safe').
  // Encashment = tx kind='adjustment' + amount<0 + payment_method='cash' +
  //              notes LIKE 'Inkasatsiya%' (yoki source='cash_drawer' + kind='adjustment')
  // Aslida har encashment kassadan seyfga pul ko'chiradi.
  async safeBalance(clinicId: string, register: string = 'reception') {
    const admin = this.supabase.admin();
    const [encashRes, manualDepRes, txOutRes, expOutRes, payoutOutRes] = await Promise.all([
      admin
        .from('transactions')
        .select('amount_uzs, notes')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .eq('kind', 'adjustment')
        .eq('payment_method', 'cash')
        .lt('amount_uzs', 0),
      admin
        .from('safe_deposits')
        .select('amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false),
      admin
        .from('transactions')
        .select('amount_uzs, kind')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .eq('source', 'safe'),
      admin
        .from('expenses')
        .select('amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .eq('source', 'safe'),
      // Payroll payouts seyfdan to'langan — faqat reception registriga.
      register === 'reception'
        ? admin
            .from('doctor_payouts')
            .select('net_uzs')
            .eq('clinic_id', clinicId)
            .eq('source', 'safe')
            .eq('status', 'paid')
        : Promise.resolve({ data: [] as Array<{ net_uzs: number }> }),
    ]);

    let encashed = 0;
    for (const r of (encashRes.data ?? []) as Array<{ amount_uzs: number; notes: string | null }>) {
      if ((r.notes ?? '').toLowerCase().includes('inkasatsiya')) {
        encashed += Math.abs(Number(r.amount_uzs ?? 0));
      }
    }
    let manualDeposited = 0;
    for (const r of (manualDepRes.data ?? []) as Array<{ amount_uzs: number }>) {
      manualDeposited += Number(r.amount_uzs ?? 0);
    }
    let outFromSafe = 0;
    for (const r of (txOutRes.data ?? []) as Array<{ amount_uzs: number; kind: string }>) {
      outFromSafe += Math.abs(Number(r.amount_uzs ?? 0));
    }
    for (const r of (expOutRes.data ?? []) as Array<{ amount_uzs: number }>) {
      outFromSafe += Number(r.amount_uzs ?? 0);
    }
    for (const r of (payoutOutRes.data ?? []) as Array<{ net_uzs: number }>) {
      outFromSafe += Number(r.net_uzs ?? 0);
    }

    const totalIn = encashed + manualDeposited;
    return {
      encashed_total_uzs: encashed,
      manual_deposited_uzs: manualDeposited,
      total_in_uzs: totalIn,
      withdrawn_from_safe_uzs: outFromSafe,
      safe_balance_uzs: totalIn - outFromSafe,
    };
  }

  // Seyfga o'tmagan naqd (drawer cash on hand) — kassada yig'ilgan, lekin hali
  // inkasatsiya qilinmagan (seyfga o'tmagan) naqd pul.
  // = naqd kirim − naqd chiqim(drawer: refund/expense/maosh) − inkasatsiya(seyfga).
  // Eslatma: boshlang'ich float (smena opening_cash) bu hisobga KIRMAYDI —
  // faqat operatsiyalardan yig'ilgan naqd. drawer + safe = jami operatsion naqd.
  async cashOnHand(clinicId: string, register: string = 'reception') {
    const admin = this.supabase.admin();
    const [txRes, expRes, payoutRes] = await Promise.all([
      // Naqd oyoqlar (mixed payment'ning naqd qismi ham) — view'dan, register bo'yicha.
      admin
        .from('transaction_payment_legs')
        .select('amount_uzs, kind, tx_source, notes')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .eq('method', 'cash'),
      admin
        .from('expenses')
        .select('amount_uzs, source, payment_method')
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false),
      // Maosh klinika darajasida (reception kassasidan) — faqat reception registriga.
      register === 'reception'
        ? admin
            .from('doctor_payouts')
            .select('net_uzs, source, method')
            .eq('clinic_id', clinicId)
            .eq('status', 'paid')
        : Promise.resolve({ data: [] as Array<{ net_uzs: number; source: string | null; method: string | null }> }),
    ]);

    let cashIn = 0; // payment cash (kirim)
    let refundsOut = 0; // drawer cash refunds
    let encashed = 0; // inkasatsiya (seyfga o'tdi)
    let adjOther = 0; // boshqa naqd tuzatishlar (signed)
    for (const r of (txRes.data ?? []) as Array<{
      amount_uzs: number;
      kind: string;
      tx_source: string | null;
      notes: string | null;
    }>) {
      if (r.tx_source === 'safe') continue; // seyf harakatlari drawer'ga ta'sir qilmaydi
      const amt = Number(r.amount_uzs ?? 0);
      if (r.kind === 'payment') cashIn += amt;
      else if (r.kind === 'refund') refundsOut += Math.abs(amt);
      else if (r.kind === 'adjustment') {
        if ((r.notes ?? '').toLowerCase().includes('inkasatsiya')) encashed += Math.abs(amt);
        else adjOther += amt; // cash_correction (+/-)
      }
    }

    let cashExpenses = 0;
    for (const e of (expRes.data ?? []) as Array<{
      amount_uzs: number;
      source: string | null;
      payment_method: string | null;
    }>) {
      if (e.source === 'safe') continue;
      if ((e.payment_method ?? 'cash') !== 'cash') continue;
      cashExpenses += Number(e.amount_uzs ?? 0);
    }

    let cashPayroll = 0;
    for (const p of (payoutRes.data ?? []) as Array<{
      net_uzs: number;
      source: string | null;
      method: string | null;
    }>) {
      if (p.source === 'safe') continue;
      if ((p.method ?? 'cash') !== 'cash') continue;
      cashPayroll += Number(p.net_uzs ?? 0);
    }

    const cashOnHand =
      cashIn - refundsOut - encashed + adjOther - cashExpenses - cashPayroll;
    return {
      cash_on_hand_uzs: cashOnHand,
      cash_in_uzs: cashIn,
      encashed_to_safe_uzs: encashed,
      cash_out_uzs: refundsOut + cashExpenses + cashPayroll,
      adjustments_uzs: adjOther,
    };
  }

  // Seyfga o'tmagan naqd YOZUVLARI ro'yxati (drawer harakatlari) — "Seyfga o'tmagan
  // naqd" kartasi bosilganda ko'rsatiladi. Naqd to'lovlar (kirim), vozvrat/rasxot
  // (chiqim) va inkasatsiya (seyfga o'tdi). Mixed to'lovning naqd qismi ham.
  async cashOnHandEntries(clinicId: string, register: string = 'reception') {
    const admin = this.supabase.admin();
    const [txRes, expRes, legRes] = await Promise.all([
      admin
        .from('transactions')
        .select(
          'id, amount_uzs, kind, payment_method, source, notes, created_at, ' +
            'patient:patients(full_name), cashier:profiles!transactions_cashier_id_fkey(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .in('payment_method', ['cash', 'mixed'])
        .order('created_at', { ascending: false })
        .limit(300),
      admin
        .from('expenses')
        .select(
          'id, amount_uzs, source, payment_method, description, created_at, ' +
            'category:expense_categories(name_i18n), recorder:profiles!expenses_recorded_by_fkey(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('register', register)
        .eq('is_void', false)
        .order('created_at', { ascending: false })
        .limit(200),
      admin
        .from('transaction_payments')
        .select('transaction_id, amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('method', 'cash'),
    ]);

    // Mixed to'lovlarning naqd oyog'i summasi (tx_id -> cash amount).
    const cashLeg = new Map<string, number>();
    for (const l of (legRes.data ?? []) as Array<{ transaction_id: string; amount_uzs: number }>) {
      cashLeg.set(l.transaction_id, (cashLeg.get(l.transaction_id) ?? 0) + Number(l.amount_uzs ?? 0));
    }

    type Entry = {
      id: string;
      ref_type: 'cash_payment' | 'cash_refund' | 'encashment' | 'cash_adjustment' | 'cash_expense';
      direction: 'in' | 'out';
      amount_uzs: number;
      reason: string;
      created_at: string;
      author: string | null;
    };
    const entries: Entry[] = [];

    for (const r of (txRes.data ?? []) as unknown as Array<{
      id: string;
      amount_uzs: number;
      kind: string;
      payment_method: string;
      source: string | null;
      notes: string | null;
      created_at: string;
      patient: { full_name: string } | null;
      cashier: { full_name: string } | null;
    }>) {
      if (r.source === 'safe') continue; // seyf harakatlari drawer emas
      const cashAmt =
        r.payment_method === 'mixed' ? (cashLeg.get(r.id) ?? 0) : Number(r.amount_uzs ?? 0);
      if (!cashAmt) continue;
      const author = r.cashier?.full_name ?? null;
      if (r.kind === 'payment') {
        // amount manfiy bo'lsa (masalan statsionar refund kind=payment) — chiqim.
        const isOut = cashAmt < 0;
        entries.push({
          id: `tx-${r.id}`,
          ref_type: isOut ? 'cash_refund' : 'cash_payment',
          direction: isOut ? 'out' : 'in',
          amount_uzs: Math.abs(cashAmt),
          reason: r.notes ?? (r.patient?.full_name ? `Naqd: ${r.patient.full_name}` : 'Naqd to\'lov'),
          created_at: r.created_at,
          author,
        });
      } else if (r.kind === 'refund') {
        entries.push({
          id: `tx-${r.id}`,
          ref_type: 'cash_refund',
          direction: 'out',
          amount_uzs: Math.abs(cashAmt),
          reason: r.notes ?? 'Vozvrat',
          created_at: r.created_at,
          author,
        });
      } else if (r.kind === 'adjustment') {
        const isEncash = (r.notes ?? '').toLowerCase().includes('inkasatsiya');
        entries.push({
          id: `tx-${r.id}`,
          ref_type: isEncash ? 'encashment' : 'cash_adjustment',
          direction: cashAmt < 0 ? 'out' : 'in',
          amount_uzs: Math.abs(cashAmt),
          reason: r.notes ?? 'Tuzatish',
          created_at: r.created_at,
          author,
        });
      }
    }

    for (const e of (expRes.data ?? []) as unknown as Array<{
      id: string;
      amount_uzs: number;
      source: string | null;
      payment_method: string | null;
      description: string | null;
      created_at: string;
      category: { name_i18n: Record<string, string> } | null;
      recorder: { full_name: string } | null;
    }>) {
      if (e.source === 'safe') continue;
      if ((e.payment_method ?? 'cash') !== 'cash') continue;
      const catName = e.category?.name_i18n?.['uz-Latn'] ?? e.category?.name_i18n?.['en'] ?? 'Rasxot';
      entries.push({
        id: `exp-${e.id}`,
        ref_type: 'cash_expense',
        direction: 'out',
        amount_uzs: Number(e.amount_uzs ?? 0),
        reason: e.description ? `${catName}: ${e.description}` : catName,
        created_at: e.created_at,
        author: e.recorder?.full_name ?? null,
      });
    }

    entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return entries;
  }

  // Manual adjustment — admin tomonidan kassa/balansga to'g'rilash kiritish.
  // 2 tip:
  //   cash_correction — kassa farqi (xato pul ko'p/kam kiritilgan)
  //   patient_balance_correction — bemor balansiga to'g'rilash
  // Audit log to'liq saqlanadi (kim, qachon, qancha, sabab).
  async adjustment(
    clinicId: string,
    userId: string,
    body: {
      type: 'cash_correction' | 'patient_balance_correction';
      amount_uzs: number;
      payment_method: string;
      reason: string;
      patient_id?: string;
    },
  ) {
    const admin = this.supabase.admin();
    if (body.type === 'patient_balance_correction' && !body.patient_id) {
      throw new BadRequestException('patient_id majburiy (patient_balance_correction)');
    }

    // Faol smena (agar bo'lsa)
    const { data: shift } = await admin
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const shiftId = (shift as { id?: string } | null)?.id ?? null;

    const typeLabel =
      body.type === 'cash_correction' ? 'Kassa tuzatish' : 'Bemor balansi tuzatish';
    const notes = `${typeLabel}: ${body.reason}`;

    // 1) transactions(kind='adjustment')
    const { data: trx, error: trxErr } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        cashier_id: userId,
        shift_id: shiftId,
        patient_id: body.patient_id ?? null,
        kind: 'adjustment',
        amount_uzs: body.amount_uzs,
        payment_method: body.payment_method,
        notes,
      })
      .select('id')
      .single();
    if (trxErr) throw new BadRequestException(trxErr.message);

    // 2) Bemor balansiga to'g'rilash bo'lsa, patient_ledger entry ham yoziladi
    if (body.type === 'patient_balance_correction' && body.patient_id) {
      await admin.from('patient_ledger').insert({
        clinic_id: clinicId,
        patient_id: body.patient_id,
        transaction_id: (trx as { id: string }).id,
        entry_kind: 'adjustment',
        amount_uzs: body.amount_uzs,
        description: body.reason,
        recorded_by: userId,
      });
    }

    return {
      ok: true,
      transaction_id: (trx as { id: string }).id,
      amount_uzs: body.amount_uzs,
      type: body.type,
    };
  }

  // Inkasatsiya — kassadan seyf/bank'ga naqd pul olib qo'yish.
  // transactions(kind='adjustment', amount=-N, payment_method='cash')
  async encash(
    clinicId: string,
    userId: string,
    body: { amount_uzs: number; destination: string; notes?: string; register?: string },
  ) {
    const admin = this.supabase.admin();
    // Faol smenani topamiz (encashment har doim smena ichida)
    const { data: shift } = await admin
      .from('shifts')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const shiftId = (shift as { id?: string } | null)?.id ?? null;

    const note = `Inkasatsiya: ${body.destination}${body.notes ? ` — ${body.notes}` : ''}`;
    const { data, error } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        cashier_id: userId,
        shift_id: shiftId,
        register: body.register ?? 'reception',
        kind: 'adjustment',
        amount_uzs: -Math.abs(body.amount_uzs),
        payment_method: 'cash',
        notes: note,
      })
      .select('id, amount_uzs')
      .single();
    if (error) throw new BadRequestException(error.message);
    return {
      ok: true,
      transaction_id: (data as { id: string }).id,
      amount_uzs: Math.abs(body.amount_uzs),
      destination: body.destination,
    };
  }

  // TOP qarzdor bemorlar — patient_ledger jadvalidan balansi manfiy
  // bo'lganlarni grupplab top N ni qaytaradi.
  async topDebtors(clinicId: string, limit = 5) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('patient_ledger')
      .select('patient_id, amount_uzs, patient:patients(id, full_name, phone)')
      .eq('clinic_id', clinicId);
    if (!data) return [];

    // Per-patient summa
    const balances = new Map<
      string,
      { patient_id: string; full_name: string | null; phone: string | null; balance: number }
    >();
    for (const r of data as unknown as Array<{
      patient_id: string;
      amount_uzs: number;
      patient: { id: string; full_name: string | null; phone: string | null } | null;
    }>) {
      const cur = balances.get(r.patient_id) ?? {
        patient_id: r.patient_id,
        full_name: r.patient?.full_name ?? null,
        phone: r.patient?.phone ?? null,
        balance: 0,
      };
      cur.balance += Number(r.amount_uzs ?? 0);
      balances.set(r.patient_id, cur);
    }

    return Array.from(balances.values())
      .filter((b) => b.balance < 0)
      .sort((a, b) => a.balance - b.balance) // eng manfiy birinchi
      .slice(0, limit)
      .map((b) => ({
        patient_id: b.patient_id,
        full_name: b.full_name,
        phone: b.phone,
        debt_uzs: Math.abs(b.balance),
      }));
  }

  // Transactions list with filter + pagination
  async transactions(
    clinicId: string,
    params: {
      from?: string;
      to?: string;
      method?: string;
      kind?: string;
      limit?: number;
      include_void?: boolean;
      amount?: number;
      search?: string;
      register?: string;
    } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('transactions')
      .select(
        '*, patient:patients(id, full_name, phone), items:transaction_items(id, service_name_snapshot, quantity, final_amount_uzs)',
      )
      .eq('clinic_id', clinicId)
      .eq('register', params.register ?? 'reception')
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 200);
    if (!params.include_void) q = q.eq('is_void', false);
    if (params.from) q = q.gte('created_at', params.from);
    if (params.to) q = q.lte('created_at', params.to);
    if (params.method && params.method !== 'undefined') q = q.eq('payment_method', params.method);
    if (params.kind) q = q.eq('kind', params.kind);
    if (params.amount && Number.isFinite(params.amount)) q = q.eq('amount_uzs', params.amount);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    // Bemor ismi/telefon orqali frontend-side filter (Supabase join orqali
    // textga qidiruv sekin va xato — kichik client-side filter yaxshiroq).
    let rows = data ?? [];
    if (params.search && params.search.trim()) {
      const term = params.search.trim().toLowerCase();
      rows = rows.filter((r) => {
        const p = (r as { patient: { full_name?: string; phone?: string } | null }).patient;
        return (
          (p?.full_name?.toLowerCase() ?? '').includes(term) ||
          (p?.phone ?? '').includes(term) ||
          (r as { id: string }).id.toLowerCase().startsWith(term)
        );
      });
    }
    return rows;
  }

  // Expenses list
  async expenses(
    clinicId: string,
    params: { from?: string; to?: string; category?: string; limit?: number; register?: string } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('expenses')
      .select('*, category:expense_categories(id, name_i18n, icon, color)')
      .eq('clinic_id', clinicId)
      .eq('register', params.register ?? 'reception')
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
    // Rasxot — faol smena MAJBURIY (smena yo'q bo'lsa BadRequestException).
    const shiftId = await this.supabase.requireActiveShift(clinicId);
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
        source: input.source ?? 'cash_drawer',
        register: input.register ?? 'reception',
        shift_id: shiftId,
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
    // Vozvrat — faol smena MAJBURIY (smena yo'q bo'lsa BadRequestException).
    const shiftId = await this.supabase.requireActiveShift(clinicId);

    // Manba (default cash_drawer = bugungi tushum). 'safe' bo'lsa, encashment
    // qoldig'idan yechiladi va kassa balansiga ta'sir qilmaydi.
    const source = input.source ?? 'cash_drawer';

    // 1) transactions ga refund yozish (amount NEGATIVE — bu kassadan chiqim)
    const { data: trx, error } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        cashier_id: userId,
        shift_id: shiftId,
        kind: 'refund',
        amount_uzs: -Math.abs(input.amount_uzs),
        payment_method: input.payment_method,
        source,
        notes: `Vozvrat (${source === 'safe' ? 'seyfdan' : 'kassadan'}): ${input.reason}${input.refund_of_transaction_id ? ` (tx: ${input.refund_of_transaction_id})` : ''}`,
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

    // 2) Aktiv smena — MAJBURIY
    const shiftId = await this.supabase.requireActiveShift(clinicId);

    const source = input.source ?? 'cash_drawer';

    // 3) Transactions refund (kassadan chiqim)
    const { data: trx, error: trxErr } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        cashier_id: userId,
        shift_id: shiftId,
        kind: 'refund',
        amount_uzs: -Math.abs(input.amount_uzs),
        payment_method: input.payment_method,
        source,
        notes: `Depozit qaytarish (${source === 'safe' ? 'seyfdan' : 'kassadan'})${input.reason ? `: ${input.reason}` : ''}`,
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
  kpis(@CurrentUser() u: { clinicId: string | null }, @Query('register') register?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.kpis(u.clinicId, register ?? 'reception');
  }

  @Get('top-debtors')
  topDebtors(
    @CurrentUser() u: { clinicId: string | null },
    @Query('limit') limit?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const lim = Math.min(50, Math.max(1, Number(limit ?? 5) || 5));
    return this.svc.topDebtors(u.clinicId, lim);
  }

  @Get('safe-balance')
  safeBalance(@CurrentUser() u: { clinicId: string | null }, @Query('register') register?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.safeBalance(u.clinicId, register ?? 'reception');
  }

  @Get('cash-on-hand')
  cashOnHand(@CurrentUser() u: { clinicId: string | null }, @Query('register') register?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cashOnHand(u.clinicId, register ?? 'reception');
  }

  @Get('cash-on-hand-entries')
  cashOnHandEntries(
    @CurrentUser() u: { clinicId: string | null },
    @Query('register') register?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cashOnHandEntries(u.clinicId, register ?? 'reception');
  }

  @Get('safe-entries')
  safeEntries(
    @CurrentUser() u: { clinicId: string | null },
    @Query('limit') limit?: string,
    @Query('register') register?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const lim = Math.min(500, Math.max(1, Number(limit ?? 200) || 200));
    return this.svc.safeEntries(u.clinicId, { limit: lim, register: register ?? 'reception' });
  }

  @Post('safe-deposit')
  @Audit({ action: 'safe.deposit_added', resourceType: 'safe_deposits' })
  addSafeDeposit(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const schema = z.object({
      amount_uzs: z.number().int().positive(),
      reason: z.string().min(3).max(500),
      register: z.enum(['reception', 'inpatient']).optional(),
    });
    return this.svc.addSafeDeposit(u.clinicId, u.userId, schema.parse(body));
  }

  @Patch('safe-deposit/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'safe.deposit_updated', resourceType: 'safe_deposits' })
  updateSafeDeposit(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const schema = z.object({
      amount_uzs: z.number().int().positive().optional(),
      reason: z.string().min(3).max(500).optional(),
    });
    return this.svc.updateSafeDeposit(u.clinicId, id, schema.parse(body));
  }

  @Delete('safe-deposit/:id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'safe.deposit_deleted', resourceType: 'safe_deposits' })
  deleteSafeDeposit(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.deleteSafeDeposit(u.clinicId, u.userId, id);
  }

  @Get('cash-flow')
  cashFlow(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('register') register?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    // Default: bugun (Asia/Tashkent)
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    return this.svc.cashFlow(
      u.clinicId,
      from ?? todayStart.toISOString(),
      to ?? todayEnd.toISOString(),
      register ?? 'reception',
    );
  }

  @Post('encash')
  @Audit({ action: 'cash.encashment', resourceType: 'transactions' })
  encash(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const schema = z.object({
      amount_uzs: z.number().int().positive(),
      destination: z.string().min(1).max(120),
      notes: z.string().max(500).optional(),
      register: z.enum(['reception', 'inpatient']).optional(),
    });
    return this.svc.encash(u.clinicId, u.userId, schema.parse(body));
  }

  @Post('adjustment')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'cash.adjustment_created', resourceType: 'transactions' })
  adjustment(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const schema = z.object({
      type: z.enum(['cash_correction', 'patient_balance_correction']),
      amount_uzs: z.number().int(),
      payment_method: z.string().min(1).max(40),
      reason: z.string().min(10).max(500),
      patient_id: z.string().uuid().optional(),
    });
    return this.svc.adjustment(u.clinicId, u.userId, schema.parse(body));
  }

  @Get('transactions')
  transactions(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method?: string,
    @Query('kind') kind?: string,
    @Query('include_void') includeVoid?: string,
    @Query('amount') amount?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('register') register?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.transactions(u.clinicId, {
      from,
      to,
      method,
      kind,
      include_void: includeVoid === 'true',
      amount: amount ? Number(amount) : undefined,
      search,
      limit: limit ? Math.min(Number(limit), 2000) : undefined,
      register: register ?? 'reception',
    });
  }

  @Get('expenses')
  expenses(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
    @Query('register') register?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.expenses(u.clinicId, { from, to, category, register: register ?? 'reception' });
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
