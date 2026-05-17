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
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
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
  soap_subjective: z.string().max(4000).nullish(),
  soap_objective: z.string().max(4000).nullish(),
  soap_assessment: z.string().max(4000).nullish(),
  soap_plan: z.string().max(4000).nullish(),
  diagnosis_code: z.string().max(16).nullish(),
  diagnosis_text: z.string().max(500).nullish(),
  sign: z.boolean().default(false),
});

// FAZA 2 — medical history
const MedicalHistorySchema = z.object({
  allergies: z.array(z.string()).optional(),
  chronic_conditions: z.array(z.string()).optional(),
  surgeries: z
    .array(z.object({ name: z.string(), year: z.string().optional(), notes: z.string().optional() }))
    .optional(),
  current_medications: z
    .array(z.object({ name: z.string(), dose: z.string().optional(), notes: z.string().optional() }))
    .optional(),
  blood_type: z.string().max(8).nullish(),
  medical_notes: z.string().max(2000).nullish(),
});

// FAZA 2 — patient file metadata
const PatientFileSchema = z.object({
  patient_id: z.string().uuid(),
  kind: z.enum(['xray', 'mri', 'ct', 'ultrasound', 'lab', 'prescription', 'photo', 'document', 'other']),
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
});

// =============================================================================
// Doctor workspace — dashboard widgets (income, pending lab/reports, queue).
// =============================================================================
@Injectable()
export class DoctorService {
  constructor(private readonly supabase: SupabaseService) {}

  // Shifokorning bugungi dashboard'i: navbat, income, pending ishlar.
  async dashboard(clinicId: string, doctorId: string) {
    const admin = this.supabase.admin();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [
      queueRes,
      incomeRes,
      pendingLabRes,
      pendingRxRes,
      recentRes,
    ] = await Promise.all([
      // Bugungi navbat — shu shifokorga biriktirilgan
      admin
        .from('queues')
        .select('id, ticket_no, status, joined_at, patient:patients(id, full_name, phone)')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .gte('joined_at', todayIso)
        .order('joined_at', { ascending: true }),
      // Bugungi income — shifokor appointmentlariga bog'langan transaksiyalar
      admin
        .from('transactions')
        .select('amount_uzs, appointment:appointments!inner(doctor_id)')
        .eq('clinic_id', clinicId)
        .eq('kind', 'payment')
        .eq('is_void', false)
        .eq('appointment.doctor_id', doctorId)
        .gte('created_at', todayIso),
      // Pending lab — shu shifokor buyurtma qilgan, hali tugamagan
      admin
        .from('lab_orders')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('ordered_by', doctorId)
        .in('status', ['pending', 'collected', 'running']),
      // Pending diagnostic reports
      admin
        .from('diagnostic_orders')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('ordered_by', doctorId)
        .in('status', ['pending', 'collected', 'running']),
      // Recent patients — shu shifokor oxirgi ko'rgan bemorlar
      admin
        .from('appointments')
        .select('id, scheduled_at, patient:patients(id, full_name, phone)')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(8),
    ]);

    const queue = queueRes.data ?? [];
    const income = (incomeRes.data ?? []).reduce(
      (s: number, t: { amount_uzs: number }) => s + Number(t.amount_uzs ?? 0),
      0,
    );

    return {
      queue: {
        waiting: queue.filter((q) => q.status === 'waiting'),
        called: queue.filter((q) => q.status === 'called'),
        serving: queue.filter((q) => q.status === 'serving'),
        served_today: queue.filter((q) => q.status === 'served').length,
      },
      today_income_uzs: income,
      pending_lab: pendingLabRes.count ?? 0,
      pending_reports: pendingRxRes.count ?? 0,
      recent_patients: recentRes.data ?? [],
    };
  }

  // Vitals yozish (ambulator yoki statsionar)
  async recordVitals(
    clinicId: string,
    userId: string,
    input: z.infer<typeof VitalsSchema>,
  ) {
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
    const { data } = await this.supabase
      .admin()
      .from('patients')
      .select('allergies, chronic_conditions, surgeries, current_medications, blood_type, medical_notes')
      .eq('clinic_id', clinicId)
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
    if (input.current_medications !== undefined) patch.current_medications = input.current_medications;
    if (input.blood_type !== undefined) patch.blood_type = input.blood_type;
    if (input.medical_notes !== undefined) patch.medical_notes = input.medical_notes;
    const { data, error } = await this.supabase
      .admin()
      .from('patients')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', patientId)
      .select('allergies, chronic_conditions, surgeries, current_medications, blood_type, medical_notes')
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
  async listTemplates(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('diagnosis_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('usage_count', { ascending: false });
    return data ?? [];
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

  async deleteTemplate(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('diagnosis_templates')
      .update({ is_active: false })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
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
  listFiles(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
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
  listTemplates(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listTemplates(u.clinicId);
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

  @Post('templates/:id/delete')
  deleteTemplate(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteTemplate(u.clinicId, id);
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
  financial(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
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
}

@Module({
  controllers: [DoctorController],
  providers: [DoctorService, SupabaseService],
  exports: [DoctorService],
})
export class DoctorModule {}
