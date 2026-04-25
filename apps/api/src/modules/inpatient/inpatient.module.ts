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
import { ApiTags } from '@nestjs/swagger';
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
  planned_discharge_at: z.string().datetime().optional(),
  referral_id: z.string().uuid().optional(),
  initial_deposit_uzs: z.number().int().nonnegative().optional(),
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

const LedgerSchema = z.object({
  patient_id: z.string().uuid(),
  stay_id: z.string().uuid().optional(),
  entry_kind: z.enum(['deposit', 'charge', 'refund', 'adjustment']),
  amount_uzs: z.number().int(),
  description: z.string().optional(),
});

@Injectable()
class InpatientService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string, opts: { status?: string } = {}) {
    const admin = this.supabase.admin();
    let q = admin
      .from('inpatient_stays')
      .select(
        '*, patient:patients(id, full_name, phone), room:rooms(id, number, section, floor, daily_price_uzs), doctor:profiles!attending_doctor_id(id, full_name)',
      )
      .eq('clinic_id', clinicId)
      .order('admitted_at', { ascending: false });
    if (opts.status) q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async roomMap(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ data: rooms }, { data: stays }] = await Promise.all([
      admin
        .from('rooms')
        .select('id, number, floor, section, building, capacity, daily_price_uzs, status, type, includes_meals, notes')
        .eq('clinic_id', clinicId)
        .eq('is_archived', false)
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

    const groupedByFloor = new Map<number, Array<Record<string, unknown>>>();
    for (const r of (rooms ?? []) as unknown as Array<{ id: string; number: string; floor: number | null; section: string | null; capacity: number; daily_price_uzs: number | null; status: string; type: string | null; includes_meals: boolean; notes: string | null }>) {
      const floor = r.floor ?? 0;
      if (!groupedByFloor.has(floor)) groupedByFloor.set(floor, []);
      groupedByFloor.get(floor)!.push({
        ...r,
        occupants: occ.get(r.id) ?? [],
        occupied: (occ.get(r.id) ?? []).length,
        vacancy: Math.max(0, r.capacity - (occ.get(r.id) ?? []).length),
      });
    }

    return {
      floors: Array.from(groupedByFloor.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([floor, rooms]) => ({ floor, rooms })),
    };
  }

  async admit(clinicId: string, userId: string, input: z.infer<typeof AdmitSchema>) {
    const admin = this.supabase.admin();
    if (input.room_id) {
      await this.assertRoomCapacity(clinicId, input.room_id);
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
        planned_discharge_at: input.planned_discharge_at ?? null,
        admitted_at: new Date().toISOString(),
        status: 'admitted',
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

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

  async transfer(clinicId: string, stayId: string, body: z.infer<typeof TransferSchema>) {
    await this.assertRoomCapacity(clinicId, body.room_id);
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('inpatient_stays')
      .update({
        room_id: body.room_id,
        bed_no: body.bed_no ?? null,
        attending_notes: body.reason ?? null,
      })
      .eq('clinic_id', clinicId)
      .eq('id', stayId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async discharge(clinicId: string, id: string, summary?: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('inpatient_stays')
      .update({
        discharged_at: new Date().toISOString(),
        discharge_summary: summary ?? null,
        status: 'discharged',
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
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
    const { data, error } = await admin
      .from('patient_ledger')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        stay_id: input.stay_id ?? null,
        entry_kind: input.entry_kind,
        amount_uzs: signedAmount,
        description: input.description ?? null,
        recorded_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
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

  @Post('admit')
  @Audit({ action: 'inpatient.admitted', resourceType: 'inpatient_stays' })
  admit(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.admit(u.clinicId, u.userId, AdmitSchema.parse(body));
  }

  @Patch(':id/transfer')
  @Audit({ action: 'inpatient.transferred', resourceType: 'inpatient_stays' })
  transfer(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.transfer(u.clinicId, id, TransferSchema.parse(body));
  }

  @Patch(':id/discharge')
  @Audit({ action: 'inpatient.discharged', resourceType: 'inpatient_stays' })
  discharge(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { summary?: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.discharge(u.clinicId, id, body?.summary);
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
