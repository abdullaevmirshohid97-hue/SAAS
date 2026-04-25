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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePerm } from '../../common/decorators/require-perm.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ALL_PERMISSIONS,
  PERMISSION_MODULES,
  PERMISSION_PRESETS,
  ROLE_DEFAULT_PERMISSIONS,
  computeEffectivePermissions,
  type PermissionKey,
} from '../../common/rbac/permissions';
import { SupabaseService } from '../../common/services/supabase.service';

const VALID_ROLES = [
  'clinic_owner',
  'clinic_admin',
  'doctor',
  'receptionist',
  'cashier',
  'pharmacist',
  'lab_technician',
  'radiologist',
  'nurse',
  'staff',
] as const;

const PermissionMapSchema = z.record(z.string(), z.boolean());

const InviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(VALID_ROLES),
  locale: z.string().default('uz-Latn'),
  permissions_override: PermissionMapSchema.optional(),
});

const UpdateStaffSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(VALID_ROLES).optional(),
  is_active: z.boolean().optional(),
  custom_role_id: z.string().uuid().nullable().optional(),
  permissions_override: PermissionMapSchema.optional(),
});

const CreateRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  base_role: z.enum(VALID_ROLES).default('staff'),
  permissions: PermissionMapSchema,
});

const UpdateRoleSchema = CreateRoleSchema.partial();

@Injectable()
class StaffService {
  constructor(private readonly supabase: SupabaseService) {}

  async listStaff(clinicId: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('profiles')
      .select(
        'id, email, full_name, phone, role, is_active, last_sign_in_at, custom_role_id, permissions_override, custom_role:custom_roles(id, name, permissions)',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    return (data ?? []).map((row) => {
      const r = row as unknown as {
        id: string;
        role: string;
        permissions_override: Record<string, boolean> | null;
        custom_role:
          | { permissions: Record<string, boolean> }
          | { permissions: Record<string, boolean> }[]
          | null;
      };
      const cr = Array.isArray(r.custom_role) ? r.custom_role[0] ?? null : r.custom_role;
      const effective = computeEffectivePermissions({
        role: r.role,
        customRolePermissions: cr?.permissions ?? null,
        permissionsOverride: r.permissions_override ?? null,
      });
      return { ...r, custom_role: cr, effective_permissions: effective };
    });
  }

  async invite(clinicId: string, userId: string, input: z.infer<typeof InviteSchema>) {
    const admin = this.supabase.admin();
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('email', input.email)
      .maybeSingle();
    if (existing) throw new Error('Bu email allaqachon ishlatilgan');

    const auth = await (admin as unknown as {
      auth: {
        admin: {
          inviteUserByEmail: (
            email: string,
            options?: { data?: Record<string, unknown>; redirectTo?: string },
          ) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
        };
      };
    }).auth.admin.inviteUserByEmail(input.email, {
      data: { clinic_id: clinicId, role: input.role, full_name: input.full_name },
    });
    if (auth.error) throw new Error(auth.error.message);
    const newUserId = auth.data.user?.id;
    if (!newUserId) throw new Error('Invite failed');

    const { data, error } = await admin
      .from('profiles')
      .insert({
        id: newUserId,
        clinic_id: clinicId,
        email: input.email,
        full_name: input.full_name,
        phone: input.phone ?? null,
        role: input.role,
        locale: input.locale,
        permissions_override: input.permissions_override ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await admin.from('invitations').insert({
      clinic_id: clinicId,
      email: input.email,
      role: input.role,
      invited_by: userId,
      token: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    });

    return data;
  }

  async update(clinicId: string, id: string, input: z.infer<typeof UpdateStaffSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('profiles')
      .update({
        ...(input.full_name !== undefined && { full_name: input.full_name }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.is_active !== undefined && { is_active: input.is_active }),
        ...(input.custom_role_id !== undefined && { custom_role_id: input.custom_role_id }),
        ...(input.permissions_override !== undefined && {
          permissions_override: input.permissions_override,
        }),
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listRoles(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('custom_roles')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .order('name');
    return data ?? [];
  }

  async createRole(clinicId: string, userId: string, input: z.infer<typeof CreateRoleSchema>) {
    const { data, error } = await this.supabase
      .admin()
      .from('custom_roles')
      .insert({
        clinic_id: clinicId,
        name: input.name,
        description: input.description ?? null,
        base_role: input.base_role,
        permissions: input.permissions,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateRole(
    clinicId: string,
    id: string,
    input: z.infer<typeof UpdateRoleSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('custom_roles')
      .update({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.base_role !== undefined && { base_role: input.base_role }),
        ...(input.permissions !== undefined && { permissions: input.permissions }),
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async archiveRole(clinicId: string, id: string) {
    await this.supabase
      .admin()
      .from('custom_roles')
      .update({ is_archived: true })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    return { ok: true };
  }

  getPermissionCatalog() {
    return {
      modules: PERMISSION_MODULES,
      groups: PERMISSION_MODULES,
      all: ALL_PERMISSIONS,
      role_defaults: ROLE_DEFAULT_PERMISSIONS,
      presets: PERMISSION_PRESETS,
    };
  }
}

@ApiTags('staff')
@Controller({ path: 'staff', version: '1' })
class StaffController {
  constructor(private readonly svc: StaffService) {}

  @Get('permissions/catalog')
  catalog() {
    return this.svc.getPermissionCatalog();
  }

  @Get()
  @RequirePerm('staff.view')
  list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listStaff(u.clinicId);
  }

  @Post('invite')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'staff.invited', resourceType: 'profiles' })
  invite(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.invite(u.clinicId, u.userId, InviteSchema.parse(body));
  }

  @Patch(':id')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'staff.updated', resourceType: 'profiles' })
  update(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.update(u.clinicId, id, UpdateStaffSchema.parse(body));
  }

  @Get('roles')
  @RequirePerm('staff.view')
  listRoles(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listRoles(u.clinicId);
  }

  @Post('roles')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'role.created', resourceType: 'custom_roles' })
  createRole(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createRole(u.clinicId, u.userId, CreateRoleSchema.parse(body));
  }

  @Patch('roles/:id')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'role.updated', resourceType: 'custom_roles' })
  updateRole(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateRole(u.clinicId, id, UpdateRoleSchema.parse(body));
  }

  @Post('roles/:id/archive')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'role.archived', resourceType: 'custom_roles' })
  archiveRole(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.archiveRole(u.clinicId, id);
  }
}

@Module({
  controllers: [StaffController],
  providers: [StaffService, SupabaseService],
  exports: [StaffService],
})
export class StaffModule {}

export { ALL_PERMISSIONS, PERMISSION_MODULES, PERMISSION_PRESETS, ROLE_DEFAULT_PERMISSIONS };
export type { PermissionKey };
