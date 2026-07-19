import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe,
  Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { AllowWithoutClinic } from '../../common/decorators/allow-without-clinic.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard as JwtAuthGuard } from '../../common/guards/auth.guard';

import { PatientPortalService } from './patient-portal.service';
import { SmsOtpService } from './sms-otp.service';

type AuthCtx = { userId: string; clinicId: string | null };

const OtpRequestSchema = z.object({ phone: z.string().min(7).max(20) });
const OtpVerifySchema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{4,8}$/),
});

const BookingSchema = z.object({
  slot_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

const NurseRequestSchema = z.object({
  clinic_id: z.string().uuid(),
  tariff_id: z.string().uuid().optional(), // tarif ixtiyoriy — klinika keyin narx beradi
  service: z.string().min(1),
  requester_name: z.string().min(2),
  requester_phone: z.string().min(9),
  address: z.string().min(5),
  address_notes: z.string().optional(),
  geo_lat: z.number().min(-90).max(90).optional(),
  geo_lng: z.number().min(-180).max(180).optional(),
  preferred_at: z.string().datetime().optional(),
  is_urgent: z.boolean().default(false),
  notes: z.string().max(500).optional(),
});

const CancelSchema = z.object({ reason: z.string().optional() });

const AppointmentRequestSchema = z.object({
  clinic_id: z.string().uuid(),
  doctor_id: z.string().uuid().nullable().optional(),
  preferred_at: z.string().datetime().optional(),
  preferred_note: z.string().max(120).optional(),
  reason: z.string().max(500).optional(),
});

const RespondAppointmentSchema = z.object({
  action: z.enum(['confirm', 'reject']),
  scheduled_at: z.string().datetime().optional(),
  response_note: z.string().max(500).optional(),
});

@ApiTags('patient')
@Controller('patient')
export class PatientPortalController {
  constructor(
    private readonly svc: PatientPortalService,
    private readonly otp: SmsOtpService,
  ) {}

  // ── Public: SMS OTP authentication ────────────────────────────────────────

  @Public()
  @Post('auth/otp/request')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  requestOtp(
    @Request() req: { ip?: string; headers?: Record<string, string> },
    @Body() body: unknown,
  ) {
    const { phone } = OtpRequestSchema.parse(body);
    return this.otp.requestOtp(phone, req.ip, req.headers?.['user-agent']);
  }

  @Public()
  @Post('auth/otp/verify')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  verifyOtp(@Body() body: unknown) {
    const { phone, code } = OtpVerifySchema.parse(body);
    return this.otp.verifyOtp(phone, code);
  }

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
  @AllowWithoutClinic()
  @Post('clinics/:slug/reviews')
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  createReview(
    @CurrentUser() user: AuthCtx,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    const data = z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(1000).optional(),
      booking_id: z.string().uuid().optional(),
    }).parse(body);
    return this.svc.createReview(user.userId, slug, data);
  }

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Post('reviews/:id/helpful')
  toggleHelpful(
    @CurrentUser() user: AuthCtx,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.toggleHelpful(user.userId, id);
  }

  // ── Clinic CRM: Web profile (klinika xodimi — clinic_id talab qilinadi) ────

  @UseGuards(JwtAuthGuard)
  @Get('clinic/web-profile')
  getWebProfile(@CurrentUser() user: AuthCtx) {
    return this.svc.getWebProfile(user.clinicId as string);
  }

  @UseGuards(JwtAuthGuard)
  @Post('clinic/web-profile')
  upsertWebProfile(@CurrentUser() user: AuthCtx, @Body() body: unknown) {
    return this.svc.upsertWebProfile(user.clinicId as string, body as Record<string, unknown>);
  }

  @UseGuards(JwtAuthGuard)
  @Get('clinic/reviews')
  getClinicReviews(@CurrentUser() user: AuthCtx) {
    return this.svc.getClinicReviewsDashboard(user.clinicId as string);
  }

  @UseGuards(JwtAuthGuard)
  @Post('clinic/reviews/:id/reply')
  replyToReview(
    @CurrentUser() user: AuthCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { reply } = z.object({ reply: z.string().min(1).max(500) }).parse(body);
    return this.svc.replyToReview(user.clinicId as string, user.userId, id, reply);
  }

  @UseGuards(JwtAuthGuard)
  @Get('clinic/analytics')
  getAnalytics(@CurrentUser() user: AuthCtx) {
    return this.svc.getProfileAnalytics(user.clinicId as string);
  }

  // ── Auth-required: Medical records (tashxis + analizlar) ──────────────────

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Get('medical/records')
  getMedicalRecords(@CurrentUser() user: AuthCtx) {
    return this.svc.getMedicalRecords(user.userId);
  }

  // ── M4: davolanish holati + statsionar hamshira chaqirish ─────────────────

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Get('treatment')
  treatmentStatus(@CurrentUser() user: AuthCtx) {
    return this.svc.treatmentStatus(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Post('treatment/nurse-call')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  inpatientNurseCall(
    @CurrentUser() user: AuthCtx,
    @Body() body: { stay_id?: string; note?: string },
  ) {
    if (!body?.stay_id) throw new BadRequestException('stay_id kerak');
    return this.svc.inpatientNurseCall(user.userId, body.stay_id, body.note);
  }

  // ── Auth-required: Bookings ───────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Get('bookings')
  listBookings(@CurrentUser() user: AuthCtx) {
    return this.svc.listBookings(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Post('bookings')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createBooking(@CurrentUser() user: AuthCtx, @Body() body: unknown) {
    const data = BookingSchema.parse(body);
    return this.svc.createBooking(user.userId, data);
  }

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Post('bookings/:id/cancel')
  cancelBooking(
    @CurrentUser() user: AuthCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    CancelSchema.parse(body);
    return this.svc.cancelBooking(user.userId, id);
  }

  // ── Auth-required: Appointment requests (navbat so'rovi) ──────────────────

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Post('appointments/request')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  createAppointmentRequest(@CurrentUser() user: AuthCtx, @Body() body: unknown) {
    const data = AppointmentRequestSchema.parse(body);
    return this.svc.createAppointmentRequest(user.userId, data);
  }

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Get('appointments/mine')
  listMyAppointmentRequests(@CurrentUser() user: AuthCtx) {
    return this.svc.listMyAppointmentRequests(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Post('appointments/:id/cancel')
  cancelAppointmentRequest(@CurrentUser() user: AuthCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelAppointmentRequest(user.userId, id);
  }

  // ── Auth-required: Nurse requests ─────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Post('nurse/requests')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  createNurseRequest(@CurrentUser() user: AuthCtx, @Body() body: unknown) {
    const data = NurseRequestSchema.parse(body);
    return this.svc.createNurseRequest(user.userId, data);
  }

  @UseGuards(JwtAuthGuard)
  @AllowWithoutClinic()
  @Get('nurse/requests/mine')
  listMyNurseRequests(@CurrentUser() user: AuthCtx) {
    return this.svc.listMyNurseRequests(user.userId);
  }
}

// ── KLINIKA xodimi: bemorlardan kelgan navbat so'rovlari ────────────────────
// Staff token'ida clinic_id bor → TenantGuard o'tadi, AllowWithoutClinic kerak emas.
@ApiTags('clinic')
@Controller('clinic/appointment-requests')
export class ClinicAppointmentRequestsController {
  constructor(private readonly svc: PatientPortalService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: AuthCtx, @Query('status') status?: string) {
    if (!user.clinicId) throw new ForbiddenException();
    return this.svc.listClinicAppointmentRequests(user.clinicId, status);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/respond')
  respond(
    @CurrentUser() user: AuthCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!user.clinicId) throw new ForbiddenException();
    const data = RespondAppointmentSchema.parse(body);
    return this.svc.respondAppointmentRequest(user.clinicId, id, user.userId, data);
  }
}
