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
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';

const OrderSchema = z.object({
  patient_id: z.string().uuid(),
  test_ids: z.array(z.string().uuid()).min(1),
  urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  clinical_notes: z.string().optional(),
  appointment_id: z.string().uuid().optional(),
  stay_id: z.string().uuid().optional(),
  referral_id: z.string().uuid().optional(),
  notify_sms: z.boolean().default(true),
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

@Injectable()
export class LabService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    clinicId: string,
    params: { status?: string; patient_id?: string; date?: string } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('lab_orders')
      .select(
        '*, patient:patients(id, full_name, phone), items:lab_order_items(*, test:lab_tests(id, name_i18n, unit, reference_range_male, reference_range_female))',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (params.status) q = q.eq('status', params.status);
    if (params.patient_id) q = q.eq('patient_id', params.patient_id);
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

  async create(clinicId: string, userId: string, input: z.infer<typeof OrderSchema>) {
    const admin = this.supabase.admin();
    const { data: tests, error: testsErr } = await admin
      .from('lab_tests')
      .select('id, name_i18n, price_uzs')
      .eq('clinic_id', clinicId)
      .in('id', input.test_ids);
    if (testsErr) throw new BadRequestException(testsErr.message);
    if (!tests || tests.length !== input.test_ids.length) {
      throw new NotFoundException('Some tests not found');
    }

    const total = (tests as Array<{ price_uzs: number }>).reduce(
      (s, t) => s + Number(t.price_uzs),
      0,
    );

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

    return order;
  }

  async transition(
    clinicId: string,
    userId: string,
    id: string,
    next: LabStatus,
    opts: { reason?: string } = {},
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
      try {
        await this.notifications.enqueue({
          clinicId,
          channel: 'sms',
          recipient: row.patient!.phone!,
          body: `Hurmatli ${row.patient!.full_name}, laboratoriya natijalaringiz tayyor. Klinikaga murojaat qiling.`,
          templateKey: 'lab.result_ready',
          patientId: row.patient_id,
          relatedResource: 'lab_orders',
          relatedId: id,
          idempotencyKey: `lab_ready:${id}`,
        });
      } catch (err) {
        // Never block the state transition on messaging failures.
        // Notifications queue retries on its own.
        console.warn('[lab] notify enqueue failed:', (err as Error).message);
      }
    }

    return this.get(clinicId, id);
  }

  async get(clinicId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('lab_orders')
      .select(
        '*, patient:patients(id, full_name, phone), items:lab_order_items(*, test:lab_tests(id, name_i18n, unit, reference_range_male, reference_range_female), results:lab_results(*))',
      )
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
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

    const { error } = await admin.from('lab_results').insert({
      clinic_id: clinicId,
      order_item_id: input.order_item_id,
      value: input.value,
      unit: input.unit ?? null,
      reference_range: input.reference_range ?? null,
      interpretation: input.interpretation ?? null,
      is_abnormal: input.is_abnormal ?? false,
      is_final: input.is_final,
      reported_by: userId,
      reported_at: new Date().toISOString(),
      attachment_url: input.attachment_url ?? null,
      attachment_mime: input.attachment_mime ?? null,
    });
    if (error) throw new BadRequestException(error.message);

    if (input.is_final) {
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
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, { status, patient_id: patientId, date });
  }

  @Get('kanban')
  kanban(@CurrentUser() u: { clinicId: string | null }, @Query('date') date?: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.kanban(u.clinicId, date);
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
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.transition(u.clinicId, u.userId, id, 'reported');
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
}

@Module({
  imports: [NotificationsModule],
  controllers: [LabController],
  providers: [LabService, SupabaseService],
  exports: [LabService],
})
export class LabModule {}
