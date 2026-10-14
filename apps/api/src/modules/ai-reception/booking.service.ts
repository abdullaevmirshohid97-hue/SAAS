import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  addDays,
  computeFreeSlots,
  doctorCredentials,
  doctorRank,
  formatHm,
  identityNames,
  isWithinSchedule,
  localDateOf,
  localMidnightUtcMs,
  localTimeOf,
  parseHm,
  phoneIlikePattern,
  phoneKey,
  samePatientIdentity,
  scheduleSummary,
  specialtyGroupKey,
  specialtyKey,
  specialtyLabel,
  splitFullName,
  weekdayOf,
  type FreeSlot,
} from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';
import { ReceptionService } from '../reception/reception.module';

import type {
  AiReceptionSettings,
  BookingSource,
  DoctorEntry,
  DoctorRule,
  DoctorTimeOff,
} from './ai-reception.types';
import { PatientNotifierService } from './patient-notifier.service';
import { AiReceptionSettingsService, schemaError } from './settings.service';

// =============================================================================
// NAVBAT DVIGATELI — shifokorlar katalogi, jadval, bo'sh vaqt, band qilish
// =============================================================================
// Kanallar (AI telefon, Telegram, AI chat, qabulxona) shu bitta servis orqali
// yozadi. Poyga holatidan himoya — `booking_reserve()` RPC (advisory lock).
// =============================================================================

/** Navbat beriladigan lavozimlar (anketada). Profil yaratilgan boshqalar ham kiradi. */
const BOOKABLE_POSITIONS = ['doctor', 'nurse', 'lab_tech'];

export type BookingErrorCode =
  | 'SLOT_TAKEN'
  | 'ALREADY_BOOKED'
  | 'SLOT_IN_PAST'
  | 'TOO_SOON'
  | 'TOO_FAR'
  | 'OUTSIDE_SCHEDULE'
  | 'DOCTOR_OFF'
  | 'CLINIC_CLOSED'
  | 'BOOKING_DISABLED'
  | 'PATIENT_NAME_REQUIRED'
  | 'PHONE_REQUIRED'
  | 'NEW_PATIENT_NOT_ALLOWED'
  | 'DOCTOR_PROFILE'
  | 'UNKNOWN_DOCTOR';

export const BOOKING_ERROR_TEXT: Record<BookingErrorCode, string> = {
  SLOT_TAKEN: "Bu vaqt hozirgina band bo'ldi",
  ALREADY_BOOKED: 'Bemor shu kuni shu shifokorga allaqachon yozilgan',
  SLOT_IN_PAST: "Bu vaqt o'tib ketgan",
  TOO_SOON: 'Bu vaqt juda yaqin — keyingi vaqtlardan birini tanlang',
  TOO_FAR: "Bu sana navbat berish oralig'idan tashqarida",
  OUTSIDE_SCHEDULE: 'Shifokor bu vaqtda qabul qilmaydi',
  DOCTOR_OFF: 'Shifokor bu vaqtda ishda emas',
  CLINIC_CLOSED: 'Klinika bu kuni dam oladi',
  BOOKING_DISABLED: 'Bu shifokorga online navbat yopiq',
  PATIENT_NAME_REQUIRED: 'Bemorning familiyasi va ismi kerak',
  PHONE_REQUIRED: 'Telefon raqami kerak (9 ta raqam)',
  NEW_PATIENT_NOT_ALLOWED: 'Yangi bemorlarni faqat qabulxona yozadi',
  DOCTOR_PROFILE: 'Shifokor profili topilmadi',
  UNKNOWN_DOCTOR: "Bunday shifokor ro'yxatda yo'q",
};

export class BookingError extends BadRequestException {
  constructor(
    readonly code: BookingErrorCode,
    message: string = BOOKING_ERROR_TEXT[code],
  ) {
    super({ message, error: code });
  }
}

export interface DoctorProfileInput {
  booking_enabled?: boolean;
  medical_category?: string | null;
  academic_degree?: string | null;
  academic_title?: string | null;
  experience_years?: number | null;
  slot_minutes?: number;
  keywords?: string[];
  public_note?: string | null;
  service_id?: string | null;
  sort_order?: number;
  rules?: Array<{ weekday: number; start_time: string; end_time: string; capacity?: number }>;
}

export interface ReserveInput {
  staffId: string;
  startIso: string;
  patient: { id?: string | null; full_name?: string | null; phone?: string | null };
  reason?: string | null;
  notes?: string | null;
  source: BookingSource;
  callId?: string | null;
  /** Qabulxona xodimi (source='staff'). Bo'lmasa — klinika egasi nomidan. */
  actorId?: string | null;
  /** Sinov: hamma tekshiruv, lekin bazaga yozilmaydi. */
  dryRun?: boolean;
  /** Bildirishnoma yubormaslik (Telegram oqimi o'zi xabar beradi). */
  silent?: boolean;
}

export interface ReserveResult {
  appointment_id: string | null;
  patient_id: string | null;
  patient_name: string;
  patient_phone: string | null;
  starts_at: string;
  date: string;
  time: string;
  doctor: DoctorEntry;
  price_uzs: number | null;
  dry_run: boolean;
  new_patient: boolean;
}

export interface UpcomingForPhone {
  appointment_id: string;
  clinic_id: string;
  clinic_name: string;
  patient_name: string;
  doctor_name: string;
  scheduled_at: string;
  date: string;
  time: string;
  confirmed: boolean;
}

/**
 * '+998XXXXXXXXX' — Telegram bog'lanishlari ham shu ko'rinishda saqlanadi.
 * Faqat O'zbekiston raqami: 9 raqam (90 123 45 67) yoki 998 bilan 12 raqam.
 * Chet el raqami (+7..., +1...) yoki yashirin raqam → null (AI raqamni so'raydi).
 */
export function normalizeUzPhone(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  if (d.length === 14 && d.startsWith('00998')) return `+${d.slice(2)}`;
  return null;
}

@Injectable()
export class BookingService {
  private readonly log = new Logger('Booking');
  private readonly dirCache = new Map<string, { at: number; list: DoctorEntry[] }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: AiReceptionSettingsService,
    private readonly reception: ReceptionService,
    private readonly notifier: PatientNotifierService,
  ) {}

  // ==========================================================================
  // Shifokorlar katalogi
  // ==========================================================================
  async directory(
    clinicId: string,
    opts: { onlyEnabled?: boolean; fresh?: boolean } = {},
  ): Promise<DoctorEntry[]> {
    const hit = this.dirCache.get(clinicId);
    let list: DoctorEntry[];
    if (!opts.fresh && hit && Date.now() - hit.at < 30_000) {
      list = hit.list;
    } else {
      list = await this.loadDirectory(clinicId);
      this.dirCache.set(clinicId, { at: Date.now(), list });
    }
    return opts.onlyEnabled ? list.filter((d) => d.booking_enabled && d.rules.length > 0) : list;
  }

  invalidate(clinicId: string) {
    this.dirCache.delete(clinicId);
  }

  private async loadDirectory(clinicId: string): Promise<DoctorEntry[]> {
    const admin = this.supabase.admin();
    const nowIso = new Date().toISOString();
    const [staffRes, profRes, rulesRes, offRes] = await Promise.all([
      admin
        .from('staff_profiles')
        .select(
          'id, clinic_id, profile_id, first_name, last_name, patronymic, position, specialization, photos, is_active',
        )
        .eq('clinic_id', clinicId)
        .eq('is_active', true),
      admin.from('doctor_booking_profiles').select('*').eq('clinic_id', clinicId),
      admin
        .from('doctor_schedule_rules')
        .select('id, staff_id, weekday, start_time, end_time, capacity')
        .eq('clinic_id', clinicId),
      admin
        .from('doctor_time_off')
        .select('id, staff_id, starts_at, ends_at, reason')
        .eq('clinic_id', clinicId)
        .gt('ends_at', nowIso)
        .order('starts_at'),
    ]);
    if (staffRes.error) throw new BadRequestException(staffRes.error.message);
    if (profRes.error) throw schemaError(profRes.error);
    if (rulesRes.error) throw schemaError(rulesRes.error);
    if (offRes.error) throw schemaError(offRes.error);

    type ProfRow = {
      staff_id: string;
      booking_enabled: boolean;
      medical_category: string | null;
      academic_degree: string | null;
      academic_title: string | null;
      experience_years: number | null;
      slot_minutes: number;
      keywords: string[] | null;
      public_note: string | null;
      service_id: string | null;
      sort_order: number;
    };
    const profiles = new Map(((profRes.data ?? []) as ProfRow[]).map((p) => [p.staff_id, p]));
    const rulesBy = new Map<string, DoctorRule[]>();
    for (const r of (rulesRes.data ?? []) as Array<DoctorRule & { staff_id: string }>) {
      const arr = rulesBy.get(r.staff_id) ?? [];
      arr.push({
        id: r.id,
        weekday: r.weekday,
        start_time: formatHm(parseHm(r.start_time)),
        end_time: formatHm(parseHm(r.end_time)),
        capacity: r.capacity ?? 1,
      });
      rulesBy.set(r.staff_id, arr);
    }
    const offBy = new Map<string, DoctorTimeOff[]>();
    for (const o of (offRes.data ?? []) as Array<DoctorTimeOff & { staff_id: string }>) {
      const arr = offBy.get(o.staff_id) ?? [];
      arr.push({ id: o.id, starts_at: o.starts_at, ends_at: o.ends_at, reason: o.reason });
      offBy.set(o.staff_id, arr);
    }

    const serviceIds = [...profiles.values()].map((p) => p.service_id).filter(Boolean) as string[];
    const services = new Map<string, { name: string | null; price: number | null }>();
    if (serviceIds.length) {
      const { data } = await admin
        .from('services')
        .select('id, name_i18n, price_uzs')
        .in('id', serviceIds);
      for (const s of (data ?? []) as Array<{
        id: string;
        name_i18n: Record<string, string> | null;
        price_uzs: number | null;
      }>) {
        const names = s.name_i18n ?? {};
        services.set(s.id, {
          name: names['uz-Latn'] ?? Object.values(names)[0] ?? null,
          price: s.price_uzs == null ? null : Number(s.price_uzs),
        });
      }
    }

    const rows = (staffRes.data ?? []) as Array<{
      id: string;
      clinic_id: string;
      profile_id: string | null;
      first_name: string;
      last_name: string;
      patronymic: string | null;
      position: string;
      specialization: string | null;
      photos: string[] | null;
    }>;

    const list: DoctorEntry[] = rows
      .filter((s) => BOOKABLE_POSITIONS.includes(s.position) || profiles.has(s.id))
      .map((s) => {
        const p = profiles.get(s.id);
        const rules = (rulesBy.get(s.id) ?? []).sort(
          (a, b) => a.weekday - b.weekday || parseHm(a.start_time) - parseHm(b.start_time),
        );
        const svc = p?.service_id ? services.get(p.service_id) : undefined;
        const key = specialtyKey(s.specialization);
        const cred = {
          medical_category: p?.medical_category ?? null,
          academic_degree: p?.academic_degree ?? null,
          academic_title: p?.academic_title ?? null,
          experience_years: p?.experience_years ?? null,
        };
        return {
          staff_id: s.id,
          clinic_id: s.clinic_id,
          profile_id: s.profile_id,
          full_name: [s.last_name, s.first_name, s.patronymic].filter(Boolean).join(' '),
          position: s.position,
          specialization: s.specialization,
          specialty_key: key,
          specialty_group: specialtyGroupKey(s.specialization),
          specialty_label: key
            ? specialtyLabel(key)
            : (s.specialization ?? '').trim() || 'Shifokor',
          photo_url: s.photos?.[0] ?? null,
          booking_enabled: p?.booking_enabled ?? false,
          ...cred,
          slot_minutes: p?.slot_minutes ?? 30,
          keywords: p?.keywords ?? [],
          public_note: p?.public_note ?? null,
          service_id: p?.service_id ?? null,
          service_name: svc?.name ?? null,
          service_price_uzs: svc?.price ?? null,
          sort_order: p?.sort_order ?? 0,
          rules,
          time_off: offBy.get(s.id) ?? [],
          credentials: doctorCredentials(cred),
          schedule_summary: scheduleSummary(rules),
        } satisfies DoctorEntry;
      });

    return list.sort(
      (a, b) =>
        Number(b.booking_enabled) - Number(a.booking_enabled) ||
        a.sort_order - b.sort_order ||
        doctorRank(b) - doctorRank(a) ||
        a.full_name.localeCompare(b.full_name),
    );
  }

  async findDoctor(clinicId: string, staffId: string, fresh = false): Promise<DoctorEntry> {
    const list = await this.directory(clinicId, { fresh });
    const d = list.find((x) => x.staff_id === staffId);
    if (!d) throw new NotFoundException('Shifokor topilmadi');
    return d;
  }

  /** appointment → klinika (Telegram eslatma tugmasidan kelganda). */
  async clinicOfAppointment(appointmentId: string): Promise<string | null> {
    const { data } = await this.supabase
      .admin()
      .from('appointments')
      .select('clinic_id')
      .eq('id', appointmentId)
      .maybeSingle();
    return (data as { clinic_id: string } | null)?.clinic_id ?? null;
  }

  /** staff_id → klinika (Telegram tugmasidan kelganda). */
  async clinicOfStaff(staffId: string): Promise<string | null> {
    const { data } = await this.supabase
      .admin()
      .from('staff_profiles')
      .select('clinic_id')
      .eq('id', staffId)
      .maybeSingle();
    return (data as { clinic_id: string } | null)?.clinic_id ?? null;
  }

  // ==========================================================================
  // Jadvalni saqlash
  // ==========================================================================
  async saveDoctor(
    clinicId: string,
    userId: string | null,
    staffId: string,
    input: DoctorProfileInput,
  ) {
    const admin = this.supabase.admin();
    const { data: staff } = await admin
      .from('staff_profiles')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('id', staffId)
      .maybeSingle();
    if (!staff) throw new NotFoundException('Xodim topilmadi');

    if (input.service_id) {
      const { data: svc } = await admin
        .from('services')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('id', input.service_id)
        .maybeSingle();
      if (!svc) throw new BadRequestException('Xizmat topilmadi');
    }

    if (input.rules) this.validateRules(input.rules);

    const profile: Record<string, unknown> = {
      staff_id: staffId,
      clinic_id: clinicId,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };
    for (const k of [
      'booking_enabled',
      'medical_category',
      'academic_degree',
      'academic_title',
      'experience_years',
      'slot_minutes',
      'keywords',
      'public_note',
      'service_id',
      'sort_order',
    ] as const) {
      if (input[k] !== undefined) profile[k] = input[k];
    }
    const { error: upErr } = await admin
      .from('doctor_booking_profiles')
      .upsert(profile, { onConflict: 'staff_id' });
    if (upErr) throw schemaError(upErr);

    if (input.rules) {
      const { error: delErr } = await admin
        .from('doctor_schedule_rules')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('staff_id', staffId);
      if (delErr) throw schemaError(delErr);
      if (input.rules.length) {
        const { error: insErr } = await admin.from('doctor_schedule_rules').insert(
          input.rules.map((r) => ({
            clinic_id: clinicId,
            staff_id: staffId,
            weekday: r.weekday,
            start_time: r.start_time,
            end_time: r.end_time,
            capacity: r.capacity ?? 1,
          })),
        );
        if (insErr) throw schemaError(insErr);
      }
    }
    this.invalidate(clinicId);
    return this.findDoctor(clinicId, staffId, true);
  }

  private validateRules(rules: NonNullable<DoctorProfileInput['rules']>) {
    for (const r of rules) {
      const a = parseHm(r.start_time);
      const b = parseHm(r.end_time);
      if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) {
        throw new BadRequestException('Hafta kuni noto‘g‘ri');
      }
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
        throw new BadRequestException(`Vaqt oralig'i noto'g'ri: ${r.start_time}–${r.end_time}`);
      }
    }
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const x = rules[i]!;
        const y = rules[j]!;
        if (
          x.weekday === y.weekday &&
          parseHm(x.start_time) < parseHm(y.end_time) &&
          parseHm(y.start_time) < parseHm(x.end_time)
        ) {
          throw new BadRequestException(
            `Bir kunda vaqtlar ustma-ust: ${x.start_time}–${x.end_time} va ${y.start_time}–${y.end_time}`,
          );
        }
      }
    }
  }

  async addTimeOff(
    clinicId: string,
    userId: string | null,
    staffId: string,
    input: { starts_at: string; ends_at: string; reason?: string | null },
  ) {
    const doctor = await this.findDoctor(clinicId, staffId, true);
    if (!(Date.parse(input.ends_at) > Date.parse(input.starts_at))) {
      throw new BadRequestException('Tugash vaqti boshlanishdan keyin bo‘lsin');
    }
    const { data, error } = await this.supabase
      .admin()
      .from('doctor_time_off')
      .insert({
        clinic_id: clinicId,
        staff_id: staffId,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        reason: input.reason ?? null,
        created_by: userId,
      })
      .select('id, starts_at, ends_at, reason')
      .single();
    if (error) throw schemaError(error);
    this.invalidate(clinicId);

    // Shu oraliqqa allaqachon yozilganlar — qabulxona ularga qo'ng'iroq qilishi kerak
    let affected: Array<{ id: string; scheduled_at: string; patient_name: string | null }> = [];
    if (doctor.profile_id) {
      const { data: appts } = await this.supabase
        .admin()
        .from('appointments')
        .select('id, scheduled_at, patient:patients(full_name)')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctor.profile_id)
        .eq('status', 'scheduled')
        .gte('scheduled_at', input.starts_at)
        .lt('scheduled_at', input.ends_at);
      affected = (
        (appts ?? []) as unknown as Array<{
          id: string;
          scheduled_at: string;
          patient: { full_name: string | null } | null;
        }>
      ).map((a) => ({
        id: a.id,
        scheduled_at: a.scheduled_at,
        patient_name: a.patient?.full_name ?? null,
      }));
    }
    return { time_off: data, affected_appointments: affected };
  }

  async removeTimeOff(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('doctor_time_off')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw schemaError(error);
    this.invalidate(clinicId);
    return { ok: true };
  }

  // ==========================================================================
  // Bo'sh vaqtlar
  // ==========================================================================
  async freeSlots(
    clinicId: string,
    staffId: string,
    opts: {
      fromDate?: string;
      days?: number;
      limit?: number;
      forStaff?: boolean;
      settings?: AiReceptionSettings;
    } = {},
  ): Promise<{ doctor: DoctorEntry; slots: FreeSlot[] }> {
    const settings = opts.settings ?? (await this.settings.get(clinicId));
    const doctor = await this.findDoctor(clinicId, staffId);
    if (!opts.forStaff && !doctor.booking_enabled) throw new BookingError('BOOKING_DISABLED');

    const today = localDateOf(new Date());
    const horizon = opts.forStaff ? 60 : settings.booking_horizon_days;
    const fromDate = opts.fromDate && opts.fromDate > today ? opts.fromDate : today;
    const lastDate = addDays(today, horizon - 1);
    if (fromDate > lastDate) return { doctor, slots: [] };
    const maxDays =
      Math.round((localMidnightUtcMs(lastDate) - localMidnightUtcMs(fromDate)) / 86_400_000) + 1;
    const days = Math.max(1, Math.min(opts.days ?? horizon, maxDays));

    const busy = await this.busyFor(
      clinicId,
      doctor.profile_id,
      new Date(localMidnightUtcMs(fromDate)).toISOString(),
      new Date(localMidnightUtcMs(addDays(fromDate, days))).toISOString(),
    );
    const ctx = await this.settings.clinicContext(clinicId);
    const slots = computeFreeSlots({
      rules: doctor.rules,
      slotMinutes: doctor.slot_minutes,
      fromDate,
      days,
      now: new Date(),
      minLeadMinutes: opts.forStaff ? 0 : settings.min_lead_minutes,
      timeOff: doctor.time_off,
      busy,
      closedDates: ctx.closed_dates,
      limit: opts.limit,
    });
    return { doctor, slots };
  }

  private async busyFor(
    clinicId: string,
    doctorProfileId: string | null,
    fromIso: string,
    toIso: string,
  ) {
    if (!doctorProfileId) return [];
    const { data, error } = await this.supabase
      .admin()
      .from('appointments')
      .select('scheduled_at, duration_min')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorProfileId)
      .in('status', ['scheduled', 'checked_in', 'in_progress'])
      // Uzun qabul oldingi kundan o'tib kelishi mumkin — chegarani kengroq olamiz
      .gte('scheduled_at', new Date(Date.parse(fromIso) - 8 * 3600_000).toISOString())
      .lt('scheduled_at', toIso);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{ scheduled_at: string; duration_min: number }>;
  }

  // ==========================================================================
  // Band qilish
  // ==========================================================================
  async reserve(clinicId: string, input: ReserveInput): Promise<ReserveResult> {
    const settings = await this.settings.get(clinicId);
    const doctor = await this.findDoctor(clinicId, input.staffId, true);
    const isStaff = input.source === 'staff';
    if (!isStaff && !doctor.booking_enabled) throw new BookingError('BOOKING_DISABLED');

    // --- vaqt tekshiruvi ---
    const startMs = Date.parse(input.startIso);
    if (!Number.isFinite(startMs)) throw new BadRequestException('Vaqt noto‘g‘ri');
    const startIso = new Date(startMs).toISOString();
    const now = Date.now();
    if (startMs <= now) throw new BookingError('SLOT_IN_PAST');
    if (!isStaff && startMs < now + settings.min_lead_minutes * 60_000) {
      throw new BookingError('TOO_SOON');
    }
    const date = localDateOf(startIso);
    const today = localDateOf(new Date(now));
    if (!isStaff && date > addDays(today, settings.booking_horizon_days - 1)) {
      throw new BookingError('TOO_FAR');
    }
    if (!isWithinSchedule(doctor.rules, doctor.slot_minutes, startIso)) {
      throw new BookingError('OUTSIDE_SCHEDULE');
    }
    const endMs = startMs + doctor.slot_minutes * 60_000;
    if (
      doctor.time_off.some(
        (o) => Date.parse(o.starts_at) < endMs && startMs < Date.parse(o.ends_at),
      )
    ) {
      throw new BookingError('DOCTOR_OFF');
    }
    const ctx = await this.settings.clinicContext(clinicId);
    if (ctx.closed_dates.includes(date)) throw new BookingError('CLINIC_CLOSED');

    const minute = Math.round((startMs - localMidnightUtcMs(date)) / 60_000);
    const capacity = Math.max(
      1,
      ...doctor.rules
        .filter(
          (r) =>
            r.weekday === weekdayOf(date) &&
            minute >= parseHm(r.start_time) &&
            minute < parseHm(r.end_time),
        )
        .map((r) => r.capacity ?? 1),
    );

    // --- bemor ---
    const patient = await this.resolvePatient(clinicId, input, settings);

    if (input.dryRun) {
      return {
        appointment_id: null,
        patient_id: patient.id,
        patient_name: patient.name,
        patient_phone: patient.phone,
        starts_at: startIso,
        date,
        time: localTimeOf(startIso),
        doctor,
        price_uzs: doctor.service_price_uzs,
        dry_run: true,
        new_patient: patient.isNew,
      };
    }

    // --- shifokor profili (appointments.doctor_id → profiles.id) ---
    let doctorProfileId = doctor.profile_id;
    if (!doctorProfileId) {
      const resolved = await this.reception
        .resolveDoctorId(clinicId, doctor.staff_id)
        .catch(() => null);
      if (!resolved || resolved === doctor.staff_id) throw new BookingError('DOCTOR_PROFILE');
      doctorProfileId = resolved;
      this.invalidate(clinicId);
    }

    const actor =
      isStaff && input.actorId ? input.actorId : await this.settings.systemActorId(clinicId);

    // Yangi bemor kartasi faqat shu yerda (sinovda emas) ochiladi
    let patientId = patient.id;
    if (!patientId)
      patientId = await this.createPatient(clinicId, actor, patient.name, patient.phone);

    const { data, error } = await this.supabase.admin().rpc(
      'booking_reserve' as never,
      {
        p_clinic_id: clinicId,
        p_doctor_id: doctorProfileId,
        p_patient_id: patientId,
        p_start: startIso,
        p_minutes: doctor.slot_minutes,
        p_capacity: capacity,
        p_source: input.source,
        p_created_by: actor,
        p_service_id: doctor.service_id,
        p_service_name: doctor.service_name,
        p_service_price: doctor.service_price_uzs,
        p_reason: input.reason?.slice(0, 500) ?? null,
        p_notes: input.notes?.slice(0, 500) ?? null,
        p_call_id: input.callId ?? null,
      } as never,
    );
    if (error) {
      const msg = error.message ?? '';
      for (const code of ['SLOT_TAKEN', 'ALREADY_BOOKED', 'SLOT_IN_PAST'] as const) {
        if (msg.includes(code)) throw new BookingError(code);
      }
      throw schemaError(error);
    }
    const appointmentId = (Array.isArray(data) ? data[0] : data) as string;

    const result: ReserveResult = {
      appointment_id: appointmentId,
      patient_id: patientId,
      patient_name: patient.name,
      patient_phone: patient.phone,
      starts_at: startIso,
      date,
      time: localTimeOf(startIso),
      doctor,
      price_uzs: doctor.service_price_uzs,
      dry_run: false,
      new_patient: patient.isNew,
    };

    if (!input.silent) {
      void this.notifier
        .bookingConfirmed(clinicId, settings, ctx, result, input.source)
        .catch((e) => this.log.warn(`tasdiq xabari: ${(e as Error).message}`));
    }
    return result;
  }

  private async resolvePatient(
    clinicId: string,
    input: ReserveInput,
    settings: AiReceptionSettings,
  ): Promise<{ id: string | null; name: string; phone: string | null; isNew: boolean }> {
    const admin = this.supabase.admin();
    if (input.patient.id) {
      const { data } = await admin
        .from('patients')
        .select('id, full_name, phone')
        .eq('clinic_id', clinicId)
        .eq('id', input.patient.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (!data) throw new NotFoundException('Bemor topilmadi');
      const p = data as { id: string; full_name: string; phone: string | null };
      return { id: p.id, name: p.full_name, phone: p.phone, isNew: false };
    }

    const fullName = (input.patient.full_name ?? '').replace(/\s+/g, ' ').trim();
    const names = identityNames({ full_name: fullName });
    if (!names.last || !names.first) throw new BookingError('PATIENT_NAME_REQUIRED');
    const phone = normalizeUzPhone(input.patient.phone);
    if (!phone) throw new BookingError('PHONE_REQUIRED');

    // "Qayta keldi": familiya + ism + telefon mos — o'sha karta (bemorlar daftari qoidasi)
    const pattern = phoneIlikePattern(phone);
    const { data: cands } = await admin
      .from('patients')
      .select('id, full_name, last_name, first_name, phone, created_at')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .ilike('phone', pattern ?? '%')
      .order('created_at', { ascending: true })
      .limit(50);
    const match = (
      (cands ?? []) as Array<{
        id: string;
        full_name: string;
        last_name: string | null;
        first_name: string | null;
        phone: string | null;
      }>
    ).find((p) => samePatientIdentity({ full_name: fullName, phone }, p));
    if (match) return { id: match.id, name: match.full_name, phone, isNew: false };

    if (input.source !== 'staff' && !settings.allow_new_patients) {
      throw new BookingError('NEW_PATIENT_NOT_ALLOWED');
    }
    return { id: null, name: titleCase(fullName), phone, isNew: true };
  }

  private async createPatient(
    clinicId: string,
    actor: string,
    fullName: string,
    phone: string | null,
  ) {
    const parts = splitFullName(fullName);
    const { data, error } = await this.supabase
      .admin()
      .from('patients')
      .insert({
        clinic_id: clinicId,
        created_by: actor,
        full_name: fullName,
        last_name: parts.last_name,
        first_name: parts.first_name,
        patronymic: parts.patronymic,
        phone,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(`Bemor kartasi ochilmadi: ${error.message}`);
    return (data as { id: string }).id;
  }

  // ==========================================================================
  // Bekor qilish / tasdiqlash (bemor yoki klinika)
  // ==========================================================================
  async cancel(
    clinicId: string,
    appointmentId: string,
    opts: { by: 'patient' | 'clinic'; reason?: string | null; phone?: string | null },
  ) {
    const appt = await this.loadOwnAppointment(
      clinicId,
      appointmentId,
      opts.by === 'patient' ? opts.phone : undefined,
    );
    if (appt.status !== 'scheduled') {
      throw new BadRequestException(
        'Bu yozuvni bekor qilib bo‘lmaydi (holati: ' + appt.status + ')',
      );
    }
    const { error } = await this.supabase
      .admin()
      .from('appointments')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        canceled_reason:
          opts.reason?.slice(0, 300) ??
          (opts.by === 'patient' ? 'Bemor bekor qildi' : 'Klinika bekor qildi'),
      })
      .eq('clinic_id', clinicId)
      .eq('id', appointmentId)
      .eq('status', 'scheduled');
    if (error) throw new BadRequestException(error.message);

    if (opts.by === 'patient') {
      void (async () => {
        const settings = await this.settings.get(clinicId);
        if (!settings.notify_owner_telegram) return;
        await this.notifier.ownerNotify(
          clinicId,
          `❌ <b>Bemor navbatni bekor qildi</b>\n👤 ${esc(appt.patient_name)}\n` +
            `👨‍⚕️ ${esc(appt.doctor_name)}\n🗓 ${esc(localDateOf(appt.scheduled_at))} ${esc(localTimeOf(appt.scheduled_at))}`,
        );
      })().catch(() => undefined);
    }
    return { ok: true, appointment_id: appointmentId };
  }

  async patientConfirm(clinicId: string, appointmentId: string, phone: string | null) {
    const appt = await this.loadOwnAppointment(clinicId, appointmentId, phone);
    if (appt.status !== 'scheduled') return { ok: false, status: appt.status };
    await this.supabase
      .admin()
      .from('appointments')
      .update({ patient_confirmed_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('id', appointmentId);
    return { ok: true, status: appt.status };
  }

  /** Yozuvni yuklaydi; `phone` berilsa — bemor telefoni mosligini talab qiladi. */
  async loadOwnAppointment(clinicId: string, appointmentId: string, phone?: string | null) {
    const { data } = await this.supabase
      .admin()
      .from('appointments')
      .select(
        'id, clinic_id, status, scheduled_at, patient:patients(full_name, phone), doctor:profiles!appointments_doctor_id_fkey(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', appointmentId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Yozuv topilmadi');
    const a = data as unknown as {
      id: string;
      status: string;
      scheduled_at: string;
      patient: { full_name: string | null; phone: string | null } | null;
      doctor: { full_name: string | null } | null;
    };
    if (phone !== undefined) {
      const k = phoneKey(phone);
      if (!k || k !== phoneKey(a.patient?.phone)) {
        throw new ForbiddenException('Bu yozuv sizning raqamingizga tegishli emas');
      }
    }
    return {
      id: a.id,
      status: a.status,
      scheduled_at: a.scheduled_at,
      patient_name: a.patient?.full_name ?? '',
      patient_phone: a.patient?.phone ?? null,
      doctor_name: a.doctor?.full_name ?? '',
    };
  }

  /** Telefon raqami bo'yicha kelgusi yozuvlar (bir yoki bir necha klinikada). */
  async upcomingForPhone(clinicIds: string[], phone: string | null): Promise<UpcomingForPhone[]> {
    const key = phoneKey(phone);
    if (!key || clinicIds.length === 0) return [];
    const admin = this.supabase.admin();
    const { data: pats } = await admin
      .from('patients')
      .select('id, clinic_id, full_name, phone')
      .in('clinic_id', clinicIds)
      .is('deleted_at', null)
      .ilike('phone', phoneIlikePattern(phone) ?? '%')
      .limit(50);
    const patients = (
      (pats ?? []) as Array<{ id: string; full_name: string; phone: string | null }>
    ).filter((p) => phoneKey(p.phone) === key);
    if (patients.length === 0) return [];
    const names = new Map(patients.map((p) => [p.id, p.full_name]));
    const { data } = await admin
      .from('appointments')
      .select(
        'id, clinic_id, patient_id, scheduled_at, patient_confirmed_at, clinic:clinics(name), doctor:profiles!appointments_doctor_id_fkey(full_name)',
      )
      .in('clinic_id', clinicIds)
      .in(
        'patient_id',
        patients.map((p) => p.id),
      )
      .eq('status', 'scheduled')
      .gt('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(10);
    return (
      (data ?? []) as unknown as Array<{
        id: string;
        clinic_id: string;
        patient_id: string;
        scheduled_at: string;
        patient_confirmed_at: string | null;
        clinic: { name: string } | null;
        doctor: { full_name: string } | null;
      }>
    ).map((a) => ({
      appointment_id: a.id,
      clinic_id: a.clinic_id,
      clinic_name: a.clinic?.name ?? '',
      patient_name: names.get(a.patient_id) ?? '',
      doctor_name: a.doctor?.full_name ?? '',
      scheduled_at: a.scheduled_at,
      date: localDateOf(a.scheduled_at),
      time: localTimeOf(a.scheduled_at),
      confirmed: !!a.patient_confirmed_at,
    }));
  }

  /** Bazada shu telefon bilan nechta bemor kartasi bor (ismlar oshkor qilinmaydi). */
  async patientsByPhone(clinicId: string, phone: string | null) {
    const key = phoneKey(phone);
    if (!key) return [];
    const { data } = await this.supabase
      .admin()
      .from('patients')
      .select('id, full_name, phone')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .ilike('phone', phoneIlikePattern(phone) ?? '%')
      .limit(20);
    return ((data ?? []) as Array<{ id: string; full_name: string; phone: string | null }>).filter(
      (p) => phoneKey(p.phone) === key,
    );
  }

  /** Qabulxona: oldindan yozilganlar ro'yxati. */
  async upcoming(clinicId: string, opts: { from?: string; to?: string; source?: string }) {
    const from = opts.from
      ? new Date(localMidnightUtcMs(opts.from)).toISOString()
      : new Date().toISOString();
    const to = opts.to
      ? new Date(localMidnightUtcMs(addDays(opts.to, 1))).toISOString()
      : new Date(Date.now() + 30 * 86_400_000).toISOString();
    let q = this.supabase
      .admin()
      .from('appointments')
      .select(
        'id, scheduled_at, duration_min, status, source, reason, patient_confirmed_at, reminder_sent_at, created_at, service_name_snapshot, service_price_snapshot, patient:patients(id, full_name, phone), doctor:profiles!appointments_doctor_id_fkey(id, full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', from)
      .lt('scheduled_at', to)
      .order('scheduled_at', { ascending: true })
      .limit(500);
    if (opts.source && opts.source !== 'all') q = q.eq('source', opts.source);
    const { data, error } = await q;
    if (error) throw schemaError(error);
    return data ?? [];
  }

  /** Klinikalardan qaysilarida online navbat ochiq shifokor bor. */
  async bookableClinics(clinicIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const id of clinicIds) {
      try {
        if ((await this.directory(id, { onlyEnabled: true })).length > 0) out.add(id);
      } catch {
        /* migratsiya yo'q yoki xato — bu klinika eski oqimda qoladi */
      }
    }
    return out;
  }
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase('uz') + w.slice(1) : w))
    .join(' ');
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
