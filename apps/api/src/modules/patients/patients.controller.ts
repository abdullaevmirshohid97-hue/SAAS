import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { patientPhoneError } from '@clary/utils';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { PatientsService } from './patients.service';
import { PatientRegistryService, type RegistryFilter } from './patient-registry.service';

const PatientFieldsSchema = z.object({
  // .trim() MAJBURIY: aks holda faqat probeldan iborat ism (" ") .min() dan
  // o'tib ketadi va bemor ISMSIZ yaratiladi (qarzdorlar ro'yxatida bo'sh qator).
  full_name: z.string().trim().min(2).optional(),
  first_name: z.string().trim().min(1).optional(),
  last_name: z.string().trim().min(1).optional(),
  patronymic: z.string().trim().optional(),
  dob: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  phone: z.string().optional(),
  secondary_phone: z.string().optional(),
  email: z.string().email().optional(),
  id_number: z.string().optional(),
  id_type: z.enum(['passport', 'id', 'driver']).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  referral_source: z
    .enum([
      'instagram',
      'telegram',
      'facebook',
      'tiktok',
      'youtube',
      'google',
      'billboard',
      'word_of_mouth',
      'doctor',
      'returning',
      'other',
    ])
    .optional(),
  referral_notes: z.string().optional(),
  referral_partner_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

const CreatePatientSchema = PatientFieldsSchema.refine(
  (v) => v.full_name || (v.first_name && v.last_name),
  { message: 'full_name or first_name+last_name required', path: ['full_name'] },
);

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly svc: PatientsService,
    private readonly registry: PatientRegistryService,
  ) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('q') q?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, page, pageSize, q);
  }

  // ⚠️ Aniq yo'llar ':id' DAN OLDIN turishi shart (ParseUUIDPipe 'registry'ni rad etadi)

  /** Bemorlar daftari: ro'yxat + tashrif/to'lov/qarz/statsionar ko'rsatkichlari. */
  @Get('registry')
  registryList(
    @CurrentUser() u: { clinicId: string | null },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(30), ParseIntPipe) pageSize: number,
    @Query('q') q?: string,
    @Query('filter') filter?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const f: RegistryFilter = filter === 'debtors' || filter === 'inpatient' ? filter : 'all';
    return this.registry.registry(u.clinicId, { q, filter: f, page, pageSize });
  }

  /** Familiya + ism + telefon mos keladigan bemor ("qayta keldi"). */
  @Get('match')
  match(
    @CurrentUser() u: { clinicId: string | null },
    @Query('last_name') last_name?: string,
    @Query('first_name') first_name?: string,
    @Query('phone') phone?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.registry.match(u.clinicId, { last_name, first_name, phone });
  }

  @Get(':id/history')
  history(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.registry.history(u.clinicId, id);
  }

  @Get(':id/stats')
  async patientStats(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return (await this.registry.stats(u.clinicId, [id])).get(id) ?? null;
  }

  @Get(':id')
  getOne(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getOne(u.clinicId, id);
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.timeline(u.clinicId, id);
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'doctor', 'receptionist')
  @Audit({ action: 'patient.registered', resourceType: 'patients' })
  create(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    // Telefon MAJBURIY: "qayta keldi" (familiya + ism + telefon) shusiz ishlamaydi
    const phoneErr = patientPhoneError((body as { phone?: string } | null)?.phone);
    if (phoneErr) {
      throw new BadRequestException(
        phoneErr === 'empty'
          ? 'Telefon raqamini kiriting'
          : "Telefon raqami to'liq emas — 9 ta raqam kiriting (masalan 90 123 45 67)",
      );
    }
    const data = CreatePatientSchema.parse(body);
    // Familiya + ism + telefon mos kelsa — mavjud bemor qaytadi (dublikat karta yo'q)
    return this.registry.createOrReuse(u.clinicId, u.userId, data);
  }

  @Patch(':id')
  @Roles('clinic_admin', 'clinic_owner', 'doctor', 'receptionist')
  @Audit({ action: 'patient.updated', resourceType: 'patients' })
  update(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const data = PatientFieldsSchema.partial().parse(body);
    return this.svc.update(u.clinicId, id, data);
  }

  @Delete(':id')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'patient.deleted', resourceType: 'patients' })
  archive(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.softDelete(u.clinicId, id);
  }
}
