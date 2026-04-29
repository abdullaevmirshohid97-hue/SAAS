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
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const POSITIONS = [
  'doctor',
  'nurse',
  'cleaner',
  'administrator',
  'cashier',
  'pharmacist',
  'lab_tech',
  'manager',
  'other',
] as const;

const StaffProfileSchema = z.object({
  profile_id: z.string().uuid().nullish(),
  last_name: z.string().min(1).max(120),
  first_name: z.string().min(1).max(120),
  patronymic: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  position: z.enum(POSITIONS),
  specialization: z.string().max(120).optional(),
  education_level: z.enum(['secondary', 'higher', 'master', 'phd']).optional(),
  diploma_url: z.string().url().optional(),
  certificates: z.array(z.string().url()).default([]),
  photos: z.array(z.string().url()).max(10).default([]),
  salary_type: z.enum(['fixed', 'percent', 'mixed']).default('fixed'),
  salary_fixed_uzs: z.number().int().nonnegative().default(0),
  salary_percent: z.number().min(0).max(100).default(0),
  is_active: z.boolean().default(true),
  notes: z.string().max(2000).optional(),
});

const StaffProfileUpdateSchema = StaffProfileSchema.partial();

@Injectable()
export class StaffProfilesService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string, filter: { position?: string; active?: boolean } = {}) {
    let q = this.supabase
      .admin()
      .from('staff_profiles')
      .select('*, profile:profiles(id, full_name, role, email)')
      .eq('clinic_id', clinicId)
      .order('last_name', { ascending: true });
    if (filter.position) q = q.eq('position', filter.position);
    if (filter.active !== undefined) q = q.eq('is_active', filter.active);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getOne(clinicId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('staff_profiles')
      .select('*, profile:profiles(id, full_name, role, email)')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async create(clinicId: string, userId: string, input: z.infer<typeof StaffProfileSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('staff_profiles')
      .insert({
        clinic_id: clinicId,
        ...input,
        profile_id: input.profile_id ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(
    clinicId: string,
    id: string,
    input: z.infer<typeof StaffProfileUpdateSchema>,
  ) {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
    const { data, error } = await this.supabase
      .admin()
      .from('staff_profiles')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async remove(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('staff_profiles')
      .update({ is_active: false })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}

@ApiTags('staff-profiles')
@Controller({ path: 'staff-profiles', version: '1' })
class StaffProfilesController {
  constructor(private readonly svc: StaffProfilesService) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('position') position?: string,
    @Query('active') active?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, {
      position,
      active: active === 'true' ? true : active === 'false' ? false : undefined,
    });
  }

  @Get(':id')
  one(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getOne(u.clinicId, id);
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'staff_profile.created', resourceType: 'staff_profiles' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId, StaffProfileSchema.parse(body));
  }

  @Patch(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'staff_profile.updated', resourceType: 'staff_profiles' })
  update(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.update(u.clinicId, id, StaffProfileUpdateSchema.parse(body));
  }

  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'staff_profile.archived', resourceType: 'staff_profiles' })
  remove(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.remove(u.clinicId, id);
  }
}

@Module({
  controllers: [StaffProfilesController],
  providers: [StaffProfilesService, SupabaseService],
  exports: [StaffProfilesService],
})
export class StaffProfilesModule {}
