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
    const slot = Array.isArray(booking.slot) ? booking.slot[0] : booking.slot;
    const estimatedWaitMin = position * (slot?.duration_min ?? 30);

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

  // ── Appointment requests (navbat so'rovi — slotsiz) ───────────────────────
  async createAppointmentRequest(
    portalUserId: string,
    input: { clinic_id: string; doctor_id?: string | null; preferred_at?: string; preferred_note?: string; reason?: string },
  ) {
    const admin = this.supabase.admin();

    const { data: pu } = await admin
      .from('portal_users')
      .select('full_name, phone')
      .eq('id', portalUserId)
      .maybeSingle();
    if (!pu?.full_name || !pu?.phone) {
      throw new BadRequestException('Avval profilingizni to\'ldiring (ism va telefon)');
    }

    const { data: clinic } = await admin
      .from('clinics')
      .select('id')
      .eq('id', input.clinic_id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (!clinic) throw new NotFoundException('Klinika topilmadi');

    // Bir klinikada faol (pending/confirmed) so'rov bittadan ortiq bo'lmasin
    const { count: activeCount } = await admin
      .from('appointment_requests')
      .select('*', { count: 'exact', head: true })
      .eq('portal_user_id', portalUserId)
      .eq('clinic_id', input.clinic_id)
      .in('status', ['pending', 'confirmed']);
    if ((activeCount ?? 0) > 0) {
      throw new BadRequestException('Bu klinikada faol navbat so\'rovingiz bor');
    }

    const { data, error } = await admin
      .from('appointment_requests')
      .insert({
        clinic_id: input.clinic_id,
        portal_user_id: portalUserId,
        doctor_id: input.doctor_id ?? null,
        patient_name_snapshot: pu.full_name,
        patient_phone_snapshot: pu.phone,
        preferred_at: input.preferred_at ?? null,
        preferred_note: input.preferred_note ?? null,
        reason: input.reason ?? null,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listMyAppointmentRequests(portalUserId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('appointment_requests')
      .select(`
        id, status, doctor_id, preferred_at, preferred_note, reason, response_note,
        scheduled_at, created_at,
        clinic:clinics(name, slug, logo_url)
      `)
      .eq('portal_user_id', portalUserId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as any[];
    // Shifokor ismlari
    const docIds = [...new Set(rows.map((r) => r.doctor_id).filter(Boolean))];
    const docById = new Map<string, string>();
    if (docIds.length > 0) {
      const { data: docs } = await this.supabase.admin().from('profiles').select('id, full_name').in('id', docIds);
      for (const d of docs ?? []) docById.set(d.id, d.full_name);
    }
    return rows.map((r) => ({ ...r, doctor_name: r.doctor_id ? docById.get(r.doctor_id) ?? null : null }));
  }

  async cancelAppointmentRequest(portalUserId: string, id: string) {
    const admin = this.supabase.admin();
    const { data: reqRow } = await admin
      .from('appointment_requests')
      .select('id, portal_user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!reqRow) throw new NotFoundException();
    if (reqRow.portal_user_id !== portalUserId) throw new ForbiddenException();
    if (!['pending', 'confirmed'].includes(reqRow.status)) {
      throw new BadRequestException('Bu so\'rovni bekor qilib bo\'lmaydi');
    }
    const { data, error } = await admin
      .from('appointment_requests')
      .update({ status: 'canceled', canceled_at: new Date().toISOString(), canceled_by: 'patient', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Appointment requests — KLINIKA tomoni (ko'rish + tasdiqlash/rad) ───────
  async listClinicAppointmentRequests(clinicId: string, status?: string) {
    let q = this.supabase
      .admin()
      .from('appointment_requests')
      .select(
        'id, status, doctor_id, patient_name_snapshot, patient_phone_snapshot, preferred_at, preferred_note, reason, response_note, scheduled_at, created_at',
      )
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as any[];
    const docIds = [...new Set(rows.map((r) => r.doctor_id).filter(Boolean))];
    const docById = new Map<string, string>();
    if (docIds.length > 0) {
      const { data: docs } = await this.supabase
        .admin()
        .from('profiles')
        .select('id, full_name')
        .in('id', docIds);
      for (const d of docs ?? []) docById.set(d.id, d.full_name);
    }
    return rows.map((r) => ({ ...r, doctor_name: r.doctor_id ? docById.get(r.doctor_id) ?? null : null }));
  }

  async respondAppointmentRequest(
    clinicId: string,
    id: string,
    userId: string | null,
    input: { action: 'confirm' | 'reject'; scheduled_at?: string; response_note?: string },
  ) {
    const admin = this.supabase.admin();
    const { data: reqRow } = await admin
      .from('appointment_requests')
      .select('id, clinic_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!reqRow) throw new NotFoundException();
    if (reqRow.clinic_id !== clinicId) throw new ForbiddenException();
    if (reqRow.status !== 'pending') {
      throw new BadRequestException('Bu so\'rov allaqachon ko\'rib chiqilgan');
    }

    const patch: Record<string, unknown> = {
      status: input.action === 'confirm' ? 'confirmed' : 'rejected',
      response_note: input.response_note ?? null,
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (input.action === 'confirm' && input.scheduled_at) patch.scheduled_at = input.scheduled_at;

    const { data, error } = await admin
      .from('appointment_requests')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── M4: Davolanish holati ────────────────────────────────────────────────
  // Bemor telefoni orqali qaysi klinikada ro'yxatda ekani + statsionarda yotgan
  // bo'lsa xona/qavat ma'lumoti. Mobil bosh ekrandagi "davolanyapsiz" kartasi.
  async treatmentStatus(portalUserId: string) {
    const admin = this.supabase.admin();
    const { data: pu } = await admin
      .from('portal_users')
      .select('phone')
      .eq('id', portalUserId)
      .maybeSingle();
    const last9 = (pu?.phone ?? '').replace(/\D/g, '').slice(-9);
    if (last9.length < 9) return { treatments: [] };

    const { data: patients } = await admin
      .from('patients')
      .select('id, clinic_id, full_name')
      .filter('phone', 'not.is', null)
      .ilike('phone', `%${last9}`)
      .is('deleted_at', null);
    const pts = (patients ?? []) as Array<{ id: string; clinic_id: string; full_name: string }>;
    if (pts.length === 0) return { treatments: [] };

    const clinicIds = [...new Set(pts.map((p) => p.clinic_id))];
    const patientIds = pts.map((p) => p.id);
    const [{ data: clinics }, { data: stays }] = await Promise.all([
      admin.from('clinics').select('id, name, logo_url, phone, address').in('id', clinicIds),
      admin
        .from('inpatient_stays')
        .select('id, patient_id, clinic_id, admitted_at, status, room:rooms(number, floor, name_i18n, type)')
        .in('patient_id', patientIds)
        .eq('status', 'admitted'),
    ]);
    const clinicById = new Map(
      ((clinics ?? []) as Array<{ id: string; name: string; logo_url: string | null; phone: string | null; address: string | null }>).map(
        (c) => [c.id, c],
      ),
    );
    type StayRow = {
      id: string;
      patient_id: string;
      clinic_id: string;
      admitted_at: string;
      room:
        | { number: string; floor: number | null; name_i18n: Record<string, string> | null; type: string | null }
        | { number: string; floor: number | null; name_i18n: Record<string, string> | null; type: string | null }[]
        | null;
    };
    const stayByPatient = new Map<string, StayRow>();
    for (const s of ((stays ?? []) as StayRow[])) stayByPatient.set(s.patient_id, s);

    return {
      treatments: pts.map((p) => {
        const clinic = clinicById.get(p.clinic_id);
        const stay = stayByPatient.get(p.id);
        const room = stay ? (Array.isArray(stay.room) ? stay.room[0] ?? null : stay.room) : null;
        return {
          clinic_patient_id: p.id,
          clinic: clinic
            ? { id: clinic.id, name: clinic.name, logo_url: clinic.logo_url, phone: clinic.phone, address: clinic.address }
            : null,
          inpatient: stay
            ? {
                stay_id: stay.id,
                admitted_at: stay.admitted_at,
                room: room
                  ? {
                      number: room.number,
                      floor: room.floor,
                      name: room.name_i18n?.['uz-Latn'] ?? room.name_i18n?.['ru'] ?? null,
                    }
                  : null,
              }
            : null,
        };
      }),
    };
  }

  // M4: statsionar bemor "Hamshira chaqirish" — nurse_tasks'ga pending vazifa
  // (assigned_to NULL → klinikadagi barcha hamshiralarga claimable ko'rinadi,
  // mobil hamshira oqimi va qabulxona kartasi shu jadvalni o'qiydi).
  async inpatientNurseCall(portalUserId: string, stayId: string, note?: string) {
    const admin = this.supabase.admin();
    const { data: pu } = await admin
      .from('portal_users')
      .select('phone, full_name')
      .eq('id', portalUserId)
      .maybeSingle();
    const last9 = (pu?.phone ?? '').replace(/\D/g, '').slice(-9);
    if (last9.length < 9) throw new BadRequestException('Telefon aniqlanmadi');

    // Xavfsizlik: stay haqiqatan shu telefonli bemorga tegishli bo'lishi shart.
    const { data: stay } = await admin
      .from('inpatient_stays')
      .select('id, clinic_id, patient_id, status, room:rooms(number, floor), patient:patients(phone, full_name)')
      .eq('id', stayId)
      .eq('status', 'admitted')
      .maybeSingle();
    if (!stay) throw new NotFoundException('Faol statsionar yozuv topilmadi');
    const st = stay as unknown as {
      id: string;
      clinic_id: string;
      patient_id: string;
      room: { number: string; floor: number | null } | { number: string; floor: number | null }[] | null;
      patient: { phone: string | null; full_name: string } | { phone: string | null; full_name: string }[] | null;
    };
    const patient = Array.isArray(st.patient) ? st.patient[0] ?? null : st.patient;
    const patPhone9 = (patient?.phone ?? '').replace(/\D/g, '').slice(-9);
    if (patPhone9 !== last9) throw new ForbiddenException('Bu yozuv sizga tegishli emas');

    // Anti-spam: oxirgi 2 daqiqada ochiq chaqiruv bo'lsa qaytadan yaratmaymiz.
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from('nurse_tasks')
      .select('id')
      .eq('stay_id', st.id)
      .is('created_by', null)
      .in('status', ['pending', 'in_progress'])
      .gte('created_at', twoMinAgo)
      .limit(1);
    if ((recent ?? []).length > 0) {
      return { ok: true, already: true };
    }

    const room = Array.isArray(st.room) ? st.room[0] ?? null : st.room;
    const roomLabel = room ? `Xona ${room.number}${room.floor != null ? `, ${room.floor}-qavat` : ''}` : 'Xona —';
    const { error } = await admin.from('nurse_tasks').insert({
      clinic_id: st.clinic_id,
      patient_id: st.patient_id,
      stay_id: st.id,
      title: `🔔 Bemor chaqiruvi — ${roomLabel}`,
      notes: note?.trim() || `${patient?.full_name ?? 'Bemor'} hamshira chaqirdi (mobil ilova)`,
      category: 'general',
      priority: 2,
      status: 'pending',
      created_by: null,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true, already: false };
  }

  // ── Medical records (tashxis + analizlar) ─────────────────────────────────
  // Bemor (portal_user) telefoni orqali klinika `patients` yozuvlariga bog'lanadi
  // va shifokor qo'ygan tashxis, retsept, laborator/instrumental natijalarni qaytaradi.
  async getMedicalRecords(portalUserId: string) {
    const admin = this.supabase.admin();

    const { data: pu } = await admin
      .from('portal_users')
      .select('phone')
      .eq('id', portalUserId)
      .maybeSingle();
    if (!pu?.phone) return { patients: [], diagnoses: [], labs: [], diagnostics: [], prescriptions: [] };

    const last9 = pu.phone.replace(/\D/g, '').slice(-9);
    if (last9.length < 9) return { patients: [], diagnoses: [], labs: [], diagnostics: [], prescriptions: [] };

    // Telefon oxirgi 9 raqami bo'yicha mos bemor yozuvlari (turli klinikalarda bo'lishi mumkin)
    const { data: patients } = await admin
      .from('patients')
      .select('id, full_name, clinic_id, dob, gender')
      .filter('phone', 'not.is', null)
      .ilike('phone', `%${last9}`)
      .is('deleted_at', null);

    const pts = (patients ?? []) as Array<{ id: string; full_name: string; clinic_id: string; dob: string | null; gender: string | null }>;
    if (pts.length === 0) return { patients: [], diagnoses: [], labs: [], diagnostics: [], prescriptions: [] };

    const patientIds = pts.map((p) => p.id);
    const clinicIds = [...new Set(pts.map((p) => p.clinic_id))];
    const patientById = new Map(pts.map((p) => [p.id, p]));

    const [{ data: clinics }, { data: notes }, { data: rxs }, { data: labOrders }, { data: diagOrders }] =
      await Promise.all([
        admin.from('clinics').select('id, name, slug, logo_url').in('id', clinicIds),
        admin
          .from('treatment_notes')
          .select('id, patient_id, clinic_id, author_id, diagnosis_code, diagnosis_text, soap_assessment, soap_plan, is_final, signed_at, created_at')
          .in('patient_id', patientIds)
          .order('created_at', { ascending: false }),
        admin
          .from('prescriptions')
          .select('id, patient_id, clinic_id, doctor_id, rx_number, diagnosis_code, diagnosis_text, instructions, status, created_at')
          .in('patient_id', patientIds)
          .order('created_at', { ascending: false }),
        admin
          .from('lab_orders')
          .select('id, patient_id, clinic_id, status, urgency, created_at, completed_at, items:lab_order_items(id, name_snapshot, status, results:lab_results(value, unit, reference_range, flag, is_abnormal, interpretation, reported_at))')
          .in('patient_id', patientIds)
          .order('created_at', { ascending: false }),
        admin
          .from('diagnostic_orders')
          .select('id, patient_id, clinic_id, name_snapshot, status, created_at, results:diagnostic_results(findings, impression, is_final, reported_at)')
          .in('patient_id', patientIds)
          .order('created_at', { ascending: false }),
      ]);

    const clinicById = new Map((clinics ?? []).map((c: any) => [c.id, c]));

    // Shifokor ismlari
    const doctorIds = [
      ...new Set([
        ...(notes ?? []).map((n: any) => n.author_id),
        ...(rxs ?? []).map((r: any) => r.doctor_id),
      ].filter(Boolean)),
    ];
    const doctorById = new Map<string, string>();
    if (doctorIds.length > 0) {
      const { data: docs } = await admin.from('profiles').select('id, full_name').in('id', doctorIds);
      for (const d of docs ?? []) doctorById.set(d.id, d.full_name);
    }

    const clinicInfo = (id: string) => {
      const c = clinicById.get(id);
      return c ? { name: c.name, slug: c.slug, logo_url: c.logo_url } : null;
    };
    const pname = (id: string) => patientById.get(id)?.full_name ?? null;

    // Tashxislar: treatment_notes (asosiy) + retseptdagi tashxis
    const diagnoses = [
      ...(notes ?? [])
        .filter((n: any) => n.diagnosis_text || n.diagnosis_code || n.soap_assessment)
        .map((n: any) => ({
          id: n.id,
          source: 'treatment_note' as const,
          patient_name: pname(n.patient_id),
          clinic: clinicInfo(n.clinic_id),
          doctor_name: doctorById.get(n.author_id) ?? null,
          diagnosis_code: n.diagnosis_code,
          diagnosis_text: n.diagnosis_text,
          assessment: n.soap_assessment,
          plan: n.soap_plan,
          is_final: n.is_final,
          occurred_at: n.signed_at ?? n.created_at,
        })),
      ...(rxs ?? [])
        .filter((r: any) => r.diagnosis_text || r.diagnosis_code)
        .map((r: any) => ({
          id: r.id,
          source: 'prescription' as const,
          patient_name: pname(r.patient_id),
          clinic: clinicInfo(r.clinic_id),
          doctor_name: doctorById.get(r.doctor_id) ?? null,
          diagnosis_code: r.diagnosis_code,
          diagnosis_text: r.diagnosis_text,
          assessment: null,
          plan: r.instructions,
          is_final: r.status === 'signed',
          occurred_at: r.created_at,
        })),
    ].sort((a, b) => (b.occurred_at ?? '').localeCompare(a.occurred_at ?? ''));

    const labs = (labOrders ?? []).map((o: any) => ({
      id: o.id,
      patient_name: pname(o.patient_id),
      clinic: clinicInfo(o.clinic_id),
      status: o.status,
      urgency: o.urgency,
      occurred_at: o.completed_at ?? o.created_at,
      items: (o.items ?? []).map((it: any) => ({
        name: it.name_snapshot,
        status: it.status,
        results: (it.results ?? []).map((rs: any) => ({
          value: rs.value,
          unit: rs.unit,
          reference_range: rs.reference_range,
          flag: rs.flag,
          is_abnormal: rs.is_abnormal,
          interpretation: rs.interpretation,
        })),
      })),
    }));

    const diagnostics = (diagOrders ?? []).map((o: any) => ({
      id: o.id,
      patient_name: pname(o.patient_id),
      clinic: clinicInfo(o.clinic_id),
      name: o.name_snapshot,
      status: o.status,
      occurred_at: o.created_at,
      results: (o.results ?? []).map((rs: any) => ({
        findings: rs.findings,
        impression: rs.impression,
        is_final: rs.is_final,
      })),
    }));

    return {
      patients: pts.map((p) => ({ id: p.id, full_name: p.full_name, clinic: clinicInfo(p.clinic_id) })),
      diagnoses,
      labs,
      diagnostics,
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
    tariff_id?: string;
    service: string;
    requester_name: string;
    requester_phone: string;
    address: string;
    address_notes?: string;
    geo_lat?: number;
    geo_lng?: number;
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
