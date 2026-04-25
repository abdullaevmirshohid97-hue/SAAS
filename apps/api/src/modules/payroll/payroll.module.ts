import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePerm } from '../../common/decorators/require-perm.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const CommissionRateSchema = z.object({
  doctor_id: z.string().uuid(),
  service_id: z.string().uuid().nullable().optional(),
  percent: z.number().min(0).max(100),
  fixed_uzs: z.number().int().nonnegative().default(0),
  valid_from: z.string().optional(),
  valid_to: z.string().nullable().optional(),
});

const LedgerEntrySchema = z.object({
  doctor_id: z.string().uuid(),
  kind: z.enum(['advance', 'bonus', 'penalty', 'adjustment', 'debt_write_off']),
  amount_uzs: z.number().int(),
  notes: z.string().optional(),
  reference: z.string().optional(),
});

const CreatePayoutSchema = z.object({
  doctor_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  period_label: z.string().optional(),
  notes: z.string().optional(),
});

const PayPayoutSchema = z.object({
  method: z.enum(['cash', 'card', 'humo', 'uzcard', 'click', 'payme', 'bank_transfer']),
  reference: z.string().optional(),
});

const AccrueSchema = z.object({
  transaction_id: z.string().uuid(),
});

@Injectable()
class PayrollService {
  constructor(private readonly supabase: SupabaseService) {}

  // ----- Rates --------------------------------------------------------------
  async listRates(clinicId: string, doctorId?: string) {
    let q = this.supabase
      .admin()
      .from('doctor_commission_rates')
      .select('*, doctor:profiles!doctor_id(full_name), service:services(name)')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .order('valid_from', { ascending: false });
    if (doctorId) q = q.eq('doctor_id', doctorId);
    const { data } = await q;
    return data ?? [];
  }

  async upsertRate(clinicId: string, userId: string, input: z.infer<typeof CommissionRateSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('doctor_commission_rates')
      .insert({
        clinic_id: clinicId,
        doctor_id: input.doctor_id,
        service_id: input.service_id ?? null,
        percent: input.percent,
        fixed_uzs: input.fixed_uzs,
        valid_from: input.valid_from ?? new Date().toISOString().slice(0, 10),
        valid_to: input.valid_to ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async archiveRate(clinicId: string, id: string) {
    await this.supabase
      .admin()
      .from('doctor_commission_rates')
      .update({ is_archived: true })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    return { ok: true };
  }

  // ----- Accrual ------------------------------------------------------------
  async accrueTransaction(clinicId: string, transactionId: string) {
    const admin = this.supabase.admin();
    const { data: tx } = await admin
      .from('transactions')
      .select(
        'id, clinic_id, amount_uzs, kind, is_void, patient_id, appointment_id, appointment:appointments(doctor_id, service_id, service_price_snapshot)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', transactionId)
      .maybeSingle();
    if (!tx) return null;
    const t = tx as unknown as {
      amount_uzs: number;
      kind: string;
      is_void: boolean;
      appointment: { doctor_id: string | null; service_id: string | null } | null;
      appointment_id: string | null;
    };
    if (t.is_void || t.kind !== 'payment') return null;
    const doctorId = t.appointment?.doctor_id;
    if (!doctorId) return null;
    const serviceId = t.appointment?.service_id ?? null;

    // Resolve applicable rate (service-specific first, then global)
    const today = new Date().toISOString().slice(0, 10);
    let rateRow: { percent: number; fixed_uzs: number } | null = null;
    if (serviceId) {
      const { data } = await admin
        .from('doctor_commission_rates')
        .select('percent, fixed_uzs')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .eq('service_id', serviceId)
        .eq('is_archived', false)
        .lte('valid_from', today)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      rateRow = data as { percent: number; fixed_uzs: number } | null;
    }
    if (!rateRow) {
      const { data } = await admin
        .from('doctor_commission_rates')
        .select('percent, fixed_uzs')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .is('service_id', null)
        .eq('is_archived', false)
        .lte('valid_from', today)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      rateRow = data as { percent: number; fixed_uzs: number } | null;
    }
    const percent = rateRow?.percent ?? 0;
    const fixed = rateRow?.fixed_uzs ?? 0;
    if (percent === 0 && fixed === 0) return null;

    const amount = Math.round((Number(t.amount_uzs) * percent) / 100) + Number(fixed);
    const { data, error } = await admin
      .from('doctor_commissions')
      .upsert(
        {
          clinic_id: clinicId,
          doctor_id: doctorId,
          transaction_id: transactionId,
          appointment_id: t.appointment_id,
          service_id: serviceId,
          gross_uzs: t.amount_uzs,
          percent,
          fixed_uzs: fixed,
          amount_uzs: amount,
          status: 'accrued',
        },
        { onConflict: 'clinic_id,transaction_id,doctor_id' },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // ----- Ledger -------------------------------------------------------------
  async ledgerList(clinicId: string, doctorId?: string) {
    let q = this.supabase
      .admin()
      .from('doctor_ledger')
      .select('*, doctor:profiles!doctor_id(full_name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    if (doctorId) q = q.eq('doctor_id', doctorId);
    const { data } = await q;
    return data ?? [];
  }

  async ledgerCreate(clinicId: string, userId: string, input: z.infer<typeof LedgerEntrySchema>) {
    const amount =
      input.kind === 'advance' || input.kind === 'penalty' || input.kind === 'debt_write_off'
        ? -Math.abs(input.amount_uzs)
        : Math.abs(input.amount_uzs);
    const { data, error } = await this.supabase
      .admin()
      .from('doctor_ledger')
      .insert({
        clinic_id: clinicId,
        doctor_id: input.doctor_id,
        kind: input.kind,
        amount_uzs: amount,
        notes: input.notes ?? null,
        reference: input.reference ?? null,
        status: 'open',
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // ----- Balances -----------------------------------------------------------
  async balances(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('doctor_balances_view')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('balance_uzs', { ascending: false });
    return data ?? [];
  }

  // ----- Payouts ------------------------------------------------------------
  async listPayouts(clinicId: string, doctorId?: string) {
    let q = this.supabase
      .admin()
      .from('doctor_payouts')
      .select('*, doctor:profiles!doctor_id(full_name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    if (doctorId) q = q.eq('doctor_id', doctorId);
    const { data } = await q;
    return data ?? [];
  }

  async getPayout(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('doctor_payouts')
      .select('*, doctor:profiles!doctor_id(full_name)')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    const { data: commissions } = await admin
      .from('doctor_commissions')
      .select('id, amount_uzs, gross_uzs, percent, transaction_id, created_at')
      .eq('clinic_id', clinicId)
      .eq('payout_id', id);
    const { data: ledger } = await admin
      .from('doctor_ledger')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('payout_id', id);
    return { payout: data, commissions: commissions ?? [], ledger: ledger ?? [] };
  }

  async createPayout(clinicId: string, userId: string, input: z.infer<typeof CreatePayoutSchema>) {
    const admin = this.supabase.admin();
    const { data: commissions } = await admin
      .from('doctor_commissions')
      .select('id, amount_uzs')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', input.doctor_id)
      .eq('status', 'accrued')
      .gte('created_at', `${input.period_start}T00:00:00.000Z`)
      .lte('created_at', `${input.period_end}T23:59:59.999Z`);

    const { data: ledger } = await admin
      .from('doctor_ledger')
      .select('id, amount_uzs, kind')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', input.doctor_id)
      .eq('status', 'open');

    const gross = (commissions ?? []).reduce((acc, c) => acc + Number((c as { amount_uzs: number }).amount_uzs), 0);
    const advances = (ledger ?? [])
      .filter((l) => (l as { kind: string }).kind === 'advance')
      .reduce((acc, l) => acc + Number((l as { amount_uzs: number }).amount_uzs), 0);
    const adjustments = (ledger ?? [])
      .filter((l) => (l as { kind: string }).kind !== 'advance')
      .reduce((acc, l) => acc + Number((l as { amount_uzs: number }).amount_uzs), 0);
    const net = gross + advances + adjustments; // advances/penalties are negative, bonus is positive

    const { data: rate } = await admin
      .from('doctor_commission_rates')
      .select('percent')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', input.doctor_id)
      .is('service_id', null)
      .eq('is_archived', false)
      .order('valid_from', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: payout, error } = await admin
      .from('doctor_payouts')
      .insert({
        clinic_id: clinicId,
        doctor_id: input.doctor_id,
        period_start: input.period_start,
        period_end: input.period_end,
        period_label: input.period_label ?? `${input.period_start} → ${input.period_end}`,
        gross_uzs: gross,
        gross_commission_uzs: gross,
        advances_uzs: advances,
        adjustments_uzs: adjustments,
        commission_percent: (rate as { percent: number } | null)?.percent ?? 0,
        net_uzs: net,
        status: 'draft',
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const payoutId = (payout as { id: string }).id;

    if (commissions && commissions.length > 0) {
      await admin
        .from('doctor_commissions')
        .update({ payout_id: payoutId })
        .in(
          'id',
          commissions.map((c) => (c as { id: string }).id),
        );
    }
    if (ledger && ledger.length > 0) {
      await admin
        .from('doctor_ledger')
        .update({ payout_id: payoutId })
        .in(
          'id',
          ledger.map((l) => (l as { id: string }).id),
        );
    }

    void userId;
    return payout;
  }

  async pay(clinicId: string, userId: string, id: string, input: z.infer<typeof PayPayoutSchema>) {
    const admin = this.supabase.admin();
    const { data: payout, error } = await admin
      .from('doctor_payouts')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_by: userId,
        method: input.method,
        reference: input.reference ?? null,
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await admin
      .from('doctor_commissions')
      .update({ status: 'paid' })
      .eq('clinic_id', clinicId)
      .eq('payout_id', id);
    await admin
      .from('doctor_ledger')
      .update({ status: 'applied' })
      .eq('clinic_id', clinicId)
      .eq('payout_id', id);
    return payout;
  }

  async cancelPayout(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    await admin
      .from('doctor_payouts')
      .update({ status: 'canceled' })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    await admin
      .from('doctor_commissions')
      .update({ payout_id: null })
      .eq('clinic_id', clinicId)
      .eq('payout_id', id);
    await admin
      .from('doctor_ledger')
      .update({ payout_id: null })
      .eq('clinic_id', clinicId)
      .eq('payout_id', id);
    return { ok: true };
  }
}

@ApiTags('payroll')
@Controller({ path: 'payroll', version: '1' })
class PayrollController {
  constructor(private readonly svc: PayrollService) {}

  @Get('balances')
  @RequirePerm('payroll.view_all')
  balances(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.balances(u.clinicId);
  }

  @Get('rates')
  @RequirePerm('payroll.view_all')
  rates(@CurrentUser() u: { clinicId: string | null }, @Query('doctor_id') doctorId?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listRates(u.clinicId, doctorId);
  }

  @Post('rates')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'payroll.rate_set', resourceType: 'doctor_commission_rates' })
  setRate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.upsertRate(u.clinicId, u.userId, CommissionRateSchema.parse(body));
  }

  @Post('rates/:id/archive')
  @Roles('clinic_owner', 'clinic_admin')
  archiveRate(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.archiveRate(u.clinicId, id);
  }

  @Get('ledger')
  @RequirePerm('payroll.view_all')
  ledger(@CurrentUser() u: { clinicId: string | null }, @Query('doctor_id') doctorId?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.ledgerList(u.clinicId, doctorId);
  }

  @Post('ledger')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'payroll.ledger_entry', resourceType: 'doctor_ledger' })
  createLedger(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.ledgerCreate(u.clinicId, u.userId, LedgerEntrySchema.parse(body));
  }

  @Get('payouts')
  @RequirePerm('payroll.view_all')
  listPayouts(@CurrentUser() u: { clinicId: string | null }, @Query('doctor_id') doctorId?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listPayouts(u.clinicId, doctorId);
  }

  @Get('payouts/:id')
  @RequirePerm('payroll.view_all')
  getPayout(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getPayout(u.clinicId, id);
  }

  @Post('payouts')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'payroll.payout_created', resourceType: 'doctor_payouts' })
  createPayout(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createPayout(u.clinicId, u.userId, CreatePayoutSchema.parse(body));
  }

  @Post('payouts/:id/pay')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'payroll.payout_paid', resourceType: 'doctor_payouts' })
  pay(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.pay(u.clinicId, u.userId, id, PayPayoutSchema.parse(body));
  }

  @Post('payouts/:id/cancel')
  @Roles('clinic_owner', 'clinic_admin')
  cancel(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cancelPayout(u.clinicId, id);
  }

  @Post('accrue')
  @Roles('clinic_owner', 'clinic_admin')
  accrue(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const { transaction_id } = AccrueSchema.parse(body);
    return this.svc.accrueTransaction(u.clinicId, transaction_id);
  }
}

@Module({
  controllers: [PayrollController],
  providers: [PayrollService, SupabaseService],
  exports: [PayrollService],
})
export class PayrollModule {}
