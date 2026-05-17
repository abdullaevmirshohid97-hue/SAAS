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

const TaskCreateSchema = z.object({
  patient_id: z.string().uuid().nullish(),
  stay_id: z.string().uuid().nullish(),
  assigned_to: z.string().uuid().nullish(),
  title: z.string().min(2).max(200),
  notes: z.string().max(4000).optional(),
  category: z
    .enum(['general', 'injection', 'iv_drip', 'dressing', 'vitals', 'medication', 'home_visit', 'procedure', 'observation'])
    .default('general'),
  priority: z.number().int().min(0).max(3).default(0),
  due_at: z.string().datetime().optional(),
});

const TaskUpdateSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  notes: z.string().max(4000).nullish(),
  category: TaskCreateSchema.shape.category.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  due_at: z.string().datetime().nullish(),
  assigned_to: z.string().uuid().nullish(),
  status: z.enum(['pending', 'in_progress', 'done', 'skipped', 'canceled']).optional(),
  result_notes: z.string().max(4000).nullish(),
});

const EmergencyCreateSchema = z.object({
  room_id: z.string().uuid().nullish(),
  patient_id: z.string().uuid().nullish(),
  message: z.string().min(2).max(500).default('Tez yordam kerak!'),
  severity: z.enum(['normal', 'high', 'critical']).default('high'),
});

const TASK_COLUMNS =
  'id, clinic_id, patient_id, stay_id, assigned_to, title, notes, category, priority, due_at, scheduled_at, status, started_at, completed_at, completed_by, result_notes, prescription_id, prescription_item_id, created_at, updated_at, created_by';

const NurseScheduleSchema = z.object({
  nurse_id: z.string().uuid(),
  floor: z.number().int(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00'),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('20:00'),
  is_active: z.boolean().default(true),
});

@Injectable()
class NurseService {
  constructor(private readonly supabase: SupabaseService) {}

  async listTasks(
    clinicId: string,
    filters: { assigned_to?: string; status?: string; patient_id?: string; mine?: string | null; userId: string | null },
  ) {
    let q = this.supabase
      .admin()
      .from('nurse_tasks')
      .select(
        `${TASK_COLUMNS}, patient:patients(id, full_name, phone), assignee:profiles!nurse_tasks_assigned_to_fkey(id, full_name)`,
      )
      .eq('clinic_id', clinicId);
    if (filters.assigned_to) q = q.eq('assigned_to', filters.assigned_to);
    if (filters.mine === 'true' && filters.userId) q = q.eq('assigned_to', filters.userId);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.patient_id) q = q.eq('patient_id', filters.patient_id);
    const { data, error } = await q
      .order('priority', { ascending: false })
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(300);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createTask(clinicId: string, userId: string, input: z.infer<typeof TaskCreateSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('nurse_tasks')
      .insert({ clinic_id: clinicId, created_by: userId, ...input })
      .select(TASK_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateTask(clinicId: string, userId: string, id: string, input: z.infer<typeof TaskUpdateSchema>) {
    const patch: Record<string, unknown> = { ...input };
    if (input.status === 'in_progress') patch['started_at'] = new Date().toISOString();
    if (input.status === 'done') {
      patch['completed_at'] = new Date().toISOString();
      patch['completed_by'] = userId;
    }
    const { data, error } = await this.supabase
      .admin()
      .from('nurse_tasks')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select(TASK_COLUMNS)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  /**
   * Hamshira vazifani o'ziga biriktiradi ("Vazifa qabul qilish"). assigned_to
   * — serverdagi userId, mijoz yubormaydi (xavfsiz). Allaqachon boshqa
   * hamshiraga biriktirilgan bo'lsa — xato.
   */
  async claimTask(clinicId: string, userId: string, id: string) {
    const admin = this.supabase.admin();
    const { data: task, error: getErr } = await admin
      .from('nurse_tasks')
      .select('id, assigned_to, status')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (getErr || !task) throw new NotFoundException('Vazifa topilmadi');
    const row = task as { id: string; assigned_to: string | null; status: string };
    if (row.assigned_to && row.assigned_to !== userId) {
      throw new BadRequestException('Bu vazifa boshqa hamshiraga biriktirilgan');
    }
    const { data, error } = await admin
      .from('nurse_tasks')
      .update({ assigned_to: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select(TASK_COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // --- emergency calls ---
  async listEmergencies(clinicId: string, onlyUnresolved = true) {
    let q = this.supabase
      .admin()
      .from('emergency_calls')
      .select(
        'id, clinic_id, room_id, patient_id, initiated_by, message, severity, acknowledged_at, acknowledged_by, resolved_at, resolved_by, broadcast_at, profiles:profiles!emergency_calls_initiated_by_fkey(id, full_name), room:rooms(id, name_i18n, number)',
      )
      .eq('clinic_id', clinicId);
    if (onlyUnresolved) q = q.is('resolved_at', null);
    const { data, error } = await q.order('broadcast_at', { ascending: false }).limit(50);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async triggerEmergency(clinicId: string, userId: string, input: z.infer<typeof EmergencyCreateSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('emergency_calls')
      .insert({
        clinic_id: clinicId,
        initiated_by: userId,
        ...input,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async ackEmergency(clinicId: string, userId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('emergency_calls')
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .is('acknowledged_at', null)
      .select()
      .maybeSingle();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async resolveEmergency(clinicId: string, userId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('emergency_calls')
      .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  // --- nurse_schedules (Sprint 2A: floor + day_of_week routing) ---
  async listSchedules(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('nurse_schedules')
      .select('*, nurse:profiles!nurse_schedules_nurse_id_fkey(id, full_name, role)')
      .eq('clinic_id', clinicId)
      .order('floor', { ascending: true })
      .order('day_of_week', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertSchedule(clinicId: string, input: z.infer<typeof NurseScheduleSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('nurse_schedules')
      .upsert(
        { clinic_id: clinicId, ...input },
        { onConflict: 'clinic_id,nurse_id,floor,day_of_week' },
      )
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteSchedule(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('nurse_schedules')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new NotFoundException(error.message);
    return { ok: true };
  }
}

@ApiTags('nurse')
@Controller('nurse')
class NurseController {
  constructor(private readonly svc: NurseService) {}

  @Get('tasks')
  list(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Query('assigned_to') assigned?: string,
    @Query('status') status?: string,
    @Query('patient_id') patient?: string,
    @Query('mine') mine?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listTasks(u.clinicId, {
      assigned_to: assigned,
      status,
      patient_id: patient,
      mine,
      userId: u.userId,
    });
  }

  @Post('tasks')
  @Audit({ action: 'nurse_task.created', resourceType: 'nurse_tasks' })
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createTask(u.clinicId, u.userId, TaskCreateSchema.parse(body));
  }

  @Patch('tasks/:id')
  @Audit({ action: 'nurse_task.updated', resourceType: 'nurse_tasks' })
  update(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.updateTask(u.clinicId, u.userId, id, TaskUpdateSchema.parse(body));
  }

  @Post('tasks/:id/claim')
  @Audit({ action: 'nurse_task.claimed', resourceType: 'nurse_tasks' })
  claim(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.claimTask(u.clinicId, u.userId, id);
  }

  @Get('emergencies')
  listEmergencies(
    @CurrentUser() u: { clinicId: string | null },
    @Query('all') all?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listEmergencies(u.clinicId, all !== 'true');
  }

  @Post('emergencies')
  @Audit({ action: 'emergency.triggered', resourceType: 'emergency_calls' })
  trigger(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.triggerEmergency(u.clinicId, u.userId, EmergencyCreateSchema.parse(body));
  }

  @Post('emergencies/:id/ack')
  @Audit({ action: 'emergency.acknowledged', resourceType: 'emergency_calls' })
  ack(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.ackEmergency(u.clinicId, u.userId, id);
  }

  @Post('emergencies/:id/resolve')
  @Audit({ action: 'emergency.resolved', resourceType: 'emergency_calls' })
  resolve(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.resolveEmergency(u.clinicId, u.userId, id);
  }

  // --- nurse_schedules ---
  @Get('schedules')
  listSchedules(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listSchedules(u.clinicId);
  }

  @Post('schedules')
  @Audit({ action: 'nurse_schedule.upserted', resourceType: 'nurse_schedules' })
  upsertSchedule(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.upsertSchedule(u.clinicId, NurseScheduleSchema.parse(body));
  }

  @Patch('schedules/:id/delete')
  @Audit({ action: 'nurse_schedule.deleted', resourceType: 'nurse_schedules' })
  deleteSchedule(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.deleteSchedule(u.clinicId, id);
  }
}

@Module({
  controllers: [NurseController],
  providers: [NurseService, SupabaseService],
  exports: [NurseService],
})
export class NurseModule {}
