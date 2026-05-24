import {
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
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const AdmitSchema = z.object({
  patient_id: z.string().uuid(),
  room_id: z.string().uuid().optional(),
  bed_no: z.string().optional(),
  tariff_id: z.string().uuid().optional(),
  attending_doctor_id: z.string().uuid().optional(),
  admission_reason: z.string().optional(),
  meal_plan: z.string().optional(),
  // Ovqat va yarim kunlik tariflar — admit paytda tanlash mumkin.
  // meal_daily_uzs server tomonidan xonadan o'qib snapshot qilinadi,
  // lekin foydalanuvchi qo'lda override qila oladi (xonada narx yo'q bo'lsa).
  with_meal: z.boolean().default(false),
  meal_daily_uzs_override: z.number().int().nonnegative().optional(),
  is_half_day: z.boolean().default(false),
  planned_discharge_at: z.string().datetime().optional(),
  referral_id: z.string().uuid().optional(),
  initial_deposit_uzs: z.number().int().nonnegative().optional(),
});

const MealPeriodAddSchema = z.object({
  stay_id: z.string().uuid(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  daily_uzs: z.number().int().nonnegative(),
});

const MealPeriodEndSchema = z.object({
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const TransferSchema = z.object({
  room_id: z.string().uuid(),
  bed_no: z.string().optional(),
  reason: z.string().optional(),
});

const VitalsSchema = z.object({
  temperature_c: z.number().optional(),
  pulse_bpm: z.number().int().optional(),
  systolic_mmhg: z.number().int().optional(),
  diastolic_mmhg: z.number().int().optional(),
  respiration_rate: z.number().int().optional(),
  oxygen_saturation: z.number().int().optional(),
  weight_kg: z.number().optional(),
  height_cm: z.number().int().optional(),
  notes: z.string().optional(),
});

const CareItemSchema = z.object({
  stay_id: z.string().uuid(),
  kind: z.enum(['medication', 'injection', 'procedure', 'examination', 'observation', 'note']),
  title: z.string().min(1),
  medication_id: z.string().uuid().optional(),
  dosage: z.string().optional(),
  quantity: z.number().int().min(1).default(1),
  route: z.string().optional(),
  scheduled_at: z.string().datetime(),
  assigned_to: z.string().uuid().optional(),
  notes: z.string().optional(),
});

const CareItemPerformSchema = z.object({
  notes: z.string().optional(),
});

const AssignmentSchema = z.object({
  profile_id: z.string().uuid(),
  role: z.enum(['doctor', 'nurse']),
});

const LedgerSchema = z.object({
  patient_id: z.string().uuid(),
  stay_id: z.string().uuid().optional(),
  entry_kind: z.enum(['deposit', 'charge', 'refund', 'adjustment']),
  amount_uzs: z.number().int(),
  description: z.string().optional(),
  // Deposit/refund kassaga (transactions) ham yoziladi — to'lov usuli kerak.
  payment_method: z
    .enum(['cash', 'card', 'transfer', 'click', 'payme', 'humo', 'uzcard'])
    .optional(),
});

// Sprint 2C: discharge schema
const DischargeSchema = z.object({
  summary: z.string().optional(),
  discharge_reason: z.enum([
    'recovery',
    'treatment_refused',
    'negative_review',
    'admin',
    'transferred',
    'deceased',
    'other',
  ]),
  discharge_payment_method: z
    .enum(['cash', 'card', 'transfer', 'click', 'payme', 'humo', 'uzcard'])
    .optional(),
  paid_amount_uzs: z.number().int().nonnegative().default(0),
  // Outstanding > paid bo'lsa va force=false → 400.
  // Force=true: admin "qarz bilan chiqarish" tasdiqlagan (discharged_with_debt=true).
  force: z.boolean().default(false),
  // discharge_reason='deceased' uchun: write-off qilinsinmi (avto adjustment).
  deceased_writeoff: z.boolean().default(false),
  // Bemorda ijobiy depozit qoldig'i bo'lsa — operator uni qaytarishni tanlasa,
  // ledger'ga refund + kassaga chiqim yoziladi.
  refund_deposit: z.boolean().default(false),
});

// Sprint 2C: stay daily_extras tahrirlash
const UpdateStayExtrasSchema = z.object({
  daily_extras_uzs: z.number().int().nonnegative(),
});

// Sprint 2C: room_included_services upsert
const IncludedServiceSchema = z.object({
  room_id: z.string().uuid(),
  service_id: z.string().uuid(),
  frequency_per_week: z.number().int().min(1).max(14).default(1),
  notes: z.string().optional(),
});

@Injectable()
class InpatientService {
  private readonly log = new Logger('InpatientService');

  constructor(private readonly supabase: SupabaseService) {}

  // Kunlik to'lov hisoblash — Toshkent yarim tunidan keyin (00:10).
  // pg_cron ham buni qiladi (5 19 * * * UTC = 00:05 Toshkent). Agar Supabase
  // planida pg_cron yo'q bo'lsa, NestJS cron'i ham bir xil RPC chaqiradi.
  // RPC IDEMPOTENT — last_charged_date < cutoff filtri tufayli ikkala
  // ishlasa ham qo'sh charge bo'lmaydi.
  @Cron('10 0 * * *', {
    name: 'inpatient-daily-charge-fallback',
    timeZone: 'Asia/Tashkent',
  })
  async dailyChargeFallback() {
    try {
      const { data, error } = await this.supabase
        .admin()
        .rpc('charge_daily_inpatient_stays' as never);
      if (error) {
        this.log.error('charge_daily_inpatient_stays xato:', error.message);
        return;
      }
      const count = (data as number | null) ?? 0;
      if (count > 0) {
        this.log.log(`Statsionar kunlik: ${count} yozuv ledger'ga qo'shildi`);
      }
    } catch (e) {
      this.log.error('charge_daily_inpatient_stays exception:', (e as Error).message);
    }
  }

  async list(clinicId: string, opts: { status?: string } = {}) {
    const admin = this.supabase.admin();
    let q = admin
      .from('inpatient_stays')
      .select(
        '*, patient:patients(id, full_name, phone, dob, gender), room:rooms(id, number, section, floor, building, daily_price_uzs), doctor:profiles!attending_doctor_id(id, full_name)',
      )
      .eq('clinic_id', clinicId)
      .order('admitted_at', { ascending: false });
    if (opts.status) q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Bitta stay batafsil — barcha bog'liq ma'lumotlar bilan
  async getStay(clinicId: string, stayId: string) {
    const admin = this.supabase.admin();

    // 1) Stay + bog'liq ma'lumotlar (patient, room, doctor)
    const { data: stay, error } = await admin
      .from('inpatient_stays')
      .select(
        `*,
         patient:patients(id, full_name, phone, dob, gender, address),
         room:rooms(id, number, section, floor, building, daily_price_uzs, half_day_price_uzs, meal_daily_uzs, capacity, type, tier),
         doctor:profiles!attending_doctor_id(id, full_name, phone)`,
      )
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!stay) throw new NotFoundException('Stay topilmadi');

    const s = stay as unknown as { id: string; patient_id: string };

    // 2) Ledger (charges, deposits, refunds — to'liq tarix)
    const { data: ledger } = await admin
      .from('patient_ledger')
      .select('id, entry_kind, amount_uzs, description, created_at, recorded_by, balance_after_uzs')
      .eq('clinic_id', clinicId)
      .eq('patient_id', s.patient_id)
      .eq('stay_id', s.id)
      .order('created_at', { ascending: false });

    // 3) Balans (umumiy)
    const balance = (ledger ?? []).reduce(
      (sum: number, r: { amount_uzs: number }) => sum + Number(r.amount_uzs ?? 0),
      0,
    );

    // 4) Ovqat oraliqlari
    const { data: mealPeriods } = await admin
      .from('inpatient_meal_periods')
      .select('id, from_date, to_date, daily_uzs, created_at')
      .eq('stay_id', s.id)
      .order('from_date', { ascending: true });

    // 5) Xodimlar (assignments)
    const { data: assignments } = await admin
      .from('inpatient_assignments')
      .select(
        'id, profile_id, role, assigned_at, removed_at, profile:profiles!profile_id(id, full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('stay_id', s.id)
      .is('removed_at', null);

    // 6) Care items (hamshira ishlari)
    const { data: careItems } = await admin
      .from('care_items')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('stay_id', s.id)
      .order('scheduled_at', { ascending: false })
      .limit(100);

    // 7) Vitals (so'nggi 20 ta)
    const { data: vitals } = await admin
      .from('patient_vitals')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('patient_id', s.patient_id)
      .order('measured_at', { ascending: false })
      .limit(20);

    return {
      stay,
      ledger: ledger ?? [],
      balance,
      meal_periods: mealPeriods ?? [],
      assignments: assignments ?? [],
      care_items: careItems ?? [],
      vitals: vitals ?? [],
    };
  }

  async roomMap(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: rooms }, { data: stays }] = await Promise.all([
      admin
        .from('rooms')
        .select(
          'id, number, floor, section, building, capacity, daily_price_uzs, half_day_price_uzs, meal_daily_uzs, status, type, tier, includes_meals, notes',
        )
        .eq('clinic_id', clinicId)
        .eq('is_archived', false)
        .order('building', { ascending: true, nullsFirst: true })
        .order('floor', { ascending: true })
        .order('number', { ascending: true }),
      admin
        .from('inpatient_stays')
        .select('id, room_id, bed_no, patient:patients(id, full_name), admitted_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'admitted'),
    ]);

    const occ = new Map<string, Array<{ id: string; bed_no: string | null; patient: { id: string; full_name: string } | null; admitted_at: string }>>();
    for (const s of (stays ?? []) as unknown as Array<{
      id: string;
      room_id: string | null;
      bed_no: string | null;
      patient: { id: string; full_name: string } | null;
      admitted_at: string;
    }>) {
      if (!s.room_id) continue;
      if (!occ.has(s.room_id)) occ.set(s.room_id, []);
      occ.get(s.room_id)!.push({
        id: s.id,
        bed_no: s.bed_no,
        patient: s.patient,
        admitted_at: s.admitted_at,
      });
    }

    type RoomRow = {
      id: string;
      number: string;
      floor: number | null;
      section: string | null;
      building: string | null;
      capacity: number;
      daily_price_uzs: number | null;
      half_day_price_uzs: number | null;
      meal_daily_uzs: number | null;
      status: string;
      type: string | null;
      tier: string | null;
      includes_meals: boolean;
      notes: string | null;
    };

    // 1) Avval bino bo'yicha guruhlash, har binoning ichida etaj bo'yicha.
    const byBuilding = new Map<string, Map<number, Array<Record<string, unknown>>>>();
    // 2) Backward-compat: floors[] ham qaytariladi (eski mijozlar uchun).
    const byFloor = new Map<number, Array<Record<string, unknown>>>();

    for (const r of (rooms ?? []) as unknown as RoomRow[]) {
      // Building qiymatini normalize qilamiz: trim + birinchi harfni katta qilish,
      // shu bilan "a bino", "A bino ", "a bino " kabi farqlar bitta guruhga birlashadi.
      const rawBuilding = (r.building ?? '').trim();
      const building = rawBuilding
        ? rawBuilding.charAt(0).toUpperCase() + rawBuilding.slice(1).toLowerCase()
        : 'Asosiy bino';
      const floor = r.floor ?? 0;
      const occupants = occ.get(r.id) ?? [];
      const enriched = {
        ...r,
        occupants,
        occupied: occupants.length,
        vacancy: Math.max(0, r.capacity - occupants.length),
      };
      if (!byBuilding.has(building)) byBuilding.set(building, new Map());
      const floorsMap = byBuilding.get(building)!;
      if (!floorsMap.has(floor)) floorsMap.set(floor, []);
      floorsMap.get(floor)!.push(enriched);

      if (!byFloor.has(floor)) byFloor.set(floor, []);
      byFloor.get(floor)!.push(enriched);
    }

    const buildings = Array.from(byBuilding.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([building, floorsMap]) => ({
        building,
        floors: Array.from(floorsMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([floor, rs]) => ({ floor, rooms: rs })),
      }));

    return {
      buildings,
      floors: Array.from(byFloor.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([floor, rs]) => ({ floor, rooms: rs })),
    };
  }

  async admit(clinicId: string, userId: string, input: z.infer<typeof AdmitSchema>) {
    const admin = this.supabase.admin();
    if (input.room_id) {
      await this.assertRoomCapacity(clinicId, input.room_id);
    }

    // Xona narxlarini snapshot qilish — keyin xona narxi o'zgartirilsa ham
    // bemorga ta'sir qilmaydi (audit izi).
    let mealSnapshot: number | null = null;
    if (input.with_meal) {
      // 1-ustuvor: foydalanuvchi qo'lda kiritgan override
      if (input.meal_daily_uzs_override != null && input.meal_daily_uzs_override > 0) {
        mealSnapshot = input.meal_daily_uzs_override;
      } else if (input.room_id) {
        // 2-ustuvor: xonadan default narx
        const { data: room } = await admin
          .from('rooms')
          .select('meal_daily_uzs')
          .eq('id', input.room_id)
          .maybeSingle();
        mealSnapshot = (room as { meal_daily_uzs: number | null } | null)?.meal_daily_uzs ?? 0;
      }
    }

    const { data: stay, error } = await admin
      .from('inpatient_stays')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        room_id: input.room_id ?? null,
        bed_no: input.bed_no ?? null,
        tariff_id: input.tariff_id ?? null,
        attending_doctor_id: input.attending_doctor_id ?? null,
        admission_reason: input.admission_reason ?? null,
        meal_plan: input.meal_plan ?? null,
        with_meal: input.with_meal,
        meal_daily_uzs: mealSnapshot,
        is_half_day: input.is_half_day,
        planned_discharge_at: input.planned_discharge_at ?? null,
        admitted_at: new Date().toISOString(),
        status: 'admitted',
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // Ovqat bilan qabul qilingan bo'lsa — boshlang'ich meal period yaratamiz
    // (from_date = bugungi Toshkent kuni, to_date NULL = ochiq).
    if (input.with_meal && mealSnapshot != null && mealSnapshot > 0) {
      const stayId = (stay as unknown as { id: string }).id;
      const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }))
        .toISOString()
        .slice(0, 10);
      await admin.from('inpatient_meal_periods').insert({
        stay_id: stayId,
        from_date: today,
        to_date: null,
        daily_uzs: mealSnapshot,
        created_by: userId,
      });
    }

    if (input.initial_deposit_uzs && input.initial_deposit_uzs > 0) {
      await this.recordLedger(clinicId, userId, {
        patient_id: input.patient_id,
        stay_id: (stay as unknown as { id: string }).id,
        entry_kind: 'deposit',
        amount_uzs: input.initial_deposit_uzs,
        description: 'Statsionar boshlang\u2018ich depozit',
      });
    }

    if (input.referral_id) {
      await admin
        .from('service_referrals')
        .update({ status: 'received' })
        .eq('clinic_id', clinicId)
        .eq('id', input.referral_id);
    }

    return stay;
  }

  async transfer(
    clinicId: string,
    userId: string | null,
    stayId: string,
    body: z.infer<typeof TransferSchema>,
  ) {
    await this.assertRoomCapacity(clinicId, body.room_id);
    const admin = this.supabase.admin();

    // 1) Mavjud stay'ning xona/yotog'ini olish (audit log uchun)
    const { data: oldStay } = await admin
      .from('inpatient_stays')
      .select('room_id, bed_no')
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .maybeSingle();
    const fromRoomId =
      (oldStay as { room_id: string | null } | null)?.room_id ?? null;
    const fromBedNo =
      (oldStay as { bed_no: string | null } | null)?.bed_no ?? null;

    // 2) Stay'ni yangilash — endi attending_notes'ga override qilmaymiz
    // (eski notlar saqlanadi). Sabab alohida transfers jadvalda.
    const { data, error } = await admin
      .from('inpatient_stays')
      .update({
        room_id: body.room_id,
        bed_no: body.bed_no ?? null,
      })
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // 3) Audit: inpatient_transfers ga qator yozish (jurnal uchun)
    if (fromRoomId !== body.room_id || fromBedNo !== (body.bed_no ?? null)) {
      await admin.from('inpatient_transfers').insert({
        clinic_id: clinicId,
        stay_id: stayId,
        from_room_id: fromRoomId,
        to_room_id: body.room_id,
        from_bed_no: fromBedNo,
        to_bed_no: body.bed_no ?? null,
        reason: body.reason ?? null,
        transferred_by: userId,
      });
    }

    return data;
  }

  // ============ Ovqat oraliqlari (meal periods) ============
  // Tenant izolyatsiyasi: avval stay'ning clinic_id'sini tekshiramiz.
  private async assertStayClinic(clinicId: string, stayId: string): Promise<void> {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('inpatient_stays')
      .select('id')
      .eq('id', stayId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Stay topilmadi');
  }

  async listMealPeriods(clinicId: string, stayId: string) {
    await this.assertStayClinic(clinicId, stayId);
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('inpatient_meal_periods')
      .select('id, stay_id, from_date, to_date, daily_uzs, created_at')
      .eq('stay_id', stayId)
      .order('from_date', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async addMealPeriod(clinicId: string, userId: string, input: z.infer<typeof MealPeriodAddSchema>) {
    await this.assertStayClinic(clinicId, input.stay_id);
    const admin = this.supabase.admin();
    // Avval ochiq period bo'lsa — uni yangi from_date - 1 da yopamiz
    // (ovqat to'xtatib qayta yoqilgan bo'lsa, eski oraliq tugagan deb hisoblanadi).
    const prevDay = new Date(input.from_date);
    prevDay.setDate(prevDay.getDate() - 1);
    const prevDayStr = prevDay.toISOString().slice(0, 10);
    await admin
      .from('inpatient_meal_periods')
      .update({ to_date: prevDayStr })
      .eq('stay_id', input.stay_id)
      .is('to_date', null);

    const { data, error } = await admin
      .from('inpatient_meal_periods')
      .insert({
        stay_id: input.stay_id,
        from_date: input.from_date,
        to_date: input.to_date ?? null,
        daily_uzs: input.daily_uzs,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async endMealPeriod(clinicId: string, periodId: string, input: z.infer<typeof MealPeriodEndSchema>) {
    const admin = this.supabase.admin();
    // Tenant tekshiruv: period stay_id orqali clinic'ga tegishlimi?
    const { data: period } = await admin
      .from('inpatient_meal_periods')
      .select('id, stay_id, inpatient_stays!inner(clinic_id)')
      .eq('id', periodId)
      .maybeSingle();
    const periodClinic = (period as unknown as { inpatient_stays?: { clinic_id?: string } } | null)
      ?.inpatient_stays?.clinic_id;
    if (!period || periodClinic !== clinicId) {
      throw new NotFoundException('Ovqat oralig‘i topilmadi');
    }
    const { data, error } = await admin
      .from('inpatient_meal_periods')
      .update({ to_date: input.to_date })
      .eq('id', periodId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async discharge(
    clinicId: string,
    userId: string,
    id: string,
    input: z.infer<typeof DischargeSchema>,
  ) {
    const admin = this.supabase.admin();

    const { data: stayRow, error: stayErr } = await admin
      .from('inpatient_stays')
      .select('id, patient_id, status, discharged_at')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (stayErr) throw new BadRequestException(stayErr.message);
    if (!stayRow) throw new NotFoundException('Stay not found');
    const stay = stayRow as { id: string; patient_id: string; status: string; discharged_at: string | null };
    if (stay.discharged_at || stay.status === 'discharged') {
      throw new BadRequestException('Stay allaqachon chiqarilgan');
    }

    // Joriy outstanding (manfiy balance = qarz)
    const { data: balRow } = await admin
      .from('patient_balance')
      .select('balance_uzs')
      .eq('clinic_id', clinicId)
      .eq('patient_id', stay.patient_id)
      .maybeSingle();
    const balance = Number((balRow as { balance_uzs?: number | string } | null)?.balance_uzs ?? 0);
    const outstanding = balance < 0 ? -balance : 0;

    const deceasedWriteoff = input.discharge_reason === 'deceased' && input.deceased_writeoff;

    if (!deceasedWriteoff) {
      // Paid amount validatsiyasi
      const paid = input.paid_amount_uzs ?? 0;
      if (paid < outstanding && !input.force) {
        throw new BadRequestException(
          `Qoldiq ${outstanding} so'm. To'liq to'lov yoki "qarz bilan chiqarish" kerak.`,
        );
      }

      // Paid > 0 bo'lsa ledger'ga deposit yozamiz
      if (paid > 0) {
        await admin.from('patient_ledger').insert({
          clinic_id: clinicId,
          patient_id: stay.patient_id,
          stay_id: id,
          entry_kind: 'deposit',
          amount_uzs: paid,
          description:
            'Discharge to‘lov' +
            (input.discharge_payment_method ? ` (${input.discharge_payment_method})` : ''),
          recorded_by: userId,
        });
      }
    } else {
      // Deceased write-off: outstanding'ni adjustment bilan 0 ga keltiramiz
      if (outstanding > 0) {
        await admin.from('patient_ledger').insert({
          clinic_id: clinicId,
          patient_id: stay.patient_id,
          stay_id: id,
          entry_kind: 'adjustment',
          amount_uzs: outstanding,
          description: 'Vafot etgan: balance write-off',
          recorded_by: userId,
        });
      }
    }

    const dischargedWithDebt =
      !deceasedWriteoff && input.force && input.paid_amount_uzs < outstanding;

    const { data, error } = await admin
      .from('inpatient_stays')
      .update({
        discharged_at: new Date().toISOString(),
        discharge_summary: input.summary ?? null,
        discharge_reason: input.discharge_reason,
        discharge_payment_method: input.discharge_payment_method ?? null,
        outstanding_settled_uzs: deceasedWriteoff ? outstanding : input.paid_amount_uzs,
        deceased_writeoff: deceasedWriteoff,
        discharged_with_debt: dischargedWithDebt,
        status: 'discharged',
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // Depozit qaytarish — operator tanlasa (refund_deposit=true) va bemorda
    // ijobiy qoldiq bo'lsa. recordLedger refund'ni ledger + kassaga yozadi.
    let depositRefundedUzs = 0;
    if (input.refund_deposit && balance > 0 && !deceasedWriteoff) {
      await this.recordLedger(clinicId, userId, {
        patient_id: stay.patient_id,
        stay_id: id,
        entry_kind: 'refund',
        amount_uzs: balance,
        description: 'Statsionar depozit qoldig‘i qaytarildi (chiqarish)',
        payment_method: input.discharge_payment_method ?? 'cash',
      });
      depositRefundedUzs = balance;
    }

    return { ...(data as Record<string, unknown>), deposit_refunded_uzs: depositRefundedUzs };
  }

  // Sprint 2C: stay balance + outstanding view
  async balance(clinicId: string, stayId: string) {
    const admin = this.supabase.admin();
    const { data: stay } = await admin
      .from('inpatient_stays')
      .select('id, patient_id, daily_extras_uzs, admitted_at, last_charged_date')
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .maybeSingle();
    if (!stay) throw new NotFoundException('Stay not found');
    const s = stay as { patient_id: string; daily_extras_uzs: number };
    const { data: bal } = await admin
      .from('patient_balance')
      .select('balance_uzs')
      .eq('clinic_id', clinicId)
      .eq('patient_id', s.patient_id)
      .maybeSingle();
    const balance = Number((bal as { balance_uzs?: number | string } | null)?.balance_uzs ?? 0);
    return {
      balance_uzs: balance,
      outstanding_uzs: balance < 0 ? -balance : 0,
      deposit_uzs: balance > 0 ? balance : 0,
      daily_extras_uzs: s.daily_extras_uzs ?? 0,
    };
  }

  async updateExtras(
    clinicId: string,
    stayId: string,
    input: z.infer<typeof UpdateStayExtrasSchema>,
  ) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('inpatient_stays')
      .update({ daily_extras_uzs: input.daily_extras_uzs })
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Sprint 2C: room_included_services CRUD
  async listIncludedServices(clinicId: string, roomId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('room_included_services')
      .select('*, service:services(id, name_i18n, price_uzs)')
      .eq('clinic_id', clinicId)
      .eq('room_id', roomId);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertIncludedService(
    clinicId: string,
    input: z.infer<typeof IncludedServiceSchema>,
  ) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('room_included_services')
      .upsert(
        { clinic_id: clinicId, ...input },
        { onConflict: 'room_id,service_id' },
      )
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteIncludedService(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { error } = await admin
      .from('room_included_services')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async recordVitals(clinicId: string, patientId: string, userId: string, input: z.infer<typeof VitalsSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('vital_signs')
      .insert({
        ...input,
        clinic_id: clinicId,
        patient_id: patientId,
        recorded_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listCareItems(clinicId: string, stayId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('care_items')
      .select('*, medication:medications(id, name), assignee:profiles!assigned_to(id, full_name)')
      .eq('clinic_id', clinicId)
      .eq('stay_id', stayId)
      .order('scheduled_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createCareItem(clinicId: string, userId: string, input: z.infer<typeof CareItemSchema>) {
    const admin = this.supabase.admin();
    const { data: stay } = await admin
      .from('inpatient_stays')
      .select('patient_id')
      .eq('clinic_id', clinicId)
      .eq('id', input.stay_id)
      .maybeSingle();
    if (!stay) throw new NotFoundException('Stay not found');
    const patientId = (stay as { patient_id: string }).patient_id;

    const { data, error } = await admin
      .from('care_items')
      .insert({
        clinic_id: clinicId,
        stay_id: input.stay_id,
        patient_id: patientId,
        kind: input.kind,
        title: input.title,
        medication_id: input.medication_id ?? null,
        dosage: input.dosage ?? null,
        quantity: input.quantity,
        route: input.route ?? null,
        scheduled_at: input.scheduled_at,
        assigned_to: input.assigned_to ?? null,
        notes: input.notes ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async performCareItem(clinicId: string, userId: string, id: string, notes?: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('care_items')
      .update({
        status: 'performed',
        performed_at: new Date().toISOString(),
        performed_by: userId,
        notes: notes ?? undefined,
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async skipCareItem(clinicId: string, id: string, reason: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('care_items')
      .update({ status: 'skipped', skip_reason: reason })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async ledger(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const [{ data: entries }, { data: balance }] = await Promise.all([
      admin
        .from('patient_ledger')
        .select('*, recorded_by_user:profiles!recorded_by(full_name)')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('patient_balance')
        .select('balance_uzs')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .maybeSingle(),
    ]);
    return {
      entries: entries ?? [],
      balance: Number(((balance as { balance_uzs?: number } | null)?.balance_uzs) ?? 0),
    };
  }

  async recordLedger(clinicId: string, userId: string, input: z.infer<typeof LedgerSchema>) {
    const admin = this.supabase.admin();
    const signedAmount =
      input.entry_kind === 'charge' || (input.entry_kind === 'adjustment' && input.amount_uzs < 0)
        ? -Math.abs(input.amount_uzs)
        : Math.abs(input.amount_uzs);

    // Deposit va refund — pul harakati. Bularni kassaga (transactions) ham
    // yozamiz, shunda kassa hisoboti va jurnal deposit'ni ko'radi.
    // charge/adjustment — ichki hisob-kitob, transactions'ga yozilmaydi.
    let transactionId: string | null = null;
    if (input.entry_kind === 'deposit' || input.entry_kind === 'refund') {
      const { data: tx, error: txErr } = await admin
        .from('transactions')
        .insert({
          clinic_id: clinicId,
          patient_id: input.patient_id,
          stay_id: input.stay_id ?? null,
          cashier_id: userId,
          kind: 'payment',
          amount_uzs:
            input.entry_kind === 'refund'
              ? -Math.abs(input.amount_uzs)
              : Math.abs(input.amount_uzs),
          payment_method: input.payment_method ?? 'cash',
          notes:
            input.description ??
            (input.entry_kind === 'deposit'
              ? 'Statsionar depozit'
              : 'Statsionar depozit qaytarish'),
        })
        .select('id')
        .single();
      if (txErr) throw new BadRequestException(txErr.message);
      transactionId = (tx as { id: string }).id;
    }

    const { data, error } = await admin
      .from('patient_ledger')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        stay_id: input.stay_id ?? null,
        entry_kind: input.entry_kind,
        amount_uzs: signedAmount,
        description: input.description ?? null,
        transaction_id: transactionId,
        recorded_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listAssignments(clinicId: string, stayId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('stay_assignments')
      .select('*, profile:profiles(id, full_name, role)')
      .eq('clinic_id', clinicId)
      .eq('stay_id', stayId)
      .order('assigned_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async addAssignment(clinicId: string, userId: string, stayId: string, input: z.infer<typeof AssignmentSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('stay_assignments')
      .upsert({
        clinic_id: clinicId,
        stay_id: stayId,
        profile_id: input.profile_id,
        role: input.role,
        assigned_by: userId,
      }, { onConflict: 'stay_id,profile_id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async removeAssignment(clinicId: string, stayId: string, profileId: string) {
    const { error } = await this.supabase.admin()
      .from('stay_assignments')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('stay_id', stayId)
      .eq('profile_id', profileId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async listCareItemsByDate(clinicId: string, date: string) {
    const admin = this.supabase.admin();
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;
    const { data, error } = await admin
      .from('care_items')
      .select('*, medication:medications(id, name), assignee:profiles!assigned_to(id, full_name), patient:patients!patient_id(id, full_name), stay:inpatient_stays!stay_id(id, bed_no, room:rooms(number))')
      .eq('clinic_id', clinicId)
      .gte('scheduled_at', from)
      .lte('scheduled_at', to)
      .order('scheduled_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private async assertRoomCapacity(clinicId: string, roomId: string) {
    const admin = this.supabase.admin();
    const [{ data: room }, { count }] = await Promise.all([
      admin
        .from('rooms')
        .select('id, capacity')
        .eq('clinic_id', clinicId)
        .eq('id', roomId)
        .maybeSingle(),
      admin
        .from('inpatient_stays')
        .select('*', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('room_id', roomId)
        .eq('status', 'admitted'),
    ]);
    if (!room) throw new NotFoundException('Room not found');
    const capacity = Number((room as { capacity: number }).capacity) || 1;
    if ((count ?? 0) >= capacity) {
      throw new BadRequestException('Xona bo\u2018sh joyi yo\u2018q');
    }
  }
}

@ApiTags('inpatient')
@Controller({ path: 'inpatient', version: '1' })
class InpatientController {
  constructor(private readonly svc: InpatientService) {}

  @Get()
  list(@CurrentUser() u: { clinicId: string | null }, @Query('status') status?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, { status });
  }

  @Get('room-map')
  roomMap(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.roomMap(u.clinicId);
  }

  // Bitta stay batafsil — patient, room, doctor, ledger, balance, meal periods,
  // assignments, care items, vitals
  @Get('stays/:id')
  getStay(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getStay(u.clinicId, id);
  }

  @Post('admit')
  @Audit({ action: 'inpatient.admitted', resourceType: 'inpatient_stays' })
  admit(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.admit(u.clinicId, u.userId, AdmitSchema.parse(body));
  }

  @Get(':id/meal-periods')
  listMealPeriods(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listMealPeriods(u.clinicId, id);
  }

  @Post('meal-periods')
  @Audit({ action: 'inpatient.meal_period_added', resourceType: 'inpatient_meal_periods' })
  addMealPeriod(
    @CurrentUser() u: { clinicId: string | null; userId: string },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.addMealPeriod(u.clinicId, u.userId, MealPeriodAddSchema.parse(body));
  }

  @Patch('meal-periods/:id/end')
  @Audit({ action: 'inpatient.meal_period_ended', resourceType: 'inpatient_meal_periods' })
  endMealPeriod(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.endMealPeriod(u.clinicId, id, MealPeriodEndSchema.parse(body));
  }

  @Patch(':id/transfer')
  @Audit({ action: 'inpatient.transferred', resourceType: 'inpatient_stays' })
  transfer(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.transfer(u.clinicId, u.userId, id, TransferSchema.parse(body));
  }

  @Patch(':id/discharge')
  @Audit({ action: 'inpatient.discharged', resourceType: 'inpatient_stays' })
  discharge(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.discharge(u.clinicId, u.userId, id, DischargeSchema.parse(body));
  }

  // Sprint 2C: stay balance + extras + included services
  @Get(':id/balance')
  balance(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.balance(u.clinicId, id);
  }

  @Patch(':id/extras')
  @Audit({ action: 'inpatient.extras_updated', resourceType: 'inpatient_stays' })
  updateExtras(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateExtras(u.clinicId, id, UpdateStayExtrasSchema.parse(body));
  }

  @Get('rooms/:roomId/included-services')
  listIncludedServices(
    @CurrentUser() u: { clinicId: string | null },
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listIncludedServices(u.clinicId, roomId);
  }

  @Post('rooms/included-services')
  @Audit({ action: 'room_included_service.upserted', resourceType: 'room_included_services' })
  upsertIncludedService(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.upsertIncludedService(u.clinicId, IncludedServiceSchema.parse(body));
  }

  @Patch('rooms/included-services/:id/delete')
  @Audit({ action: 'room_included_service.deleted', resourceType: 'room_included_services' })
  deleteIncludedService(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteIncludedService(u.clinicId, id);
  }

  @Post('patients/:patientId/vitals')
  @Audit({ action: 'inpatient.vitals_recorded', resourceType: 'vital_signs' })
  vitals(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.recordVitals(u.clinicId, patientId, u.userId, VitalsSchema.parse(body));
  }

  // --- Care items (schedule) ---
  @Get(':stayId/care-items')
  careItems(
    @CurrentUser() u: { clinicId: string | null },
    @Param('stayId', ParseUUIDPipe) stayId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listCareItems(u.clinicId, stayId);
  }

  @Post('care-items')
  @Audit({ action: 'care.scheduled', resourceType: 'care_items' })
  createCareItem(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createCareItem(u.clinicId, u.userId, CareItemSchema.parse(body));
  }

  @Patch('care-items/:id/perform')
  @Audit({ action: 'care.performed', resourceType: 'care_items' })
  performCareItem(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const { notes } = CareItemPerformSchema.parse(body ?? {});
    return this.svc.performCareItem(u.clinicId, u.userId, id, notes);
  }

  @Patch('care-items/:id/skip')
  @Audit({ action: 'care.skipped', resourceType: 'care_items' })
  skipCareItem(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.skipCareItem(u.clinicId, id, body?.reason ?? 'skipped');
  }

  // --- Staff assignments ---
  @Get(':stayId/assignments')
  listAssignments(
    @CurrentUser() u: { clinicId: string | null },
    @Param('stayId', ParseUUIDPipe) stayId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listAssignments(u.clinicId, stayId);
  }

  @Post(':stayId/assignments')
  @Audit({ action: 'inpatient.staff_assigned', resourceType: 'stay_assignments' })
  addAssignment(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('stayId', ParseUUIDPipe) stayId: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.addAssignment(u.clinicId, u.userId, stayId, AssignmentSchema.parse(body));
  }

  @Post(':stayId/assignments/:profileId/remove')
  @Audit({ action: 'inpatient.staff_unassigned', resourceType: 'stay_assignments' })
  removeAssignment(
    @CurrentUser() u: { clinicId: string | null },
    @Param('stayId', ParseUUIDPipe) stayId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.removeAssignment(u.clinicId, stayId, profileId);
  }

  @Get('schedule')
  schedule(
    @CurrentUser() u: { clinicId: string | null },
    @Query('date') date?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const d = date ?? new Date().toISOString().slice(0, 10);
    return this.svc.listCareItemsByDate(u.clinicId, d);
  }

  // --- Patient ledger (wallet) ---
  @Get('patients/:patientId/ledger')
  ledger(
    @CurrentUser() u: { clinicId: string | null },
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.ledger(u.clinicId, patientId);
  }

  @Post('ledger')
  @Audit({ action: 'ledger.entry', resourceType: 'patient_ledger' })
  addLedger(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.recordLedger(u.clinicId, u.userId, LedgerSchema.parse(body));
  }
}

@Module({
  controllers: [InpatientController],
  providers: [InpatientService, SupabaseService],
  exports: [InpatientService],
})
export class InpatientModule {}
