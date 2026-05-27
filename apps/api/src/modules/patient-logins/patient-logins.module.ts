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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// Bemorga umumiy Clary bot uchun login/parol yaratish.
// Clinic admin/owner/super_admin tomonidan amalga oshiriladi.

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const CreateSchema = z.object({
  username: z.string().min(3).max(60).regex(/^[a-zA-Z0-9_.-]+$/, 'Faqat lotin harflari, raqamlar, _ . -'),
  password: z.string().min(6).max(120),
});

const UpdatePasswordSchema = z.object({
  password: z.string().min(6).max(120),
});

@Injectable()
export class PatientLoginsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getByPatient(clinicId: string, patientId: string) {
    const { data } = await this.supabase
      .admin()
      .from('patient_logins')
      .select('id, patient_id, username, is_active, last_login_at, created_at')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .maybeSingle();
    return data ?? null;
  }

  async create(clinicId: string, userId: string, patientId: string, input: z.infer<typeof CreateSchema>) {
    const admin = this.supabase.admin();
    // Bemor mavjudligini tekshirish
    const { data: p } = await admin
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('id', patientId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!p) throw new NotFoundException('Bemor topilmadi');

    // Username allaqachon bandmi?
    const { data: existing } = await admin
      .from('patient_logins')
      .select('id, patient_id')
      .eq('clinic_id', clinicId)
      .eq('username', input.username)
      .maybeSingle();
    if (existing) {
      const ex = existing as { id: string; patient_id: string };
      if (ex.patient_id !== patientId) {
        throw new BadRequestException('Bu username band');
      }
      // Bir xil bemorga qayta yaratish — parolni yangilash
      const hash = await argon2.hash(input.password, ARGON2_OPTS);
      const { data, error } = await admin
        .from('patient_logins')
        .update({ password_hash: hash, is_active: true })
        .eq('id', ex.id)
        .select('id, patient_id, username, is_active, last_login_at, created_at')
        .single();
      if (error) throw new BadRequestException(error.message);
      return data;
    }

    // Bemorda boshqa login bor bo'lsa — uni o'chiramiz
    await admin.from('patient_logins').delete().eq('clinic_id', clinicId).eq('patient_id', patientId);

    const hash = await argon2.hash(input.password, ARGON2_OPTS);
    const { data, error } = await admin
      .from('patient_logins')
      .insert({
        patient_id: patientId,
        clinic_id: clinicId,
        username: input.username,
        password_hash: hash,
        is_active: true,
        created_by: userId,
      })
      .select('id, patient_id, username, is_active, last_login_at, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async resetPassword(clinicId: string, patientId: string, input: z.infer<typeof UpdatePasswordSchema>) {
    const admin = this.supabase.admin();
    const { data: existing } = await admin
      .from('patient_logins')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .maybeSingle();
    if (!existing) throw new NotFoundException('Login mavjud emas');
    const hash = await argon2.hash(input.password, ARGON2_OPTS);
    const { data, error } = await admin
      .from('patient_logins')
      .update({ password_hash: hash, is_active: true })
      .eq('id', (existing as { id: string }).id)
      .select('id, patient_id, username, is_active, last_login_at, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(clinicId: string, patientId: string) {
    const admin = this.supabase.admin();
    const { error } = await admin
      .from('patient_logins')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}

@ApiTags('patient-logins')
@Controller('patients/:patientId/login')
class PatientLoginsController {
  constructor(private readonly svc: PatientLoginsService) {}

  @Get()
  @Roles('clinic_owner', 'clinic_admin', 'receptionist', 'super_admin')
  get(
    @CurrentUser() u: { clinicId: string | null },
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getByPatient(u.clinicId, patientId);
  }

  @Post()
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'patient_login.created', resourceType: 'patient_logins' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId, patientId, CreateSchema.parse(body));
  }

  @Patch('password')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'patient_login.password_reset', resourceType: 'patient_logins' })
  resetPassword(
    @CurrentUser() u: { clinicId: string | null },
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.resetPassword(u.clinicId, patientId, UpdatePasswordSchema.parse(body));
  }

  @Delete()
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  @Audit({ action: 'patient_login.deleted', resourceType: 'patient_logins' })
  remove(
    @CurrentUser() u: { clinicId: string | null },
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.remove(u.clinicId, patientId);
  }
}

@Module({
  controllers: [PatientLoginsController],
  providers: [PatientLoginsService, SupabaseService],
  exports: [PatientLoginsService],
})
export class PatientLoginsModule {}
