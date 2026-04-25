import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';

// ---------------------------------------------------------------------------
// Segment filter DSL (whitelisted, server-authoritative)
// ---------------------------------------------------------------------------
export const SegmentFilterSchema = z
  .object({
    gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
    age_min: z.number().int().nonnegative().optional(),
    age_max: z.number().int().nonnegative().optional(),
    referral_sources: z.array(z.string()).optional(),
    lifecycle: z
      .array(z.enum(['new', 'active', 'warming', 'cooling', 'passive']))
      .optional(),
    min_total_spent_uzs: z.number().int().nonnegative().optional(),
    max_total_spent_uzs: z.number().int().nonnegative().optional(),
    min_visits: z.number().int().nonnegative().optional(),
    has_services: z.array(z.string().uuid()).optional(),
    has_inpatient: z.boolean().optional(),
    days_since_activity_min: z.number().int().nonnegative().optional(),
    days_since_activity_max: z.number().int().nonnegative().optional(),
    registered_after: z.string().datetime().optional(),
    registered_before: z.string().datetime().optional(),
    phone_required: z.boolean().optional(),
  })
  .strict();
export type SegmentFilter = z.infer<typeof SegmentFilterSchema>;

const CampaignSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['oneshot', 'drip', 'triggered']).default('oneshot'),
  channel: z.enum(['sms', 'email', 'push', 'multi']).default('sms'),
  target_segment_id: z.string().uuid().optional(),
  filter_query: SegmentFilterSchema.optional(),
  message_body: z.string().min(1).max(1000).optional(),
  scheduled_at: z.string().datetime().optional(),
});

const CreateSegmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  filter_query: SegmentFilterSchema,
  is_dynamic: z.boolean().default(true),
});

const SendCampaignSchema = z.object({
  campaign_id: z.string().uuid(),
  message_body: z.string().min(1).max(1000),
});

const SendSmsAdhocSchema = z.object({
  filter_query: SegmentFilterSchema,
  message_body: z.string().min(1).max(1000),
  dry_run: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
class MarketingService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------- Segments ----------------
  async listSegments(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('marketing_segments')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async createSegment(
    clinicId: string,
    userId: string,
    input: z.infer<typeof CreateSegmentSchema>,
  ) {
    const { count } = await this.queryLtv(clinicId, input.filter_query, {
      countOnly: true,
    });
    const { data, error } = await this.supabase
      .admin()
      .from('marketing_segments')
      .insert({
        clinic_id: clinicId,
        name: input.name,
        description: input.description ?? null,
        filter_query: input.filter_query,
        is_dynamic: input.is_dynamic,
        patient_count_cached: count ?? 0,
        last_calculated_at: new Date().toISOString(),
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async previewSegment(clinicId: string, filter: SegmentFilter, limit = 25) {
    const { count, rows } = await this.queryLtv(clinicId, filter, { limit });
    return { count, sample: rows };
  }

  // ---------------- Campaigns ----------------
  async listCampaigns(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('marketing_campaigns')
      .select('*, segment:marketing_segments(id, name, patient_count_cached)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async createCampaign(
    clinicId: string,
    userId: string,
    input: z.infer<typeof CampaignSchema>,
  ) {
    let segmentId = input.target_segment_id ?? null;
    if (!segmentId && input.filter_query) {
      const segment = await this.createSegment(clinicId, userId, {
        name: `Ad-hoc: ${input.name}`,
        filter_query: input.filter_query,
        is_dynamic: true,
      });
      segmentId = (segment as { id: string }).id;
    }
    const { data, error } = await this.supabase
      .admin()
      .from('marketing_campaigns')
      .insert({
        clinic_id: clinicId,
        name: input.name,
        kind: input.kind,
        channel: input.channel,
        target_segment_id: segmentId,
        scheduled_at: input.scheduled_at ?? null,
        status: 'draft',
        variants: input.message_body ? { default: { body: input.message_body } } : null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async sendCampaign(
    clinicId: string,
    userId: string,
    input: z.infer<typeof SendCampaignSchema>,
  ) {
    const admin = this.supabase.admin();
    const { data: campaign } = await admin
      .from('marketing_campaigns')
      .select('*, segment:marketing_segments(id, filter_query)')
      .eq('clinic_id', clinicId)
      .eq('id', input.campaign_id)
      .single();
    if (!campaign) throw new Error('Campaign not found');
    const seg = (campaign as { segment: { filter_query: unknown } | null }).segment;
    const filter = seg ? (seg.filter_query as SegmentFilter) : {};

    const { rows } = await this.queryLtv(clinicId, filter, { limit: 5000 });
    const enqueued: string[] = [];
    for (const p of rows) {
      if (!p.phone) continue;
      const ik = `campaign:${input.campaign_id}:${p.patient_id}`;
      const res = await this.notifications.enqueue({
        clinicId,
        channel: 'sms',
        recipient: p.phone,
        body: input.message_body,
        patientId: p.patient_id,
        relatedResource: 'marketing_campaigns',
        relatedId: input.campaign_id,
        idempotencyKey: ik,
        metadata: { campaign_id: input.campaign_id, sent_by: userId },
      });
      if (res?.id) {
        enqueued.push(res.id);
        await admin.from('marketing_campaign_sends').insert({
          clinic_id: clinicId,
          campaign_id: input.campaign_id,
          patient_id: p.patient_id,
          channel: 'sms',
          provider: 'outbox',
          provider_message_id: res.id,
          sent_at: new Date().toISOString(),
        });
      }
    }

    await admin
      .from('marketing_campaigns')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        stats: {
          sent: enqueued.length,
          delivered: 0,
          opened: 0,
          clicked: 0,
          converted: 0,
          unsubscribed: 0,
        },
      })
      .eq('clinic_id', clinicId)
      .eq('id', input.campaign_id);

    return { enqueued: enqueued.length, total_candidates: rows.length };
  }

  async sendAdhoc(
    clinicId: string,
    userId: string,
    input: z.infer<typeof SendSmsAdhocSchema>,
  ) {
    const { count, rows } = await this.queryLtv(clinicId, input.filter_query, {
      limit: 5000,
    });
    if (input.dry_run) {
      return { dry_run: true, count, sample: rows.slice(0, 20) };
    }
    const ik = `adhoc:${clinicId}:${Date.now()}`;
    let enqueued = 0;
    for (const p of rows) {
      if (!p.phone) continue;
      const res = await this.notifications.enqueue({
        clinicId,
        channel: 'sms',
        recipient: p.phone,
        body: input.message_body,
        patientId: p.patient_id,
        relatedResource: 'marketing_adhoc',
        idempotencyKey: `${ik}:${p.patient_id}`,
        metadata: { sent_by: userId },
      });
      if (res?.id) enqueued += 1;
    }
    return { dry_run: false, count, enqueued };
  }

  async ltvOverview(clinicId: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('patient_ltv_view')
      .select('lifecycle_stage, total_spent_uzs')
      .eq('clinic_id', clinicId);
    const buckets: Record<string, { count: number; revenue: number }> = {};
    let totalRevenue = 0;
    let totalPatients = 0;
    for (const r of data ?? []) {
      const row = r as { lifecycle_stage: string; total_spent_uzs: number | null };
      const stage = row.lifecycle_stage;
      const spent = Number(row.total_spent_uzs ?? 0);
      buckets[stage] = buckets[stage] ?? { count: 0, revenue: 0 };
      buckets[stage].count += 1;
      buckets[stage].revenue += spent;
      totalRevenue += spent;
      totalPatients += 1;
    }
    return {
      totals: {
        patients: totalPatients,
        revenue_uzs: totalRevenue,
        avg_ltv_uzs: totalPatients > 0 ? Math.round(totalRevenue / totalPatients) : 0,
      },
      lifecycle: buckets,
    };
  }

  // ---------------- Internal ----------------
  private async queryLtv(
    clinicId: string,
    filter: SegmentFilter,
    opts: { limit?: number; countOnly?: boolean } = {},
  ): Promise<{
    count: number;
    rows: Array<{
      patient_id: string;
      full_name: string;
      phone: string | null;
      lifecycle_stage: string;
      total_spent_uzs: number;
      visits_total: number;
      last_activity_at: string | null;
    }>;
  }> {
    const admin = this.supabase.admin();
    let q = admin
      .from('patient_ltv_view')
      .select(
        'patient_id, full_name, phone, gender, dob, referral_source, lifecycle_stage, total_spent_uzs, visits_total, days_since_activity, last_activity_at',
        { count: 'exact' },
      )
      .eq('clinic_id', clinicId);

    if (filter.gender) q = q.eq('gender', filter.gender);
    if (filter.referral_sources?.length)
      q = q.in('referral_source', filter.referral_sources);
    if (filter.lifecycle?.length) q = q.in('lifecycle_stage', filter.lifecycle);
    if (typeof filter.min_total_spent_uzs === 'number')
      q = q.gte('total_spent_uzs', filter.min_total_spent_uzs);
    if (typeof filter.max_total_spent_uzs === 'number')
      q = q.lte('total_spent_uzs', filter.max_total_spent_uzs);
    if (typeof filter.min_visits === 'number') q = q.gte('visits_total', filter.min_visits);
    if (typeof filter.days_since_activity_min === 'number')
      q = q.gte('days_since_activity', filter.days_since_activity_min);
    if (typeof filter.days_since_activity_max === 'number')
      q = q.lte('days_since_activity', filter.days_since_activity_max);
    if (filter.registered_after) q = q.gte('registered_at', filter.registered_after);
    if (filter.registered_before) q = q.lte('registered_at', filter.registered_before);
    if (filter.phone_required) q = q.not('phone', 'is', null);

    if (typeof filter.age_min === 'number')
      q = q.lte('dob', new Date(Date.now() - filter.age_min * 365.25 * 864e5).toISOString());
    if (typeof filter.age_max === 'number')
      q = q.gte('dob', new Date(Date.now() - (filter.age_max + 1) * 365.25 * 864e5).toISOString());

    if (opts.countOnly) {
      const { count } = await q.limit(1);
      return { count: count ?? 0, rows: [] };
    }

    const { data, count } = await q.order('last_activity_at', { ascending: false }).limit(opts.limit ?? 25);

    // Post-filters requiring secondary queries
    let rows = (data ?? []) as Array<{
      patient_id: string;
      full_name: string;
      phone: string | null;
      lifecycle_stage: string;
      total_spent_uzs: number;
      visits_total: number;
      last_activity_at: string | null;
    }>;

    if (filter.has_services?.length) {
      const { data: sv } = await admin
        .from('appointments')
        .select('patient_id')
        .eq('clinic_id', clinicId)
        .in('service_id', filter.has_services);
      const set = new Set((sv ?? []).map((r) => (r as { patient_id: string }).patient_id));
      rows = rows.filter((r) => set.has(r.patient_id));
    }
    if (filter.has_inpatient) {
      const { data: inp } = await admin
        .from('inpatient_stays')
        .select('patient_id')
        .eq('clinic_id', clinicId);
      const set = new Set((inp ?? []).map((r) => (r as { patient_id: string }).patient_id));
      rows = rows.filter((r) => set.has(r.patient_id));
    }

    return { count: count ?? rows.length, rows };
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
@ApiTags('marketing')
@Controller({ path: 'marketing', version: '1' })
class MarketingController {
  constructor(private readonly svc: MarketingService) {}

  @Get('ltv')
  ltv(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.ltvOverview(u.clinicId);
  }

  @Get('segments')
  listSegments(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listSegments(u.clinicId);
  }

  @Post('segments')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'segment.created', resourceType: 'marketing_segments' })
  createSegment(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createSegment(u.clinicId, u.userId, CreateSegmentSchema.parse(body));
  }

  @Post('segments/preview')
  preview(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
    @Query('limit') limit?: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const parsed = z.object({ filter_query: SegmentFilterSchema }).parse(body);
    return this.svc.previewSegment(u.clinicId, parsed.filter_query, Number(limit) || 25);
  }

  @Get('campaigns')
  listCampaigns(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listCampaigns(u.clinicId);
  }

  @Post('campaigns')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'campaign.created', resourceType: 'marketing_campaigns' })
  createCampaign(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.createCampaign(u.clinicId, u.userId, CampaignSchema.parse(body));
  }

  @Post('campaigns/:id/send')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'campaign.sent', resourceType: 'marketing_campaigns' })
  sendCampaign(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    const parsed = z.object({ message_body: z.string().min(1).max(1000) }).parse(body);
    return this.svc.sendCampaign(u.clinicId, u.userId, {
      campaign_id: id,
      message_body: parsed.message_body,
    });
  }

  @Post('sms/bulk')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'marketing.bulk_sms', resourceType: 'marketing_adhoc' })
  sendAdhoc(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.sendAdhoc(u.clinicId, u.userId, SendSmsAdhocSchema.parse(body));
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [MarketingController],
  providers: [MarketingService, SupabaseService],
})
export class MarketingModule {}
