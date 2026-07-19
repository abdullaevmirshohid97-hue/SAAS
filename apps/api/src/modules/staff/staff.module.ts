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

const StaffDocumentSchema = z.object({
  type: z.enum(['diploma', 'certificate', 'license', 'id', 'other']).default('other'),
  name: z.string().min(1),
  url: z.string().url(),
  uploaded_at: z.string().datetime().optional(),
});

const InviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(VALID_ROLES),
  locale: z.string().default('uz-Latn'),
  permissions_override: PermissionMapSchema.optional(),
  photo_url: z.string().url().optional(),
  documents: z.array(StaffDocumentSchema).optional(),
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
export class StaffService {
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

  // Plan bo'yicha xodim o'rinlari sarfi — frontend cheklovni oldindan
  // ko'rsatishi uchun. max NULL bo'lsa — cheksiz.
  async seatUsage(clinicId: string): Promise<{ used: number; max: number | null }> {
    const admin = this.supabase.admin();
    const { data: limits } = await admin
      .rpc('get_clinic_plan_limits' as never, { p_clinic_id: clinicId } as never)
      .single();
    const max = (limits as { max_staff: number | null } | null)?.max_staff ?? null;
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('is_active', true);
    return { used: count ?? 0, max };
  }

  // Plan o'rni bo'shligini tekshiradi — limit to'lgan bo'lsa xato tashlaydi.
  // invite() va staff_profiles grantAccess() ikkalasi ham ishlatadi.
  async assertSeatAvailable(clinicId: string) {
    const admin = this.supabase.admin();
    const { data: limits } = await admin
      .rpc('get_clinic_plan_limits' as never, { p_clinic_id: clinicId } as never)
      .single();
    const maxStaff = (limits as { max_staff: number | null } | null)?.max_staff ?? null;
    if (maxStaff == null) return;
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('is_active', true);
    if ((count ?? 0) >= maxStaff) {
      throw new BadRequestException(
        `Plan'ingiz cheklovi tugadi (${maxStaff} xodim). Tarifni yangilash kerak.`,
      );
    }
  }

  // Login akkaunt yaratish: auth.users + profiles + set_user_clinic RPC.
  // invite() va grantAccess() uchun umumiy. Plan o'rni OLDIN tekshirilishi
  // kerak (chaqiruvchi assertSeatAvailable'ni chaqiradi).
  async provisionLoginUser(
    clinicId: string,
    input: {
      email: string;
      full_name: string;
      role: string;
      phone?: string | null;
      locale?: string;
      permissions_override?: Record<string, boolean> | null;
      photo_url?: string | null;
      documents?: Array<Record<string, unknown>>;
    },
  ): Promise<{ userId: string; profile: unknown }> {
    const admin = this.supabase.admin();
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('email', input.email)
      .maybeSingle();
    if (existing) throw new BadRequestException('Bu email allaqachon ishlatilgan');

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

    const documentsWithStamps = (input.documents ?? []).map((d) => ({
      ...d,
      uploaded_at: (d as { uploaded_at?: string }).uploaded_at ?? new Date().toISOString(),
    }));
    const { data, error } = await admin
      .from('profiles')
      .upsert(
        {
          id: newUserId,
          clinic_id: clinicId,
          email: input.email,
          full_name: input.full_name,
          phone: input.phone ?? null,
          role: input.role,
          locale: input.locale ?? 'uz-Latn',
          permissions_override: input.permissions_override ?? null,
          photo_url: input.photo_url ?? null,
          documents: documentsWithStamps,
        },
        { onConflict: 'id' },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    // MUHIM: xodimning JWT app_metadata'siga clinic_id + role yoziladi.
    // RLS (get_my_clinic_id / get_my_role) app_metadata'dan o'qiydi.
    const { error: claimErr } = await admin.rpc('set_user_clinic' as never, {
      p_user_id: newUserId,
      p_clinic_id: clinicId,
      p_role: input.role,
    } as never);
    if (claimErr) throw new Error(claimErr.message);

    return { userId: newUserId, profile: data };
  }

  async invite(clinicId: string, userId: string, input: z.infer<typeof InviteSchema>) {
    const admin = this.supabase.admin();
    await this.assertSeatAvailable(clinicId);

    const { userId: newUserId, profile } = await this.provisionLoginUser(clinicId, {
      email: input.email,
      full_name: input.full_name,
      role: input.role,
      phone: input.phone,
      locale: input.locale,
      permissions_override: input.permissions_override ?? null,
      photo_url: input.photo_url ?? null,
      documents: input.documents,
    });

    await admin.from('invitations').insert({
      clinic_id: clinicId,
      email: input.email,
      role: input.role,
      invited_by: userId,
      token: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    });

    // Login taklifi bilan birga HR yozuvi ham yaratiladi — aks holda xodim
    // "Xodim profillari" (staff_profiles: maosh/HR) ro'yxatida ko'rinmay,
    // admin "qo'shdim lekin ro'yxatda yo'q" deb adashadi. Best-effort:
    // xato taklifni buzmaydi. grantAccess() bunga kirmaydi (u aksincha —
    // mavjud HR yozuviga login ochadi).
    try {
      const { data: hrExists } = await admin
        .from('staff_profiles')
        .select('id')
        .eq('profile_id', newUserId)
        .maybeSingle();
      if (!hrExists) {
        const parts = input.full_name.trim().split(/\s+/);
        await admin.from('staff_profiles').insert({
          clinic_id: clinicId,
          profile_id: newUserId,
          last_name: parts[0] ?? input.full_name,
          first_name: parts.slice(1).join(' ') || (parts[0] ?? input.full_name),
          phone: input.phone ?? null,
          email: input.email,
          position: input.role,
          salary_type: 'fixed',
          salary_fixed_uzs: 0,
          salary_percent: 0,
          is_active: true,
          created_by: userId,
        });
      }
    } catch {
      /* HR yozuvi best-effort — taklifni bloklamaydi */
    }
    return profile;
  }

  // ── M1: parol boshqaruvi — admin xodimga parol beradi/yangilaydi ──────────
  // Berilgan oxirgi parol staff_credentials'da saqlanadi (faqat shu API orqali,
  // clinic_admin ko'radi). Google-only akkauntga email-identity ham qo'shiladi —
  // aks holda parol o'rnatilsa ham mobil login "Invalid credentials" beradi.
  async setStaffPassword(
    clinicId: string,
    adminId: string,
    staffId: string,
    customPassword?: string,
  ): Promise<{ password: string }> {
    const admin = this.supabase.admin();
    const { data: prof } = await admin
      .from('profiles')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('id', staffId)
      .maybeSingle();
    if (!prof) throw new NotFoundException('Xodim topilmadi');

    const password =
      customPassword?.trim() && customPassword.trim().length >= 8
        ? customPassword.trim()
        : `Clary-${Math.random().toString(36).slice(2, 6)}${Math.floor(1000 + Math.random() * 9000)}`;

    const { error: updErr } = await (admin as unknown as {
      auth: {
        admin: {
          updateUserById: (
            id: string,
            attrs: { password: string; email_confirm?: boolean },
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
    }).auth.admin.updateUserById(staffId, { password, email_confirm: true });
    if (updErr) throw new BadRequestException(updErr.message);

    // Google-only bo'lsa email identity (best-effort emas — login uchun SHART)
    const { error: idErr } = await admin.rpc('ensure_email_identity' as never, {
      p_user_id: staffId,
    } as never);
    if (idErr) throw new BadRequestException(idErr.message);

    await admin.from('staff_credentials').upsert(
      {
        profile_id: staffId,
        clinic_id: clinicId,
        password_plain: password,
        set_by: adminId,
        set_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' },
    );
    return { password };
  }

  async getStaffPassword(
    clinicId: string,
    staffId: string,
  ): Promise<{ password: string | null; set_at: string | null }> {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('staff_credentials')
      .select('password_plain, set_at')
      .eq('clinic_id', clinicId)
      .eq('profile_id', staffId)
      .maybeSingle();
    const row = data as { password_plain: string; set_at: string } | null;
    return { password: row?.password_plain ?? null, set_at: row?.set_at ?? null };
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

  @Get('seat-usage')
  @RequirePerm('staff.view')
  seatUsage(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.seatUsage(u.clinicId);
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

  // M1 — parol berish/yangilash (faqat admin). Parol javobda qaytadi va
  // staff_credentials'da saqlanadi ("paroli doim adminda bo'lsin" talabi).
  @Post(':id/password')
  @Roles('clinic_owner', 'clinic_admin')
  @Audit({ action: 'staff.password_set', resourceType: 'profiles' })
  setPassword(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { password?: string },
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.setStaffPassword(u.clinicId, u.userId, id, body?.password);
  }

  @Get(':id/password')
  @Roles('clinic_owner', 'clinic_admin')
  getPassword(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getStaffPassword(u.clinicId, id);
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
