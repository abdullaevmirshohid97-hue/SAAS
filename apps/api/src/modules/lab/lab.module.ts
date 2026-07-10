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
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { toFhirObservation, type LabResultForFhir } from './analyzers/fhir-mapper';
import { GenericHl7Adapter } from './analyzers/analyzer-adapter';

const OrderSchema = z
  .object({
    patient_id: z.string().uuid(),
    test_ids: z.array(z.string().uuid()).default([]),
    // Panel(lar) — har biri bir nechta testni qo'shadi. test_ids bilan birlashtiriladi.
    panel_ids: z.array(z.string().uuid()).default([]),
    urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
    clinical_notes: z.string().optional(),
    appointment_id: z.string().uuid().optional(),
    stay_id: z.string().uuid().optional(),
    referral_id: z.string().uuid().optional(),
    notify_sms: z.boolean().default(true),
    // Lab POS — mustaqil sotuv (to'lov lab ichida saqlanadi, umumiy kassaga tegmaydi).
    payment_method: z.string().max(32).optional(),
    paid_uzs: z.number().int().nonnegative().optional(),
    debt_uzs: z.number().int().nonnegative().optional(),
    discount_uzs: z.number().int().nonnegative().optional(),
    // Xalqaro standart tashxis kodi (ixtiyoriy).
    icd10_code: z.string().max(16).optional(),
    // Integratsiya rejimida transaction shu smenaga bog'lanadi (kassa drawer).
    shift_id: z.string().uuid().optional(),
  })
  .refine((v) => v.test_ids.length > 0 || v.panel_ids.length > 0, {
    message: 'test_ids yoki panel_ids dan kamida bittasi kerak',
  });

const ResultSchema = z.object({
  order_item_id: z.string().uuid(),
  value: z.string().min(1),
  unit: z.string().optional(),
  reference_range: z.string().optional(),
  interpretation: z.string().optional(),
  is_abnormal: z.boolean().optional(),
  is_final: z.boolean().default(true),
  attachment_url: z.string().url().optional(),
  attachment_mime: z.string().optional(),
  // FAZA 2 — smart entry
  numeric_value: z.number().nullish(),
  loinc_code: z.string().nullish(),
  flag: z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high']).nullish(),
  // FAZA 3 — validatsiya holati. Default 'validated' = orqaga moslik (oddiy oqim).
  // Validatsiya talab qiluvchi klinika 'draft' yuboradi → keyin tasdiqlanadi.
  validation_status: z.enum(['draft', 'validated']).default('validated'),
});

const SampleSchema = z.object({
  order_id: z.string().uuid(),
  sample_type: z
    .enum(['blood', 'urine', 'stool', 'swab', 'tissue', 'other'])
    .default('blood'),
});

type LabStatus = 'pending' | 'collected' | 'running' | 'completed' | 'reported' | 'delivered' | 'canceled';

const NEXT: Record<LabStatus, LabStatus[]> = {
  pending: ['collected', 'canceled'],
  collected: ['running', 'canceled'],
  running: ['completed', 'canceled'],
  completed: ['reported', 'canceled'],
  reported: ['delivered'],
  delivered: [],
  canceled: [],
};

type ResultFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

/**
 * Referens diapazon ("3.5 - 5.5" yoki "3.5-5.5") va raqamli qiymatdan natija
 * darajasini aniqlaydi. Diapazondan 50%+ chetga chiqsa — kritik. Aniqlay
 * olmasa null qaytaradi (smart entry uni belgilamaydi).
 */
function detectFlag(numeric: number | null, refRange: string | null): ResultFlag | null {
  if (numeric === null || !refRange) return null;
  const m = refRange.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return null;
  const span = high - low;
  if (numeric < low) {
    return numeric < low - span * 0.5 ? 'critical_low' : 'low';
  }
  if (numeric > high) {
    return numeric > high + span * 0.5 ? 'critical_high' : 'high';
  }
  return 'normal';
}

@Injectable()
export class LabService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    clinicId: string,
    params: { status?: string; patient_id?: string; date?: string; q?: string } = {},
  ) {
    const admin = this.supabase.admin();
    const search = params.q?.trim();
    // Bemor ismi bo'yicha qidiruvda embedded relation inner join bo'lishi kerak.
    const patientRel = search
      ? 'patient:patients!inner(id, full_name, phone)'
      : 'patient:patients(id, full_name, phone)';
    let q = admin
      .from('lab_orders')
      .select(
        `*, ${patientRel}, items:lab_order_items(*, test:lab_tests(id, name_i18n, unit, reference_range_male, reference_range_female, reference_range_child))`,
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (params.status) q = q.eq('status', params.status);
    if (params.patient_id) q = q.eq('patient_id', params.patient_id);
    if (search) q = q.ilike('patient.full_name', `%${search}%`);
    if (params.date) {
      const start = `${params.date}T00:00:00.000Z`;
      const end = `${params.date}T23:59:59.999Z`;
      q = q.gte('created_at', start).lte('created_at', end);
    }
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async kanban(clinicId: string, date?: string) {
    const today = date ?? new Date().toISOString().slice(0, 10);
    const rows = await this.list(clinicId, { date: today });
    const byStatus: Record<string, unknown[]> = {
      pending: [],
      collected: [],
      running: [],
      completed: [],
      reported: [],
      delivered: [],
      canceled: [],
    };
    for (const r of rows as Array<{ status: string }>) {
      const key = r.status in byStatus ? r.status : 'pending';
      (byStatus[key] ??= []).push(r);
    }
    return { date: today, by_status: byStatus };
  }

  /**
   * Lab KASSA — davr bo'yicha daromad: to'lov usuli kesimida to'langan jami +
   * qarz + chegirma. Umumiy kassaga TEGMAYDI (lab o'z hisobini yuritadi).
   */
  async revenue(clinicId: string, from?: string, to?: string) {
    const admin = this.supabase.admin();
    let q = admin
      .from('lab_orders')
      .select('payment_method, total_uzs, paid_uzs, debt_uzs, discount_uzs, created_at')
      .eq('clinic_id', clinicId);
    if (from) q = q.gte('created_at', `${from}T00:00:00.000Z`);
    if (to) q = q.lte('created_at', `${to}T23:59:59.999Z`);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows =
      (data as Array<{
        payment_method: string | null;
        paid_uzs: number;
        debt_uzs: number;
        discount_uzs: number;
      }>) ?? [];
    const byMethod: Record<string, number> = {};
    let totalPaid = 0;
    let totalDebt = 0;
    let totalDiscount = 0;
    for (const r of rows) {
      const paid = Number(r.paid_uzs ?? 0);
      const m = r.payment_method ?? 'other';
      byMethod[m] = (byMethod[m] ?? 0) + paid;
      totalPaid += paid;
      totalDebt += Number(r.debt_uzs ?? 0);
      totalDiscount += Number(r.discount_uzs ?? 0);
    }
    return {
      count: rows.length,
      total_paid_uzs: totalPaid,
      total_debt_uzs: totalDebt,
      total_discount_uzs: totalDiscount,
      by_method: byMethod,
    };
  }

  /** Lab qarzdorlar — qarzi bor (debt_uzs > 0) lab sotuvlari. */
  async debtors(clinicId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('lab_orders')
      .select(
        'id, created_at, total_uzs, paid_uzs, debt_uzs, payment_method, status, ' +
          'patient:patients(id, full_name, phone)',
      )
      .eq('clinic_id', clinicId)
      .gt('debt_uzs', 0)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(clinicId: string, userId: string, input: z.infer<typeof OrderSchema>) {
    const admin = this.supabase.admin();

    // Panellardan test ID'larini yig'ib, to'g'ridan-to'g'ri test_ids bilan birlashtiramiz.
    const testIdSet = new Set<string>(input.test_ids);
    if (input.panel_ids.length > 0) {
      const { data: panelItems, error: panelErr } = await admin
        .from('lab_panel_items')
        .select('lab_test_id')
        .eq('clinic_id', clinicId)
        .in('panel_id', input.panel_ids);
      if (panelErr) throw new BadRequestException(panelErr.message);
      for (const it of (panelItems as Array<{ lab_test_id: string }> | null) ?? []) {
        testIdSet.add(it.lab_test_id);
      }
    }
    const testIds = [...testIdSet];
    if (testIds.length === 0) {
      throw new BadRequestException('Buyurtmada birorta ham analiz yo‘q');
    }

    const { data: tests, error: testsErr } = await admin
      .from('lab_tests')
      .select('id, name_i18n, price_uzs')
      .eq('clinic_id', clinicId)
      .in('id', testIds);
    if (testsErr) throw new BadRequestException(testsErr.message);
    if (!tests || tests.length !== testIds.length) {
      throw new NotFoundException('Some tests not found');
    }

    const total = (tests as Array<{ price_uzs: number }>).reduce(
      (s, t) => s + Number(t.price_uzs),
      0,
    );

    // Lab POS to'lov — chegirma, to'langan, qarz. Berilmasa: to'liq to'langan deb hisoblanadi.
    const discount = Math.min(input.discount_uzs ?? 0, total);
    const net = Math.max(0, total - discount);
    const paid = input.paid_uzs ?? net;
    const debt = input.debt_uzs ?? Math.max(0, net - paid);

    const { data: order, error } = await admin
      .from('lab_orders')
      .insert({
        clinic_id: clinicId,
        patient_id: input.patient_id,
        appointment_id: input.appointment_id ?? null,
        ordered_by: userId,
        urgency: input.urgency,
        clinical_notes: input.clinical_notes ?? null,
        total_uzs: total,
        notify_sms: input.notify_sms,
        payment_method: input.payment_method ?? null,
        paid_uzs: paid,
        debt_uzs: debt,
        discount_uzs: discount,
        icd10_code: input.icd10_code ?? null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    const orderId = (order as { id: string }).id;

    const items = (tests as Array<{ id: string; name_i18n: Record<string, string>; price_uzs: number }>).map(
      (t) => ({
        clinic_id: clinicId,
        order_id: orderId,
        lab_test_id: t.id,
        name_snapshot: t.name_i18n['uz-Latn'] ?? t.name_i18n['uz'] ?? t.name_i18n['en'] ?? 'Lab',
        price_snapshot: Number(t.price_uzs),
        status: 'pending',
      }),
    );
    if (items.length > 0) await admin.from('lab_order_items').insert(items);

    if (input.referral_id) {
      await admin
        .from('service_referrals')
        .update({ status: 'billed' })
        .eq('clinic_id', clinicId)
        .eq('id', input.referral_id);
    }

    // Integratsiya rejimi (default): lab sotuvini umumiy jurnal/kassaga transaction
    // sifatida yozamiz. Standalone: faqat lab_orders (izolyatsiya, transaction yo'q).
    const { data: clinicRow } = await admin
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .maybeSingle();
    const labMode =
      (clinicRow?.settings as { lab_mode?: string } | null)?.lab_mode ?? 'integrated';
    if (labMode === 'integrated') {
      const { data: trx } = await admin
        .from('transactions')
        .insert({
          clinic_id: clinicId,
          cashier_id: userId,
          shift_id: input.shift_id ?? null,
          patient_id: input.patient_id,
          kind: 'payment',
          amount_uzs: paid,
          payment_method: input.payment_method ?? 'cash',
        })
        .select('id')
        .single();
      const trxId = (trx as { id: string } | null)?.id;
      if (trxId && items.length > 0) {
        await admin.from('transaction_items').insert(
          items.map((it) => ({
            clinic_id: clinicId,
            transaction_id: trxId,
            service_name_snapshot: it.name_snapshot,
            service_price_snapshot: it.price_snapshot,
            quantity: 1,
            final_amount_uzs: it.price_snapshot,
          })),
        );
      }
    }

    return order;
  }

  async transition(
    clinicId: string,
    userId: string,
    id: string,
    next: LabStatus,
    opts: { reason?: string; channel?: 'sms' | 'telegram' } = {},
  ) {
    const admin = this.supabase.admin();
    const { data: order, error } = await admin
      .from('lab_orders')
      .select('id, status, patient_id, notify_sms, patient:patients(id, full_name, phone)')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException(error.message);
    const row = order as unknown as {
      id: string;
      status: LabStatus;
      patient_id: string;
      notify_sms: boolean;
      patient: { full_name: string; phone?: string | null } | null;
    };
    if (!NEXT[row.status].includes(next)) {
      throw new BadRequestException(`Illegal transition ${row.status} → ${next}`);
    }
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: next };
    if (next === 'collected') patch['sample_collected_at'] = now;
    if (next === 'collected') patch['sample_collected_by'] = userId;
    if (next === 'collected') patch['received_at'] = now;
    if (next === 'running') patch['running_at'] = now;
    if (next === 'completed') patch['completed_at'] = now;
    if (next === 'reported') {
      patch['reported_at'] = now;
      patch['reported_by'] = userId;
    }
    if (next === 'delivered') patch['delivered_at'] = now;
    if (next === 'canceled' && opts.reason) patch['clinical_notes'] = opts.reason;

    const { error: upErr } = await admin
      .from('lab_orders')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (upErr) throw new BadRequestException(upErr.message);

    // Notify the patient as soon as the order is "completed" — natijalar
    // tayyor bo'ldi, lekin rasmiy hujjat chiqishini kutishning hojati yo'q.
    // `reported` ham aynan shu idempotency key bilan enqueue qilinadi,
    // shuning uchun bitta tahlil bo'yicha faqat bitta SMS yuboriladi.
    const shouldSms =
      (next === 'completed' || next === 'reported') && row.notify_sms && row.patient?.phone;
    if (shouldSms) {
      const channel = opts.channel ?? 'sms';
      const body = `Hurmatli ${row.patient!.full_name}, laboratoriya natijalaringiz tayyor. Klinikaga murojaat qiling.`;
      try {
        await this.notifications.enqueue({
          clinicId,
          channel,
          recipient: row.patient!.phone!,
          body,
          templateKey: 'lab.result_ready',
          patientId: row.patient_id,
          relatedResource: 'lab_orders',
          relatedId: id,
          idempotencyKey: `lab_ready:${channel}:${id}`,
        });
      } catch (err) {
        // Never block the state transition on messaging failures.
        console.warn('[lab] notify enqueue failed:', (err as Error).message);
      }
    }

    return this.get(clinicId, id);
  }

  async get(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const [{ data: order, error }, { data: clinic }] = await Promise.all([
      admin
        .from('lab_orders')
        .select(
          '*, patient:patients(id, full_name, first_name, last_name, patronymic, dob, gender, phone), items:lab_order_items(*, test:lab_tests(id, name_i18n, unit, reference_range_male, reference_range_female, reference_range_child), results:lab_results(*))',
        )
        .eq('clinic_id', clinicId)
        .eq('id', id)
        .single(),
      admin
        .from('clinics')
        .select('id, name, slug, logo_url, primary_color, phone, address, city, region')
        .eq('id', clinicId)
        .maybeSingle(),
    ]);
    if (error) throw new NotFoundException(error.message);
    return { ...order, clinic };
  }

  /**
   * QR public natija — `public_token` bo'yicha, LOGINSIZ. Bemor qog'ozdagi QR'ni
   * skaner qilganda ochiladi. Faqat `reported`/`delivered` (yakuniy) natija
   * qaytariladi — tugallanmagan natija ochilmaydi. Telefon/moliya QAYTARILMAYDI.
   */
  async getPublicResult(token: string) {
    const admin = this.supabase.admin();
    const { data: order, error } = await admin
      .from('lab_orders')
      .select(
        'id, clinic_id, status, urgency, created_at, reported_at, delivered_at, clinical_notes, ' +
          'patient:patients(full_name, first_name, last_name, patronymic, dob, gender), ' +
          'items:lab_order_items(id, name_snapshot, status, ' +
          'test:lab_tests(name_i18n, unit, reference_range_male, reference_range_female, reference_range_child), ' +
          'results:lab_results(value, unit, is_abnormal, is_final, flag))',
      )
      .eq('public_token', token)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!order) throw new NotFoundException('Natija topilmadi');
    const row = order as unknown as Record<string, unknown> & {
      clinic_id: string;
      status: string;
    };
    if (row.status !== 'reported' && row.status !== 'delivered') {
      throw new BadRequestException('NATIJA_TAYYOR_EMAS');
    }
    const { data: clinic } = await admin
      .from('clinics')
      .select('id, name, logo_url, primary_color, phone, address, city, region')
      .eq('id', row.clinic_id)
      .maybeSingle();
    return { ...row, clinic };
  }

  async recordResult(clinicId: string, userId: string, input: z.infer<typeof ResultSchema>) {
    const admin = this.supabase.admin();

    const { data: item, error: itemErr } = await admin
      .from('lab_order_items')
      .select('id, order_id, clinic_id')
      .eq('clinic_id', clinicId)
      .eq('id', input.order_item_id)
      .single();
    if (itemErr) throw new NotFoundException(itemErr.message);

    // Smart entry — raqamli qiymat va darajani avtomatik aniqlaymiz (agar
    // mijoz tomonidan berilmagan bo'lsa). value matni asl ko'rinishni saqlaydi.
    const numeric =
      input.numeric_value ??
      (Number.isFinite(Number(input.value)) ? Number(input.value) : null);
    const flag =
      input.flag ?? detectFlag(numeric, input.reference_range ?? null);
    const isAbnormal =
      input.is_abnormal ??
      (flag !== null && flag !== 'normal');

    // FAZA 3 — draft natija validatsiyani kutadi: is_final majburan false,
    // shunda natija no_update_final qoidasiga tushmaydi va validator keyin
    // tasdiqlay oladi. 'validated' (oddiy oqim) bo'lsa input.is_final amal qiladi.
    const isDraft = input.validation_status === 'draft';
    const isFinal = isDraft ? false : input.is_final;

    const { data: inserted, error } = await admin
      .from('lab_results')
      .insert({
        clinic_id: clinicId,
        order_item_id: input.order_item_id,
        value: input.value,
        unit: input.unit ?? null,
        reference_range: input.reference_range ?? null,
        interpretation: input.interpretation ?? null,
        is_abnormal: isAbnormal,
        is_final: isFinal,
        reported_by: userId,
        reported_at: new Date().toISOString(),
        attachment_url: input.attachment_url ?? null,
        attachment_mime: input.attachment_mime ?? null,
        numeric_value: numeric,
        loinc_code: input.loinc_code ?? null,
        flag,
        validation_status: input.validation_status,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    // Validatsiya jurnali — natija kiritildi
    await admin.from('lab_validation_logs').insert({
      clinic_id: clinicId,
      result_id: (inserted as { id: string }).id,
      actor_id: userId,
      action: isDraft ? 'entered' : 'validated',
    });

    // Faqat tasdiqlangan (validated) yakuniy natija order item'ni yopadi.
    // Draft natija — validatorni kutadi, item 'pending' qoladi.
    if (isFinal) {
      await admin
        .from('lab_order_items')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', input.order_item_id);

      // If all items of the order completed → mark order completed
      const orderId = (item as { order_id: string }).order_id;
      const { data: remaining } = await admin
        .from('lab_order_items')
        .select('status')
        .eq('order_id', orderId);
      const statuses = ((remaining as Array<{ status: string }> | null) ?? []).map((r) => r.status);
      if (statuses.length > 0 && statuses.every((s) => s === 'completed')) {
        await this.transition(clinicId, userId, orderId, 'completed');
      }
    }
    return this.get(clinicId, (item as { order_id: string }).order_id);
  }

  /**
   * FAZA 3 — draft natijani validator tasdiqlaydi yoki rad etadi.
   * Tasdiqlanganda natija yakuniylashtiriladi (is_final=true) va order item
   * yopiladi; rad etilganda validation_status='rejected' bo'ladi.
   */
  async validateResult(
    clinicId: string,
    userId: string,
    resultId: string,
    decision: 'validate' | 'reject',
    note?: string,
  ) {
    const admin = this.supabase.admin();
    const { data: result, error } = await admin
      .from('lab_results')
      .select('id, order_item_id, validation_status, is_final')
      .eq('clinic_id', clinicId)
      .eq('id', resultId)
      .single();
    if (error || !result) throw new NotFoundException('Natija topilmadi');
    const row = result as {
      id: string;
      order_item_id: string;
      validation_status: string;
      is_final: boolean;
    };
    if (row.validation_status === 'validated') {
      throw new BadRequestException('Natija allaqachon tasdiqlangan');
    }

    const now = new Date().toISOString();
    if (decision === 'validate') {
      // is_final hali false — no_update_final qoidasi UPDATE'ga to'sqinlik qilmaydi.
      const { error: upErr } = await admin
        .from('lab_results')
        .update({
          validation_status: 'validated',
          validated_by: userId,
          validated_at: now,
          is_final: true,
        })
        .eq('clinic_id', clinicId)
        .eq('id', resultId);
      if (upErr) throw new BadRequestException(upErr.message);

      // Order item'ni yopamiz, hammasi tugagan bo'lsa order'ni completed qilamiz.
      await admin
        .from('lab_order_items')
        .update({ status: 'completed', completed_at: now })
        .eq('id', row.order_item_id);
      const { data: itemRow } = await admin
        .from('lab_order_items')
        .select('order_id')
        .eq('id', row.order_item_id)
        .single();
      const orderId = (itemRow as { order_id: string } | null)?.order_id;
      if (orderId) {
        const { data: remaining } = await admin
          .from('lab_order_items')
          .select('status')
          .eq('order_id', orderId);
        const statuses = ((remaining as Array<{ status: string }> | null) ?? []).map(
          (r) => r.status,
        );
        if (statuses.length > 0 && statuses.every((s) => s === 'completed')) {
          // transition faqat ruxsat etilgan holatda completed qiladi
          try {
            await this.transition(clinicId, userId, orderId, 'completed');
          } catch {
            /* order allaqachon completed bo'lishi mumkin — e'tiborsiz */
          }
        }
      }
    } else {
      const { error: upErr } = await admin
        .from('lab_results')
        .update({ validation_status: 'rejected', validated_by: userId, validated_at: now })
        .eq('clinic_id', clinicId)
        .eq('id', resultId);
      if (upErr) throw new BadRequestException(upErr.message);
    }

    await admin.from('lab_validation_logs').insert({
      clinic_id: clinicId,
      result_id: resultId,
      actor_id: userId,
      action: decision === 'validate' ? 'validated' : 'rejected',
      note: note ?? null,
    });

    return { ok: true, decision };
  }

  /** FAZA 3 — realtime dashboard kartalari (yagona RPC). */
  async dashboardStats(clinicId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin.rpc('lab_dashboard_stats', { p_clinic: clinicId });
    if (error) throw new BadRequestException(error.message);
    return data ?? {};
  }

  /** FAZA 3 — bemorning bitta LOINC bo'yicha natija tarixi (trend grafik). */
  async patientTrend(clinicId: string, patientId: string, loincCode: string) {
    const admin = this.supabase.admin();
    // patient → order → order_item → result zanjiri orqali
    const { data, error } = await admin
      .from('lab_results')
      .select(
        'id, numeric_value, value, unit, flag, reported_at, ' +
          'item:lab_order_items!inner(order:lab_orders!inner(patient_id))',
      )
      .eq('clinic_id', clinicId)
      .eq('loinc_code', loincCode)
      .eq('validation_status', 'validated')
      .not('numeric_value', 'is', null)
      .order('reported_at', { ascending: true })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    // patient_id bo'yicha filtr (embedded inner join natijasidan)
    const rows = ((data as unknown) as Array<{
      id: string;
      numeric_value: number;
      value: string;
      unit: string | null;
      flag: string | null;
      reported_at: string;
      item: { order: { patient_id: string } | { patient_id: string }[] } | null;
    }>) ?? [];
    return rows
      .filter((r) => {
        const order = r.item?.order;
        const pid = Array.isArray(order) ? order[0]?.patient_id : order?.patient_id;
        return pid === patientId;
      })
      .map((r) => ({
        id: r.id,
        numeric_value: r.numeric_value,
        value: r.value,
        unit: r.unit,
        flag: r.flag,
        reported_at: r.reported_at,
      }));
  }

  // ── FAZA 1 — Panellar, ICD-10 tavsiya, LOINC qidiruv ──────────────────────

  /** Klinika lab panellari — har biri tarkibidagi testlar bilan. */
  async listPanels(clinicId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('lab_panels')
      .select(
        '*, items:lab_panel_items(id, sort_order, test:lab_tests(id, name_i18n, price_uzs, unit))',
      )
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * ICD-10 tashxis kodi bo'yicha tavsiya etilgan analizlar. LOINC tavsiyalarini
   * shu klinikada mavjud lab_tests bilan moslaydi — buyurtma berish uchun
   * to'g'ridan-to'g'ri test ID qaytadi.
   */
  async recommendTests(clinicId: string, icd10Code: string) {
    const admin = this.supabase.admin();
    const { data: recs, error } = await admin
      .from('icd10_lab_recommendations')
      .select('loinc_code, priority, rationale, loinc:loinc_tests(short_name, unit, category)')
      .eq('icd10_code', icd10Code)
      .order('priority', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    type LoincRef = { short_name: string; unit: string | null; category: string };
    const rows = ((recs as unknown) as Array<{
      loinc_code: string;
      priority: number;
      rationale: string | null;
      // Supabase embedded relation tipi array bo'lishi mumkin — ikkalasini ham qabul qilamiz
      loinc: LoincRef | LoincRef[] | null;
    }> | null) ?? [];
    if (rows.length === 0) return [];
    const oneLoinc = (l: LoincRef | LoincRef[] | null): LoincRef | null =>
      Array.isArray(l) ? (l[0] ?? null) : l;

    // Shu klinikada mavjud, LOINC'ga bog'langan testlarni topamiz.
    const loincCodes = rows.map((r) => r.loinc_code);
    const { data: tests } = await admin
      .from('lab_tests')
      .select('id, name_i18n, price_uzs, loinc_code')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .in('loinc_code', loincCodes);
    const testByLoinc = new Map<string, { id: string; name_i18n: Record<string, string>; price_uzs: number }>();
    for (const t of (tests as Array<{
      id: string;
      name_i18n: Record<string, string>;
      price_uzs: number;
      loinc_code: string;
    }> | null) ?? []) {
      if (!testByLoinc.has(t.loinc_code)) testByLoinc.set(t.loinc_code, t);
    }

    return rows.map((r) => {
      const test = testByLoinc.get(r.loinc_code);
      const loinc = oneLoinc(r.loinc);
      return {
        loinc_code: r.loinc_code,
        priority: r.priority,
        rationale: r.rationale,
        name: loinc?.short_name ?? r.loinc_code,
        category: loinc?.category ?? null,
        // available=true bo'lsa klinika bu testni buyurtma qila oladi
        available: !!test,
        test_id: test?.id ?? null,
        price_uzs: test?.price_uzs ?? null,
      };
    });
  }

  /** LOINC qidiruv — trigram, qisqa/uzun nom va komponent bo'yicha. */
  async searchLoinc(query: string, limit = 20) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('loinc_tests')
      .select('loinc_code, short_name, long_name, component, unit, category')
      .ilike('search_text', `%${q}%`)
      .limit(limit);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── FAZA 2 — Namuna (tube) kuzatuvi ───────────────────────────────────────

  /** Buyurtma uchun probirka yaratadi — ketma-ket tube_id + barcode beriladi. */
  async createSample(clinicId: string, input: z.infer<typeof SampleSchema>) {
    const admin = this.supabase.admin();

    // Buyurtma shu klinikaga tegishliligini tekshiramiz
    const { data: order, error: ordErr } = await admin
      .from('lab_orders')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('id', input.order_id)
      .single();
    if (ordErr || !order) throw new NotFoundException('Buyurtma topilmadi');

    const { data: seq, error: seqErr } = await admin.rpc('next_lab_tube_no', {
      p_clinic: clinicId,
    });
    if (seqErr) throw new BadRequestException(seqErr.message);
    const year = new Date().getFullYear().toString().slice(-2);
    const tubeId = `LAB-${year}-${String(seq).padStart(6, '0')}`;

    const { data: sample, error } = await admin
      .from('lab_samples')
      .insert({
        clinic_id: clinicId,
        order_id: input.order_id,
        tube_id: tubeId,
        barcode: tubeId,
        sample_type: input.sample_type,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return sample;
  }

  /** Buyurtma probirkalari ro'yxati. */
  async listSamples(clinicId: string, orderId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('lab_samples')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Barkod/QR skan — namuna, buyurtma, bemor va testlarni bir so'rovda
   * qaytaradi (one-click workflow yadrosi). Laborant probirkani skanerlaydi.
   */
  async scanSample(clinicId: string, code: string) {
    const admin = this.supabase.admin();
    const { data: sample, error } = await admin
      .from('lab_samples')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('barcode', code.trim())
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!sample) throw new NotFoundException('Bunday barkodli namuna topilmadi');
    const order = await this.get(clinicId, (sample as { order_id: string }).order_id);
    return { sample, order };
  }

  /** Namuna holatini o'zgartiradi (yig'ildi / qabul qilindi / rad etildi). */
  async updateSampleStatus(
    clinicId: string,
    userId: string,
    sampleId: string,
    status: 'collected' | 'received' | 'rejected',
    rejectedReason?: string,
  ) {
    const admin = this.supabase.admin();
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status };
    if (status === 'collected') {
      patch['collected_at'] = now;
      patch['collected_by'] = userId;
    }
    if (status === 'received') patch['received_at'] = now;
    if (status === 'rejected') patch['rejected_reason'] = rejectedReason ?? null;

    const { data, error } = await admin
      .from('lab_samples')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', sampleId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * FAZA 4 — analizatordan kelgan HL7 v2 ORU xabarini qabul qiladi, parse
   * qiladi va analyzer_logs ga yozadi. Natijalar avtomatik lab_results ga
   * QO'SHILMAYDI — validatsiya oqimi (FAZA 3) buzilmasligi uchun parse natijasi
   * qaytariladi, laborant uni ko'rib kiritadi. To'liq avtomatik qo'llash
   * kelajak bosqichi (analyzer ↔ sample bog'lash ishonchli bo'lganda).
   */
  async ingestHl7(clinicId: string, analyzer: string, rawPayload: string) {
    const admin = this.supabase.admin();
    const adapter = new GenericHl7Adapter();
    const outcome = adapter.parse(rawPayload);

    // analyzer_logs ga yozamiz — har xabar audit qilinadi
    await admin.from('analyzer_logs').insert({
      clinic_id: clinicId,
      analyzer: analyzer || adapter.analyzerKey,
      direction: 'inbound',
      protocol: 'hl7',
      raw_payload: rawPayload,
      parsed: outcome.ok ? (outcome.results as unknown as object) : null,
      status: outcome.ok ? 'parsed' : 'failed',
      error_message: outcome.error ?? null,
    });

    if (!outcome.ok) {
      throw new BadRequestException(outcome.error ?? 'HL7 parse muvaffaqiyatsiz');
    }
    return { ok: true, count: outcome.results.length, results: outcome.results };
  }

  /**
   * FAZA 4 — buyurtma natijalarini FHIR Observation Bundle sifatida eksport
   * qiladi. Tashqi LIS/EHR integratsiyasiga tayyor (HL7 FHIR R4).
   */
  async exportFhir(clinicId: string, orderId: string) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('lab_results')
      .select(
        'id, loinc_code, value, numeric_value, unit, reference_range, flag, ' +
          'reported_at, validation_status, item:lab_order_items!inner(order_id)',
      )
      .eq('clinic_id', clinicId)
      .eq('item.order_id', orderId);
    if (error) throw new BadRequestException(error.message);
    const rows = ((data as unknown) as Array<LabResultForFhir>) ?? [];
    return {
      resourceType: 'Bundle',
      type: 'collection',
      entry: rows.map((r) => ({ resource: toFhirObservation(r) })),
    };
  }
}

@ApiTags('lab')
@Controller({ path: 'lab', version: '1' })
class LabController {
  constructor(private readonly svc: LabService) {}

  @Get('orders')
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('status') status?: string,
    @Query('patient_id') patientId?: string,
    @Query('date') date?: string,
    @Query('q') q?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, { status, patient_id: patientId, date, q });
  }

  @Get('kanban')
  kanban(@CurrentUser() u: { clinicId: string | null }, @Query('date') date?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.kanban(u.clinicId, date);
  }

  // ── Lab KASSA (mustaqil — umumiy kassaga tegmaydi) ───────────────────────────

  @Get('revenue')
  revenue(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.revenue(u.clinicId, from, to);
  }

  @Get('debtors')
  debtors(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.debtors(u.clinicId);
  }

  @Get('panels')
  panels(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listPanels(u.clinicId);
  }

  @Get('recommend')
  recommend(
    @CurrentUser() u: { clinicId: string | null },
    @Query('icd10') icd10?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    if (!icd10) throw new BadRequestException('icd10 query param kerak');
    return this.svc.recommendTests(u.clinicId, icd10);
  }

  @Get('loinc/search')
  loincSearch(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.svc.searchLoinc(q ?? '', limit ? Number(limit) : 20);
  }

  // ── FAZA 2 — Namuna (tube) endpointlari ───────────────────────────────────

  @Post('samples')
  @Audit({ action: 'lab.sample_created', resourceType: 'lab_samples' })
  createSample(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createSample(u.clinicId, SampleSchema.parse(body));
  }

  @Get('orders/:id/samples')
  orderSamples(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listSamples(u.clinicId, id);
  }

  @Get('samples/scan/:code')
  scanSample(
    @CurrentUser() u: { clinicId: string | null },
    @Param('code') code: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.scanSample(u.clinicId, code);
  }

  @Patch('samples/:id/status')
  @Audit({ action: 'lab.sample_status', resourceType: 'lab_samples' })
  sampleStatus(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: 'collected' | 'received' | 'rejected'; reason?: string },
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    if (!body?.status) throw new BadRequestException('status kerak');
    return this.svc.updateSampleStatus(u.clinicId, u.userId, id, body.status, body.reason);
  }

  /** QR public natija — loginsiz, token bo'yicha. patient.clary.uz/r/<token> chaqiradi. */
  @Public()
  @Get('public-result/:token')
  @Throttle({ public: { ttl: 60_000, limit: 30 } })
  publicResult(@Param('token', ParseUUIDPipe) token: string) {
    return this.svc.getPublicResult(token);
  }

  @Get('orders/:id')
  get(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.get(u.clinicId, id);
  }

  @Post('orders')
  @Audit({ action: 'lab.ordered', resourceType: 'lab_orders' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId, OrderSchema.parse(body));
  }

  @Patch('orders/:id/collect')
  @Audit({ action: 'lab.collected', resourceType: 'lab_orders' })
  collect(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transition(u.clinicId, u.userId, id, 'collected');
  }

  @Patch('orders/:id/start')
  @Audit({ action: 'lab.running', resourceType: 'lab_orders' })
  start(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transition(u.clinicId, u.userId, id, 'running');
  }

  @Patch('orders/:id/complete')
  @Audit({ action: 'lab.completed', resourceType: 'lab_orders' })
  complete(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transition(u.clinicId, u.userId, id, 'completed');
  }

  @Patch('orders/:id/report')
  @Audit({ action: 'lab.reported', resourceType: 'lab_orders' })
  report(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { channel?: 'sms' | 'telegram' } = {},
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transition(u.clinicId, u.userId, id, 'reported', {
      channel: body.channel ?? 'sms',
    });
  }

  @Patch('orders/:id/deliver')
  @Audit({ action: 'lab.delivered', resourceType: 'lab_orders' })
  deliver(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transition(u.clinicId, u.userId, id, 'delivered');
  }

  @Patch('orders/:id/cancel')
  @Audit({ action: 'lab.canceled', resourceType: 'lab_orders' })
  cancel(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transition(u.clinicId, u.userId, id, 'canceled', { reason: body?.reason });
  }

  @Post('results')
  @Audit({ action: 'lab.result_recorded', resourceType: 'lab_results' })
  result(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.recordResult(u.clinicId, u.userId, ResultSchema.parse(body));
  }

  // ── FAZA 3 — Validatsiya, dashboard, trend ────────────────────────────────

  @Patch('results/:id/validate')
  @Audit({ action: 'lab.result_validated', resourceType: 'lab_results' })
  validate(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.validateResult(u.clinicId, u.userId, id, 'validate', body?.note);
  }

  @Patch('results/:id/reject')
  @Audit({ action: 'lab.result_rejected', resourceType: 'lab_results' })
  reject(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.validateResult(u.clinicId, u.userId, id, 'reject', body?.note);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.dashboardStats(u.clinicId);
  }

  @Get('trend')
  trend(
    @CurrentUser() u: { clinicId: string | null },
    @Query('patient_id') patientId?: string,
    @Query('loinc') loinc?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    if (!patientId || !loinc) {
      throw new BadRequestException('patient_id va loinc query paramlari kerak');
    }
    return this.svc.patientTrend(u.clinicId, patientId, loinc);
  }

  // ── FAZA 4 — FHIR eksport (LIS/EHR integratsiyasiga tayyor) ───────────────

  @Get('orders/:id/fhir')
  fhir(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.exportFhir(u.clinicId, id);
  }

  @Post('hl7/ingest')
  @Audit({ action: 'lab.hl7_ingested', resourceType: 'analyzer_logs' })
  ingestHl7(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: { analyzer?: string; payload?: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    if (!body?.payload) throw new BadRequestException('payload (HL7 xabar) kerak');
    return this.svc.ingestHl7(u.clinicId, body.analyzer ?? '', body.payload);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [LabController],
  providers: [LabService, SupabaseService],
  exports: [LabService],
})
export class LabModule {}
