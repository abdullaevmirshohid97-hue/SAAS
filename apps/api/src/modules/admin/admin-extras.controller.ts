import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AdminExtrasService } from './admin-extras.service';

@ApiTags('admin-extras')
@Controller('admin')
@UseGuards(SuperAdminGuard)
export class AdminExtrasController {
  constructor(private readonly svc: AdminExtrasService) {}

  // ── Portal users ─────────────────────────────────────────────────────────

  @Get('portal-users')
  listPortalUsers(
    @Query('q') q?: string,
    @Query('city') city?: string,
    @Query('suspended') suspended?: string,
    @Query('page') page?: string,
  ) {
    return this.svc.listPortalUsers({
      q,
      city,
      suspended: suspended === 'true' ? true : suspended === 'false' ? false : undefined,
      page: page ? Number(page) : undefined,
    });
  }

  @Get('portal-users/stats')
  portalUserStats() {
    return this.svc.portalUserStats();
  }

  @Get('portal-users/:id')
  getPortalUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPortalUser(id);
  }

  @Post('portal-users/:id/suspend')
  suspendPortalUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
  ) {
    return this.svc.suspendPortalUser(id, body.reason);
  }

  @Post('portal-users/:id/unsuspend')
  unsuspendPortalUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unsuspendPortalUser(id);
  }

  // ── Feature flags ─────────────────────────────────────────────────────────

  @Get('extras/feature-flags')
  listFeatureFlags(@Query('clinic_id') clinicId?: string) {
    return this.svc.listFeatureFlags(clinicId);
  }

  @Post('extras/feature-flags')
  setFeatureFlag(
    @CurrentUser() u: { userId: string | null },
    @Body() body: { clinic_id: string; feature: string; enabled: boolean; reason: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.setFeatureFlag(body.clinic_id, body.feature, body.enabled, body.reason, u.userId);
  }

  @Post('extras/feature-flags/bulk')
  bulkSetFeatureFlag(
    @CurrentUser() u: { userId: string | null },
    @Body() body: { clinic_ids: string[]; feature: string; enabled: boolean },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.bulkSetFeatureFlag(body.clinic_ids, body.feature, body.enabled, u.userId);
  }

  // ── Moderation ────────────────────────────────────────────────────────────

  @Get('moderation/web-profiles')
  listWebProfiles(@Query('published') published?: string, @Query('page') page?: string) {
    return this.svc.listWebProfiles({
      published: published === 'true' ? true : published === 'false' ? false : undefined,
      page: page ? Number(page) : undefined,
    });
  }

  @Post('moderation/web-profiles/:clinicId')
  moderateWebProfile(
    @Param('clinicId', ParseUUIDPipe) clinicId: string,
    @Body() body: { action: 'publish' | 'unpublish' },
  ) {
    return this.svc.moderateWebProfile(clinicId, body.action);
  }

  @Get('moderation/reviews')
  listReviews(@Query('hidden') hidden?: string, @Query('page') page?: string) {
    return this.svc.listReviewsForModeration({
      hidden: hidden === 'true' ? true : hidden === 'false' ? false : undefined,
      page: page ? Number(page) : undefined,
    });
  }

  @Post('moderation/reviews/:id')
  moderateReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { hidden: boolean },
  ) {
    return this.svc.moderateReview(id, body.hidden);
  }

  // ── Plan management ───────────────────────────────────────────────────────

  @Post('tenants/:id/change-plan')
  changePlan(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { plan: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.changePlan(id, body.plan, u.userId);
  }

  // ── System health ─────────────────────────────────────────────────────────

  @Get('system/health')
  getSystemHealth() {
    return this.svc.getSystemHealth();
  }

  // ── Broadcast messaging ───────────────────────────────────────────────────

  @Post('broadcast')
  sendBroadcast(
    @CurrentUser() u: { userId: string | null },
    @Body()
    body: {
      target: 'all_clinics' | 'by_plan' | 'by_city' | 'specific';
      plan?: string;
      city?: string;
      clinic_ids?: string[];
      subject: string;
      body: string;
      channel: 'in_app' | 'email';
    },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.sendBroadcast({ ...body, sender_id: u.userId });
  }

  // ── Enhanced tenant detail ────────────────────────────────────────────────

  @Get('tenants/:id/detail')
  getTenantDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getTenantDetail(id);
  }
}
