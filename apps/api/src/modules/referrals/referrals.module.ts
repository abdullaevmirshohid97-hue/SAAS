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
import { CreateServiceReferralSchema } from '@clary/schemas';

import { SupabaseService } from '../../common/services/supabase.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@Injectable()
export class ReferralsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(
    clinicId: string,
    opts: { status?: string; kind?: string; patientId?: string; doctorId?: string } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('service_referrals')
      .select(
        '*, patient:patients(id, full_name, phone), doctor:profiles!doctor_id(id, full_name), service:services(id, name, price_uzs), diagnostic:diagnostic_types(id, name, price_uzs), lab:lab_tests(id, name, price_uzs)',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.kind) q = q.eq('referral_kind', opts.kind);
    if (opts.patientId) q = q.eq('patient_id', opts.patientId);
    if (opts.doctorId) q = q.eq('doctor_id', opts.doctorId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(
    clinicId: string,
    doctorId: string,
    body: unknown,
  ) {
    const parsed = CreateServiceReferralSchema.parse(body);
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('service_referrals')
      .insert({
        clinic_id: clinicId,
        doctor_id: doctorId,
        created_by: doctorId,
        patient_id: parsed.patient_id,
        appointment_id: parsed.appointment_id ?? null,
        stay_id: parsed.stay_id ?? null,
        referral_kind: parsed.referral_kind,
        target_service_id: parsed.target_service_id ?? null,
        target_diagnostic_type_id: parsed.target_diagnostic_type_id ?? null,
        target_lab_test_id: parsed.target_lab_test_id ?? null,
        target_room_id: parsed.target_room_id ?? null,
        urgency: parsed.urgency,
        clinical_indication: parsed.clinical_indication ?? null,
        notes: parsed.notes ?? null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async markReceived(clinicId: string, id: string) {
    return this.setStatus(clinicId, id, 'received');
  }

  async markBilled(clinicId: string, id: string, transactionId?: string) {
    const patch: Record<string, unknown> = {
      status: 'billed',
      fulfilled_at: new Date().toISOString(),
    };
    if (transactionId) patch.fulfilled_transaction_id = transactionId;
    return this.updateRaw(clinicId, id, patch);
  }

  async markCompleted(clinicId: string, id: string) {
    return this.setStatus(clinicId, id, 'completed');
  }

  async cancel(clinicId: string, id: string, reason?: string) {
    return this.updateRaw(clinicId, id, {
      status: 'canceled',
      notes: reason ?? 'canceled',
    });
  }

  private async setStatus(clinicId: string, id: string, status: string) {
    return this.updateRaw(clinicId, id, { status });
  }

  private async updateRaw(clinicId: string, id: string, patch: Record<string, unknown>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('service_referrals')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException();
    return data;
  }
}

@ApiTags('referrals')
@Controller({ path: 'referrals', version: '1' })
class ReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('patient_id') patientId?: string,
    @Query('doctor_id') doctorId?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, { status, kind, patientId, doctorId });
  }

  @Post()
  @Audit({ action: 'referral.created', resourceType: 'service_referrals' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId, body);
  }

  @Patch(':id/receive')
  @Audit({ action: 'referral.received', resourceType: 'service_referrals' })
  receive(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.markReceived(u.clinicId, id);
  }

  @Patch(':id/complete')
  @Audit({ action: 'referral.completed', resourceType: 'service_referrals' })
  complete(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.markCompleted(u.clinicId, id);
  }

  @Patch(':id/cancel')
  @Audit({ action: 'referral.canceled', resourceType: 'service_referrals' })
  cancel(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cancel(u.clinicId, id, body?.reason);
  }
}

@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService, SupabaseService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
