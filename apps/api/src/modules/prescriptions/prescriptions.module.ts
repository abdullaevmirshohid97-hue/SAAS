import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreatePrescriptionSchema } from '@clary/schemas';

import { SupabaseService } from '../../common/services/supabase.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

function generateRxNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RX-${ts}-${rand}`;
}

@Injectable()
export class PrescriptionsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(
    clinicId: string,
    opts: { status?: string; patientId?: string; doctorId?: string } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('prescriptions')
      .select(
        '*, patient:patients(id, full_name, phone), doctor:profiles!doctor_id(id, full_name), items:prescription_items(*)',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.patientId) q = q.eq('patient_id', opts.patientId);
    if (opts.doctorId) q = q.eq('doctor_id', opts.doctorId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async get(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('prescriptions')
      .select(
        '*, patient:patients(id, full_name, phone), doctor:profiles!doctor_id(id, full_name), items:prescription_items(*)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException();
    return data;
  }

  async create(clinicId: string, doctorId: string, body: unknown) {
    const parsed = CreatePrescriptionSchema.parse(body);
    const admin = this.supabase.admin();

    const estimated = parsed.items.reduce(
      (sum, it) => sum + (it.unit_price_snapshot ?? 0) * it.quantity,
      0,
    );

    const { data: rx, error: rxErr } = await admin
      .from('prescriptions')
      .insert({
        clinic_id: clinicId,
        patient_id: parsed.patient_id,
        doctor_id: doctorId,
        created_by: doctorId,
        appointment_id: parsed.appointment_id ?? null,
        stay_id: parsed.stay_id ?? null,
        rx_number: generateRxNumber(),
        diagnosis_code: parsed.diagnosis_code ?? null,
        diagnosis_text: parsed.diagnosis_text ?? null,
        instructions: parsed.instructions ?? null,
        valid_until: parsed.valid_until ?? null,
        is_signed: parsed.sign,
        signed_at: parsed.sign ? new Date().toISOString() : null,
        total_estimated_uzs: estimated,
      })
      .select()
      .single();
    if (rxErr) throw new BadRequestException(rxErr.message);

    const rxTyped = rx as unknown as { id: string };
    const items = parsed.items.map((it) => ({
      clinic_id: clinicId,
      prescription_id: rxTyped.id,
      medication_id: it.medication_id ?? null,
      medication_name_snapshot: it.medication_name_snapshot,
      dosage: it.dosage ?? null,
      route: it.route ?? null,
      frequency: it.frequency ?? null,
      duration: it.duration ?? null,
      quantity: it.quantity,
      unit_price_snapshot: it.unit_price_snapshot ?? null,
      notes: it.notes ?? null,
    }));
    const { error: itemsErr } = await admin.from('prescription_items').insert(items);
    if (itemsErr) throw new BadRequestException(itemsErr.message);

    return this.get(clinicId, rxTyped.id);
  }

  async sign(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('prescriptions')
      .update({ is_signed: true, signed_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async cancel(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('prescriptions')
      .update({ status: 'canceled' })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async byPatient(clinicId: string, patientId: string) {
    return this.list(clinicId, { patientId });
  }
}

@ApiTags('prescriptions')
@Controller({ path: 'prescriptions', version: '1' })
class PrescriptionsController {
  constructor(private readonly svc: PrescriptionsService) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('status') status?: string,
    @Query('patient_id') patientId?: string,
    @Query('doctor_id') doctorId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, { status, patientId, doctorId });
  }

  @Get(':id')
  get(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.get(u.clinicId, id);
  }

  @Post()
  @Audit({ action: 'prescription.created', resourceType: 'prescriptions' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId, body);
  }

  @Patch(':id/sign')
  @Audit({ action: 'prescription.signed', resourceType: 'prescriptions' })
  sign(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.sign(u.clinicId, id);
  }

  @Patch(':id/cancel')
  @Audit({ action: 'prescription.canceled', resourceType: 'prescriptions' })
  cancel(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cancel(u.clinicId, id);
  }
}

@Module({
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService, SupabaseService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
