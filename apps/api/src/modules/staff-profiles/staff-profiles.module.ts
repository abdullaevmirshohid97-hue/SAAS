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
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { StaffModule, StaffService } from '../staff/staff.module';

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

const VALID_ROLES = [
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

const StaffProfileSchema = z.object({
  profile_id: z.string().uuid().nullish(),
  last_name: z.string().min(1).max(120),
  first_name: z.string().min(1).max(120),
  patronymic: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
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

// "Ilovaga ruxsat ber" — maosh xodimiga login akkaunt yaratish.
const GrantAccessSchema = z.object({
  email: z.string().email(),
  role: z.enum(VALID_ROLES),
});

@Injectable()
export class StaffProfilesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly staff: StaffService,
  ) {}

  async list(clinicId: string, filter: { position?: string; active?: boolean } = {}) {
    let q = this.supabase
      .admin()
      .from('staff_profiles')
      .select('*, profile:profiles!profile_id(id, full_name, role, email)')
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
      .select('*, profile:profiles!profile_id(id, full_name, role, email)')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async create(clinicId: string, userId: string, input: z.infer<typeof StaffProfileSchema>) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
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

    // Maosh va Hisob-kitob uchun: shifokor anketaga qo'shilganda
    // darhol "ghost" auth.users + profiles yaratiladi (login imkonisiz —
    // tasodifiy parol, foydalanuvchi bilmaydi). Shu orqali payroll FK
    // (profiles.id -> auth.users.id) ishlaydi.
    const row = data as {
      id: string;
      first_name: string;
      last_name: string;
      patronymic: string | null;
      phone: string | null;
      profile_id: string | null;
      position: string;
    };
    // Klinik xodimlar uchun ghost profile yaratiladi (login imkonisiz, faqat
     // payroll/qabulxona dropdown va appointment.doctor_id uchun zarur).
     // Kassir, qabulxona xodimi, "boshqa" — ghost YO'Q (ular foydalanuvchi
     // sifatida alohida 'staff' tabida login bilan qo'shiladi).
     const KLINIK_POSITIONS = new Set([
       'doctor', 'nurse', 'administrator',
       'pharmacist', 'lab_tech', 'manager', 'cleaner',
     ]);
     if (KLINIK_POSITIONS.has(row.position) && !row.profile_id) {
      try {
        const fullName = [row.last_name, row.first_name, row.patronymic].filter(Boolean).join(' ');
        const ghostEmail = `payroll+${row.id.slice(0, 8)}@clary.local`;
        // Tasodifiy uzun parol — hech kim bilmaydi, login qila olmaydi.
        const randomPassword = randomUUID() + randomUUID();

        const authClient = admin as unknown as {
          auth: {
            admin: {
              createUser: (input: {
                email: string;
                password: string;
                email_confirm?: boolean;
                user_metadata?: Record<string, unknown>;
              }) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
            };
          };
        };
        const created = await authClient.auth.admin.createUser({
          email: ghostEmail,
          password: randomPassword,
          email_confirm: true,
          user_metadata: { ghost: true, source: 'staff_profiles', staff_profile_id: row.id },
        });
        const newProfileId = created.data.user?.id;
        if (newProfileId) {
          // Position -> role: administrator -> clinic_admin, qolgan
          // klinik xodimlar -> 'doctor' (user_role enum cheklov sabab).
          // Frontend staff_profiles.position ko'rsatadi (badge bilan).
          const POSITION_TO_ROLE: Record<string, string> = {
            doctor: 'doctor',
            nurse: 'doctor',
            administrator: 'clinic_admin',
            pharmacist: 'doctor',
            lab_tech: 'doctor',
            manager: 'doctor',
            cleaner: 'doctor',
          };
          const ghostRole = POSITION_TO_ROLE[row.position] ?? 'doctor';
          await admin.from('profiles').insert({
            id: newProfileId,
            clinic_id: clinicId,
            email: ghostEmail,
            full_name: fullName,
            phone: row.phone,
            role: ghostRole,
            is_active: true,
          });
          await admin
            .from('staff_profiles')
            .update({ profile_id: newProfileId })
            .eq('id', row.id);
          // Anketadagi salary_percent / salary_fixed_uzs ni payroll'ga sync
          const percent = Number((input as { salary_percent?: number }).salary_percent ?? 0);
          const fixed = Number((input as { salary_fixed_uzs?: number }).salary_fixed_uzs ?? 0);
          if (percent > 0 || fixed > 0) {
            await admin.from('doctor_commission_rates').insert({
              clinic_id: clinicId,
              doctor_id: newProfileId,
              service_id: null,
              percent,
              fixed_uzs: fixed,
              valid_from: new Date().toISOString().slice(0, 10),
            });
          }
          (data as { profile_id?: string | null }).profile_id = newProfileId;
        }
      } catch {
        // Ghost yaratish xatosi anketani buzmasin
      }
    }
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

  // Backfill — mavjud staff_profiles (klinik position'lar, profile_id=NULL)
  // uchun ghost auth user + profile yaratish. Bir martalik amal, yangi
  // anketa qo'shilganda create() avtomatik qiladi.
  // KLINIK_POSITIONS: doctor, nurse, administrator, pharmacist, lab_tech,
  // manager, cleaner — qabulxonada dropdown va payroll'da ko'rinishi shart.
  async backfillGhostProfiles(clinicId: string): Promise<{ created: number; skipped: number }> {
    const admin = this.supabase.admin();
    const KLINIK_POSITIONS = [
      'doctor', 'nurse', 'administrator',
      'pharmacist', 'lab_tech', 'manager', 'cleaner',
    ];
    const { data: rows } = await admin
      .from('staff_profiles')
      .select('id, clinic_id, first_name, last_name, patronymic, phone, salary_percent, salary_fixed_uzs, position')
      .eq('clinic_id', clinicId)
      .in('position', KLINIK_POSITIONS)
      .is('profile_id', null)
      .eq('is_active', true);

    const list = (rows ?? []) as Array<{
      id: string;
      clinic_id: string;
      first_name: string;
      last_name: string;
      patronymic: string | null;
      phone: string | null;
      salary_percent: number | null;
      salary_fixed_uzs: number | null;
      position: string;
    }>;

    let created = 0;
    let skipped = 0;

    const authClient = admin as unknown as {
      auth: {
        admin: {
          createUser: (input: {
            email: string;
            password: string;
            email_confirm?: boolean;
            user_metadata?: Record<string, unknown>;
          }) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
        };
      };
    };

    for (const sp of list) {
      try {
        const fullName = [sp.last_name, sp.first_name, sp.patronymic].filter(Boolean).join(' ');
        const ghostEmail = `payroll+${sp.id.slice(0, 8)}@clary.local`;
        const randomPassword = randomUUID() + randomUUID();

        const createdUser = await authClient.auth.admin.createUser({
          email: ghostEmail,
          password: randomPassword,
          email_confirm: true,
          user_metadata: { ghost: true, source: 'staff_profiles', staff_profile_id: sp.id },
        });
        const newId = createdUser.data.user?.id;
        if (!newId) {
          skipped++;
          continue;
        }
        const POSITION_TO_ROLE: Record<string, string> = {
          doctor: 'doctor',
          nurse: 'doctor',
          administrator: 'clinic_admin',
          pharmacist: 'doctor',
          lab_tech: 'doctor',
          manager: 'doctor',
          cleaner: 'doctor',
        };
        const ghostRole = POSITION_TO_ROLE[sp.position] ?? 'doctor';
        await admin.from('profiles').insert({
          id: newId,
          clinic_id: sp.clinic_id,
          email: ghostEmail,
          full_name: fullName,
          phone: sp.phone,
          role: ghostRole,
          is_active: true,
        });
        await admin.from('staff_profiles').update({ profile_id: newId }).eq('id', sp.id);

        const percent = Number(sp.salary_percent ?? 0);
        const fixed = Number(sp.salary_fixed_uzs ?? 0);
        if (percent > 0 || fixed > 0) {
          await admin.from('doctor_commission_rates').insert({
            clinic_id: sp.clinic_id,
            doctor_id: newId,
            service_id: null,
            percent,
            fixed_uzs: fixed,
            valid_from: new Date().toISOString().slice(0, 10),
          });
        }
        created++;
      } catch {
        skipped++;
      }
    }
    return { created, skipped };
  }

  // Butunlay o'chirish — bazadan butunlay yo'qoladi (qaytarib bo'lmaydi).
  // Faqat owner/admin uchun.
  // Agar xodimda login akkaunt bo'lsa — u ham birga o'chiriladi (cascade):
  // auth.users -> profiles -> staff_profiles. clinic_owner'ni o'chirib bo'lmaydi.
  async hardDelete(clinicId: string, id: string, requesterId: string) {
    const admin = this.supabase.admin();
    const { data: row } = await admin
      .from('staff_profiles')
      .select('profile_id')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!row) throw new NotFoundException('Xodim topilmadi');
    const profileId = (row as { profile_id: string | null }).profile_id;

    if (profileId) {
      if (profileId === requesterId) {
        throw new BadRequestException('O\'zingizni o\'chira olmaysiz');
      }
      const { data: prof } = await admin
        .from('profiles')
        .select('role')
        .eq('id', profileId)
        .maybeSingle();
      const role = (prof as { role?: string } | null)?.role ?? null;
      if (role === 'clinic_owner') {
        throw new BadRequestException('Klinika egasini o\'chirib bo\'lmaydi');
      }

      // staff_profiles.profile_id ni bo'shatamiz — login bog'lanishni uzamiz.
      await admin
        .from('staff_profiles')
        .update({ profile_id: null })
        .eq('clinic_id', clinicId)
        .eq('id', id);

      // profiles satrini TO'LIQ o'chirib bo'lmaydi — boshqa jadvallarda FK
      // aloqalari bor (doctor_commissions, appointments, transactions va h.k.)
      // va tarixiy hisobotlar uchun bu zarur. Shuning uchun profile'ni
      // soft-disable qilamiz: is_active=false, clinic_id NULL.
      // email NOT NULL constraint bor — soxta unikal qiymat qo'yamiz
      // (eski email qayta ishlatilishi uchun bo'shatiladi).
      const deletedEmail = `deleted+${profileId.slice(0, 8)}-${Date.now()}@clary.local`;
      const { error: profErr } = await admin
        .from('profiles')
        .update({
          is_active: false,
          email: deletedEmail,
          clinic_id: null,
          permissions_override: null,
        })
        .eq('id', profileId);
      if (profErr) {
        throw new BadRequestException(`Profile soft-disable bo'lmadi: ${profErr.message}`);
      }

      // auth.users ni o'chiramiz — bu loginni butunlay to'xtatadi.
      try {
        await (admin as unknown as {
          auth: { admin: { deleteUser: (id: string) => Promise<{ error: { message: string } | null }> } };
        }).auth.admin.deleteUser(profileId);
      } catch {
        // ignore — profile is_active=false bo'lgani uchun loginga ruxsat yo'q
      }
    }

    const { error } = await admin
      .from('staff_profiles')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Maosh xodimiga ilovaga kirish huquqi berish: login akkaunt yaratiladi
  // (auth + profiles + JWT claim), staff_profiles.profile_id bog'lanadi.
  // Plan o'rni cheklovi tekshiriladi.
  async grantAccess(
    clinicId: string,
    id: string,
    input: z.infer<typeof GrantAccessSchema>,
  ) {
    const admin = this.supabase.admin();
    const { data: sp, error: spErr } = await admin
      .from('staff_profiles')
      .select('id, profile_id, first_name, last_name')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (spErr || !sp) throw new NotFoundException('Xodim topilmadi');
    const row = sp as { id: string; profile_id: string | null; first_name: string; last_name: string };
    if (row.profile_id) {
      throw new BadRequestException('Bu xodimda allaqachon ilova akkaunti bor');
    }

    // Plan o'rni — login foydalanuvchilar soni cheklovi
    await this.staff.assertSeatAvailable(clinicId);

    const fullName = `${row.last_name} ${row.first_name}`.trim();
    const { userId } = await this.staff.provisionLoginUser(clinicId, {
      email: input.email,
      full_name: fullName,
      role: input.role,
    });

    const { data, error } = await admin
      .from('staff_profiles')
      .update({ profile_id: userId, email: input.email })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('*, profile:profiles!profile_id(id, full_name, role, email)')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
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
    if (!u.clinicId) {
      throw new ForbiddenException(
        'Sizning hisobingizda klinika biriktirilmagan. Tizimdan chiqib qaytadan kiring yoki admin bilan bog\'laning.',
      );
    }
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

  // Butunlay o'chirish — bazadan butunlay yo'q qiladi.
  @Delete(':id/hard')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'staff_profile.deleted', resourceType: 'staff_profiles' })
  hardDelete(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.hardDelete(u.clinicId, id, u.userId);
  }

  @Post(':id/grant-access')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'staff_profile.access_granted', resourceType: 'staff_profiles' })
  grantAccess(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.grantAccess(u.clinicId, id, GrantAccessSchema.parse(body));
  }

  // Backfill — mavjud shifokorlarni payroll bilan ulash. Bir martalik.
  @Post('backfill-ghost-profiles')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'staff_profile.backfill', resourceType: 'staff_profiles' })
  backfillGhostProfiles(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.backfillGhostProfiles(u.clinicId);
  }

  // GET versiya — brauzer URL bilan chaqirish uchun (qulay UI yo'q paytlarda).
  // Login holatida URL bo'lib o'tilsa darhol ishga tushadi.
  @Get('backfill-ghost-profiles')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  @Audit({ action: 'staff_profile.backfill', resourceType: 'staff_profiles' })
  backfillGhostProfilesGet(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.backfillGhostProfiles(u.clinicId);
  }
}

@Module({
  imports: [StaffModule],
  controllers: [StaffProfilesController],
  providers: [StaffProfilesService, SupabaseService],
  exports: [StaffProfilesService],
})
export class StaffProfilesModule {}
