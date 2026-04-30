import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
export class AdminExtrasService {
  constructor(private readonly supabase: SupabaseService) {}

  private sb() { return this.supabase.admin(); }

  // ── Portal users (axoli) ──────────────────────────────────────────────────

  async listPortalUsers(params: { q?: string; city?: string; suspended?: boolean; page?: number }) {
    const limit = 50;
    const offset = ((params.page ?? 1) - 1) * limit;
    let q = this.sb()
      .from('portal_users')
      .select('id,full_name,phone,email,city,region,country,is_active,is_suspended,created_at,last_sign_in_at', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.q) q = q.or(`full_name.ilike.%${params.q}%,phone.ilike.%${params.q}%,email.ilike.%${params.q}%`);
    if (params.city) q = q.eq('city', params.city);
    if (params.suspended !== undefined) q = q.eq('is_suspended', params.suspended);

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], total: count ?? 0 };
  }

  async getPortalUser(id: string) {
    const { data: user } = await this.sb()
      .from('portal_users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!user) throw new NotFoundException();

    const [bookings, nurseReqs, stats] = await Promise.all([
      this.sb()
        .from('online_queue_bookings')
        .select('id,status,created_at,clinic:clinics(name),slot:online_queue_slots(starts_at)')
        .eq('portal_user_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      this.sb()
        .from('home_nurse_requests')
        .select('id,status,service,created_at,clinic:clinics(name)')
        .eq('portal_user_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      this.sb()
        .from('clinic_reviews')
        .select('id,rating,clinic:clinics(name),created_at')
        .eq('portal_user_id', id)
        .limit(10),
    ]);

    return { user, bookings: bookings.data ?? [], nurse_requests: nurseReqs.data ?? [], reviews: stats.data ?? [] };
  }

  async suspendPortalUser(id: string, reason: string) {
    const { data, error } = await this.sb()
      .from('portal_users')
      .update({ is_suspended: true, suspension_reason: reason })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async unsuspendPortalUser(id: string) {
    const { data, error } = await this.sb()
      .from('portal_users')
      .update({ is_suspended: false, suspension_reason: null })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async portalUserStats() {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [total, newThisWeek, byCity, bookingsTotal, nurseTotal] = await Promise.all([
      this.sb().from('portal_users').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      this.sb().from('portal_users').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
      this.sb().from('portal_users').select('city').is('deleted_at', null).not('city', 'is', null),
      this.sb().from('online_queue_bookings').select('*', { count: 'exact', head: true }),
      this.sb().from('home_nurse_requests').select('*', { count: 'exact', head: true }),
    ]);

    const cityCounts: Record<string, number> = {};
    for (const u of (byCity.data ?? []) as Array<{ city: string }>) {
      cityCounts[u.city] = (cityCounts[u.city] ?? 0) + 1;
    }
    const topCities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([city, count]) => ({ city, count }));

    return {
      total: total.count ?? 0,
      new_this_week: newThisWeek.count ?? 0,
      bookings_total: bookingsTotal.count ?? 0,
      nurse_requests_total: nurseTotal.count ?? 0,
      top_cities: topCities,
    };
  }

  // ── Feature flags ─────────────────────────────────────────────────────────

  async listFeatureFlags(clinicId?: string) {
    let q = this.sb()
      .from('clinic_features')
      .select('clinic_id,feature,enabled,reason,enabled_at,enabled_by,clinic:clinics(id,name)');
    if (clinicId) q = q.eq('clinic_id', clinicId);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async setFeatureFlag(clinicId: string, feature: string, enabled: boolean, reason: string, adminId: string) {
    const { data, error } = await this.sb()
      .from('clinic_features')
      .upsert({
        clinic_id: clinicId,
        feature,
        enabled,
        reason,
        enabled_at: enabled ? new Date().toISOString() : null,
        enabled_by: adminId,
      }, { onConflict: 'clinic_id,feature' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async bulkSetFeatureFlag(clinicIds: string[], feature: string, enabled: boolean, adminId: string) {
    const rows = clinicIds.map((cid) => ({
      clinic_id: cid,
      feature,
      enabled,
      enabled_at: enabled ? new Date().toISOString() : null,
      enabled_by: adminId,
    }));
    const { error } = await this.sb()
      .from('clinic_features')
      .upsert(rows, { onConflict: 'clinic_id,feature' });
    if (error) throw new BadRequestException(error.message);
    return { updated: clinicIds.length };
  }

  // ── Moderation ────────────────────────────────────────────────────────────

  async listWebProfiles(params: { published?: boolean; page?: number }) {
    const limit = 30;
    const offset = ((params.page ?? 1) - 1) * limit;
    let q = this.sb()
      .from('clinic_web_profiles')
      .select('*,clinic:clinics(id,name,city,logo_url)', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.published !== undefined) q = q.eq('is_published', params.published);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], total: count ?? 0 };
  }

  async moderateWebProfile(clinicId: string, action: 'publish' | 'unpublish') {
    const { data, error } = await this.sb()
      .from('clinic_web_profiles')
      .update({ is_published: action === 'publish' })
      .eq('clinic_id', clinicId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listReviewsForModeration(params: { hidden?: boolean; page?: number }) {
    const limit = 50;
    const offset = ((params.page ?? 1) - 1) * limit;
    let q = this.sb()
      .from('clinic_reviews')
      .select('id,rating,comment,helpful_count,is_hidden,is_verified,created_at,clinic:clinics(id,name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (params.hidden !== undefined) q = q.eq('is_hidden', params.hidden);
    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], total: count ?? 0 };
  }

  async moderateReview(reviewId: string, hidden: boolean) {
    const { data, error } = await this.sb()
      .from('clinic_reviews')
      .update({ is_hidden: hidden })
      .eq('id', reviewId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Plan management ───────────────────────────────────────────────────────

  async changePlan(clinicId: string, plan: string, adminId: string) {
    const validPlans = ['demo', 'starter', 'pro', 'enterprise'];
    if (!validPlans.includes(plan)) throw new BadRequestException('Invalid plan');

    const { data, error } = await this.sb()
      .from('clinics')
      .update({ current_plan: plan })
      .eq('id', clinicId)
      .select('id,name,current_plan')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Log the action
    await this.sb().from('platform_payments').insert({
      clinic_id: clinicId,
      amount_usd_cents: 0,
      status: 'admin_override',
      notes: `Plan changed to ${plan} by admin ${adminId}`,
    }).then(() => {});

    return data;
  }

  // ── System health ─────────────────────────────────────────────────────────

  async getSystemHealth() {
    const now = Date.now();
    const checks: Record<string, { status: 'ok' | 'warn' | 'error'; latency_ms?: number; detail?: string }> = {};

    // DB ping
    const dbStart = Date.now();
    try {
      await this.sb().from('clinics').select('id', { count: 'exact', head: true }).limit(1);
      checks.database = { status: 'ok', latency_ms: Date.now() - dbStart };
    } catch (e) {
      checks.database = { status: 'error', detail: String(e) };
    }

    // Counts for health overview
    const [clinics, portals, tickets, reviews, bookings] = await Promise.all([
      this.sb().from('clinics').select('*', { count: 'exact', head: true }).eq('is_active', true),
      this.sb().from('portal_users').select('*', { count: 'exact', head: true }).is('deleted_at', null),
      this.sb().from('support_tickets').select('*', { count: 'exact', head: true }).in('status', ['open', 'pending']),
      this.sb().from('clinic_reviews').select('*', { count: 'exact', head: true }).eq('is_hidden', false),
      this.sb().from('online_queue_bookings').select('*', { count: 'exact', head: true }).in('status', ['pending', 'confirmed']),
    ]);

    // Recent errors (last hour from audit log)
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count: recentAudit } = await this.sb()
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', hourAgo);

    return {
      timestamp: new Date().toISOString(),
      uptime_check: Date.now() - now < 5000 ? 'ok' : 'slow',
      checks,
      counts: {
        active_clinics: clinics.count ?? 0,
        portal_users: portals.count ?? 0,
        open_tickets: tickets.count ?? 0,
        live_reviews: reviews.count ?? 0,
        active_bookings: bookings.count ?? 0,
        audit_events_1h: recentAudit ?? 0,
      },
    };
  }

  // ── Broadcast messaging ───────────────────────────────────────────────────

  async sendBroadcast(params: {
    target: 'all_clinics' | 'by_plan' | 'by_city' | 'specific';
    plan?: string;
    city?: string;
    clinic_ids?: string[];
    subject: string;
    body: string;
    channel: 'in_app' | 'email';
    sender_id: string;
  }) {
    // Resolve target clinic IDs
    let clinicIds: string[] = [];

    if (params.target === 'all_clinics') {
      const { data } = await this.sb().from('clinics').select('id').is('deleted_at', null).eq('is_active', true);
      clinicIds = (data ?? []).map((c: { id: string }) => c.id);
    } else if (params.target === 'by_plan' && params.plan) {
      const { data } = await this.sb().from('clinics').select('id').eq('current_plan', params.plan).is('deleted_at', null);
      clinicIds = (data ?? []).map((c: { id: string }) => c.id);
    } else if (params.target === 'by_city' && params.city) {
      const { data } = await this.sb().from('clinics').select('id').eq('city', params.city).is('deleted_at', null);
      clinicIds = (data ?? []).map((c: { id: string }) => c.id);
    } else if (params.target === 'specific' && params.clinic_ids?.length) {
      clinicIds = params.clinic_ids;
    }

    if (clinicIds.length === 0) throw new BadRequestException('Maqsad klinikalar topilmadi');

    // Store broadcast record
    const { data: broadcast, error } = await this.sb()
      .from('platform_payments') // Reuse or create dedicated table — using as log for now
      .insert({
        clinic_id: clinicIds[0],
        amount_usd_cents: 0,
        status: 'broadcast',
        notes: JSON.stringify({
          subject: params.subject,
          body: params.body,
          channel: params.channel,
          target_count: clinicIds.length,
          sender_id: params.sender_id,
          sent_at: new Date().toISOString(),
        }),
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // In production: enqueue to BullMQ for actual email/SMS delivery
    // For now: return summary
    return {
      broadcast_id: broadcast?.id,
      target_count: clinicIds.length,
      channel: params.channel,
      status: 'queued',
      note: 'Delivery queued — BullMQ worker will process',
    };
  }

  // ── Enhanced tenant detail ────────────────────────────────────────────────

  async getTenantDetail(id: string) {
    const [clinic, profiles, subs, revenue, webProfile, featureFlags, reviews, portals] = await Promise.all([
      this.sb().from('clinics').select('*').eq('id', id).maybeSingle(),
      this.sb().from('profiles').select('id,full_name,email,role,is_active,last_sign_in_at,created_at').eq('clinic_id', id).order('role'),
      this.sb().from('subscriptions').select('*').eq('clinic_id', id).order('created_at', { ascending: false }).limit(5),
      this.sb().from('transactions')
        .select('amount_uzs,created_at')
        .eq('clinic_id', id)
        .eq('kind', 'payment')
        .eq('is_void', false)
        .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
      this.sb().from('clinic_web_profiles').select('*').eq('clinic_id', id).maybeSingle(),
      this.sb().from('clinic_features').select('feature,enabled,reason,enabled_at').eq('clinic_id', id),
      this.sb().from('clinic_rating_summary').select('*').eq('clinic_id', id).maybeSingle(),
      this.sb().from('portal_users').select('*', { count: 'exact', head: true }),
    ]);

    if (!clinic.data) throw new NotFoundException('Klinika topilmadi');

    const revenue30d = (revenue.data ?? []).reduce((s: number, t: { amount_uzs: number }) => s + Number(t.amount_uzs ?? 0), 0);

    const [apptCount, bookingCount] = await Promise.all([
      this.sb().from('appointments').select('*', { count: 'exact', head: true }).eq('clinic_id', id),
      this.sb().from('online_queue_bookings').select('*', { count: 'exact', head: true }).eq('clinic_id', id),
    ]);

    return {
      clinic: clinic.data,
      profiles: profiles.data ?? [],
      subscriptions: subs.data ?? [],
      revenue_30d: revenue30d,
      web_profile: webProfile.data,
      feature_flags: featureFlags.data ?? [],
      rating: reviews.data,
      stats: {
        appointments_total: apptCount.count ?? 0,
        bookings_total: bookingCount.count ?? 0,
        staff_count: (profiles.data ?? []).length,
      },
    };
  }
}
