import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { networkPatientScope } from '../../common/network/network-scope';
import { tashkentDate, tashkentDayStartIso } from '../../common/tashkent-range';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
// Clary Cast: shifokorning hozirgi xonasi ("7", "205", "UZI")
const RoomSchema = z.object({
  doctor_id: z.string().uuid().optional(),
  room_label: z.string().trim().max(16).nullable(),
});
// Boshqa shifokorning xonasini belgilashi mumkin bo'lganlar
const ROOM_EDITORS = ['clinic_owner', 'clinic_admin', 'receptionist', 'super_admin'];
const ROOM_MIGRATION_MSG =
  "Xona maydoni bazada hali yo'q — serverda scripts/deploy-cast-voice.sh ishga tushirilsin";

const VitalsSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullish(),
  temperature_c: z.number().min(30).max(45).nullish(),
  pulse_bpm: z.number().int().min(20).max(250).nullish(),
  systolic_mmhg: z.number().int().min(40).max(300).nullish(),
  diastolic_mmhg: z.number().int().min(20).max(200).nullish(),
  respiration_rate: z.number().int().min(4).max(80).nullish(),
  oxygen_saturation: z.number().int().min(50).max(100).nullish(),
  weight_kg: z.number().min(0.5).max(400).nullish(),
  height_cm: z.number().int().min(20).max(260).nullish(),
  notes: z.string().max(500).nullish(),
});

const ConsultationSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullish(),
  // Shu qabulning qoralamasi — berilsa YANGILANADI (avtosaqlash har safar
  // yangi qator yaratmasin). Imzolangan yozuv o'zgarmaydi — unda yangisi.
  note_id: z.string().uuid().nullish(),
  soap_subjective: z.string().max(4000).nullish(),
  soap_objective: z.string().max(4000).nullish(),
  soap_assessment: z.string().max(4000).nullish(),
  soap_plan: z.string().max(4000).nullish(),
  diagnosis_code: z.string().max(16).nullish(),
  diagnosis_text: z.string().max(500).nullish(),
  sign: z.boolean().default(false),
});

// FAZA 2 — medical history
// Qabulni bitta amalda yakunlash: xulosa (imzolangan) + vital belgilar +
// navbat "ko'rildi" + yozuv (appointment) "yakunlandi".
const FinishVisitSchema = ConsultationSchema.omit({ sign: true }).extend({
  queue_id: z.string().uuid(),
  vitals: VitalsSchema.omit({ patient_id: true, appointment_id: true }).nullish(),
});

const MedicalHistorySchema = z.object({
  allergies: z.array(z.string()).optional(),
  chronic_conditions: z.array(z.string()).optional(),
  surgeries: z
    .array(
      z.object({ name: z.string(), year: z.string().optional(), notes: z.string().optional() }),
    )
    .optional(),
  current_medications: z
    .array(
      z.object({ name: z.string(), dose: z.string().optional(), notes: z.string().optional() }),
    )
    .optional(),
  blood_type: z.string().max(8).nullish(),
  medical_notes: z.string().max(2000).nullish(),
});

// FAZA 2 — patient file metadata
const PatientFileSchema = z.object({
  patient_id: z.string().uuid(),
  kind: z.enum([
    'xray',
    'mri',
    'ct',
    'ultrasound',
    'lab',
    'prescription',
    'photo',
    'document',
    'other',
  ]),
  title: z.string().min(1).max(200),
  url: z.string().url(),
  mime_type: z.string().max(120).nullish(),
  size_bytes: z.number().int().nonnegative().nullish(),
  notes: z.string().max(500).nullish(),
});

// FAZA 2 — diagnosis template
const TemplateSchema = z.object({
  name: z.string().min(1).max(120),
  diagnosis_code: z.string().max(16).nullish(),
  diagnosis_text: z.string().max(500).nullish(),
  soap_subjective: z.string().max(4000).nullish(),
  soap_objective: z.string().max(4000).nullish(),
  soap_assessment: z.string().max(4000).nullish(),
  soap_plan: z.string().max(4000).nullish(),
  // 'private' — faqat egasi; 'clinic' — butun klinika ko'radi.
  visibility: z.enum(['private', 'clinic']).default('private'),
});

// Tahrirlashda hamma maydon ixtiyoriy (nom bo'sh yuborilmasa bas).
const TemplateUpdateSchema = TemplateSchema.partial();

// =============================================================================
// Doctor workspace — dashboard widgets (income, pending lab/reports, queue).
// =============================================================================
@Injectable()
export class DoctorService {
  constructor(private readonly supabase: SupabaseService) {}

  // Shifokorning bugungi dashboard'i: navbat, tushum, kutilayotgan ishlar.
  // Kun — Toshkent bo'yicha (queue_date); tushum — analitika bilan bir xil
  // ta'rif (kassa asosida, qarzsiz, shifokor = chek yoki navbat shifokori).
  async dashboard(clinicId: string, doctorId: string) {
    const admin = this.supabase.admin();
    const today = tashkentDate();
    const todayIso = tashkentDayStartIso(today);

    const [queueRes, incomeRes, pendingLabRes, pendingRxRes, recentRes] = await Promise.all([
      admin
        .from('queues')
        .select(
          'id, ticket_no, status, joined_at, called_at, started_at, served_at, appointment_id, service:services(name_i18n), patient:patients(id, full_name, phone, dob, gender)',
        )
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .eq('queue_date', today)
        .neq('status', 'left')
        .order('priority', { ascending: false })
        .order('joined_at', { ascending: true }),
      admin.rpc(
        'analytics_doctors' as never,
        { p_clinic: clinicId, p_from: today, p_to: today } as never,
      ),
      admin
        .from('lab_orders')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('ordered_by', doctorId)
        .in('status', ['pending', 'collected', 'running']),
      admin
        .from('diagnostic_orders')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('ordered_by', doctorId)
        .in('status', ['pending', 'collected', 'running']),
      admin
        .from('appointments')
        .select('id, scheduled_at, patient:patients(id, full_name, phone)')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(8),
    ]);

    type Row = {
      id: string;
      status: string;
      service: { name_i18n: Record<string, string> | null } | null;
      patient: { id: string } | null;
    };
    const queue = ((queueRes.data ?? []) as unknown as Row[]).map((q) => {
      const n = q.service?.name_i18n ?? null;
      const { service: _s, ...rest } = q;
      return {
        ...rest,
        service_name: n
          ? (n['uz-Latn'] ?? n['uz'] ?? n['ru'] ?? Object.values(n)[0] ?? null)
          : null,
      };
    });

    // Bugun yozilgan xulosalar — ko'rilganlar ro'yxatida "xulosa bor" belgisi
    const patientIds = [
      ...new Set(queue.map((q) => q.patient?.id).filter((x): x is string => !!x)),
    ];
    const notesToday = new Map<string, { id: string; is_final: boolean }>();
    if (patientIds.length) {
      const { data: notes } = await admin
        .from('treatment_notes')
        .select('id, patient_id, is_final, created_at')
        .eq('clinic_id', clinicId)
        .in('patient_id', patientIds)
        .gte('created_at', todayIso)
        .order('created_at', { ascending: true });
      for (const n of (notes ?? []) as Array<{
        id: string;
        patient_id: string;
        is_final: boolean;
      }>) {
        const prev = notesToday.get(n.patient_id);
        if (!prev || n.is_final || !prev.is_final)
          notesToday.set(n.patient_id, { id: n.id, is_final: n.is_final });
      }
    }
    const withNote = <T extends { patient?: { id: string } | null }>(q: T) => ({
      ...q,
      note: q.patient?.id ? (notesToday.get(q.patient.id) ?? null) : null,
    });

    const income = ((incomeRes.data ?? []) as Array<{ doctor_id: string; revenue_uzs: number }>)
      .filter((r) => r.doctor_id === doctorId)
      .reduce((sum, r) => sum + Number(r.revenue_uzs ?? 0), 0);

    const served = queue.filter((q) => q.status === 'served').map(withNote);
    return {
      queue: {
        waiting: queue.filter((q) => q.status === 'waiting').map(withNote),
        called: queue.filter((q) => q.status === 'called').map(withNote),
        serving: queue.filter((q) => q.status === 'serving').map(withNote),
        served: served.reverse(),
        served_today: served.length,
      },
      today_income_uzs: income,
      pending_lab: pendingLabRes.count ?? 0,
      pending_reports: pendingRxRes.count ?? 0,
      recent_patients: recentRes.data ?? [],
    };
  }

  // Vitals yozish (ambulator yoki statsionar)
  async recordVitals(clinicId: string, userId: string, input: z.infer<typeof VitalsSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('vital_signs')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        appointment_id: input.appointment_id ?? null,
        recorded_by: userId,
        temperature_c: input.temperature_c ?? null,
        pulse_bpm: input.pulse_bpm ?? null,
        systolic_mmhg: input.systolic_mmhg ?? null,
        diastolic_mmhg: input.diastolic_mmhg ?? null,
        respiration_rate: input.respiration_rate ?? null,
        oxygen_saturation: input.oxygen_saturation ?? null,
        weight_kg: input.weight_kg ?? null,
        height_cm: input.height_cm ?? null,
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Konsultatsiya SOAP yozuvini saqlash (tashxis kodi bilan)
  async saveConsultation(
    clinicId: string,
    userId: string,
    input: z.infer<typeof ConsultationSchema>,
  ) {
    const fields = {
      soap_subjective: input.soap_subjective ?? null,
      soap_objective: input.soap_objective ?? null,
      soap_assessment: input.soap_assessment ?? null,
      soap_plan: input.soap_plan ?? null,
      diagnosis_code: input.diagnosis_code ?? null,
      diagnosis_text: input.diagnosis_text ?? null,
      is_final: input.sign,
      signed_at: input.sign ? new Date().toISOString() : null,
    };
    if (input.note_id) {
      // Faqat qoralama yangilanadi (imzolangani bazada qoida bilan himoyalangan)
      const { data: upd, error: updErr } = await this.supabase
        .admin()
        .from('treatment_notes')
        .update({ ...fields, appointment_id: input.appointment_id ?? null })
        .eq('clinic_id', clinicId)
        .eq('id', input.note_id)
        .eq('is_final', false)
        .select()
        .maybeSingle();
      if (updErr) throw new BadRequestException(updErr.message);
      if (upd) return upd;
    }
    const { data, error } = await this.supabase
      .admin()
      .from('treatment_notes')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        appointment_id: input.appointment_id ?? null,
        author_id: userId,
        soap_subjective: input.soap_subjective ?? null,
        soap_objective: input.soap_objective ?? null,
        soap_assessment: input.soap_assessment ?? null,
        soap_plan: input.soap_plan ?? null,
        diagnosis_code: input.diagnosis_code ?? null,
        diagnosis_text: input.diagnosis_text ?? null,
        is_final: input.sign,
        signed_at: input.sign ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Shu muallifning bugungi oxirgi qoralamasi (qabulga qaytilganda tiklash uchun). */
  // ── Shifokor xonasi (Clary Cast TV chaqiruvi) ─────────────────────────────
  async room(clinicId: string, doctorId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .select('id, room_label')
      .eq('clinic_id', clinicId)
      .eq('id', doctorId)
      .maybeSingle();
    // Migratsiyagacha ish joyi yiqilmasin — xona shunchaki "yo'q"
    if (error) return { room_label: null, available: false };
    return {
      room_label: (data as { room_label: string | null } | null)?.room_label ?? null,
      available: true,
    };
  }

  async rooms(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .select('id, full_name, role, room_label')
      .eq('clinic_id', clinicId)
      .in('role', ['doctor', 'clinic_admin', 'clinic_owner'])
      .eq('is_active', true)
      .order('full_name');
    if (error) {
      throw new BadRequestException(
        /room_label/.test(error.message) ? ROOM_MIGRATION_MSG : error.message,
      );
    }
    return data ?? [];
  }

  async setRoom(
    clinicId: string,
    actor: { userId: string; role: string | null },
    body: z.infer<typeof RoomSchema>,
  ) {
    const doctorId = body.doctor_id ?? actor.userId;
    if (doctorId !== actor.userId && !ROOM_EDITORS.includes(actor.role ?? '')) {
      throw new ForbiddenException("Xonani shifokorning o'zi yoki administrator belgilaydi");
    }
    const value = body.room_label?.trim() || null;
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .update({ room_label: value })
      .eq('clinic_id', clinicId)
      .eq('id', doctorId)
      .select('id, room_label')
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        /room_label/.test(error.message) ? ROOM_MIGRATION_MSG : error.message,
      );
    }
    if (!data) throw new NotFoundException('Xodim topilmadi');
    return data;
  }

  async visitDraft(clinicId: string, userId: string, patientId: string) {
    const { data } = await this.supabase
      .admin()
      .from('treatment_notes')
      .select(
        'id, soap_subjective, soap_objective, soap_assessment, soap_plan, diagnosis_code, diagnosis_text, is_final, created_at',
      )
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('author_id', userId)
      .gte('created_at', tashkentDayStartIso(tashkentDate()))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  }

  /**
   * Qabulni yakunlash — bitta tugma: xulosa imzolanadi (matn bo'lsa), vital
   * belgilar yoziladi (kiritilgan bo'lsa), navbat "ko'rildi", yozuv esa
   * "yakunlandi" holatiga o'tadi.
   */
  async finishVisit(clinicId: string, userId: string, input: z.infer<typeof FinishVisitSchema>) {
    const admin = this.supabase.admin();
    const { data: q, error: qErr } = await admin
      .from('queues')
      .select('id, status, patient_id, appointment_id')
      .eq('clinic_id', clinicId)
      .eq('id', input.queue_id)
      .maybeSingle();
    if (qErr) throw new BadRequestException(qErr.message);
    if (!q) throw new NotFoundException('Navbat topilmadi');
    const queue = q as {
      id: string;
      status: string;
      patient_id: string;
      appointment_id: string | null;
    };
    if (queue.patient_id !== input.patient_id) throw new BadRequestException('Bemor mos emas');
    const appointmentId = input.appointment_id ?? queue.appointment_id;

    const hasNote = [
      input.soap_subjective,
      input.soap_objective,
      input.soap_assessment,
      input.soap_plan,
      input.diagnosis_code,
      input.diagnosis_text,
    ].some((v) => !!v && String(v).trim() !== '');
    const note = hasNote
      ? await this.saveConsultation(clinicId, userId, {
          ...input,
          appointment_id: appointmentId,
          sign: true,
        })
      : null;

    const v = input.vitals ?? null;
    const hasVitals =
      !!v && Object.values(v).some((x) => x !== null && x !== undefined && x !== '');
    if (v && hasVitals) {
      await this.recordVitals(clinicId, userId, {
        ...v,
        patient_id: input.patient_id,
        appointment_id: appointmentId,
      });
    }

    const now = new Date().toISOString();
    const { error: upErr } = await admin
      .from('queues')
      .update({
        status: 'served',
        served_at: now,
        ...(queue.status === 'waiting' || queue.status === 'called' ? { started_at: now } : {}),
      })
      .eq('clinic_id', clinicId)
      .eq('id', queue.id);
    if (upErr) throw new BadRequestException(upErr.message);

    if (appointmentId) {
      await admin
        .from('appointments')
        .update({ status: 'completed' })
        .eq('clinic_id', clinicId)
        .eq('id', appointmentId)
        .in('status', ['scheduled', 'checked_in', 'in_progress']);
    }
    return { ok: true, note_id: (note as { id?: string } | null)?.id ?? null };
  }

  // Bemorning oxirgi vitals + treatment notes (consultation workspace uchun)
  async patientClinical(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const [vitalsRes, notesRes] = await Promise.all([
      admin
        .from('vital_signs')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('recorded_at', { ascending: false })
        .limit(5),
      admin
        .from('treatment_notes')
        .select(
          'id, soap_subjective, soap_objective, soap_assessment, soap_plan, diagnosis_code, diagnosis_text, is_final, signed_at, created_at, author:profiles!author_id(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    return {
      vitals: vitalsRes.data ?? [],
      notes: notesRes.data ?? [],
    };
  }

  // ── FAZA 2: Medical history ──────────────────────────────────────────────
  async getMedicalHistory(clinicId: string, patientId: string) {
    const scope = await networkPatientScope(this.supabase.admin(), clinicId);
    const { data } = await this.supabase
      .admin()
      .from('patients')
      .select(
        'allergies, chronic_conditions, surgeries, current_medications, blood_type, medical_notes',
      )
      .in('clinic_id', scope)
      .eq('id', patientId)
      .maybeSingle();
    return data ?? {};
  }

  async updateMedicalHistory(
    clinicId: string,
    patientId: string,
    input: z.infer<typeof MedicalHistorySchema>,
  ) {
    const patch: Record<string, unknown> = {};
    if (input.allergies !== undefined) patch.allergies = input.allergies;
    if (input.chronic_conditions !== undefined) patch.chronic_conditions = input.chronic_conditions;
    if (input.surgeries !== undefined) patch.surgeries = input.surgeries;
    if (input.current_medications !== undefined)
      patch.current_medications = input.current_medications;
    if (input.blood_type !== undefined) patch.blood_type = input.blood_type;
    if (input.medical_notes !== undefined) patch.medical_notes = input.medical_notes;
    const scope = await networkPatientScope(this.supabase.admin(), clinicId);
    const { data, error } = await this.supabase
      .admin()
      .from('patients')
      .update(patch)
      .in('clinic_id', scope)
      .eq('id', patientId)
      .select(
        'allergies, chronic_conditions, surgeries, current_medications, blood_type, medical_notes',
      )
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── FAZA 2: Patient files ────────────────────────────────────────────────
  async listFiles(clinicId: string, patientId: string) {
    const { data } = await this.supabase
      .admin()
      .from('patient_files')
      .select('id, kind, title, url, mime_type, size_bytes, notes, created_at, uploaded_by')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async addFile(clinicId: string, userId: string, input: z.infer<typeof PatientFileSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('patient_files')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        kind: input.kind,
        title: input.title,
        url: input.url,
        mime_type: input.mime_type ?? null,
        size_bytes: input.size_bytes ?? null,
        notes: input.notes ?? null,
        uploaded_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteFile(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('patient_files')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── FAZA 2: Diagnosis templates ──────────────────────────────────────────
  // Shablon SHAXSIY: standart holda faqat egasi ko'radi. `visibility='clinic'`
  // qilinsa butun klinikaga ochiladi (bosh shifokor standarti). Ilgari ro'yxat
  // faqat clinic_id bo'yicha filtrlanardi — har bir shifokor barcha
  // mutaxassisliklarning shablonini ko'rib, ro'yxat ishlatib bo'lmas edi.
  async listTemplates(clinicId: string, userId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('diagnosis_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .or(`created_by.eq.${userId},visibility.eq.clinic`)
      .order('usage_count', { ascending: false });
    if (error) throw new BadRequestException(`Shablonlar olinmadi: ${error.message}`);

    // `is_mine` — UI "Mening shablonlarim" va "Klinika shablonlari" deb ajratadi.
    return (data ?? []).map((t) => ({
      ...(t as Record<string, unknown>),
      is_mine: (t as { created_by: string | null }).created_by === userId,
    }));
  }

  async createTemplate(clinicId: string, userId: string, input: z.infer<typeof TemplateSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('diagnosis_templates')
      .insert({ clinic_id: clinicId, created_by: userId, ...input })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Tahrirlash — faqat EGASI. Kabinet sahifasidagi muharrir shuni ishlatadi.
  async updateTemplate(
    clinicId: string,
    userId: string,
    id: string,
    input: z.infer<typeof TemplateUpdateSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('diagnosis_templates')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Shablon topilmadi yoki sizniki emas');
    return data;
  }

  // O'chirish ham faqat egasiga — boshqa shifokor klinika shablonini
  // ko'rgani bilan uni o'chira olmasligi kerak.
  async deleteTemplate(clinicId: string, userId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('diagnosis_templates')
      .update({ is_active: false })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .eq('created_by', userId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Shablon topilmadi yoki sizniki emas');
    return { ok: true };
  }

  // Shablon ishlatilganda usage_count oshirish
  async bumpTemplate(clinicId: string, id: string) {
    const { data } = await this.supabase
      .admin()
      .from('diagnosis_templates')
      .select('usage_count')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (data) {
      await this.supabase
        .admin()
        .from('diagnosis_templates')
        .update({ usage_count: (data.usage_count ?? 0) + 1 })
        .eq('clinic_id', clinicId)
        .eq('id', id);
    }
    return { ok: true };
  }

  // ── FAZA 2: Financial awareness ──────────────────────────────────────────
  async patientFinancial(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const [balanceRes, paidRes] = await Promise.all([
      // patient_balance view — ledger balansi (statsionar depozit/charge).
      // Manfiy bo'lsa — bemor qarzdor.
      admin
        .from('patient_balance')
        .select('balance_uzs')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .maybeSingle(),
      // Jami to'langan summa (umumiy ko'rsatkich uchun)
      admin
        .from('transactions')
        .select('amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('kind', 'payment')
        .eq('is_void', false),
    ]);
    const ledgerBalance = Number(
      (balanceRes.data as { balance_uzs?: number } | null)?.balance_uzs ?? 0,
    );
    const totalPaid = (paidRes.data ?? []).reduce(
      (s: number, t: { amount_uzs: number }) => s + Number(t.amount_uzs ?? 0),
      0,
    );
    return {
      ledger_balance_uzs: ledgerBalance,
      // Manfiy ledger = qarz
      outstanding_debt_uzs: ledgerBalance < 0 ? -ledgerBalance : 0,
      total_paid_uzs: totalPaid,
    };
  }

  // ── FAZA 3: Doctor analytics — so'nggi 30 kun ──────────────────────────────
  async analytics(clinicId: string, doctorId: string) {
    const admin = this.supabase.admin();
    const since = new Date(Date.now() - 30 * 864e5).toISOString();

    const [apptRes, notesRes, incomeRes] = await Promise.all([
      // 30 kunlik appointment'lar (kun bo'yicha)
      admin
        .from('appointments')
        .select('scheduled_at, patient_id, status')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .gte('scheduled_at', since),
      // 30 kunlik tashxislar (ICD-10 taqsimot)
      admin
        .from('treatment_notes')
        .select('diagnosis_code, diagnosis_text')
        .eq('clinic_id', clinicId)
        .eq('author_id', doctorId)
        .gte('created_at', since)
        .not('diagnosis_code', 'is', null),
      // 30 kunlik income
      admin
        .from('transactions')
        .select('amount_uzs, created_at, appointment:appointments!inner(doctor_id)')
        .eq('clinic_id', clinicId)
        .eq('kind', 'payment')
        .eq('is_void', false)
        .eq('appointment.doctor_id', doctorId)
        .gte('created_at', since),
    ]);

    const appts = apptRes.data ?? [];
    const completed = appts.filter((a) => a.status === 'completed');
    const uniquePatients = new Set(appts.map((a) => a.patient_id)).size;

    // Kun bo'yicha bemor soni
    const byDay: Record<string, number> = {};
    for (const a of completed) {
      const d = (a.scheduled_at as string).slice(0, 10);
      byDay[d] = (byDay[d] ?? 0) + 1;
    }
    const dailyPatients = Object.entries(byDay)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));

    // ICD-10 taqsimot — top tashxislar
    const dxCount: Record<string, { code: string; text: string; count: number }> = {};
    for (const n of notesRes.data ?? []) {
      const code = n.diagnosis_code as string;
      if (!dxCount[code]) {
        dxCount[code] = { code, text: (n.diagnosis_text as string) ?? '', count: 0 };
      }
      dxCount[code].count += 1;
    }
    const topDiagnoses = Object.values(dxCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const income = (incomeRes.data ?? []).reduce(
      (s: number, t: { amount_uzs: number }) => s + Number(t.amount_uzs ?? 0),
      0,
    );

    // Repeat patients — 2+ marta kelganlar
    const visitsByPatient: Record<string, number> = {};
    for (const a of appts) {
      visitsByPatient[a.patient_id] = (visitsByPatient[a.patient_id] ?? 0) + 1;
    }
    const repeatPatients = Object.values(visitsByPatient).filter((v) => v >= 2).length;

    return {
      period_days: 30,
      total_appointments: appts.length,
      completed_appointments: completed.length,
      unique_patients: uniquePatients,
      repeat_patients: repeatPatients,
      income_uzs: income,
      avg_per_day:
        dailyPatients.length > 0
          ? Math.round((completed.length / dailyPatients.length) * 10) / 10
          : 0,
      daily_patients: dailyPatients,
      top_diagnoses: topDiagnoses,
    };
  }

  // ── Notifications feed ───────────────────────────────────────────────────
  // Shifokorga: o'ziga atalган (recipient_id) + klinika bo'ylab (NULL).
  async listNotifications(clinicId: string, userId: string, onlyUnread = false) {
    let q = this.supabase
      .admin()
      .from('notifications_inapp')
      .select('id, kind, severity, title, body, ref_resource, ref_id, is_read, created_at')
      .eq('clinic_id', clinicId)
      .or(`recipient_id.eq.${userId},recipient_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (onlyUnread) q = q.eq('is_read', false);
    const { data } = await q;
    return data ?? [];
  }

  async unreadCount(clinicId: string, userId: string) {
    const { count } = await this.supabase
      .admin()
      .from('notifications_inapp')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('is_read', false)
      .or(`recipient_id.eq.${userId},recipient_id.is.null`);
    return { unread: count ?? 0 };
  }

  async markRead(clinicId: string, userId: string, id: string | 'all') {
    const admin = this.supabase.admin();
    let q = admin
      .from('notifications_inapp')
      .update({ is_read: true })
      .eq('clinic_id', clinicId)
      .or(`recipient_id.eq.${userId},recipient_id.is.null`);
    if (id !== 'all') q = q.eq('id', id);
    await q;
    return { ok: true };
  }
}

@ApiTags('doctor')
@Controller('doctor')
class DoctorController {
  constructor(private readonly svc: DoctorService) {}

  @Get('dashboard')
  dashboard(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Query('doctor_id') doctorId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const did = doctorId ?? u.userId;
    if (!did) throw new ForbiddenException('doctor_id required');
    return this.svc.dashboard(u.clinicId, did);
  }

  @Get('patients/:id/clinical')
  patientClinical(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.patientClinical(u.clinicId, id);
  }

  @Post('vitals')
  @Audit({ action: 'doctor.vitals_recorded', resourceType: 'vital_signs' })
  recordVitals(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.recordVitals(u.clinicId, u.userId, VitalsSchema.parse(body));
  }

  @Post('consultation')
  @Audit({ action: 'doctor.consultation_saved', resourceType: 'treatment_notes' })
  saveConsultation(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.saveConsultation(u.clinicId, u.userId, ConsultationSchema.parse(body));
  }

  @Get('room')
  room(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Query('doctor_id') doctorId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const did = doctorId ?? u.userId;
    if (!did) throw new ForbiddenException('doctor_id required');
    return this.svc.room(u.clinicId, did);
  }

  @Get('rooms')
  rooms(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.rooms(u.clinicId);
  }

  @Put('room')
  @Audit({ action: 'doctor.room_set', resourceType: 'profiles' })
  setRoom(
    @CurrentUser() u: { clinicId: string | null; userId: string | null; role: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.setRoom(u.clinicId, { userId: u.userId, role: u.role }, RoomSchema.parse(body));
  }

  @Get('patients/:id/draft')
  visitDraft(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.visitDraft(u.clinicId, u.userId, id);
  }

  @Post('finish-visit')
  @Audit({ action: 'doctor.visit_finished', resourceType: 'queues' })
  finishVisit(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.finishVisit(u.clinicId, u.userId, FinishVisitSchema.parse(body));
  }

  // ── FAZA 2: Medical history ──────────────────────────────────────────────
  @Get('patients/:id/history')
  getHistory(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getMedicalHistory(u.clinicId, id);
  }

  @Post('patients/:id/history')
  @Audit({ action: 'doctor.history_updated', resourceType: 'patients' })
  updateHistory(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateMedicalHistory(u.clinicId, id, MedicalHistorySchema.parse(body));
  }

  // ── FAZA 2: Patient files ────────────────────────────────────────────────
  @Get('patients/:id/files')
  listFiles(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listFiles(u.clinicId, id);
  }

  @Post('files')
  @Audit({ action: 'doctor.file_added', resourceType: 'patient_files' })
  addFile(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.addFile(u.clinicId, u.userId, PatientFileSchema.parse(body));
  }

  @Post('files/:id/delete')
  @Audit({ action: 'doctor.file_deleted', resourceType: 'patient_files' })
  deleteFile(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteFile(u.clinicId, id);
  }

  // ── FAZA 2: Diagnosis templates ──────────────────────────────────────────
  @Get('templates')
  listTemplates(@CurrentUser() u: { clinicId: string | null; userId: string | null }) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.listTemplates(u.clinicId, u.userId);
  }

  @Post('templates')
  @Audit({ action: 'doctor.template_created', resourceType: 'diagnosis_templates' })
  createTemplate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createTemplate(u.clinicId, u.userId, TemplateSchema.parse(body));
  }

  @Post('templates/:id/update')
  @Audit({ action: 'doctor.template_updated', resourceType: 'diagnosis_templates' })
  updateTemplate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateTemplate(u.clinicId, u.userId, id, TemplateUpdateSchema.parse(body));
  }

  @Post('templates/:id/delete')
  deleteTemplate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.deleteTemplate(u.clinicId, u.userId, id);
  }

  @Post('templates/:id/use')
  useTemplate(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.bumpTemplate(u.clinicId, id);
  }

  // ── FAZA 2: Financial awareness ──────────────────────────────────────────
  @Get('patients/:id/financial')
  financial(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.patientFinancial(u.clinicId, id);
  }

  // ── FAZA 3: Doctor analytics ─────────────────────────────────────────────
  @Get('analytics')
  analytics(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Query('doctor_id') doctorId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const did = doctorId ?? u.userId;
    if (!did) throw new ForbiddenException('doctor_id required');
    return this.svc.analytics(u.clinicId, did);
  }

  // ── Notifications feed ───────────────────────────────────────────────────
  @Get('notifications')
  notifications(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Query('unread') unread?: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.listNotifications(u.clinicId, u.userId, unread === 'true');
  }

  @Get('notifications/count')
  notificationsCount(@CurrentUser() u: { clinicId: string | null; userId: string | null }) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.unreadCount(u.clinicId, u.userId);
  }

  @Post('notifications/:id/read')
  markRead(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id') id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.markRead(u.clinicId, u.userId, id === 'all' ? 'all' : id);
  }
}

@Module({
  controllers: [DoctorController],
  providers: [DoctorService, SupabaseService],
  exports: [DoctorService],
})
export class DoctorModule {}
