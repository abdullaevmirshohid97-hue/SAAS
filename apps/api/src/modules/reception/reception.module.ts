import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const PaymentMethod = z.enum(['cash', 'card', 'transfer', 'insurance', 'click', 'payme', 'uzum', 'kaspi', 'humo', 'uzcard']);

const PatientPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  patronymic: z.string().optional(),
  full_name: z.string().optional(),
  dob: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  referral_source: z
    .enum([
      'instagram',
      'telegram',
      'facebook',
      'tiktok',
      'youtube',
      'google',
      'billboard',
      'word_of_mouth',
      'doctor',
      'returning',
      'other',
    ])
    .optional(),
  referral_notes: z.string().optional(),
});

const CheckoutItemSchema = z.object({
  service_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(50),
  unit_price_uzs: z.number().int().min(0).optional(),
  discount_uzs: z.number().int().min(0).default(0),
});

const CheckoutSchema = z.object({
  patient: PatientPayloadSchema,
  doctor_id: z.string().uuid().nullish(),
  items: z.array(CheckoutItemSchema).default([]),
  payment_method: PaymentMethod,
  paid_amount_uzs: z.number().int().min(0),
  debt_uzs: z.number().int().min(0).default(0),
  notes: z.string().optional(),
  add_to_queue: z.boolean().default(true),
  shift_id: z.string().uuid().nullish(),
  provider_reference: z.string().optional(),
  // Sprint 2D: bemor allaqachon checked_in / serving bo'lsa shu
  // appointmentga xizmatlarni qo'shish, yangi appointment yaratmaslik.
  existing_appointment_id: z.string().uuid().nullish(),
});

export type CheckoutInput = z.infer<typeof CheckoutSchema>;

@Injectable()
class ReceptionService {
  constructor(private readonly supabase: SupabaseService) {}

  private async resolvePatient(clinicId: string, userId: string, payload: z.infer<typeof PatientPayloadSchema>) {
    const admin = this.supabase.admin();
    if (payload.id) {
      const { data, error } = await admin
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('id', payload.id)
        .is('deleted_at', null)
        .single();
      if (error || !data) throw new BadRequestException('patient not found');
      return data as { id: string };
    }
    if (!payload.first_name || !payload.last_name) {
      throw new BadRequestException('first_name and last_name required to create patient');
    }
    const composedName = [payload.last_name, payload.first_name, payload.patronymic].filter(Boolean).join(' ');
    const { data, error } = await admin
      .from('patients')
      .insert({
        clinic_id: clinicId,
        created_by: userId,
        full_name: payload.full_name ?? composedName,
        first_name: payload.first_name,
        last_name: payload.last_name,
        patronymic: payload.patronymic ?? null,
        dob: payload.dob ?? null,
        gender: payload.gender ?? null,
        phone: payload.phone ?? null,
        address: payload.address ?? null,
        referral_source: payload.referral_source ?? null,
        referral_notes: payload.referral_notes ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as { id: string };
  }

  // Doktor identifikatorini "haqiqiy" profiles.id ga aylantiradi.
  // Agar berilgan id staff_profiles dan kelsa (login holatisiz xodim),
  // avtomatik "ghost" profiles qator yaratiladi (login imkonisiz, faqat
  // payroll uchun papka). Keyin staff_profiles.profile_id shu bilan
  // bog'lanadi va keyingi safar takror yaratish kerakmas.
  // Anketadagi salary_percent / salary_fixed_uzs payroll'ga default
  // foiz sifatida sync qilinadi (xizmatga bo'yicha ustun foiz bo'lsa
  // u ham qoladi).
  private async resolveDoctorId(clinicId: string, rawId: string): Promise<string> {
    const admin = this.supabase.admin();

    // 1) Agar bu allaqachon profiles.id bo'lsa — to'g'ri qaytaradi.
    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', rawId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (profile) return rawId;

    // 2) Bu staff_profiles.id bo'lishi mumkin.
    const { data: staff } = await admin
      .from('staff_profiles')
      .select('id, profile_id, first_name, last_name, patronymic, phone, salary_percent, salary_fixed_uzs')
      .eq('id', rawId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (!staff) {
      // Hech bir tablitsada topilmadi — original id qaytaramiz, FK xato beradi.
      return rawId;
    }

    const sp = staff as {
      id: string;
      profile_id: string | null;
      first_name: string;
      last_name: string;
      patronymic: string | null;
      phone: string | null;
      salary_percent: number | null;
      salary_fixed_uzs: number | null;
    };

    // Allaqachon profile bog'langan — uni qaytaramiz.
    if (sp.profile_id) return sp.profile_id;

    // Ghost profile yaratamiz — payroll uchun, login imkonisiz.
    const newProfileId = randomUUID();
    const fullName = [sp.last_name, sp.first_name, sp.patronymic].filter(Boolean).join(' ');
    const ghostEmail = `payroll+${sp.id.slice(0, 8)}@clary.local`;

    const { error: insErr } = await admin.from('profiles').insert({
      id: newProfileId,
      clinic_id: clinicId,
      email: ghostEmail,
      full_name: fullName,
      phone: sp.phone,
      role: 'doctor',
      is_active: true,
    });
    if (insErr) throw new Error(`Ghost profile yaratilmadi: ${insErr.message}`);

    // staff_profiles.profile_id ni bog'laymiz — keyingi safar takror yaratmaydi.
    await admin
      .from('staff_profiles')
      .update({ profile_id: newProfileId })
      .eq('id', sp.id);

    // Anketadagi default foizni payroll'ga sync — global rate sifatida
    // (service_id NULL). Agar foiz/fix mavjud bo'lsa.
    const percent = Number(sp.salary_percent ?? 0);
    const fixed = Number(sp.salary_fixed_uzs ?? 0);
    if (percent > 0 || fixed > 0) {
      await admin.from('doctor_commission_rates').insert({
        clinic_id: clinicId,
        doctor_id: newProfileId,
        service_id: null,
        percent,
        fixed_uzs: fixed,
        valid_from: new Date().toISOString().slice(0, 10),
      });
    }

    return newProfileId;
  }

  private async accrueCommission(
    clinicId: string,
    transactionId: string,
    doctorId: string,
    serviceId: string,
    grossUzs: number,
  ): Promise<void> {
    const admin = this.supabase.admin();
    const today = new Date().toISOString().slice(0, 10);

    let rate: { percent: number; fixed_uzs: number } | null = null;
    {
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
      rate = data as { percent: number; fixed_uzs: number } | null;
    }
    if (!rate) {
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
      rate = data as { percent: number; fixed_uzs: number } | null;
    }
    const percent = rate?.percent ?? 0;
    const fixed = rate?.fixed_uzs ?? 0;
    if (percent === 0 && fixed === 0) return;

    const amount = Math.round((Number(grossUzs) * Number(percent)) / 100) + Number(fixed);
    await admin
      .from('doctor_commissions')
      .upsert(
        {
          clinic_id: clinicId,
          doctor_id: doctorId,
          transaction_id: transactionId,
          service_id: serviceId,
          gross_uzs: grossUzs,
          percent,
          fixed_uzs: fixed,
          amount_uzs: amount,
          status: 'accrued',
        },
        { onConflict: 'clinic_id,transaction_id,doctor_id' },
      );
  }

  private async generateTicketNo(clinicId: string, doctorId: string | null): Promise<string> {
    const admin = this.supabase.admin();
    const prefix = doctorId ? doctorId.slice(0, 2).toUpperCase() : 'G';
    const today = new Date();
    const { count } = await admin
      .from('queues')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('joined_at', new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString());
    const seq = (count ?? 0) + 1;
    return `${prefix}-${String(seq).padStart(3, '0')}`;
  }

  async checkout(clinicId: string, userId: string, input: CheckoutInput) {
    const admin = this.supabase.admin();
    const patient = await this.resolvePatient(clinicId, userId, input.patient);

    const serviceIds = [...new Set(input.items.map((i) => i.service_id))];
    const { data: services, error: svcErr } = await admin
      .from('services')
      .select('id, name_i18n, price_uzs, category_id, doctor_required')
      .eq('clinic_id', clinicId)
      .in('id', serviceIds)
      .eq('is_archived', false);
    if (svcErr) throw new BadRequestException(svcErr.message);
    const svcMap = new Map((services ?? []).map((s) => [s.id as string, s]));
    for (const it of input.items) {
      if (!svcMap.has(it.service_id)) throw new BadRequestException(`service ${it.service_id} not available`);
    }

    let total = 0;
    const itemRows: Array<Record<string, unknown>> = [];
    for (const it of input.items) {
      const svc = svcMap.get(it.service_id)!;
      const unit = it.unit_price_uzs ?? Number((svc as { price_uzs: number }).price_uzs);
      const itemTotal = unit * it.quantity - (it.discount_uzs ?? 0);
      total += itemTotal;
      const nameI18n = (svc as { name_i18n: Record<string, string> }).name_i18n;
      itemRows.push({
        clinic_id: clinicId,
        service_id: it.service_id,
        service_name_snapshot: nameI18n['uz-Latn'] ?? nameI18n.ru ?? Object.values(nameI18n)[0] ?? 'service',
        service_price_snapshot: unit,
        quantity: it.quantity,
        discount_snapshot: it.discount_uzs ? { amount: it.discount_uzs } : null,
        final_amount_uzs: itemTotal,
      });
    }

    if (input.paid_amount_uzs + (input.debt_uzs ?? 0) < total) {
      throw new BadRequestException('paid + debt must cover total');
    }

    let shiftId = input.shift_id ?? null;
    if (!shiftId) {
      const { data: activeShift } = await admin
        .from('shifts')
        .select('id')
        .eq('clinic_id', clinicId)
        .is('closed_at', null)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeShift) shiftId = (activeShift as { id: string }).id;
    }

    const { data: trx, error: trxErr } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        patient_id: patient.id,
        shift_id: shiftId,
        cashier_id: userId,
        kind: 'payment',
        amount_uzs: input.paid_amount_uzs,
        payment_method: input.payment_method,
        provider_reference: input.provider_reference ?? null,
        notes: input.notes ?? null,
      })
      .select('id')
      .single();
    if (trxErr || !trx) throw new BadRequestException(trxErr?.message ?? 'failed to create transaction');

    const items = itemRows.map((row) => ({ ...row, transaction_id: (trx as { id: string }).id }));
    const { error: itemErr } = await admin.from('transaction_items').insert(items);
    if (itemErr) throw new BadRequestException(itemErr.message);

    let appointmentId: string | null = null;
    let queueId: string | null = null;
    let ticketNo: string | null = null;

    // Sprint 2D: existing appointment'ga xizmat qo'shish
    if (input.existing_appointment_id) {
      const { data: existingAppt, error: existErr } = await admin
        .from('appointments')
        .select('id, doctor_id, patient_id, status')
        .eq('clinic_id', clinicId)
        .eq('id', input.existing_appointment_id)
        .maybeSingle();
      if (existErr) throw new BadRequestException(existErr.message);
      if (!existingAppt) throw new NotFoundException('appointment not found');
      if ((existingAppt as { patient_id: string }).patient_id !== patient.id) {
        throw new BadRequestException('appointment belongs to a different patient');
      }
      appointmentId = (existingAppt as { id: string }).id;
      await admin
        .from('transactions')
        .update({ appointment_id: appointmentId })
        .eq('clinic_id', clinicId)
        .eq('id', (trx as { id: string }).id);
      // Existing queue row mavjud bo'lsa undan ticket_no'ni olamiz (UI uchun)
      const { data: existingQ } = await admin
        .from('queues')
        .select('id, ticket_no')
        .eq('clinic_id', clinicId)
        .eq('appointment_id', appointmentId)
        .maybeSingle();
      if (existingQ) {
        queueId = (existingQ as { id: string }).id;
        ticketNo = ((existingQ as { ticket_no: string | null }).ticket_no) ?? null;
      }
    } else if (input.doctor_id && input.add_to_queue) {
      // staff_profiles dan kelgan id ni profiles.id ga aylantirish
      // (kerak bo'lsa ghost profile yaratiladi va default foiz sync qilinadi).
      const resolvedDoctorId = await this.resolveDoctorId(clinicId, input.doctor_id);

      const primaryItem = input.items[0] ?? null;
      const svc = primaryItem ? svcMap.get(primaryItem.service_id) ?? null : null;
      const nameI18n = svc ? (svc as { name_i18n: Record<string, string> }).name_i18n : null;

      const apptInsert: Record<string, unknown> = {
        clinic_id: clinicId,
        patient_id: patient.id,
        doctor_id: resolvedDoctorId,
        scheduled_at: new Date().toISOString(),
        status: 'checked_in',
        created_by: userId,
        checked_in_at: new Date().toISOString(),
      };
      if (primaryItem && svc && nameI18n) {
        apptInsert.service_id = primaryItem.service_id;
        apptInsert.service_name_snapshot = nameI18n['uz-Latn'] ?? Object.values(nameI18n)[0] ?? 'service';
        apptInsert.service_price_snapshot = Number((svc as { price_uzs: number }).price_uzs);
      }

      const { data: appt, error: apptErr } = await admin
        .from('appointments')
        .insert(apptInsert)
        .select('id')
        .single();
      if (apptErr) throw new BadRequestException(apptErr.message);
      appointmentId = (appt as { id: string }).id;

      ticketNo = await this.generateTicketNo(clinicId, resolvedDoctorId);
      const { data: q, error: qErr } = await admin
        .from('queues')
        .insert({
          clinic_id: clinicId,
          appointment_id: appointmentId,
          patient_id: patient.id,
          doctor_id: resolvedDoctorId,
          ticket_no: ticketNo,
          status: 'waiting',
        })
        .select('id')
        .single();
      if (qErr) throw new BadRequestException(qErr.message);
      queueId = (q as { id: string }).id;

      await admin
        .from('transactions')
        .update({ appointment_id: appointmentId })
        .eq('clinic_id', clinicId)
        .eq('id', (trx as { id: string }).id);

      if (primaryItem) {
        try {
          await this.accrueCommission(clinicId, (trx as { id: string }).id, resolvedDoctorId, primaryItem.service_id, input.paid_amount_uzs);
        } catch {
          // payroll accrual failure must never block reception flow
        }
      }
    }

    return {
      patient_id: patient.id,
      transaction_id: (trx as { id: string }).id,
      total_uzs: total,
      paid_uzs: input.paid_amount_uzs,
      debt_uzs: input.debt_uzs ?? 0,
      appointment_id: appointmentId,
      queue_id: queueId,
      ticket_no: ticketNo,
      shift_id: shiftId,
    };
  }
}

@ApiTags('reception')
@Controller('reception')
class ReceptionController {
  constructor(
    private readonly svc: ReceptionService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post('checkout')
  @Roles('clinic_admin', 'clinic_owner', 'receptionist')
  @Audit({ action: 'reception.checkout', resourceType: 'transactions' })
  checkout(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const data = CheckoutSchema.parse(body);
    return this.svc.checkout(u.clinicId, u.userId, data);
  }

  // Sprint 2D: bemorning ochiq appointment'larini topish
  @Get('open-appointments')
  async openByPatient(
    @CurrentUser() u: { clinicId: string | null },
    @Query('patient_id') patientId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    if (!patientId) throw new BadRequestException('patient_id required');
    const { data, error } = await this.supabase
      .admin()
      .from('appointments')
      .select(
        'id, doctor_id, doctor:profiles!doctor_id(full_name), service_name_snapshot, status, scheduled_at, checked_in_at',
      )
      .eq('clinic_id', u.clinicId)
      .eq('patient_id', patientId)
      .in('status', ['scheduled', 'checked_in', 'in_progress'])
      .order('scheduled_at', { ascending: false })
      .limit(10);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}

@ApiTags('doctors')
@Controller('doctors')
class DoctorsController {
  constructor(private readonly supabase: SupabaseService) {}

  // Doktorlar ro'yxati IKKI manbadan keladi:
  // 1) profiles (login user, role='doctor' va admin/owner ham)
  // 2) staff_profiles (anketa, position='doctor', login bo'lmasligi mumkin)
  // profile_id allaqachon to'lgan staff_profiles takrorlanmaydi.
  @Get()
  async list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    const admin = this.supabase.admin();

    const [{ data: profiles, error: profErr }, { data: staffRows }] = await Promise.all([
      admin
        .from('profiles')
        .select('id, full_name, role, phone, avatar_url')
        .eq('clinic_id', u.clinicId)
        .in('role', ['doctor', 'clinic_admin', 'clinic_owner'])
        .order('full_name'),
      admin
        .from('staff_profiles')
        .select('id, first_name, last_name, patronymic, phone, profile_id, position, photos')
        .eq('clinic_id', u.clinicId)
        .eq('position', 'doctor')
        .eq('is_active', true),
    ]);
    if (profErr) throw new NotFoundException(profErr.message);

    const profileBackedStaffIds = new Set(
      ((staffRows ?? []) as Array<{ profile_id: string | null }>)
        .filter((s) => s.profile_id)
        .map((s) => s.profile_id as string),
    );

    // Anketa doktorlar — faqat login holatisizlari (profile_id NULL).
    // profile_id to'lgan'lar profiles ro'yxatida allaqachon bor.
    const staffDoctors = ((staffRows ?? []) as Array<{
      id: string;
      first_name: string;
      last_name: string;
      patronymic: string | null;
      phone: string | null;
      profile_id: string | null;
      photos: string[] | null;
    }>)
      .filter((s) => !s.profile_id)
      .map((s) => ({
        id: s.id,
        full_name: [s.last_name, s.first_name, s.patronymic].filter(Boolean).join(' '),
        role: 'doctor',
        phone: s.phone,
        avatar_url: (s.photos && s.photos[0]) || null,
        // Marker — frontend bilsin bu xodim staff_profiles dan
        source: 'staff_profile' as const,
      }));

    const merged = [
      ...((profiles ?? []) as Array<{ id: string; full_name: string }>).map((p) => ({
        ...p,
        source: 'profile' as const,
      })),
      ...staffDoctors,
    ];
    // Profil takrorlanishini oldindan filter qildik, qo'shimcha check shart emas.
    void profileBackedStaffIds;
    merged.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return merged;
  }
}

@ApiTags('services')
@Controller('services')
class ServicesListController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('category') category?: string,
    @Query('q') q?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    let query = this.supabase
      .admin()
      .from('services')
      .select('id, name_i18n, description_i18n, price_uzs, duration_min, doctor_required, category_id, sort_order')
      .eq('clinic_id', u.clinicId)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })
      .limit(500);
    if (category) query = query.eq('category_id', category);
    const { data, error } = await query;
    if (error) throw new NotFoundException(error.message);
    const rows = data ?? [];
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) => {
      const n = (r as { name_i18n: Record<string, string> }).name_i18n;
      return Object.values(n).some((v) => v.toLowerCase().includes(needle));
    });
  }
}

@Module({
  controllers: [ReceptionController, DoctorsController, ServicesListController],
  providers: [ReceptionService, SupabaseService],
  exports: [ReceptionService],
})
export class ReceptionModule {}
