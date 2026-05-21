import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import * as argon2 from 'argon2';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const I18n = z.record(z.string(), z.string());

const ShiftOperatorCreateSchema = z.object({
  profile_id: z.string().uuid().nullish(),
  full_name: z.string().min(2).max(120),
  phone: z.string().max(40).optional(),
  role: z.string().max(40).default('cashier'),
  color: z.string().max(16).optional(),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits'),
  sort_order: z.number().int().optional(),
});

const ShiftOperatorUpdateSchema = z.object({
  full_name: z.string().min(2).max(120).optional(),
  phone: z.string().max(40).nullish(),
  role: z.string().max(40).optional(),
  color: z.string().max(16).nullish(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  profile_id: z.string().uuid().nullish(),
});

const PinChangeSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/),
});

const ShiftScheduleSchema = z.object({
  name_i18n: I18n,
  code: z.string().max(32).optional(),
  color: z.string().max(16).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  crosses_midnight: z.boolean().optional(),
  days_of_week: z
    .array(z.number().int().min(0).max(7))
    .transform((arr) => arr.map((d) => (d === 7 ? 0 : d)))
    .default([1, 2, 3, 4, 5]),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  sort_order: z.number().int().optional(),
});

const ShiftScheduleUpdateSchema = ShiftScheduleSchema.partial();

const ShiftAssignmentSchema = z.object({
  schedule_id: z.string().uuid(),
  operator_id: z.string().uuid(),
  is_primary: z.boolean().optional(),
  effective_from: z.string().optional(),
  effective_to: z.string().optional(),
});

const OpenShiftSchema = z.object({
  operator_id: z.string().uuid(),
  schedule_id: z.string().uuid().optional(),
  pin: z.string().regex(/^\d{4,8}$/),
  opening_cash_uzs: z.number().int().nonnegative().default(0),
  opened_via: z.string().max(40).optional(),
});

const CloseShiftSchema = z.object({
  actual_cash_uzs: z.number().int().nonnegative(),
  closing_notes: z.string().max(2000).optional(),
});

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 5;

// Fields we project out of shift_operators to clients (pin_hash is NEVER returned).
const OPERATOR_SAFE_COLUMNS =
  'id, clinic_id, profile_id, full_name, phone, role, color, is_active, sort_order, is_archived, pin_failed_attempts, pin_locked_until, last_pin_set_at, created_at, updated_at, version';

@Injectable()
class ShiftsService {
  private readonly log = new Logger(ShiftsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // --------------------------------------------------------------------- operators
  async listOperators(clinicId: string, includeArchived = false) {
    let q = this.supabase
      .admin()
      .from('shift_operators')
      .select(OPERATOR_SAFE_COLUMNS)
      .eq('clinic_id', clinicId)
      .order('sort_order', { ascending: true })
      .order('full_name', { ascending: true });
    if (!includeArchived) q = q.eq('is_archived', false);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createOperator(clinicId: string, userId: string, input: z.infer<typeof ShiftOperatorCreateSchema>) {
    const pinHash = await argon2.hash(input.pin, ARGON2_OPTIONS);
    const { data, error } = await this.supabase
      .admin()
      .from('shift_operators')
      .insert({
        clinic_id: clinicId,
        profile_id: input.profile_id ?? null,
        full_name: input.full_name,
        phone: input.phone ?? null,
        role: input.role,
        color: input.color ?? null,
        pin_hash: pinHash,
        last_pin_set_at: new Date().toISOString(),
        sort_order: input.sort_order ?? 0,
        created_by: userId,
        updated_by: userId,
      })
      .select(OPERATOR_SAFE_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateOperator(clinicId: string, operatorId: string, userId: string, input: z.infer<typeof ShiftOperatorUpdateSchema>) {
    const patch: Record<string, unknown> = { updated_by: userId };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.supabase
      .admin()
      .from('shift_operators')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', operatorId)
      .select(OPERATOR_SAFE_COLUMNS)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async changePin(clinicId: string, operatorId: string, userId: string, pin: string) {
    const pinHash = await argon2.hash(pin, ARGON2_OPTIONS);
    const { data, error } = await this.supabase
      .admin()
      .from('shift_operators')
      .update({
        pin_hash: pinHash,
        last_pin_set_at: new Date().toISOString(),
        pin_failed_attempts: 0,
        pin_locked_until: null,
        updated_by: userId,
      })
      .eq('clinic_id', clinicId)
      .eq('id', operatorId)
      .select(OPERATOR_SAFE_COLUMNS)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveOperator(clinicId: string, operatorId: string, userId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('shift_operators')
      .update({
        is_archived: true,
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_by: userId,
        updated_by: userId,
      })
      .eq('clinic_id', clinicId)
      .eq('id', operatorId)
      .select(OPERATOR_SAFE_COLUMNS)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  // --------------------------------------------------------------------- schedules
  async listSchedules(clinicId: string, includeArchived = false) {
    let q = this.supabase
      .admin()
      .from('shift_schedules')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('sort_order', { ascending: true })
      .order('start_time', { ascending: true });
    if (!includeArchived) q = q.eq('is_archived', false);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createSchedule(clinicId: string, userId: string, input: z.infer<typeof ShiftScheduleSchema>) {
    const crosses = input.crosses_midnight ?? input.end_time <= input.start_time;
    const { data, error } = await this.supabase
      .admin()
      .from('shift_schedules')
      .insert({
        clinic_id: clinicId,
        ...input,
        crosses_midnight: crosses,
        created_by: userId,
        updated_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateSchedule(clinicId: string, id: string, userId: string, input: z.infer<typeof ShiftScheduleUpdateSchema>) {
    const patch: Record<string, unknown> = { updated_by: userId, ...input };
    if (input.end_time && input.start_time && input.crosses_midnight === undefined) {
      patch['crosses_midnight'] = input.end_time <= input.start_time;
    }
    const { data, error } = await this.supabase
      .admin()
      .from('shift_schedules')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveSchedule(clinicId: string, id: string, userId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('shift_schedules')
      .update({ is_archived: true, archived_at: new Date().toISOString(), archived_by: userId, updated_by: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  // --------------------------------------------------------------------- assignments
  async listAssignments(clinicId: string, scheduleId?: string) {
    let q = this.supabase
      .admin()
      .from('shift_schedule_assignments')
      .select('*')
      .eq('clinic_id', clinicId);
    if (scheduleId) q = q.eq('schedule_id', scheduleId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async addAssignment(clinicId: string, userId: string, input: z.infer<typeof ShiftAssignmentSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('shift_schedule_assignments')
      .insert({ clinic_id: clinicId, created_by: userId, ...input })
      .select()
      .single();
    if (error) throw new ConflictException(error.message);
    return data;
  }

  async removeAssignment(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('shift_schedule_assignments')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new NotFoundException(error.message);
    return { ok: true };
  }

  // --------------------------------------------------------------------- shifts (open/close/active)
  async openShift(clinicId: string, userId: string, input: z.infer<typeof OpenShiftSchema>, ip?: string) {
    const { data: op, error: opErr } = await this.supabase
      .admin()
      .from('shift_operators')
      .select('id, pin_hash, pin_failed_attempts, pin_locked_until, is_active, is_archived')
      .eq('clinic_id', clinicId)
      .eq('id', input.operator_id)
      .single();
    if (opErr || !op) throw new NotFoundException('Operator not found');
    if (!op.is_active || op.is_archived) throw new ForbiddenException('Operator inactive');
    if (op.pin_locked_until && new Date(op.pin_locked_until) > new Date()) {
      throw new ForbiddenException('Operator PIN temporarily locked');
    }

    const ok = await argon2.verify(op.pin_hash as string, input.pin).catch(() => false);
    if (!ok) {
      const attempts = (op.pin_failed_attempts as number) + 1;
      const lockUntil =
        attempts >= MAX_PIN_ATTEMPTS
          ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString()
          : null;
      await this.supabase
        .admin()
        .from('shift_operators')
        .update({
          pin_failed_attempts: attempts,
          pin_locked_until: lockUntil,
        })
        .eq('id', op.id);
      this.log.warn({ clinicId, operator: op.id, attempts, ip }, 'shift-operator pin failed');
      throw new UnauthorizedException('Invalid PIN');
    }

    // success — reset counter
    await this.supabase
      .admin()
      .from('shift_operators')
      .update({ pin_failed_attempts: 0, pin_locked_until: null })
      .eq('id', op.id);

    // Pre-check: KLINIKADA ochiq smena bormi (har qaysi operator)?
    // - Bir xil user shu OPERATOR bilan qaytadan → eski smenani avtomatik
    //   yopib yangi ochish (server restart yoki yopish unutilgan holat).
    // - Aks holda — xato matni: klinika faqat bitta yagona faol smena
    //   bo'lishi kerak. Qabulxona ochsa, admin shu smenani ko'radi.
    const { data: existingShift } = await this.supabase
      .admin()
      .from('shifts')
      .select('id, user_id, operator_id, opened_at, operator:shift_operators(full_name)')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingShift) {
      const existing = existingShift as unknown as {
        id: string;
        user_id: string;
        operator_id: string | null;
        opened_at: string;
        operator: { full_name: string } | null;
      };
      // Bir xil user + bir xil operator — qaytadan ochish (avtomatik yopib qayta)
      if (existing.user_id === userId && existing.operator_id === input.operator_id) {
        await this.closeShift(clinicId, userId, existing.id, {
          actual_cash_uzs: 0,
          closing_notes: 'Avtomatik yopildi (qaytadan ochildi)',
        });
      } else {
        // Boshqa user — aniq xato matni
        const opName = existing.operator?.full_name ?? 'Operator';
        const openedAt = new Date(existing.opened_at).toLocaleString('uz-UZ', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        throw new ConflictException(
          `${opName} allaqachon ochiq smenada (${openedAt} dan). Avval o‘sha smenani yoping.`,
        );
      }
    }

    const { data, error } = await this.supabase
      .admin()
      .from('shifts')
      .insert({
        clinic_id: clinicId,
        user_id: userId,
        operator_id: input.operator_id,
        schedule_id: input.schedule_id ?? null,
        opening_cash_uzs: input.opening_cash_uzs,
        opened_via: input.opened_via ?? 'pos',
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        // Pre-check bormi-yo'qmi, race condition bo'lsa zaxira xato
        throw new ConflictException('Bu operator allaqachon boshqa smenada ochiq.');
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  // Faol smenadagi operator PIN'ini tekshirish.
  // Kassa daromad maydonlarini ochish kabi maxfiy amallar uchun ishlatiladi.
  async verifyActiveShiftPin(clinicId: string, pin: string): Promise<{ ok: boolean }> {
    const admin = this.supabase.admin();
    const { data: shift } = await admin
      .from('shifts')
      .select('id, operator_id')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!shift) {
      throw new ForbiddenException('Faol smena yo\'q');
    }
    const operatorId = (shift as { operator_id: string | null }).operator_id;
    if (!operatorId) throw new ForbiddenException('Smena operatorisiz');
    const { data: op } = await admin
      .from('shift_operators')
      .select('pin_hash')
      .eq('clinic_id', clinicId)
      .eq('id', operatorId)
      .maybeSingle();
    if (!op) throw new ForbiddenException('Operator topilmadi');
    const ok = await argon2.verify((op as { pin_hash: string }).pin_hash, pin).catch(() => false);
    if (!ok) throw new UnauthorizedException('Noto\'g\'ri PIN');
    return { ok: true };
  }

  async closeShift(clinicId: string, userId: string, shiftId: string, input: z.infer<typeof CloseShiftSchema>) {
    const admin = this.supabase.admin();

    const totals = await this.aggregateShiftTotals(clinicId, shiftId);

    const { data, error } = await admin
      .from('shifts')
      .update({
        closed_at: new Date().toISOString(),
        actual_cash_uzs: input.actual_cash_uzs,
        cash_total_uzs: totals.cash,
        card_total_uzs: totals.card,
        electronic_total_uzs: totals.electronic,
        expected_cash_uzs: totals.cash,
        closing_notes: input.closing_notes ?? null,
        closing_manager_id: userId,
      })
      .eq('clinic_id', clinicId)
      .eq('id', shiftId)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  /**
   * Smena yopish hisoboti — smenadagi barcha amallar, to'lovlar, bemorlar,
   * ishlagan xodimlar, maosh va yakuniy moliyaviy ko'rsatkichlar.
   * Yopilmagan smena uchun ham "hozirgi holat" hisobotini beradi.
   */
  async shiftReport(clinicId: string, shiftId: string) {
    const admin = this.supabase.admin();

    // 1) Smena qatori
    const { data: shiftRow, error: shiftErr } = await admin
      .from('shifts')
      .select(
        '*, operator:shift_operators(id, full_name, role), ' +
          'schedule:shift_schedules(id, name_i18n, start_time, end_time)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', shiftId)
      .maybeSingle();
    if (shiftErr || !shiftRow) throw new NotFoundException('Smena topilmadi');
    const shift = shiftRow as unknown as {
      opened_at: string;
      closed_at: string | null;
      operator: { full_name: string } | null;
    };
    const from = shift.opened_at;
    const to = shift.closed_at ?? new Date().toISOString();

    // 2) Smena amallari — transactions (bemor + xizmat + kassir)
    const { data: txData } = await admin
      .from('transactions')
      .select(
        'id, created_at, amount_uzs, kind, payment_method, is_void, ' +
          'patient:patients(full_name), ' +
          'cashier:profiles!transactions_cashier_id_fkey(full_name), ' +
          'appointment:appointments(service_name_snapshot)',
      )
      .eq('clinic_id', clinicId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false });
    const transactions = ((txData ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      amount_uzs: number;
      kind: string;
      payment_method: string;
      is_void: boolean;
      patient: { full_name: string } | null;
      cashier: { full_name: string } | null;
      appointment: { service_name_snapshot: string | null } | null;
    }>).map((r) => ({
      id: r.id,
      occurred_at: r.created_at,
      patient_name: r.patient?.full_name ?? null,
      service_name: r.appointment?.service_name_snapshot ?? null,
      cashier_name: r.cashier?.full_name ?? null,
      payment_method: r.payment_method,
      kind: r.kind,
      amount_uzs: Number(r.amount_uzs ?? 0),
      is_void: !!r.is_void,
    }));

    // 3) Dorixona savdolari
    const { data: phData } = await admin
      .from('pharmacy_sales')
      .select('id, created_at, total_uzs, paid_uzs, is_void, patient:patients(full_name)')
      .eq('clinic_id', clinicId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false });
    const pharmacySales = ((phData ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      total_uzs: number;
      paid_uzs: number;
      is_void: boolean;
      patient: { full_name: string } | null;
    }>).map((r) => ({
      id: r.id,
      occurred_at: r.created_at,
      patient_name: r.patient?.full_name ?? 'Anonim mijoz',
      total_uzs: Number(r.total_uzs ?? 0),
      paid_uzs: Number(r.paid_uzs ?? 0),
      is_void: !!r.is_void,
    }));

    // 4) Rasxotlar
    const { data: exData } = await admin
      .from('expenses')
      .select(
        'id, created_at, amount_uzs, description, payment_method, ' +
          'category:expense_categories(name_i18n), ' +
          'recorder:profiles!expenses_recorded_by_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false });
    const expenses = ((exData ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      amount_uzs: number;
      description: string | null;
      payment_method: string | null;
      category: { name_i18n: Record<string, string> } | null;
      recorder: { full_name: string } | null;
    }>).map((r) => ({
      id: r.id,
      occurred_at: r.created_at,
      category:
        r.category?.name_i18n?.['uz-Latn'] ?? r.category?.name_i18n?.['en'] ?? 'Rasxot',
      description: r.description,
      payment_method: r.payment_method,
      recorder_name: r.recorder?.full_name ?? null,
      amount_uzs: Number(r.amount_uzs ?? 0),
    }));

    // 5) Ishlagan xodimlar — appointments (shifokor) + queues (shifokor) vaqt
    //    oralig'idan. Har biri uchun amal soni.
    const { data: apptStaff } = await admin
      .from('appointments')
      .select('doctor_id, doctor:profiles!appointments_doctor_id_fkey(full_name, role)')
      .eq('clinic_id', clinicId)
      .gte('scheduled_at', from)
      .lte('scheduled_at', to);
    const { data: queueStaff } = await admin
      .from('queues')
      .select('doctor_id, doctor:profiles!queues_doctor_id_fkey(full_name, role)')
      .eq('clinic_id', clinicId)
      .not('doctor_id', 'is', null)
      .gte('called_at', from)
      .lte('called_at', to);

    const staffMap = new Map<
      string,
      { name: string; role: string; appointments: number; queue: number }
    >();
    const addStaff = (
      rows: Array<{ doctor_id: string | null; doctor: { full_name: string; role: string } | null }> | null,
      key: 'appointments' | 'queue',
    ) => {
      for (const r of rows ?? []) {
        if (!r.doctor_id || !r.doctor) continue;
        const cur =
          staffMap.get(r.doctor_id) ??
          { name: r.doctor.full_name, role: r.doctor.role, appointments: 0, queue: 0 };
        cur[key] += 1;
        staffMap.set(r.doctor_id, cur);
      }
    };
    addStaff(
      (apptStaff ?? []) as unknown as Array<{
        doctor_id: string | null;
        doctor: { full_name: string; role: string } | null;
      }>,
      'appointments',
    );
    addStaff(
      (queueStaff ?? []) as unknown as Array<{
        doctor_id: string | null;
        doctor: { full_name: string; role: string } | null;
      }>,
      'queue',
    );
    const staff = [...staffMap.values()].sort((a, b) => a.name.localeCompare(b.name));

    // 6) Maosh — smena oralig'idagi to'lovlar + smenada to'plangan komissiya
    const { data: payouts } = await admin
      .from('doctor_payouts')
      .select('id, net_uzs, paid_at, doctor:profiles!doctor_payouts_doctor_id_fkey(full_name)')
      .eq('clinic_id', clinicId)
      .not('paid_at', 'is', null)
      .gte('paid_at', from)
      .lte('paid_at', to);
    const salaryPayouts = ((payouts ?? []) as unknown as Array<{
      id: string;
      net_uzs: number;
      paid_at: string;
      doctor: { full_name: string } | null;
    }>).map((r) => ({
      id: r.id,
      doctor_name: r.doctor?.full_name ?? '—',
      net_uzs: Number(r.net_uzs ?? 0),
      paid_at: r.paid_at,
    }));

    const { data: commissions } = await admin
      .from('doctor_commissions')
      .select('amount_uzs, doctor:profiles!doctor_commissions_doctor_id_fkey(full_name)')
      .eq('clinic_id', clinicId)
      .gte('created_at', from)
      .lte('created_at', to);
    const commByDoctor = new Map<string, number>();
    for (const c of (commissions ?? []) as unknown as Array<{
      amount_uzs: number;
      doctor: { full_name: string } | null;
    }>) {
      const name = c.doctor?.full_name ?? '—';
      commByDoctor.set(name, (commByDoctor.get(name) ?? 0) + Number(c.amount_uzs ?? 0));
    }
    const shiftCommissions = [...commByDoctor.entries()].map(([doctor_name, amount_uzs]) => ({
      doctor_name,
      amount_uzs,
    }));

    // 7) Yakuniy hisob
    const revenue =
      transactions
        .filter((t) => !t.is_void && t.kind !== 'refund')
        .reduce((s, t) => s + t.amount_uzs, 0) +
      pharmacySales.filter((p) => !p.is_void).reduce((s, p) => s + p.paid_uzs, 0);
    const refunds = transactions
      .filter((t) => !t.is_void && t.kind === 'refund')
      .reduce((s, t) => s + t.amount_uzs, 0);
    const expenseTotal = expenses.reduce((s, e) => s + e.amount_uzs, 0);
    const salaryTotal = salaryPayouts.reduce((s, p) => s + p.net_uzs, 0);
    const totalExpense = expenseTotal + salaryTotal;
    const netProfit = revenue - refunds - totalExpense;

    return {
      shift: shiftRow,
      operator_name: shift.operator?.full_name ?? null,
      opened_at: from,
      closed_at: shift.closed_at,
      transactions,
      pharmacy_sales: pharmacySales,
      expenses,
      staff,
      salary_payouts: salaryPayouts,
      shift_commissions: shiftCommissions,
      totals: {
        revenue,
        refunds,
        expenses: expenseTotal,
        salaries: salaryTotal,
        total_expense: totalExpense,
        net_profit: netProfit,
      },
    };
  }

  private async aggregateShiftTotals(clinicId: string, shiftId: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('transactions')
      .select('payment_method, amount_uzs, kind, is_void')
      .eq('clinic_id', clinicId)
      .eq('shift_id', shiftId)
      .eq('is_void', false);
    const totals = { cash: 0, card: 0, electronic: 0 };
    for (const row of data ?? []) {
      const sign = (row as { kind: string }).kind === 'refund' ? -1 : 1;
      const amt = sign * Number((row as { amount_uzs: number }).amount_uzs);
      const m = String((row as { payment_method: string }).payment_method);
      if (m === 'cash') totals.cash += amt;
      else if (m === 'card' || m === 'humo' || m === 'uzcard') totals.card += amt;
      else totals.electronic += amt;
    }
    return totals;
  }

  async getActiveShift(clinicId: string, userId: string) {
    // Klinika uchun YAGONA faol smena qaytariladi — qabulxona, admin va
    // boshqalar bir xil smenani ko'radi. user_id bo'yicha filter olib
    // tashlandi (avval har user faqat o'zi ochganini ko'rardi).
    void userId;
    const { data, error } = await this.supabase
      .admin()
      .from('shifts')
      .select('*, operator:shift_operators(id, full_name, role, color), schedule:shift_schedules(id, name_i18n, start_time, end_time)')
      .eq('clinic_id', clinicId)
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listShifts(clinicId: string, from?: string, to?: string) {
    let q = this.supabase
      .admin()
      .from('shifts')
      .select('*, operator:shift_operators(id, full_name, role)')
      .eq('clinic_id', clinicId);
    if (from) q = q.gte('opened_at', from);
    if (to) q = q.lte('opened_at', to);
    const { data, error } = await q.order('opened_at', { ascending: false }).limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async assignmentsForToday(clinicId: string, onDate?: string) {
    const dateIso = onDate ?? new Date().toISOString().slice(0, 10);
    const dow = new Date(dateIso).getUTCDay();
    const { data: scheds, error } = await this.supabase
      .admin()
      .from('shift_schedules')
      .select('*, assignments:shift_schedule_assignments(operator_id, is_primary), operators:shift_schedule_assignments(operator:shift_operators(id, full_name, role, color))')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .contains('days_of_week', [dow])
      .order('start_time', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return scheds ?? [];
  }
}

// ---------------------------------------------------------------------- Controllers
@ApiTags('shift-operators')
@Controller('shift-operators')
class ShiftOperatorsController {
  constructor(private readonly svc: ShiftsService) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('includeArchived') includeArchived?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listOperators(u.clinicId, includeArchived === 'true');
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_operator.created', resourceType: 'shift_operators' })
  async create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createOperator(u.clinicId, u.userId, ShiftOperatorCreateSchema.parse(body));
  }

  @Patch(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_operator.updated', resourceType: 'shift_operators' })
  async update(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateOperator(u.clinicId, id, u.userId, ShiftOperatorUpdateSchema.parse(body));
  }

  @Post(':id/pin')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_operator.pin_changed', resourceType: 'shift_operators' })
  async changePin(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const { pin } = PinChangeSchema.parse(body);
    return this.svc.changePin(u.clinicId, id, u.userId, pin);
  }

  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_operator.archived', resourceType: 'shift_operators' })
  async archive(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.archiveOperator(u.clinicId, id, u.userId);
  }
}

@ApiTags('shift-schedules')
@Controller('shift-schedules')
class ShiftSchedulesController {
  constructor(private readonly svc: ShiftsService) {}

  @Get()
  list(@CurrentUser() u: { clinicId: string | null }, @Query('includeArchived') includeArchived?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listSchedules(u.clinicId, includeArchived === 'true');
  }

  @Get('for-date')
  forDate(@CurrentUser() u: { clinicId: string | null }, @Query('date') date?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.assignmentsForToday(u.clinicId, date);
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_schedule.created', resourceType: 'shift_schedules' })
  async create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createSchedule(u.clinicId, u.userId, ShiftScheduleSchema.parse(body));
  }

  @Patch(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_schedule.updated', resourceType: 'shift_schedules' })
  async update(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateSchedule(u.clinicId, id, u.userId, ShiftScheduleUpdateSchema.parse(body));
  }

  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_schedule.archived', resourceType: 'shift_schedules' })
  async archive(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.archiveSchedule(u.clinicId, id, u.userId);
  }

  @Get(':id/assignments')
  assignments(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listAssignments(u.clinicId, id);
  }

  @Post(':id/assignments')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_schedule.assignment_added', resourceType: 'shift_schedule_assignments' })
  addAssignment(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Omit<z.infer<typeof ShiftAssignmentSchema>, 'schedule_id'>,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.addAssignment(u.clinicId, u.userId, { ...body, schedule_id: id });
  }

  @Delete('assignments/:assignmentId')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'shift_schedule.assignment_removed', resourceType: 'shift_schedule_assignments' })
  removeAssignment(
    @CurrentUser() u: { clinicId: string | null },
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.removeAssignment(u.clinicId, assignmentId);
  }
}

@ApiTags('shifts')
@Controller('shifts')
class ShiftsController {
  constructor(private readonly svc: ShiftsService) {}

  @Get('active')
  active(@CurrentUser() u: { clinicId: string | null; userId: string | null }) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.getActiveShift(u.clinicId, u.userId);
  }

  // Faol smenadagi operator PIN'ini tekshirish — maxfiy daromad maydonlarini
  // ochish kabi UI amallar uchun. Smenani kim ochgan bo'lsa o'sha PIN.
  @Post('active/verify-pin')
  async verifyActiveShiftPin(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const schema = z.object({ pin: z.string().min(4).max(8) });
    const { pin } = schema.parse(body);
    return this.svc.verifyActiveShiftPin(u.clinicId, pin);
  }

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listShifts(u.clinicId, from, to);
  }

  @Post('open')
  @Audit({ action: 'shift.opened', resourceType: 'shifts' })
  async open(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.openShift(u.clinicId, u.userId, OpenShiftSchema.parse(body));
  }

  @Patch(':id/close')
  @Audit({ action: 'shift.closed', resourceType: 'shifts' })
  async close(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.closeShift(u.clinicId, u.userId, id, CloseShiftSchema.parse(body));
  }

  @Get(':id/report')
  report(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.shiftReport(u.clinicId, id);
  }
}

@Module({
  controllers: [ShiftOperatorsController, ShiftSchedulesController, ShiftsController],
  providers: [ShiftsService, SupabaseService],
  exports: [ShiftsService],
})
export class ShiftsModule {}

// Silence unused pipes warning
void DefaultValuePipe;
