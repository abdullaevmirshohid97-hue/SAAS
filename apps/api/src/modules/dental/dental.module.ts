import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePerm } from '../../common/decorators/require-perm.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// Butun-tish holatlari — dental_teeth.status CHECK bilan mos
// (20260424001040_dental.sql + 20260609000001_dental_status_extend.sql).
const TOOTH_STATUS = [
  'sound', 'caries', 'filling', 'root_canal', 'crown', 'bridge', 'implant',
  'missing', 'extracted', 'erupting', 'impacted', 'mobile', 'fractured',
  'discolored', 'sensitive', 'watch', 'pulpitis', 'periodontitis',
] as const;

const ToothUpdateSchema = z.object({
  patient_id: z.string().uuid(),
  fdi_number: z.number().int(),
  status: z.enum(TOOTH_STATUS).optional(),
  // Yuza (surface) shartlari: { mesial,distal,buccal,lingual,occlusal } → caries/filling/sealant/''
  surfaces: z.record(z.string()).optional(),
  color_hex: z.string().max(9).nullish(),
  notes: z.string().max(2000).nullish(),
});

const PlanCreateSchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid().nullish(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullish(),
});

const PlanUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['draft', 'approved', 'in_progress', 'done', 'canceled']).optional(),
  doctor_id: z.string().uuid().nullish(),
  notes: z.string().max(4000).nullish(),
});

const ItemAddSchema = z.object({
  fdi_number: z.number().int().nullish(),
  surfaces: z.record(z.string()).nullish(),
  service_id: z.string().uuid().nullish(),
  service_name: z.string().max(300).optional(),
  price_uzs: z.number().int().nonnegative().optional(),
  quantity: z.number().int().min(1).default(1),
  notes: z.string().max(2000).nullish(),
});

const ItemUpdateSchema = z.object({
  status: z.enum(['pending', 'scheduled', 'in_progress', 'done', 'canceled']).optional(),
  scheduled_at: z.string().datetime().nullish(),
  price_uzs: z.number().int().nonnegative().optional(),
  quantity: z.number().int().min(1).optional(),
  notes: z.string().max(2000).nullish(),
});

const PaySchema = z.object({
  payments: z
    .array(z.object({
      method: z.enum(['cash', 'card', 'transfer', 'click', 'payme', 'humo', 'uzcard']),
      amount_uzs: z.number().int().positive(),
    }))
    .min(1),
  notes: z.string().max(500).optional(),
});

@Injectable()
class DentalService {
  constructor(private readonly supabase: SupabaseService) {}

  // Bemorning dental kartasini topadi yoki yaratadi (clinic+patient UNIQUE),
  // barcha belgilangan tishlar bilan qaytaradi. UI 32 (yoki sut) tishni
  // chizadi, saqlangan tishlarni ustiga qo'yadi.
  async getOrCreateChart(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    let { data: chart } = await admin
      .from('dental_charts')
      .select('id, clinic_id, patient_id, doctor_id, notes, is_adult, version, updated_at')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .maybeSingle();

    if (!chart) {
      const { data: created, error } = await admin
        .from('dental_charts')
        .insert({ clinic_id: clinicId, patient_id: patientId })
        .select('id, clinic_id, patient_id, doctor_id, notes, is_adult, version, updated_at')
        .single();
      if (error) throw new BadRequestException(error.message);
      chart = created;
    }

    const chartId = (chart as { id: string }).id;
    const { data: teeth } = await admin
      .from('dental_teeth')
      .select('id, fdi_number, surfaces, status, color_hex, last_intervention_at, notes, updated_at')
      .eq('chart_id', chartId)
      .order('fdi_number', { ascending: true });

    return { chart, teeth: teeth ?? [] };
  }

  async updateTooth(
    clinicId: string,
    userId: string,
    input: z.infer<typeof ToothUpdateSchema>,
  ) {
    const admin = this.supabase.admin();
    const { chart } = await this.getOrCreateChart(clinicId, input.patient_id);
    const chartId = (chart as { id: string }).id;

    const row: Record<string, unknown> = {
      chart_id: chartId,
      clinic_id: clinicId,
      fdi_number: input.fdi_number,
      updated_by: userId,
    };
    if (input.status !== undefined) row.status = input.status;
    if (input.surfaces !== undefined) row.surfaces = input.surfaces;
    if (input.color_hex !== undefined) row.color_hex = input.color_hex;
    if (input.notes !== undefined) row.notes = input.notes;
    if (input.status && input.status !== 'sound') {
      row.last_intervention_at = new Date().toISOString();
    }

    const { data, error } = await admin
      .from('dental_teeth')
      .upsert(row, { onConflict: 'chart_id,fdi_number' })
      .select('id, fdi_number, surfaces, status, color_hex, last_intervention_at, notes, updated_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---- Davolash rejalari ----
  async listPlans(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('dental_treatment_plans')
      .select(
        'id, patient_id, doctor_id, title, status, total_uzs, paid_uzs, notes, ' +
          'approved_at, completed_at, created_at, updated_at, ' +
          'doctor:profiles!dental_treatment_plans_doctor_id_fkey(id, full_name), ' +
          'items:dental_treatment_items(id, fdi_number, surfaces, service_id, service_name_snapshot, ' +
          'price_uzs, quantity, status, scheduled_at, done_at, sort_order, notes, created_at)',
      )
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getPlan(clinicId: string, planId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('dental_treatment_plans')
      .select(
        'id, patient_id, doctor_id, title, status, total_uzs, paid_uzs, notes, ' +
          'approved_at, completed_at, created_at, updated_at, ' +
          'doctor:profiles!dental_treatment_plans_doctor_id_fkey(id, full_name), ' +
          'items:dental_treatment_items(id, fdi_number, surfaces, service_id, service_name_snapshot, ' +
          'price_uzs, quantity, status, scheduled_at, done_at, sort_order, notes, created_at)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', planId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Reja topilmadi');
    return data;
  }

  async createPlan(clinicId: string, userId: string, input: z.infer<typeof PlanCreateSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('dental_treatment_plans')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        doctor_id: input.doctor_id ?? null,
        title: input.title ?? 'Davolash rejasi',
        notes: input.notes ?? null,
        created_by: userId,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return this.getPlan(clinicId, (data as { id: string }).id);
  }

  async updatePlan(clinicId: string, planId: string, input: z.infer<typeof PlanUpdateSchema>) {
    const admin = this.supabase.admin();
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.doctor_id !== undefined) patch.doctor_id = input.doctor_id;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 'approved') patch.approved_at = new Date().toISOString();
      if (input.status === 'done') patch.completed_at = new Date().toISOString();
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Hech narsa o‘zgartirilmadi');
    const { error } = await admin
      .from('dental_treatment_plans')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', planId);
    if (error) throw new BadRequestException(error.message);
    return this.getPlan(clinicId, planId);
  }

  // Rejaga band (item) qo'shish. Xizmat tanlansa narx+nom snapshot qilinadi.
  // total_uzs trigger orqali avtomatik qayta hisoblanadi.
  async addItem(clinicId: string, planId: string, input: z.infer<typeof ItemAddSchema>) {
    const admin = this.supabase.admin();

    // Reja shu klinikaga tegishlimi?
    const { data: plan } = await admin
      .from('dental_treatment_plans')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('id', planId)
      .maybeSingle();
    if (!plan) throw new NotFoundException('Reja topilmadi');

    let name = input.service_name?.trim() ?? '';
    let price = input.price_uzs ?? 0;
    if (input.service_id) {
      const { data: svc } = await admin
        .from('services')
        .select('name_i18n, price_uzs')
        .eq('clinic_id', clinicId)
        .eq('id', input.service_id)
        .maybeSingle();
      if (!svc) throw new BadRequestException('Xizmat topilmadi');
      const nameI18n = (svc as { name_i18n: Record<string, string> }).name_i18n;
      if (!name) name = nameI18n['uz-Latn'] ?? nameI18n.ru ?? Object.values(nameI18n)[0] ?? 'Xizmat';
      if (!input.price_uzs) price = Number((svc as { price_uzs: number }).price_uzs ?? 0);
    }
    if (!name) throw new BadRequestException('Xizmat nomi yoki service_id majburiy');

    const { data, error } = await admin
      .from('dental_treatment_items')
      .insert({
        plan_id: planId,
        clinic_id: clinicId,
        fdi_number: input.fdi_number ?? null,
        surfaces: input.surfaces ?? null,
        service_id: input.service_id ?? null,
        service_name_snapshot: name,
        price_uzs: price,
        quantity: input.quantity,
        notes: input.notes ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return { ok: true, id: (data as { id: string }).id };
  }

  async updateItem(clinicId: string, userId: string, itemId: string, input: z.infer<typeof ItemUpdateSchema>) {
    const admin = this.supabase.admin();
    const patch: Record<string, unknown> = {};
    if (input.scheduled_at !== undefined) patch.scheduled_at = input.scheduled_at;
    if (input.price_uzs !== undefined) patch.price_uzs = input.price_uzs;
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 'done') {
        patch.done_at = new Date().toISOString();
        patch.done_by = userId;
      }
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Hech narsa o‘zgartirilmadi');
    const { data, error } = await admin
      .from('dental_treatment_items')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', itemId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Band topilmadi');
    return { ok: true };
  }

  async removeItem(clinicId: string, itemId: string) {
    const admin = this.supabase.admin();
    const { error } = await admin
      .from('dental_treatment_items')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', itemId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Reja bo'yicha to'lov qabul qilish (bosqichli to'lov). Reception registriga
  // yoziladi (kassa/jurnalda ko'rinadi). Aralash (split) usul qo'llab-quvvatlanadi.
  // plan.paid_uzs to'langan summaga oshiriladi.
  async payPlan(clinicId: string, userId: string, planId: string, input: z.infer<typeof PaySchema>) {
    const admin = this.supabase.admin();

    const { data: plan } = await admin
      .from('dental_treatment_plans')
      .select('id, patient_id, doctor_id, paid_uzs, total_uzs, title')
      .eq('clinic_id', clinicId)
      .eq('id', planId)
      .maybeSingle();
    if (!plan) throw new NotFoundException('Reja topilmadi');
    const p = plan as { id: string; patient_id: string; doctor_id: string | null; paid_uzs: number; title: string };

    const legs = input.payments.filter((l) => l.amount_uzs > 0);
    const paid = legs.reduce((s, l) => s + l.amount_uzs, 0);
    if (paid <= 0) throw new BadRequestException('To‘lov summasi 0');

    // Pul harakati — faol smena majburiy.
    const shiftId = await this.supabase.requireActiveShift(clinicId);
    const isMixed = legs.length > 1;
    const note = input.notes?.trim() || `Stomatologiya: ${p.title}`;

    const { data: trx, error: trxErr } = await admin
      .from('transactions')
      .insert({
        clinic_id: clinicId,
        patient_id: p.patient_id,
        doctor_id: p.doctor_id,
        shift_id: shiftId,
        cashier_id: userId,
        register: 'reception',
        kind: 'payment',
        amount_uzs: paid,
        payment_method: isMixed ? 'mixed' : legs[0]!.method,
        notes: note,
      })
      .select('id')
      .single();
    if (trxErr || !trx) throw new BadRequestException(trxErr?.message ?? 'Tranzaksiya yaratilmadi');
    const trxId = (trx as { id: string }).id;

    if (isMixed) {
      const { error: legErr } = await admin.from('transaction_payments').insert(
        legs.map((l) => ({
          clinic_id: clinicId,
          transaction_id: trxId,
          method: l.method,
          amount_uzs: l.amount_uzs,
          source: l.method === 'cash' ? 'cash_drawer' : 'bank',
        })),
      );
      if (legErr) throw new BadRequestException(legErr.message);
    }

    const { error: updErr } = await admin
      .from('dental_treatment_plans')
      .update({ paid_uzs: Number(p.paid_uzs ?? 0) + paid })
      .eq('clinic_id', clinicId)
      .eq('id', planId);
    if (updErr) throw new BadRequestException(updErr.message);

    return { ok: true, transaction_id: trxId, paid_uzs: paid };
  }
}

@ApiTags('dental')
@Controller('dental')
class DentalController {
  constructor(private readonly svc: DentalService) {}

  @Get('chart')
  @RequirePerm('dental.view')
  getChart(@CurrentUser() u: { clinicId: string | null }, @Query('patient_id', ParseUUIDPipe) patientId: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getOrCreateChart(u.clinicId, patientId);
  }

  @Patch('tooth')
  @RequirePerm('dental.edit_chart')
  @Audit({ action: 'dental.tooth.updated', resourceType: 'dental_teeth' })
  updateTooth(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateTooth(u.clinicId, u.userId, ToothUpdateSchema.parse(body));
  }

  @Get('plans')
  @RequirePerm('dental.view')
  listPlans(@CurrentUser() u: { clinicId: string | null }, @Query('patient_id', ParseUUIDPipe) patientId: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listPlans(u.clinicId, patientId);
  }

  @Get('plans/:id')
  @RequirePerm('dental.view')
  getPlan(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getPlan(u.clinicId, id);
  }

  @Post('plans')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.plan.created', resourceType: 'dental_treatment_plans' })
  createPlan(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createPlan(u.clinicId, u.userId, PlanCreateSchema.parse(body));
  }

  @Patch('plans/:id')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.plan.updated', resourceType: 'dental_treatment_plans' })
  updatePlan(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updatePlan(u.clinicId, id, PlanUpdateSchema.parse(body));
  }

  @Post('plans/:id/items')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.item.added', resourceType: 'dental_treatment_items' })
  addItem(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.addItem(u.clinicId, id, ItemAddSchema.parse(body));
  }

  @Patch('items/:id')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.item.updated', resourceType: 'dental_treatment_items' })
  updateItem(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateItem(u.clinicId, u.userId, id, ItemUpdateSchema.parse(body));
  }

  @Delete('items/:id')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.item.removed', resourceType: 'dental_treatment_items' })
  removeItem(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.removeItem(u.clinicId, id);
  }

  @Post('plans/:id/pay')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.plan.paid', resourceType: 'transactions' })
  payPlan(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.payPlan(u.clinicId, u.userId, id, PaySchema.parse(body));
  }
}

@Module({
  controllers: [DentalController],
  providers: [DentalService, SupabaseService],
  exports: [DentalService],
})
export class DentalModule {}
