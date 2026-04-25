import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { AppointmentsService } from './appointments.service';

const CreateSchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid().optional(),
  service_id: z.string().uuid().optional(),
  room_id: z.string().uuid().optional(),
  scheduled_at: z.string().datetime(),
  duration_min: z.number().int().positive().default(30),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  @Get()
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('doctor') doctor?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId, { from, to, doctor });
  }

  @Post()
  @Roles('clinic_admin', 'receptionist')
  @Audit({ action: 'appointment.scheduled', resourceType: 'appointments' })
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const data = CreateSchema.parse(body);
    return this.svc.create(u.clinicId, u.userId, data);
  }

  @Patch(':id')
  @Audit({ action: 'appointment.rescheduled', resourceType: 'appointments' })
  update(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const data = CreateSchema.partial().parse(body);
    return this.svc.update(u.clinicId, id, data);
  }
}
