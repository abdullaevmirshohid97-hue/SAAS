import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
export class PatientPortalService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── Clinics ──────────────────────────────────────────────────────────────

  async searchClinics(params: {
    query?: string;
    city?: string;
    specialty?: string;
    min_rating?: number;
    page?: number;
  }) {
    const limit = 30;
    const offset = ((params.page ?? 1) - 1) * limit;

    let q = this.supabase
      .admin()
      .from('clinics')
      .select(`
        id,slug,name,city,region,address,phone,logo_url,primary_color,organization_type,is_active,
        web_profile:clinic_web_profiles(specialties,tagline,services,is_published),
        rating:clinic_rating_summary(avg_rating,review_count)
      `, { count: 'exact' })
      .eq('is_active', true)
      .is('deleted_at', null)
      .range(offset, offset + limit - 1);

    if (params.query) {
      // Search by clinic name OR service type via web profile
      q = q.or(`name.ilike.%${params.query}%`);
    }
    if (params.city) q = q.eq('city', params.city);

    const { data, count, error } = await q;
    if (error) throw new BadRequestException(error.message);

    let result = (data ?? []) as any[];

    // Filter by specialty (service type)
    if (params.query) {
      result = result.filter((c) => {
        const nameMatch = c.name?.toLowerCase().includes(params.query!.toLowerCase());
        const services = c.web_profile?.services ?? [];
        const serviceMatch = services.some((s: any) =>
          s.name?.toLowerCase().includes(params.query!.toLowerCase()),
        );
        const specialtyMatch = (c.web_profile?.specialties ?? []).some((sp: string) =>
          sp.toLowerCase().includes(params.query!.toLowerCase()),
        );
        return nameMatch || serviceMatch || specialtyMatch;
      });
    }

    if (params.specialty) {
      result = result.filter((c) =>
        (c.web_profile?.specialties ?? []).some((sp: string) =>
          sp.toLowerCase().includes(params.specialty!.toLowerCase()),
        ),
      );
    }

    // Filter by min rating
    if (params.min_rating) {
      result = result.filter((c) => (c.rating?.avg_rating ?? 0) >= params.min_rating!);
    }

    // Sort by rating descending
    result.sort((a, b) => (b.rating?.avg_rating ?? 0) - (a.rating?.avg_rating ?? 0));

    return { data: result, total: count ?? 0 };
  }

  async getNearbyClinics(city: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('clinics')
      .select(`
        id,slug,name,city,address,phone,logo_url,primary_color,organization_type,
        web_profile:clinic_web_profiles(specialties,tagline,is_published),
        rating:clinic_rating_summary(avg_rating,review_count)
      `)
      .eq('is_active', true)
      .eq('city', city)
      .is('deleted_at', null)
      .limit(30);

    if (error) throw new BadRequestException(error.message);

    const result = (data ?? []) as any[];
    result.sort((a, b) => (b.rating?.avg_rating ?? 0) - (a.rating?.avg_rating ?? 0));
    return result;
  }

  async getClinic(slug: string) {
    const { data: clinic, error } = await this.supabase
      .admin()
      .from('clinics')
      .select(`
        id,slug,name,city,region,address,phone,website,logo_url,primary_color,organization_type,is_active,
        web_profile:clinic_web_profiles(
          tagline,description,banner_url,gallery_urls,video_urls,
          services,working_hours,geo_lat,geo_lng,specialties,
          languages,established_year,bed_count,is_published
        ),
        rating:clinic_rating_summary(avg_rating,review_count,stars_5,stars_4,stars_3,stars_2,stars_1)
      `)
      .eq('slug', slug)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!clinic) throw new NotFoundException('Klinika topilmadi');

    const [{ data: doctors }, { data: recentReviews }] = await Promise.all([
      this.supabase
        .admin()
        .from('profiles')
        .select('id,full_name,specialization:specialty,photo_url,experience_years')
        .eq('clinic_id', clinic.id)
        .eq('is_active', true),
      this.supabase
        .admin()
        .from('clinic_reviews')
        .select('id,rating,comment,helpful_count,reply_text,replied_at,created_at,portal_user_id')
        .eq('clinic_id', clinic.id)
        .eq('is_hidden', false)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    // Track profile view (fire-and-forget)
    this.supabase.admin().from('clinic_profile_views')
      .insert({ clinic_id: clinic.id, source: 'web' })
      .then(() => {});

    return { ...clinic, doctors: doctors ?? [], recent_reviews: recentReviews ?? [] };
  }

  async getSlots(slug: string, params: { from: string; to: string; doctor_id?: string }) {
    const { data: clinic } = await this.supabase
      .admin()
      .from('clinics')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (!clinic) throw new NotFoundException('Klinika topilmadi');

    let q = this.supabase
      .admin()
      .from('online_queue_slots')
      .select('id,starts_at,duration_min,capacity,booked_count,doctor_id,price_snapshot_uzs')
      .eq('clinic_id', clinic.id)
      .eq('is_open', true)
      .gte('starts_at', params.from)
      .lt('starts_at', params.to)
      .order('starts_at');

    if (params.doctor_id) q = q.eq('doctor_id', params.doctor_id);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Bookings ─────────────────────────────────────────────────────────────

  async createBooking(portalUserId: string, input: { slot_id: string; reason?: string }) {
    // Get patient snapshot
    const { data: patient } = await this.supabase
      .admin()
      .from('portal_users')
      .select('full_name,phone')
      .eq('id', portalUserId)
      .maybeSingle();

    if (!patient?.full_name || !patient?.phone) {
      throw new BadRequestException('Avval profilingizni to\'ldiring (ism va telefon)');
    }

    // Get slot
    const { data: slot } = await this.supabase
      .admin()
      .from('online_queue_slots')
      .select('id,clinic_id,capacity,booked_count,is_open,starts_at')
      .eq('id', input.slot_id)
      .maybeSingle();

    if (!slot) throw new NotFoundException('Slot topilmadi');
    if (!slot.is_open) throw new BadRequestException('Bu slot yopiq');
    if (slot.booked_count >= slot.capacity) throw new BadRequestException('Slot to\'lgan');
    if (new Date(slot.starts_at) < new Date()) throw new BadRequestException('Bu vaqt o\'tib ketgan');

    const { data: booking, error } = await this.supabase
      .admin()
      .from('online_queue_bookings')
      .insert({
        slot_id: input.slot_id,
        portal_user_id: portalUserId,
        clinic_id: slot.clinic_id,
        patient_name_snapshot: patient.full_name,
        patient_phone_snapshot: patient.phone,
        reason: input.reason,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return booking;
  }

  async listBookings(portalUserId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('online_queue_bookings')
      .select(`
        id, slot_id, clinic_id, status, created_at,
        slot:online_queue_slots(id,starts_at,duration_min,capacity,booked_count),
        clinic:clinics(name,slug,logo_url)
      `)
      .eq('portal_user_id', portalUserId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async cancelBooking(portalUserId: string, bookingId: string) {
    const { data: booking } = await this.supabase
      .admin()
      .from('online_queue_bookings')
      .select('id,portal_user_id,status')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) throw new NotFoundException();
    if (booking.portal_user_id !== portalUserId) throw new ForbiddenException();
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw new BadRequestException('Bu navbatni bekor qilib bo\'lmaydi');
    }

    const { data, error } = await this.supabase
      .admin()
      .from('online_queue_bookings')
      .update({ status: 'canceled', canceled_at: new Date().toISOString(), canceled_by: 'patient' })
      .eq('id', bookingId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Queue status ──────────────────────────────────────────────────────────

  async getQueueStatus(bookingId: string) {
    const { data: booking } = await this.supabase
      .admin()
      .from('online_queue_bookings')
      .select(`
        id, status, slot_id, clinic_id,
        slot:online_queue_slots(id,starts_at,duration_min,capacity,booked_count,price_snapshot_uzs),
        clinic:clinics(name,logo_url)
      `)
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) throw new NotFoundException('Navbat topilmadi');

    // Count bookings ahead (confirmed/checked_in, earlier created_at)
    const { count: queueAhead } = await this.supabase
      .admin()
      .from('online_queue_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('slot_id', booking.slot_id)
      .in('status', ['confirmed', 'checked_in'])
      .lt('created_at', new Date().toISOString());

    const position = (queueAhead ?? 0) + 1;
    const estimatedWaitMin = position * (booking.slot?.duration_min ?? 30);

    return {
      booking_id: booking.id,
      status: booking.status,
      position: ['pending', 'confirmed', 'checked_in'].includes(booking.status) ? position : null,
      queue_ahead: queueAhead ?? 0,
      estimated_wait_min: ['pending', 'confirmed'].includes(booking.status) ? estimatedWaitMin : null,
      slot: booking.slot,
      clinic: booking.clinic,
    };
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  async getReviews(clinicSlug: string, page = 1) {
    const { data: clinic } = await this.supabase.admin()
      .from('clinics').select('id').eq('slug', clinicSlug).maybeSingle();
    if (!clinic) throw new NotFoundException();

    const limit = 20;
    const offset = (page - 1) * limit;
    const { data, count, error } = await this.supabase.admin()
      .from('clinic_reviews')
      .select('id,rating,comment,helpful_count,reply_text,replied_at,is_verified,created_at,portal_user_id', { count: 'exact' })
      .eq('clinic_id', clinic.id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new BadRequestException(error.message);
    return { data: data ?? [], total: count ?? 0 };
  }

  async createReview(portalUserId: string, clinicSlug: string, input: {
    rating: number;
    comment?: string;
    booking_id?: string;
  }) {
    const { data: clinic } = await this.supabase.admin()
      .from('clinics').select('id').eq('slug', clinicSlug).maybeSingle();
    if (!clinic) throw new NotFoundException();

    // Check if user has a completed booking (verified review)
    let isVerified = false;
    if (input.booking_id) {
      const { data: booking } = await this.supabase.admin()
        .from('online_queue_bookings')
        .select('id')
        .eq('id', input.booking_id)
        .eq('portal_user_id', portalUserId)
        .eq('status', 'completed')
        .maybeSingle();
      isVerified = !!booking;
    }

    const { data, error } = await this.supabase.admin()
      .from('clinic_reviews')
      .upsert({
        clinic_id: clinic.id,
        portal_user_id: portalUserId,
        booking_id: input.booking_id ?? null,
        rating: input.rating,
        comment: input.comment,
        is_verified: isVerified,
      }, { onConflict: 'clinic_id,portal_user_id' })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async replyToReview(clinicId: string, staffProfileId: string, reviewId: string, replyText: string) {
    const { data: review } = await this.supabase.admin()
      .from('clinic_reviews').select('id,clinic_id').eq('id', reviewId).maybeSingle();
    if (!review) throw new NotFoundException();
    if (review.clinic_id !== clinicId) throw new ForbiddenException();

    const { data, error } = await this.supabase.admin()
      .from('clinic_reviews')
      .update({ reply_text: replyText, replied_at: new Date().toISOString(), replied_by: staffProfileId })
      .eq('id', reviewId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async toggleHelpful(portalUserId: string, reviewId: string) {
    const { data: existing } = await this.supabase.admin()
      .from('clinic_review_helpful')
      .select('review_id')
      .eq('review_id', reviewId)
      .eq('portal_user_id', portalUserId)
      .maybeSingle();

    if (existing) {
      await this.supabase.admin()
        .from('clinic_review_helpful')
        .delete()
        .eq('review_id', reviewId)
        .eq('portal_user_id', portalUserId);
      return { helpful: false };
    } else {
      await this.supabase.admin()
        .from('clinic_review_helpful')
        .insert({ review_id: reviewId, portal_user_id: portalUserId });
      return { helpful: true };
    }
  }

  async getClinicReviewsDashboard(clinicId: string) {
    const { data, error } = await this.supabase.admin()
      .from('clinic_reviews')
      .select('id,rating,comment,helpful_count,reply_text,replied_at,is_verified,created_at,portal_user_id')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Web profile (clinic CRM) ───────────────────────────────────────────────

  async getWebProfile(clinicId: string) {
    const { data, error } = await this.supabase.admin()
      .from('clinic_web_profiles')
      .select('*')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertWebProfile(clinicId: string, input: Record<string, unknown>) {
    const { data, error } = await this.supabase.admin()
      .from('clinic_web_profiles')
      .upsert({ clinic_id: clinicId, ...input }, { onConflict: 'clinic_id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getProfileAnalytics(clinicId: string) {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ count: viewsWeek }, { count: viewsMonth }, { data: rating }] = await Promise.all([
      this.supabase.admin().from('clinic_profile_views')
        .select('*', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).gte('viewed_at', weekAgo),
      this.supabase.admin().from('clinic_profile_views')
        .select('*', { count: 'exact', head: true })
        .eq('clinic_id', clinicId).gte('viewed_at', monthAgo),
      this.supabase.admin().from('clinic_rating_summary')
        .select('avg_rating,review_count').eq('clinic_id', clinicId).maybeSingle(),
    ]);

    return {
      views_week: viewsWeek ?? 0,
      views_month: viewsMonth ?? 0,
      avg_rating: rating?.avg_rating ?? null,
      review_count: rating?.review_count ?? 0,
    };
  }

  // ── Home nurse ────────────────────────────────────────────────────────────

  async getNurseTariffs(params?: { city?: string; service?: string }) {
    let q = this.supabase
      .admin()
      .from('home_nurse_tariffs')
      .select(`
        id, clinic_id, service, name_i18n, base_uzs, per_km_uzs, urgent_bonus_uzs,
        clinic:clinics(name,slug,logo_url,city)
      `)
      .eq('is_active', true);

    if (params?.service) q = q.eq('service', params.service);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    let result = data ?? [];
    if (params?.city) {
      result = result.filter((t: any) => t.clinic?.city === params.city);
    }
    return result;
  }

  async createNurseRequest(portalUserId: string, input: {
    clinic_id: string;
    tariff_id: string;
    service: string;
    requester_name: string;
    requester_phone: string;
    address: string;
    address_notes?: string;
    preferred_at?: string;
    is_urgent?: boolean;
    notes?: string;
  }) {
    const { data, error } = await this.supabase
      .admin()
      .from('home_nurse_requests')
      .insert({ portal_user_id: portalUserId, ...input })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listMyNurseRequests(portalUserId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('home_nurse_requests')
      .select('*')
      .eq('portal_user_id', portalUserId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
