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

const FileCreateSchema = z.object({
  patient_id: z.string().uuid(),
  storage_path: z.string().min(1).max(500),
  kind: z.enum(['xray_opg', 'xray_ct', 'xray_periapical', 'intraoral', 'before', 'after', 'other']).default('other'),
  file_name: z.string().max(300).nullish(),
  mime_type: z.string().max(120).nullish(),
  size_bytes: z.number().int().nonnegative().nullish(),
  fdi_number: z.number().int().nullish(),
  plan_id: z.string().uuid().nullish(),
  taken_at: z.string().datetime().nullish(),
  notes: z.string().max(2000).nullish(),
});

const LAB_ORDER_TYPE = ['crown', 'bridge', 'denture', 'implant_crown', 'inlay_onlay', 'veneer', 'aligner', 'other'] as const;
const LAB_STATUS = ['ordered', 'in_progress', 'ready', 'delivered', 'canceled'] as const;

const LabOrderCreateSchema = z.object({
  patient_id: z.string().uuid(),
  plan_id: z.string().uuid().nullish(),
  item_id: z.string().uuid().nullish(),
  doctor_id: z.string().uuid().nullish(),
  lab_name: z.string().min(1).max(200),
  order_type: z.enum(LAB_ORDER_TYPE).default('other'),
  tooth_numbers: z.array(z.number().int()).default([]),
  shade: z.string().max(50).nullish(),
  material: z.string().max(120).nullish(),
  price_uzs: z.number().int().nonnegative().default(0),
  due_at: z.string().datetime().nullish(),
  notes: z.string().max(2000).nullish(),
});

const LabOrderUpdateSchema = z.object({
  status: z.enum(LAB_STATUS).optional(),
  lab_name: z.string().min(1).max(200).optional(),
  order_type: z.enum(LAB_ORDER_TYPE).optional(),
  doctor_id: z.string().uuid().nullish(),
  tooth_numbers: z.array(z.number().int()).optional(),
  shade: z.string().max(50).nullish(),
  material: z.string().max(120).nullish(),
  price_uzs: z.number().int().nonnegative().optional(),
  due_at: z.string().datetime().nullish(),
  notes: z.string().max(2000).nullish(),
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

  // ---- Rasmlar / rentgen ----
  // Yuklash mijoz tomonidan to'g'ridan-to'g'ri storage'ga; bu yerda metadata
  // saqlanadi va ro'yxatda har fayl uchun signed URL (1 soat) generatsiya qilinadi.
  async listFiles(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('dental_files')
      .select('id, patient_id, plan_id, fdi_number, kind, storage_path, file_name, mime_type, size_bytes, taken_at, notes, created_at')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{ storage_path: string } & Record<string, unknown>>;
    if (rows.length === 0) return [];
    const paths = rows.map((r) => r.storage_path);
    const { data: signed } = await admin.storage.from('dental-files').createSignedUrls(paths, 3600);
    const urlByPath = new Map<string, string>();
    for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string }>) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    }
    return rows.map((r) => ({ ...r, signed_url: urlByPath.get(r.storage_path) ?? null }));
  }

  async createFile(clinicId: string, userId: string, input: z.infer<typeof FileCreateSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('dental_files')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        plan_id: input.plan_id ?? null,
        fdi_number: input.fdi_number ?? null,
        kind: input.kind,
        storage_path: input.storage_path,
        file_name: input.file_name ?? null,
        mime_type: input.mime_type ?? null,
        size_bytes: input.size_bytes ?? null,
        taken_at: input.taken_at ?? null,
        notes: input.notes ?? null,
        uploaded_by: userId,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return { ok: true, id: (data as { id: string }).id };
  }

  async deleteFile(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data: row } = await admin
      .from('dental_files')
      .select('storage_path')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!row) throw new NotFoundException('Fayl topilmadi');
    const path = (row as { storage_path: string }).storage_path;
    await admin.storage.from('dental-files').remove([path]);
    const { error } = await admin.from('dental_files').delete().eq('clinic_id', clinicId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ---- Laboratoriya buyurtmalari ----
  private readonly LAB_SELECT =
    'id, patient_id, plan_id, item_id, doctor_id, lab_name, order_type, tooth_numbers, shade, material, ' +
    'price_uzs, status, ordered_at, due_at, received_at, delivered_at, notes, created_at, ' +
    'doctor:profiles!dental_lab_orders_doctor_id_fkey(id, full_name), patient:patients(id, full_name)';

  async listLabOrders(clinicId: string, opts: { patientId?: string; status?: string }) {
    const admin = this.supabase.admin();
    let q = admin.from('dental_lab_orders').select(this.LAB_SELECT).eq('clinic_id', clinicId);
    if (opts.patientId) q = q.eq('patient_id', opts.patientId);
    if (opts.status) q = q.eq('status', opts.status);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(300);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createLabOrder(clinicId: string, userId: string, input: z.infer<typeof LabOrderCreateSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('dental_lab_orders')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        plan_id: input.plan_id ?? null,
        item_id: input.item_id ?? null,
        doctor_id: input.doctor_id ?? null,
        lab_name: input.lab_name,
        order_type: input.order_type,
        tooth_numbers: input.tooth_numbers,
        shade: input.shade ?? null,
        material: input.material ?? null,
        price_uzs: input.price_uzs,
        due_at: input.due_at ?? null,
        notes: input.notes ?? null,
        created_by: userId,
      })
      .select(this.LAB_SELECT)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateLabOrder(clinicId: string, id: string, input: z.infer<typeof LabOrderUpdateSchema>) {
    const admin = this.supabase.admin();
    const patch: Record<string, unknown> = {};
    if (input.lab_name !== undefined) patch.lab_name = input.lab_name;
    if (input.order_type !== undefined) patch.order_type = input.order_type;
    if (input.doctor_id !== undefined) patch.doctor_id = input.doctor_id;
    if (input.tooth_numbers !== undefined) patch.tooth_numbers = input.tooth_numbers;
    if (input.shade !== undefined) patch.shade = input.shade;
    if (input.material !== undefined) patch.material = input.material;
    if (input.price_uzs !== undefined) patch.price_uzs = input.price_uzs;
    if (input.due_at !== undefined) patch.due_at = input.due_at;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status !== undefined) {
      patch.status = input.status;
      // Holat oqimi: tayyor → lab'dan qaytib keldi; topshirildi → bemorga berildi.
      if (input.status === 'ready') patch.received_at = new Date().toISOString();
      if (input.status === 'delivered') patch.delivered_at = new Date().toISOString();
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Hech narsa o‘zgartirilmadi');
    const { data, error } = await admin
      .from('dental_lab_orders')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select(this.LAB_SELECT)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Buyurtma topilmadi');
    return data;
  }

  async deleteLabOrder(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { error } = await admin.from('dental_lab_orders').delete().eq('clinic_id', clinicId).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
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

  @Get('files')
  @RequirePerm('dental.view')
  listFiles(@CurrentUser() u: { clinicId: string | null }, @Query('patient_id', ParseUUIDPipe) patientId: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listFiles(u.clinicId, patientId);
  }

  @Post('files')
  @RequirePerm('dental.edit_chart')
  @Audit({ action: 'dental.file.added', resourceType: 'dental_files' })
  createFile(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createFile(u.clinicId, u.userId, FileCreateSchema.parse(body));
  }

  @Delete('files/:id')
  @RequirePerm('dental.edit_chart')
  @Audit({ action: 'dental.file.removed', resourceType: 'dental_files' })
  removeFile(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteFile(u.clinicId, id);
  }

  @Get('lab-orders')
  @RequirePerm('dental.view')
  listLabOrders(
    @CurrentUser() u: { clinicId: string | null },
    @Query('patient_id') patientId?: string,
    @Query('status') status?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listLabOrders(u.clinicId, { patientId, status });
  }

  @Post('lab-orders')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.lab_order.created', resourceType: 'dental_lab_orders' })
  createLabOrder(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createLabOrder(u.clinicId, u.userId, LabOrderCreateSchema.parse(body));
  }

  @Patch('lab-orders/:id')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.lab_order.updated', resourceType: 'dental_lab_orders' })
  updateLabOrder(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateLabOrder(u.clinicId, id, LabOrderUpdateSchema.parse(body));
  }

  @Delete('lab-orders/:id')
  @RequirePerm('dental.manage_plan')
  @Audit({ action: 'dental.lab_order.removed', resourceType: 'dental_lab_orders' })
  removeLabOrder(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteLabOrder(u.clinicId, id);
  }
}

@Module({
  controllers: [DentalController],
  providers: [DentalService, SupabaseService],
  exports: [DentalService],
})
export class DentalModule {}
