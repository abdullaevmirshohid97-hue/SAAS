import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
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
  // Har oy aniq beriladigan oylik (komissiyadan tashqari). Default 0.
  monthly_base_uzs: z.number().int().nonnegative().default(0),
  valid_from: z.string().optional(),
  valid_to: z.string().nullable().optional(),
});

const PeriodSummarySchema = z.object({
  doctor_id: z.string().uuid().optional(),
  from: z.string(), // YYYY-MM-DD
  to: z.string(),   // YYYY-MM-DD
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
  source: z.enum(['cash_drawer', 'safe']).optional(),
});

const AccrueSchema = z.object({
  transaction_id: z.string().uuid(),
});

@Injectable()
class PayrollService {
  private readonly log = new Logger('PayrollService');

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
        monthly_base_uzs: input.monthly_base_uzs ?? 0,
        valid_from: input.valid_from ?? new Date().toISOString().slice(0, 10),
        valid_to: input.valid_to ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Stavkasi sozlanmagan tranzaksiyalar — payroll_unaccrued_view orqali.
  // Admin Hisob-kitob > "Sozlanmagan" tab'da ko'rib, stavka qo'shadi.
  async listUnaccrued(clinicId: string, doctorId?: string) {
    const admin = this.supabase.admin();
    let q = admin
      .from('payroll_unaccrued_view')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (doctorId) q = q.eq('doctor_id', doctorId);
    const { data } = await q;
    return data ?? [];
  }

  // Period bo'yicha aniq summary (commissions + monthly_base + bonuses − advances)
  async periodSummary(clinicId: string, doctorId: string, from: string, to: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('payroll_period_summary' as never, {
        p_clinic_id: clinicId,
        p_doctor_id: doctorId,
        p_from: from,
        p_to: to,
      } as never)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Butun klinika uchun period summary — barcha shifokorlar
  async clinicPeriodSummary(clinicId: string, from: string, to: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('payroll_clinic_period_summary' as never, {
        p_clinic_id: clinicId,
        p_from: from,
        p_to: to,
      } as never);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // Oylik berish holati — tanlangan davr bo'yicha har xodimga: oldi/olmadi +
  // oylik berish kuni (payday) keldimi (due). Maosh oynasidagi 'Oylik oldi' /
  // 'Oylik olishi kerak' ro'yxatlari va eslatma uchun.
  async paydayStatus(clinicId: string, from: string, to: string) {
    const admin = this.supabase.admin();
    const [summary, profilesRes, payoutsRes] = await Promise.all([
      this.clinicPeriodSummary(clinicId, from, to),
      admin
        .from('staff_profiles')
        .select('profile_id, payday_kind, payday_day, position')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .not('profile_id', 'is', null),
      admin
        .from('doctor_payouts')
        .select('doctor_id, status, period_start, period_end, paid_at, net_uzs')
        .eq('clinic_id', clinicId)
        .neq('status', 'canceled')
        .gte('period_start', from)
        .lte('period_end', to),
    ]);

    const paydayMap = new Map<string, { kind: string; day: number; position: string }>();
    for (const s of (profilesRes.data ?? []) as Array<{ profile_id: string; payday_kind: string; payday_day: number; position: string }>) {
      paydayMap.set(s.profile_id, { kind: s.payday_kind, day: s.payday_day, position: s.position });
    }
    const paidMap = new Map<string, { paid_at: string | null; status: string; paid_uzs: number }>();
    for (const p of (payoutsRes.data ?? []) as Array<{ doctor_id: string; status: string; paid_at: string | null; net_uzs: number }>) {
      const cur = paidMap.get(p.doctor_id) ?? { paid_at: null, status: 'draft', paid_uzs: 0 };
      // paid_uzs — faqat HAQIQATAN to'langan payout'lar yig'indisi (draft hisobga olinmaydi).
      if (p.status === 'paid') {
        cur.paid_uzs += Number(p.net_uzs ?? 0);
        cur.paid_at = p.paid_at ?? cur.paid_at;
        cur.status = 'paid';
      } else if (cur.status !== 'paid') {
        cur.status = p.status;
      }
      paidMap.set(p.doctor_id, cur);
    }

    // Bugun (Asia/Tashkent) — payday kelganini aniqlash uchun
    const todayTk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
    todayTk.setHours(0, 0, 0, 0);
    const toDate = new Date(`${to}T00:00:00`);

    const dueDateFor = (kind: string, day: number): Date => {
      // monthly: tanlangan davr oxirgi oyidagi N-kun (oy oxiridan oshmasin)
      // weekly: davr oxiridagi mos hafta-kuni (1=Dush..7=Yak)
      if (kind === 'weekly') {
        const d = new Date(toDate);
        // JS getDay: 0=Yak..6=Shan → bizniki 1=Dush..7=Yak
        const target = day === 7 ? 0 : day; // 7(Yak)->0
        while (d.getDay() !== target) d.setDate(d.getDate() - 1);
        return d;
      }
      const y = toDate.getFullYear();
      const m = toDate.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(day, lastDay));
    };

    return ((summary ?? []) as Array<{ doctor_id: string; doctor_name: string; net_uzs: number }>).map((r) => {
      const pd = paydayMap.get(r.doctor_id);
      const kind = pd?.kind ?? 'monthly';
      const day = pd?.day ?? 3;
      const due_date = dueDateFor(kind, day);
      const paidRec = paidMap.get(r.doctor_id);
      const paid = !!paidRec;
      const net = Number(r.net_uzs ?? 0);
      const paidUzs = paidRec?.paid_uzs ?? 0;
      // Qoldiq (to'lanmagan) = net − to'langan (manfiy bo'lmasin).
      const unpaidUzs = Math.max(0, net - paidUzs);
      const due = !paid && due_date <= todayTk && net > 0;
      return {
        doctor_id: r.doctor_id,
        doctor_name: r.doctor_name,
        net_uzs: net,
        paid_uzs: paidUzs,
        unpaid_uzs: unpaidUzs,
        payday_kind: kind,
        payday_day: day,
        position: pd?.position ?? null,
        paid,
        paid_at: paidRec?.paid_at ?? null,
        due,
        due_date: due_date.toISOString().slice(0, 10),
      };
    });
  }

  // Statsionar payroll summasi har shifokor uchun (davr ichida).
  // doctor_ledger.reference 'inpatient:...' bilan boshlanadigan yozuvlar
  // statsionardan kelgan kunlik/admission bonuslar.
  async inpatientPayrollByPeriod(clinicId: string, from: string, to: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('doctor_ledger')
      .select('doctor_id, amount_uzs, reference')
      .eq('clinic_id', clinicId)
      .like('reference', 'inpatient:%')
      .gte('created_at', `${from}T00:00:00.000Z`)
      .lte('created_at', `${to}T23:59:59.999Z`);
    if (error) throw new Error(error.message);
    const map: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ doctor_id: string; amount_uzs: number }>) {
      map[r.doctor_id] = (map[r.doctor_id] ?? 0) + Number(r.amount_uzs);
    }
    return map;
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
    if (percent === 0 && fixed === 0) {
      // Stavka topilmadi — admin Hisob-kitob > "Sozlanmagan" tab'da ko'radi.
      // payroll_unaccrued_view bu tranzaksiyani avtomatik ko'rsatadi.
      this.log.warn(
        `[accrual] stavka yo'q: clinic=${clinicId} doctor=${doctorId} service=${serviceId ?? 'global'} tx=${transactionId}`,
      );
      return { unaccrued: true, doctor_id: doctorId, transaction_id: transactionId } as unknown as null;
    }

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

    // Duplicate guard: shu davr uchun shu xodimga payout allaqachon bor bo'lsa,
    // qayta yaratmaymiz. Faqat 'canceled' bo'lganlarni hisobga olmaymiz.
    const { data: existing } = await admin
      .from('doctor_payouts')
      .select('id, status, period_label')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', input.doctor_id)
      .eq('period_start', input.period_start)
      .eq('period_end', input.period_end)
      .neq('status', 'canceled')
      .maybeSingle();
    if (existing) {
      const ex = existing as { id: string; status: string; period_label: string | null };
      throw new BadRequestException(
        `Bu davr uchun payout allaqachon mavjud (holat: ${ex.status === 'paid' ? "to'langan" : ex.status === 'draft' ? 'qoralama' : ex.status})`,
      );
    }

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
        source: input.source ?? 'cash_drawer',
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

  // ----- Ulush (klinika vs shifokor) ----------------------------------------
  // Xizmat to'lovida: shifokor komissiyasi = shifokor ulushi; qolgani
  // (gross − komissiya) = klinika ulushi. doctor_commissions dan [from,to].
  async shareSummary(clinicId: string, from: string, to: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('doctor_commissions')
      .select('doctor_id, gross_uzs, amount_uzs, doctor:profiles!doctor_id(full_name)')
      .eq('clinic_id', clinicId)
      .neq('status', 'reversed')
      .gte('created_at', `${from}T00:00:00.000Z`)
      .lte('created_at', `${to}T23:59:59.999Z`);
    const rows = (data ?? []) as unknown as Array<{
      doctor_id: string;
      gross_uzs: number;
      amount_uzs: number;
      doctor: { full_name: string } | null;
    }>;
    const byDoctor = new Map<
      string,
      { doctor_id: string; doctor_name: string; gross_uzs: number; commission_uzs: number; clinic_share_uzs: number; tx_count: number }
    >();
    let totalGross = 0;
    let totalCommission = 0;
    for (const r of rows) {
      const g = Number(r.gross_uzs ?? 0);
      const a = Number(r.amount_uzs ?? 0);
      totalGross += g;
      totalCommission += a;
      const cur = byDoctor.get(r.doctor_id) ?? {
        doctor_id: r.doctor_id,
        doctor_name: r.doctor?.full_name ?? '—',
        gross_uzs: 0,
        commission_uzs: 0,
        clinic_share_uzs: 0,
        tx_count: 0,
      };
      cur.gross_uzs += g;
      cur.commission_uzs += a;
      cur.clinic_share_uzs += g - a;
      cur.tx_count += 1;
      byDoctor.set(r.doctor_id, cur);
    }
    return {
      total_gross_uzs: totalGross,
      total_commission_uzs: totalCommission,
      clinic_share_uzs: totalGross - totalCommission,
      by_doctor: Array.from(byDoctor.values()).sort((a, b) => b.commission_uzs - a.commission_uzs),
    };
  }

  // ----- Shifokor drill-down (jurnaldek) ------------------------------------
  // Bitta shifokorning davr ichidagi komissiya qatorlari: sana, bemor, xizmat,
  // gross, foiz, topgani. Frontend kunlar bo'yicha guruhlaydi.
  async doctorEarnings(clinicId: string, doctorId: string, from: string, to: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('doctor_commissions')
      .select(
        'id, gross_uzs, percent, amount_uzs, created_at, transaction_id, ' +
          'service:services(name_i18n), transaction:transactions(patient:patients(full_name))',
      )
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .neq('status', 'reversed')
      .gte('created_at', `${from}T00:00:00.000Z`)
      .lte('created_at', `${to}T23:59:59.999Z`)
      .order('created_at', { ascending: false })
      .limit(1000);
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      gross_uzs: number;
      percent: number;
      amount_uzs: number;
      created_at: string;
      transaction_id: string;
      service: { name_i18n: Record<string, string> | null } | null;
      transaction: { patient: { full_name: string } | null } | null;
    }>;
    return rows.map((r) => {
      const ni = r.service?.name_i18n ?? null;
      const serviceName = ni ? ni['uz-Latn'] ?? ni.ru ?? Object.values(ni)[0] ?? null : null;
      return {
        id: r.id,
        date: r.created_at,
        patient_name: r.transaction?.patient?.full_name ?? null,
        service_name: serviceName,
        gross_uzs: Number(r.gross_uzs ?? 0),
        percent: Number(r.percent ?? 0),
        amount_uzs: Number(r.amount_uzs ?? 0),
        transaction_id: r.transaction_id,
      };
    });
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
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'payroll.rate_set', resourceType: 'doctor_commission_rates' })
  setRate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.upsertRate(u.clinicId, u.userId, CommissionRateSchema.parse(body));
  }

  @Post('rates/:id/archive')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
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
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
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
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'payroll.payout_created', resourceType: 'doctor_payouts' })
  createPayout(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createPayout(u.clinicId, u.userId, CreatePayoutSchema.parse(body));
  }

  @Post('payouts/:id/pay')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
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
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  cancel(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cancelPayout(u.clinicId, id);
  }

  @Post('accrue')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  accrue(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const { transaction_id } = AccrueSchema.parse(body);
    return this.svc.accrueTransaction(u.clinicId, transaction_id);
  }

  @Get('unaccrued')
  @RequirePerm('payroll.view_all')
  unaccrued(
    @CurrentUser() u: { clinicId: string | null },
    @Query('doctor_id') doctorId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listUnaccrued(u.clinicId, doctorId);
  }

  @Get('period-summary')
  @RequirePerm('payroll.view_all')
  periodSummary(
    @CurrentUser() u: { clinicId: string | null },
    @Query('doctor_id') doctorId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = PeriodSummarySchema.parse({ doctor_id: doctorId, from, to });
    if (!v.doctor_id) throw new ForbiddenException('doctor_id majburiy');
    return this.svc.periodSummary(u.clinicId, v.doctor_id, v.from, v.to);
  }

  @Get('clinic-period-summary')
  @RequirePerm('payroll.view_all')
  clinicPeriodSummary(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = PeriodSummarySchema.parse({ from, to });
    return this.svc.clinicPeriodSummary(u.clinicId, v.from, v.to);
  }

  @Get('inpatient-payroll-by-period')
  @RequirePerm('payroll.view_all')
  inpatientPayrollByPeriod(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = PeriodSummarySchema.parse({ from, to });
    return this.svc.inpatientPayrollByPeriod(u.clinicId, v.from, v.to);
  }

  @Get('payday-status')
  @RequirePerm('payroll.view_all')
  paydayStatus(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = PeriodSummarySchema.parse({ from, to });
    return this.svc.paydayStatus(u.clinicId, v.from, v.to);
  }

  @Get('share-summary')
  @RequirePerm('payroll.view_all')
  shareSummary(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = PeriodSummarySchema.parse({ from, to });
    return this.svc.shareSummary(u.clinicId, v.from, v.to);
  }

  @Get('doctor-earnings')
  @RequirePerm('payroll.view_all')
  doctorEarnings(
    @CurrentUser() u: { clinicId: string | null },
    @Query('doctor_id') doctorId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const v = PeriodSummarySchema.parse({ doctor_id: doctorId, from, to });
    if (!v.doctor_id) throw new ForbiddenException('doctor_id majburiy');
    return this.svc.doctorEarnings(u.clinicId, v.doctor_id, v.from, v.to);
  }
}

@Module({
  controllers: [PayrollController],
  providers: [PayrollService, SupabaseService],
  exports: [PayrollService],
})
export class PayrollModule {}
