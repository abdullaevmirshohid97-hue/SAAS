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
}

@Module({
  controllers: [DoctorController],
  providers: [DoctorService, SupabaseService],
  exports: [DoctorService],
})
export class DoctorModule {}
