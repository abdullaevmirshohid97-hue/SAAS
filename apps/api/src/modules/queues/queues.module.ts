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
import { z } from 'zod';

import { SupabaseService } from '../../common/services/supabase.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

const EnqueueSchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(9).default(0),
  appointment_id: z.string().uuid().nullable().optional(),
  referral_id: z.string().uuid().nullable().optional(),
  source: z.enum(['reception', 'referral', 'kiosk', 'online']).default('reception'),
  ticket_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().optional(),
});

const SkipSchema = z.object({
  reason: z.string().max(500).optional(),
});

type QueueRow = {
  id: string;
  clinic_id: string;
  doctor_id: string | null;
  patient_id: string;
  ticket_no: string | null;
  ticket_code: string | null;
  ticket_color: string | null;
  queue_date: string;
  queue_seq: number | null;
  status: 'waiting' | 'called' | 'serving' | 'served' | 'left';
  priority: number;
  joined_at: string;
  called_at: string | null;
  started_at: string | null;
  served_at: string | null;
  left_at: string | null;
  service_id: string | null;
  source: string;
  referral_id: string | null;
  notes: string | null;
};

@Injectable()
export class QueuesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(
    clinicId: string,
    opts: { status?: string[]; doctorId?: string; date?: string } = {},
  ) {
    const admin = this.supabase.admin();
    let q = admin
      .from('queues')
      .select(
        '*, patient:patients(id, full_name, first_name, last_name, phone), doctor:profiles!doctor_id(id, full_name)',
      )
      .eq('clinic_id', clinicId);
    const statuses = opts.status && opts.status.length
      ? opts.status
      : ['waiting', 'called', 'serving'];
    q = q.in('status', statuses);
    if (opts.doctorId) q = q.eq('doctor_id', opts.doctorId);
    if (opts.date) q = q.eq('queue_date', opts.date);
    q = q.order('priority', { ascending: false }).order('joined_at', { ascending: true });
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async kanban(clinicId: string, date?: string) {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('queues')
      .select(
        'id, ticket_code, ticket_color, status, priority, doctor_id, patient_id, queue_seq, joined_at, called_at, started_at, patient:patients(id, full_name), doctor:profiles!doctor_id(id, full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('queue_date', d)
      .order('priority', { ascending: false })
      .order('joined_at', { ascending: true });
    type Row = {
      id: string;
      status: 'waiting' | 'called' | 'serving' | 'served' | 'left';
      doctor_id: string | null;
      doctor?: { id: string; full_name: string } | null;
    };
    const byStatus = {
      waiting: [] as Row[],
      called: [] as Row[],
      serving: [] as Row[],
      served: [] as Row[],
    };
    const byDoctor = new Map<string, { doctor: { id: string; full_name: string } | null; rows: Row[] }>();
    for (const row of (data ?? []) as unknown as Row[]) {
      if (row.status in byStatus) {
        (byStatus as unknown as Record<string, Row[]>)[row.status]!.push(row);
      }
      const key = row.doctor_id ?? 'unassigned';
      if (!byDoctor.has(key)) {
        byDoctor.set(key, { doctor: row.doctor ?? null, rows: [] });
      }
      byDoctor.get(key)!.rows.push(row);
    }
    return {
      date: d,
      by_status: byStatus,
      by_doctor: Array.from(byDoctor.entries()).map(([k, v]) => ({
        doctor_id: k === 'unassigned' ? null : k,
        doctor: v.doctor,
        rows: v.rows,
      })),
    };
  }

  async enqueue(
    clinicId: string,
    body: z.infer<typeof EnqueueSchema>,
  ): Promise<QueueRow> {
    const admin = this.supabase.admin();
    const ticketNo = `Q-${Date.now().toString().slice(-6)}`;
    const { data, error } = await admin
      .from('queues')
      .insert({
        clinic_id: clinicId,
        patient_id: body.patient_id,
        doctor_id: body.doctor_id ?? null,
        service_id: body.service_id ?? null,
        ticket_no: ticketNo,
        ticket_color: body.ticket_color ?? null,
        priority: body.priority,
        appointment_id: body.appointment_id ?? null,
        referral_id: body.referral_id ?? null,
        source: body.source,
        notes: body.notes ?? null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as unknown as QueueRow;
  }

  async callNext(clinicId: string, doctorId: string) {
    const admin = this.supabase.admin();
    const { data: candidate } = await admin
      .from('queues')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('doctor_id', doctorId)
      .eq('status', 'waiting')
      .order('priority', { ascending: false })
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!candidate) throw new NotFoundException('Navbatda bemor yo\u2018q');
    return this.updateStatus(clinicId, (candidate as { id: string }).id, 'called');
  }

  async updateStatus(
    clinicId: string,
    id: string,
    status: 'called' | 'serving' | 'served' | 'left',
    extra: Record<string, unknown> = {},
  ): Promise<QueueRow> {
    const patch: Record<string, unknown> = { status, ...extra };
    const now = new Date().toISOString();
    if (status === 'called') patch.called_at = now;
    if (status === 'serving') patch.started_at = now;
    if (status === 'served') patch.served_at = now;
    if (status === 'left') patch.left_at = now;
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('queues')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as unknown as QueueRow;
  }

  async skip(clinicId: string, id: string, reason?: string) {
    return this.updateStatus(clinicId, id, 'left', { notes: reason ?? 'skipped' });
  }
}

@ApiTags('queues')
@Controller({ path: 'queues', version: '1' })
class QueuesController {
  constructor(private readonly svc: QueuesService) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('status') status?: string,
    @Query('doctor_id') doctorId?: string,
    @Query('date') date?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const statuses = status ? status.split(',') : undefined;
    return this.svc.list(u.clinicId, { status: statuses, doctorId, date });
  }

  @Get('kanban')
  kanban(
    @CurrentUser() u: { clinicId: string | null },
    @Query('date') date?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.kanban(u.clinicId, date);
  }

  @Post()
  @Audit({ action: 'queue.joined', resourceType: 'queues' })
  enqueue(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const parsed = EnqueueSchema.parse(body);
    return this.svc.enqueue(u.clinicId, parsed);
  }

  @Post('call-next')
  @Audit({ action: 'queue.called_next', resourceType: 'queues' })
  callNext(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: { doctor_id?: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const doctorId = body.doctor_id ?? u.userId;
    if (!doctorId) throw new BadRequestException('doctor_id required');
    return this.svc.callNext(u.clinicId, doctorId);
  }

  @Patch(':id/call')
  @Audit({ action: 'queue.called', resourceType: 'queues' })
  call(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateStatus(u.clinicId, id, 'called');
  }

  @Patch(':id/accept')
  @Audit({ action: 'queue.accepted', resourceType: 'queues' })
  accept(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateStatus(u.clinicId, id, 'serving');
  }

  @Patch(':id/complete')
  @Audit({ action: 'queue.completed', resourceType: 'queues' })
  complete(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateStatus(u.clinicId, id, 'served');
  }

  @Patch(':id/skip')
  @Audit({ action: 'queue.skipped', resourceType: 'queues' })
  skip(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const parsed = SkipSchema.parse(body ?? {});
    return this.svc.skip(u.clinicId, id, parsed.reason);
  }
}

@Module({
  controllers: [QueuesController],
  providers: [QueuesService, SupabaseService],
  exports: [QueuesService],
})
export class QueuesModule {}
