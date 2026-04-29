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
import { SupabaseService } from '../../common/services/supabase.service';

const OrderSchema = z.object({
  patient_id: z.string().uuid(),
  diagnostic_type_id: z.string().uuid(),
  scheduled_at: z.string().datetime().optional(),
  urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  clinical_indication: z.string().optional(),
});

const ResultSchema = z.object({
  findings: z.string().optional(),
  impression: z.string().optional(),
  numeric_values: z.record(z.unknown()).optional(),
  attachments: z.array(z.unknown()).optional(),
  is_final: z.boolean().default(false),
});

const EquipmentCategory = z.enum([
  'xray',
  'us',
  'mri',
  'ct',
  'ecg',
  'echo',
  'eeg',
  'emg',
  'endoscopy',
  'mammography',
  'densitometry',
  'spirometry',
  'audiometry',
  'other',
]);

const EquipmentCreateSchema = z.object({
  name_i18n: z.record(z.string(), z.string()),
  category: EquipmentCategory,
  model: z.string().max(120).optional(),
  manufacturer: z.string().max(120).optional(),
  serial_no: z.string().max(80).optional(),
  room_id: z.string().uuid().nullish(),
  service_id: z.string().uuid().nullish(),
  diagnostic_type_id: z.string().uuid().nullish(),
  price_uzs: z.number().int().nonnegative().optional(),
  duration_min: z.number().int().min(5).max(480).default(30),
  preparation_i18n: z.record(z.string(), z.string()).default({}),
  metadata: z.record(z.unknown()).default({}),
});

const EquipmentUpdateSchema = EquipmentCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
});

@Injectable()
class DiagnosticsService {
  constructor(private readonly supabase: SupabaseService) {}

  async listOrders(clinicId: string) {
    const { data } = await this.supabase.admin().from('diagnostic_orders').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false });
    return data ?? [];
  }

  async createOrder(clinicId: string, userId: string, input: z.infer<typeof OrderSchema>) {
    const admin = this.supabase.admin();
    const { data: dt } = await admin.from('diagnostic_types').select('name_i18n, price_uzs').eq('id', input.diagnostic_type_id).single();
    if (!dt) throw new Error('Unknown diagnostic type');
    const { data, error } = await admin.from('diagnostic_orders').insert({
      ...input,
      clinic_id: clinicId,
      ordered_by: userId,
      created_by: userId,
      name_snapshot: (dt['name_i18n'] as Record<string, string>)['uz-Latn'],
      price_snapshot: dt['price_uzs'],
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async recordResult(clinicId: string, orderId: string, userId: string, input: z.infer<typeof ResultSchema>) {
    const { data, error } = await this.supabase.admin().from('diagnostic_results').insert({
      clinic_id: clinicId,
      order_id: orderId,
      reported_by: userId,
      reported_at: new Date().toISOString(),
      ...input,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  // --- equipment catalog ---
  async listEquipment(clinicId: string, includeInactive = false) {
    let q = this.supabase
      .admin()
      .from('diagnostic_equipment')
      .select('*, room:rooms(id, name_i18n, number), service:services(id, name_i18n), diagnostic_type:diagnostic_types(id, name_i18n)')
      .eq('clinic_id', clinicId);
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q.order('category').order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createEquipment(clinicId: string, userId: string, input: z.infer<typeof EquipmentCreateSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('diagnostic_equipment')
      .insert({ clinic_id: clinicId, created_by: userId, ...input })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateEquipment(clinicId: string, id: string, input: z.infer<typeof EquipmentUpdateSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('diagnostic_equipment')
      .update(input)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async archiveEquipment(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('diagnostic_equipment')
      .update({ is_active: false })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new NotFoundException(error.message);
    return { ok: true };
  }
}

@ApiTags('diagnostics')
@Controller('diagnostics')
class DiagnosticsController {
  constructor(private readonly svc: DiagnosticsService) {}

  @Get('orders')
  list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listOrders(u.clinicId);
  }

  @Post('orders')
  @Audit({ action: 'diagnostic.ordered', resourceType: 'diagnostic_orders' })
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createOrder(u.clinicId, u.userId, OrderSchema.parse(body));
  }

  @Patch('orders/:id/result')
  @Audit({ action: 'diagnostic.completed', resourceType: 'diagnostic_results' })
  result(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.recordResult(u.clinicId, id, u.userId, ResultSchema.parse(body));
  }

  @Get('equipment')
  listEquipment(
    @CurrentUser() u: { clinicId: string | null },
    @Query('include_inactive') includeInactive?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listEquipment(u.clinicId, includeInactive === 'true');
  }

  @Post('equipment')
  @Audit({ action: 'diagnostic_equipment.created', resourceType: 'diagnostic_equipment' })
  createEquipment(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createEquipment(u.clinicId, u.userId, EquipmentCreateSchema.parse(body));
  }

  @Patch('equipment/:id')
  @Audit({ action: 'diagnostic_equipment.updated', resourceType: 'diagnostic_equipment' })
  updateEquipment(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateEquipment(u.clinicId, id, EquipmentUpdateSchema.parse(body));
  }

  @Delete('equipment/:id')
  @Audit({ action: 'diagnostic_equipment.archived', resourceType: 'diagnostic_equipment' })
  archiveEquipment(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.archiveEquipment(u.clinicId, id);
  }
}

@Module({
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService, SupabaseService],
})
export class DiagnosticsModule {}
