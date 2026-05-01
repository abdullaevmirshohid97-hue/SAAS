import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe,
  Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard as JwtAuthGuard } from '../../common/guards/auth.guard';

import { PatientPortalService } from './patient-portal.service';

const BookingSchema = z.object({
  slot_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

const NurseRequestSchema = z.object({
  clinic_id: z.string().uuid(),
  tariff_id: z.string().uuid(),
  service: z.string().min(1),
  requester_name: z.string().min(2),
  requester_phone: z.string().min(9),
  address: z.string().min(5),
  address_notes: z.string().optional(),
  preferred_at: z.string().datetime().optional(),
  is_urgent: z.boolean().default(false),
  notes: z.string().max(500).optional(),
});

const CancelSchema = z.object({ reason: z.string().optional() });

@ApiTags('patient')
@Controller('patient')
export class PatientPortalController {
  constructor(private readonly svc: PatientPortalService) {}

  // ── Public: Clinics ───────────────────────────────────────────────────────

  @Public()
  @Get('clinics')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  searchClinics(
    @Query('query') query?: string,
    @Query('city') city?: string,
    @Query('specialty') specialty?: string,
    @Query('min_rating') minRating?: string,
    @Query('page') page?: string,
  ) {
    return this.svc.searchClinics({
      query, city, specialty,
      min_rating: minRating ? Number(minRating) : undefined,
      page: page ? Number(page) : 1,
    });
  }

  @Public()
  @Get('clinics/nearby')
  getNearby(@Query('city') city: string) {
    if (!city) return [];
    return this.svc.getNearbyClinics(city);
  }

  @Public()
  @Get('clinics/:slug')
  getClinic(@Param('slug') slug: string) {
    return this.svc.getClinic(slug);
  }

  @Public()
  @Get('clinics/:slug/slots')
  getSlots(
    @Param('slug') slug: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('doctor_id') doctorId?: string,
  ) {
    return this.svc.getSlots(slug, { from, to, doctor_id: doctorId });
  }

  // ── Public: Queue status (shareable link) ────────────────────────────────

  @Public()
  @Get('queue/:bookingId')
  getQueueStatus(@Param('bookingId', ParseUUIDPipe) bookingId: string) {
    return this.svc.getQueueStatus(bookingId);
  }

  // ── Public: Nurse tariffs ─────────────────────────────────────────────────

  @Public()
  @Get('nurse/tariffs')
  getNurseTariffs(@Query('city') city?: string, @Query('service') service?: string) {
    return this.svc.getNurseTariffs({ city, service });
  }

  // ── Public: Reviews ───────────────────────────────────────────────────────

  @Public()
  @Get('clinics/:slug/reviews')
  getReviews(@Param('slug') slug: string, @Query('page') page?: string) {
    return this.svc.getReviews(slug, page ? Number(page) : 1);
  }

  @UseGuards(JwtAuthGuard)
  @Post('clinics/:slug/reviews')
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  createReview(
    @Request() req: { user: { sub: string } },
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    const data = z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(1000).optional(),
      booking_id: z.string().uuid().optional(),
    }).parse(body);
    return this.svc.createReview(req.user.sub, slug, data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('reviews/:id/helpful')
  toggleHelpful(
    @Request() req: { user: { sub: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.toggleHelpful(req.user.sub, id);
  }

  // ── Clinic CRM: Web profile ───────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('clinic/web-profile')
  getWebProfile(@Request() req: { user: { clinicId: string } }) {
    return this.svc.getWebProfile(req.user.clinicId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('clinic/web-profile')
  upsertWebProfile(
    @Request() req: { user: { clinicId: string } },
    @Body() body: unknown,
  ) {
    return this.svc.upsertWebProfile(req.user.clinicId, body as Record<string, unknown>);
  }

  @UseGuards(JwtAuthGuard)
  @Get('clinic/reviews')
  getClinicReviews(@Request() req: { user: { clinicId: string } }) {
    return this.svc.getClinicReviewsDashboard(req.user.clinicId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('clinic/reviews/:id/reply')
  replyToReview(
    @Request() req: { user: { clinicId: string; userId: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { reply } = z.object({ reply: z.string().min(1).max(500) }).parse(body);
    return this.svc.replyToReview(req.user.clinicId, req.user.userId, id, reply);
  }

  @UseGuards(JwtAuthGuard)
  @Get('clinic/analytics')
  getAnalytics(@Request() req: { user: { clinicId: string } }) {
    return this.svc.getProfileAnalytics(req.user.clinicId);
  }

  // ── Auth-required: Bookings ───────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('bookings')
  listBookings(@Request() req: { user: { sub: string } }) {
    return this.svc.listBookings(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bookings')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createBooking(@Request() req: { user: { sub: string } }, @Body() body: unknown) {
    const data = BookingSchema.parse(body);
    return this.svc.createBooking(req.user.sub, data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bookings/:id/cancel')
  cancelBooking(
    @Request() req: { user: { sub: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    CancelSchema.parse(body);
    return this.svc.cancelBooking(req.user.sub, id);
  }

  // ── Auth-required: Nurse requests ─────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('nurse/requests')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  createNurseRequest(@Request() req: { user: { sub: string } }, @Body() body: unknown) {
    const data = NurseRequestSchema.parse(body);
    return this.svc.createNurseRequest(req.user.sub, data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('nurse/requests/mine')
  listMyNurseRequests(@Request() req: { user: { sub: string } }) {
    return this.svc.listMyNurseRequests(req.user.sub);
  }
}
