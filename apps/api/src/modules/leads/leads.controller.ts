import { Body, Controller, ForbiddenException, Get, Headers, Ip, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

import { LeadsService } from './leads.service';

const LeadSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(160).optional(),
  clinicName: z.string().max(160).optional(),
  message: z.string().max(2000).optional(),
  source: z.string().max(40).default('unknown'),
  utm: z.object({
    source: z.string().max(80).optional(),
    medium: z.string().max(80).optional(),
    campaign: z.string().max(120).optional(),
    content: z.string().max(160).optional(),
    term: z.string().max(160).optional(),
  }).optional(),
});

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly svc: LeadsService) {}

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 5 } })
  @Post()
  create(
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
    @Body() body: unknown,
  ) {
    const data = LeadSchema.parse(body);
    return this.svc.create({ ...data, ip, userAgent: ua ?? null });
  }

  @Get()
  list(
    @CurrentUser() user: { role: string },
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    if (user.role !== 'platform_admin' && user.role !== 'platform_owner') {
      throw new ForbiddenException();
    }
    return this.svc.list({ status, limit: limit ? Number(limit) : 50 });
  }
}
