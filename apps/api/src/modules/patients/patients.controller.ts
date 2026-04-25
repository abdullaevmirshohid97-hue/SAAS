import { Body, Controller, DefaultValuePipe, Delete, ForbiddenException, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { PatientsService } from './patients.service';

const PatientFieldsSchema = z.object({
    full_name: z.string().min(2).optional(),
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    patronymic: z.string().optional(),
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
  constructor(private readonly svc: PatientsService) {}

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
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const data = CreatePatientSchema.parse(body);
    return this.svc.create(u.clinicId, u.userId, data);
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
