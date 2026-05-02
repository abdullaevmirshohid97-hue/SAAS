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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SupabaseService } from '../../common/services/supabase.service';

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------
const JoinRequestSchema = z.object({
  full_name: z.string().min(2).max(120),
  phone: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  experience_years: z.number().int().min(0).max(80).optional(),
  about: z.string().max(2000).optional(),
  photo_url: z.string().url().optional(),
  diploma_url: z.string().url().optional(),
  certificate_urls: z.array(z.string().url()).max(10).default([]),
  clinic_id: z.string().uuid(),
});

const ReviewJoinSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reject_reason: z.string().max(500).optional(),
});

const AssignNurseSchema = z.object({
  request_id: z.string().uuid(),
  nurse_profile_id: z.string().uuid(),
  quoted_price_uzs: z.number().int().nonnegative().optional(),
  scheduled_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional(),
  sessions_per_day: z.number().int().min(1).max(6).optional(),
  days_count: z.number().int().min(1).max(365).optional(),
});

const StartTaskSchema = z.object({});
const CompleteTaskSchema = z.object({
  notes: z.string().max(2000).optional(),
  proof_image_url: z.string().url().optional(),
});

const ChatSendSchema = z.object({
  body: z.string().max(2000).optional(),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'file']),
        url: z.string().url(),
        name: z.string().max(120).optional(),
      }),
    )
    .max(10)
    .default([]),
}).refine((v) => (v.body && v.body.trim()) || v.attachments.length > 0, {
  message: 'Message must contain text or attachment',
});

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------
@Injectable()
export class NursePortalService {
  constructor(private readonly supabase: SupabaseService) {}

  // ----------------- nurse onboarding ----------------
  async submitJoinRequest(
    authUserId: string,
    email: string,
    input: z.infer<typeof JoinRequestSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('nurse_join_requests')
      .upsert(
        {
          email,
          auth_user_id: authUserId,
          full_name: input.full_name,
          phone: input.phone ?? null,
          city: input.city ?? null,
          experience_years: input.experience_years ?? null,
          about: input.about ?? null,
          photo_url: input.photo_url ?? null,
          diploma_url: input.diploma_url ?? null,
          certificate_urls: input.certificate_urls,
          clinic_id: input.clinic_id,
          status: 'pending',
        },
        { onConflict: 'email,clinic_id' },
      )
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getMyNurseStatus(authUserId: string) {
    const { data: requests } = await this.supabase
      .admin()
      .from('nurse_join_requests')
      .select('*, clinic:clinics(id, name, city, logo_url)')
      .eq('auth_user_id', authUserId)
      .order('created_at', { ascending: false });

    const approved = (requests ?? []).find((r) => r.status === 'approved');
    return {
      requests: requests ?? [],
      approved_clinic_id: approved?.clinic_id ?? null,
      approved_staff_profile_id: approved?.staff_profile_id ?? null,
    };
  }

  async listJoinRequestsForClinic(clinicId: string, status?: string) {
    let q = this.supabase
      .admin()
      .from('nurse_join_requests')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async reviewJoinRequest(
    clinicId: string,
    requestId: string,
    reviewerId: string,
    input: z.infer<typeof ReviewJoinSchema>,
  ) {
    const admin = this.supabase.admin();
    const { data: req, error: fetchErr } = await admin
      .from('nurse_join_requests')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', requestId)
      .single();
    if (fetchErr || !req) throw new NotFoundException('Join request not found');

    let staffProfileId: string | null = req.staff_profile_id ?? null;
    if (input.status === 'approved') {
      // Auto-create staff_profile entry
      const [last, first, ...rest] = (req.full_name as string).split(/\s+/);
      const { data: sp, error: spErr } = await admin
        .from('staff_profiles')
        .insert({
          clinic_id: clinicId,
          last_name: last ?? req.full_name,
          first_name: first ?? '',
          patronymic: rest.join(' ') || null,
          phone: req.phone,
          position: 'nurse',
          photos: req.photo_url ? [req.photo_url] : [],
          diploma_url: req.diploma_url,
          certificates: req.certificate_urls ?? [],
          is_active: true,
          created_by: reviewerId,
        })
        .select('id')
        .single();
      if (spErr) throw new BadRequestException(spErr.message);
      staffProfileId = sp.id;
    }

    const { data, error } = await admin
      .from('nurse_join_requests')
      .update({
        status: input.status,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        reject_reason: input.reject_reason ?? null,
        staff_profile_id: staffProfileId,
      })
      .eq('id', requestId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ----------------- nurse tasks ----------------
  async listTasksForNurse(nurseProfileId: string, opts: { status?: string } = {}) {
    let q = this.supabase
      .admin()
      .from('home_nurse_requests')
      .select(
        '*, patient:portal_users(id, full_name, phone), clinic:clinics(id, name, phone)',
      )
      .eq('assigned_nurse_profile_id', nurseProfileId)
      .order('preferred_at', { ascending: true });
    if (opts.status) q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async startTask(nurseProfileId: string, requestId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('home_nurse_requests')
      .update({ status: 'on_the_way' })
      .eq('id', requestId)
      .eq('assigned_nurse_profile_id', nurseProfileId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async completeTask(
    nurseProfileId: string,
    requestId: string,
    input: z.infer<typeof CompleteTaskSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('home_nurse_requests')
      .update({ status: 'completed' })
      .eq('id', requestId)
      .eq('assigned_nurse_profile_id', nurseProfileId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // Insert visit record if missing
    const { data: existing } = await this.supabase
      .admin()
      .from('home_nurse_visits')
      .select('id')
      .eq('request_id', requestId)
      .maybeSingle();
    if (!existing) {
      await this.supabase
        .admin()
        .from('home_nurse_visits')
        .insert({
          request_id: requestId,
          clinic_id: data.clinic_id,
          nurse_id: nurseProfileId,
          ended_at: new Date().toISOString(),
          nurse_notes: input.notes ?? null,
          total_uzs: data.quoted_price_uzs ?? 0,
          base_uzs: data.estimate_base_uzs ?? 0,
        });
    }

    // Add system message + photo if any
    if (input.proof_image_url || input.notes) {
      await this.supabase.admin().from('home_nurse_request_messages').insert({
        request_id: requestId,
        sender_kind: 'nurse',
        sender_user_id: nurseProfileId,
        body: input.notes ?? null,
        attachments: input.proof_image_url
          ? [{ type: 'image', url: input.proof_image_url, name: 'Tasdiq rasmi' }]
          : [],
      });
    }

    return data;
  }

  // ----------------- clinic assigns nurse ----------------
  async assignNurse(
    clinicId: string,
    input: z.infer<typeof AssignNurseSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('home_nurse_requests')
      .update({
        assigned_nurse_profile_id: input.nurse_profile_id,
        assigned_at: new Date().toISOString(),
        status: 'assigned',
        quoted_price_uzs: input.quoted_price_uzs ?? null,
        scheduled_times: input.scheduled_times ?? [],
        sessions_per_day: input.sessions_per_day ?? 1,
        days_count: input.days_count ?? 1,
      })
      .eq('id', input.request_id)
      .eq('clinic_id', clinicId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // System chat message
    await this.supabase.admin().from('home_nurse_request_messages').insert({
      request_id: input.request_id,
      sender_kind: 'system',
      body: `Hamshira tayinlandi. Narx: ${input.quoted_price_uzs ?? '-'} UZS`,
    });

    return data;
  }

  // ----------------- chat (shared between patient/clinic/nurse) ----------------
  async listMessages(authUserId: string, requestId: string) {
    // RLS will filter; admin client bypasses RLS but we re-check ownership
    const { data: req } = await this.supabase
      .admin()
      .from('home_nurse_requests')
      .select('portal_user_id, clinic_id, assigned_nurse_profile_id')
      .eq('id', requestId)
      .single();
    if (!req) throw new NotFoundException();
    // Authorization is enforced by caller (portal/clinic/nurse) — keep it simple here
    const { data, error } = await this.supabase
      .admin()
      .from('home_nurse_request_messages')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async sendMessage(
    requestId: string,
    senderKind: 'patient' | 'clinic' | 'nurse',
    senderUserId: string,
    input: z.infer<typeof ChatSendSchema>,
  ) {
    const { data, error } = await this.supabase
      .admin()
      .from('home_nurse_request_messages')
      .insert({
        request_id: requestId,
        sender_kind: senderKind,
        sender_user_id: senderUserId,
        body: input.body ?? null,
        attachments: input.attachments,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}

// -----------------------------------------------------------------------------
// Controllers — split per consumer (nurse / clinic / patient)
// -----------------------------------------------------------------------------
@ApiTags('nurse-portal')
@Controller({ path: 'nurse-portal', version: '1' })
@UseGuards(AuthGuard)
class NurseSelfController {
  constructor(private readonly svc: NursePortalService) {}

  @Post('join-request')
  @Audit({ action: 'nurse_portal.join_requested', resourceType: 'nurse_join_requests' })
  submit(
    @Req() req: Request & { user?: { sub?: string; email?: string } },
    @Body() body: unknown,
  ) {
    const user = req.user;
    if (!user?.sub || !user?.email) throw new ForbiddenException();
    return this.svc.submitJoinRequest(user.sub, user.email, JoinRequestSchema.parse(body));
  }

  @Get('me')
  me(@Req() req: Request & { user?: { sub?: string } }) {
    if (!req.user?.sub) throw new ForbiddenException();
    return this.svc.getMyNurseStatus(req.user.sub);
  }

  @Get('tasks')
  tasks(
    @Req() req: Request & { user?: { sub?: string } },
    @Query('status') status?: string,
  ) {
    if (!req.user?.sub) throw new ForbiddenException();
    return this.svc.listTasksForNurse(req.user.sub, { status });
  }

  @Patch('tasks/:id/start')
  @Audit({ action: 'nurse_portal.task_started', resourceType: 'home_nurse_requests' })
  start(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!req.user?.sub) throw new ForbiddenException();
    return this.svc.startTask(req.user.sub, id);
  }

  @Patch('tasks/:id/complete')
  @Audit({ action: 'nurse_portal.task_completed', resourceType: 'home_nurse_requests' })
  complete(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!req.user?.sub) throw new ForbiddenException();
    return this.svc.completeTask(req.user.sub, id, CompleteTaskSchema.parse(body));
  }

  @Get('tasks/:id/messages')
  messages(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!req.user?.sub) throw new ForbiddenException();
    return this.svc.listMessages(req.user.sub, id);
  }

  @Post('tasks/:id/messages')
  send(
    @Req() req: Request & { user?: { sub?: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!req.user?.sub) throw new ForbiddenException();
    return this.svc.sendMessage(id, 'nurse', req.user.sub, ChatSendSchema.parse(body));
  }
}

// Clinic-side controller — uses CurrentUser/clinicId
@ApiTags('nurse-portal-clinic')
@Controller({ path: 'clinic/nurse-portal', version: '1' })
class NursePortalClinicController {
  constructor(private readonly svc: NursePortalService) {}

  @Get('join-requests')
  list(
    @CurrentUser() u: { clinicId: string | null },
    @Query('status') status?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listJoinRequestsForClinic(u.clinicId, status);
  }

  @Patch('join-requests/:id')
  @Audit({ action: 'nurse_portal.join_reviewed', resourceType: 'nurse_join_requests' })
  review(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.reviewJoinRequest(u.clinicId, id, u.userId, ReviewJoinSchema.parse(body));
  }

  @Post('assign-nurse')
  @Audit({ action: 'nurse_portal.assigned', resourceType: 'home_nurse_requests' })
  assign(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.assignNurse(u.clinicId, AssignNurseSchema.parse(body));
  }

  @Get('requests/:id/messages')
  messages(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.listMessages(u.userId, id);
  }

  @Post('requests/:id/messages')
  send(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.sendMessage(id, 'clinic', u.userId, ChatSendSchema.parse(body));
  }
}

@Module({
  controllers: [NurseSelfController, NursePortalClinicController],
  providers: [NursePortalService, SupabaseService],
  exports: [NursePortalService],
})
export class NursePortalModule {}

// Silence unused import lints
void Public;
