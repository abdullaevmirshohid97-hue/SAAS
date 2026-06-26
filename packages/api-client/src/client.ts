export interface ClaryApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  locale?: string;
}

export interface ClaryApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

export interface InpatientDebtor {
  stay_id: string;
  patient_id: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  room_label: string | null;
  doctor_name: string | null;
  admitted_at: string;
  discharged_at: string | null;
  days: number;
  debt_uzs: number;
  debt_reason: string | null;
  discharge_reason: string | null;
  attendant: { name: string; phone: string | null; age: number | null; gender: string | null } | null;
}

// --- Dental (stomatologiya) ---
export interface DentalToothRow {
  id: string;
  fdi_number: number;
  surfaces: Record<string, string>;
  status: string;
  color_hex: string | null;
  last_intervention_at: string | null;
  notes: string | null;
  updated_at: string;
}
export interface DentalChartResponse {
  chart: {
    id: string;
    clinic_id: string;
    patient_id: string;
    doctor_id: string | null;
    notes: string | null;
    is_adult: boolean;
    version: number;
    updated_at: string;
  };
  teeth: DentalToothRow[];
}
export interface DentalPlanItem {
  id: string;
  fdi_number: number | null;
  surfaces: Record<string, string> | null;
  service_id: string | null;
  service_name_snapshot: string;
  price_uzs: number;
  quantity: number;
  status: string;
  scheduled_at: string | null;
  done_at: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
}
export interface DentalPlan {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  title: string;
  status: string;
  total_uzs: number;
  paid_uzs: number;
  notes: string | null;
  approved_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  doctor: { id: string; full_name: string } | null;
  items: DentalPlanItem[];
}
export interface DentalFile {
  id: string;
  patient_id: string;
  plan_id: string | null;
  fdi_number: number | null;
  kind: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  taken_at: string | null;
  notes: string | null;
  created_at: string;
  signed_url: string | null;
}
export interface DentalLabOrder {
  id: string;
  patient_id: string;
  plan_id: string | null;
  item_id: string | null;
  doctor_id: string | null;
  lab_name: string;
  order_type: string;
  tooth_numbers: number[];
  shade: string | null;
  material: string | null;
  price_uzs: number;
  status: string;
  ordered_at: string;
  due_at: string | null;
  received_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  created_at: string;
  doctor: { id: string; full_name: string } | null;
  patient: { id: string; full_name: string } | null;
}
export interface DentalReport {
  summary: {
    plans_count: number;
    plans_total_uzs: number;
    plans_paid_uzs: number;
    plans_outstanding_uzs: number;
    items_count: number;
    lab_count: number;
    lab_total_uzs: number;
  };
  by_service: Array<{ service: string; count: number; revenue_uzs: number }>;
  by_doctor: Array<{ doctor_id: string | null; doctor_name: string; plans: number; total_uzs: number; paid_uzs: number }>;
  plan_status: Array<{ status: string; count: number }>;
  lab_status: Array<{ status: string; count: number; total_uzs: number }>;
}

export class ClaryApiClient {
  constructor(private readonly opts: ClaryApiClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const url = this.opts.baseUrl + path;
    const token = this.opts.getAccessToken ? await this.opts.getAccessToken() : null;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': this.opts.locale ?? 'uz-Latn',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({ error: { code: 'HTTP_ERROR', message: res.statusText } }))) as { error?: { code: string; message: string; details?: unknown } };
      // Zod validation errors: details bor bo'lsa, fieldlarni messageda ko'rsatamiz
      let message = json.error?.message ?? res.statusText;
      const details = json.error?.details;
      if (details && typeof details === 'object' && 'fieldErrors' in details) {
        const fieldErrors = (details as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {};
        const fieldMsgs = Object.entries(fieldErrors)
          .map(([f, msgs]) => `${f}: ${(msgs ?? []).join(', ')}`)
          .filter((s) => s.length > 0);
        if (fieldMsgs.length > 0) {
          message = `${message} (${fieldMsgs.join('; ')})`;
        }
      }
      const err = new Error(message) as ClaryApiError;
      err.status = res.status;
      err.code = json.error?.code ?? 'HTTP_ERROR';
      err.details = details;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  get<T>(path: string, extraHeaders?: Record<string, string>) { return this.request<T>('GET', path, undefined, extraHeaders); }
  post<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) { return this.request<T>('POST', path, body, extraHeaders); }
  patch<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) { return this.request<T>('PATCH', path, body, extraHeaders); }
  put<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) { return this.request<T>('PUT', path, body, extraHeaders); }
  delete<T>(path: string, bodyOrHeaders?: unknown, extraHeaders?: Record<string, string>) {
    // Backwards-compatible: ikkinchi argument plain object (header'ga o'xshash) bo'lsa
    // header sifatida, aks holda body sifatida ishlatamiz.
    const looksLikeHeaders =
      bodyOrHeaders != null &&
      typeof bodyOrHeaders === 'object' &&
      !Array.isArray(bodyOrHeaders) &&
      Object.values(bodyOrHeaders as Record<string, unknown>).every((v) => typeof v === 'string');
    if (looksLikeHeaders && extraHeaders === undefined) {
      return this.request<T>('DELETE', path, undefined, bodyOrHeaders as Record<string, string>);
    }
    return this.request<T>('DELETE', path, bodyOrHeaders, extraHeaders);
  }

  // Typed endpoint helpers
  patients = {
    list: (params?: { page?: number; pageSize?: number; q?: string }) =>
      this.get<{ items: unknown[]; total: number }>(`/api/v1/patients?${new URLSearchParams(params as Record<string, string>).toString()}`),
    get: (id: string) => this.get<unknown>(`/api/v1/patients/${id}`),
    create: (body: unknown) => this.post<unknown>('/api/v1/patients', body),
    update: (id: string, body: unknown) => this.patch<unknown>(`/api/v1/patients/${id}`, body),
    archive: (id: string) => this.delete<unknown>(`/api/v1/patients/${id}`),
    getLogin: (id: string) =>
      this.get<{ id: string; patient_id: string; username: string; is_active: boolean; last_login_at: string | null; created_at: string } | null>(
        `/api/v1/patients/${id}/login`,
      ),
    createLogin: (id: string, body: { username: string; password: string }) =>
      this.post<{ id: string; username: string; is_active: boolean }>(`/api/v1/patients/${id}/login`, body),
    resetLoginPassword: (id: string, password: string) =>
      this.patch<{ id: string }>(`/api/v1/patients/${id}/login/password`, { password }),
    deleteLogin: (id: string) => this.delete<{ ok: boolean }>(`/api/v1/patients/${id}/login`),
    timeline: (id: string) =>
      this.get<{
        patient: {
          id: string;
          full_name: string;
          phone: string | null;
          gender: string | null;
          dob: string | null;
          address: string | null;
        } | null;
        summary: {
          total_spent_uzs: number;
          visits: number;
          prescriptions: number;
          lab_orders: number;
          stays: number;
        };
        events: Array<{
          id: string;
          type:
            | 'visit' | 'note' | 'lab' | 'diagnostic' | 'prescription'
            | 'pharmacy' | 'payment' | 'inpatient' | 'vital' | 'referral' | 'file';
          date: string;
          title: string;
          subtitle?: string | null;
          status?: string;
          ref_id: string;
          module: string;
          abnormal?: boolean;
          amount_uzs?: number;
          icd?: { code: string; name: string };
          attachments?: Array<{ name: string; url: string }>;
          details?: Record<string, unknown>;
        }>;
        appointments: Array<Record<string, unknown>>;
        transactions: Array<Record<string, unknown>>;
        prescriptions: Array<Record<string, unknown>>;
        referrals: Array<Record<string, unknown>>;
        lab_orders: Array<Record<string, unknown>>;
        inpatient_stays: Array<Record<string, unknown>>;
        pharmacy_sales: Array<Record<string, unknown>>;
        clinical_notes: Array<Record<string, unknown>>;
        diagnostics: Array<Record<string, unknown>>;
        vital_signs: Array<Record<string, unknown>>;
        patient_files: Array<Record<string, unknown>>;
      }>(`/api/v1/patients/${id}/timeline`),
  };

  appointments = {
    list: (params?: { from?: string; to?: string; doctor?: string }) =>
      this.get<unknown[]>(`/api/v1/appointments?${new URLSearchParams(params as Record<string, string>).toString()}`),
    create: (body: unknown) => this.post<unknown>('/api/v1/appointments', body),
    remove: (id: string) =>
      this.delete<{ ok: boolean; appointment_id: string }>(`/api/v1/appointments/${id}`),
  };

  queues = {
    list: (params?: { status?: string; doctor_id?: string; date?: string }) =>
      this.get<unknown[]>(`/api/v1/queues?${new URLSearchParams(params as Record<string, string>).toString()}`),
    count: () => this.get<{ count: number }>('/api/v1/queues/count'),
    kanban: (date?: string) =>
      this.get<{
        date: string;
        by_status: Record<string, unknown[]>;
        by_doctor: Array<{ doctor_id: string | null; doctor: { id: string; full_name: string } | null; rows: unknown[] }>;
      }>(`/api/v1/queues/kanban${date ? `?date=${date}` : ''}`),
    enqueue: (body: {
      patient_id: string;
      doctor_id?: string | null;
      service_id?: string | null;
      priority?: number;
      appointment_id?: string | null;
      referral_id?: string | null;
      source?: 'reception' | 'referral' | 'kiosk' | 'online';
      ticket_color?: string;
      notes?: string;
    }) => this.post<unknown>('/api/v1/queues', body),
    callNext: (doctor_id?: string) => this.post<unknown>('/api/v1/queues/call-next', { doctor_id }),
    call: (id: string) => this.patch<unknown>(`/api/v1/queues/${id}/call`),
    accept: (id: string) => this.patch<unknown>(`/api/v1/queues/${id}/accept`),
    complete: (id: string) => this.patch<unknown>(`/api/v1/queues/${id}/complete`),
    skip: (id: string, reason?: string) => this.patch<unknown>(`/api/v1/queues/${id}/skip`, { reason }),
  };

  referrals = {
    list: (params?: {
      status?: string;
      kind?: string;
      patient_id?: string;
      doctor_id?: string;
      specialty?: string;
      target_doctor_id?: string;
    }) =>
      this.get<unknown[]>(`/api/v1/referrals?${new URLSearchParams(params as Record<string, string>).toString()}`),
    create: (body: {
      patient_id: string;
      referral_kind: 'diagnostic' | 'lab' | 'service' | 'inpatient' | 'other';
      target_service_id?: string;
      target_diagnostic_type_id?: string;
      target_lab_test_id?: string;
      target_room_id?: string;
      target_specialty?: string;
      target_doctor_id?: string;
      urgency?: 'routine' | 'urgent' | 'stat';
      clinical_indication?: string;
      notes?: string;
      appointment_id?: string;
      stay_id?: string;
    }) => this.post<unknown>('/api/v1/referrals', body),
    receive: (id: string) => this.patch<unknown>(`/api/v1/referrals/${id}/receive`),
    complete: (id: string) => this.patch<unknown>(`/api/v1/referrals/${id}/complete`),
    cancel: (id: string, reason?: string) => this.patch<unknown>(`/api/v1/referrals/${id}/cancel`, { reason }),
  };

  prescriptions = {
    list: (params?: { status?: string; patient_id?: string; doctor_id?: string }) =>
      this.get<unknown[]>(`/api/v1/prescriptions?${new URLSearchParams(params as Record<string, string>).toString()}`),
    get: (id: string) => this.get<unknown>(`/api/v1/prescriptions/${id}`),
    create: (body: {
      patient_id: string;
      appointment_id?: string;
      stay_id?: string;
      diagnosis_code?: string;
      diagnosis_text?: string;
      instructions?: string;
      valid_until?: string;
      sign?: boolean;
      dispense_at_pharmacy?: boolean;
      items: Array<{
        medication_id?: string;
        medication_name_snapshot: string;
        dosage?: string;
        route?: string;
        frequency?: string;
        duration?: string;
        quantity: number;
        unit_price_snapshot?: number;
        notes?: string;
        schedule_times?: Array<{ time: string; label?: string }>;
        days_count?: number;
        assigned_nurse_id?: string;
      }>;
    }) => this.post<unknown>('/api/v1/prescriptions', body),
    sign: (id: string) => this.patch<unknown>(`/api/v1/prescriptions/${id}/sign`),
    cancel: (id: string) => this.patch<unknown>(`/api/v1/prescriptions/${id}/cancel`),
  };

  catalog = {
    list: (entity: string, params?: { page?: number; pageSize?: number; q?: string }) => {
      const filtered = Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
      ) as Record<string, string>;
      const qs = new URLSearchParams(filtered).toString();
      return this.get<{ items: unknown[]; total: number }>(`/api/v1/catalog/${entity}${qs ? `?${qs}` : ''}`);
    },
    create: (entity: string, body: unknown) => this.post<unknown>(`/api/v1/catalog/${entity}`, body),
    update: (entity: string, id: string, body: unknown, version?: number) =>
      this.patch<unknown>(`/api/v1/catalog/${entity}/${id}${version ? `?version=${version}` : ''}`, body),
    archive: (entity: string, id: string, reason?: string) =>
      this.delete<unknown>(`/api/v1/catalog/${entity}/${id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`),
    restore: (entity: string, id: string) => this.post<unknown>(`/api/v1/catalog/${entity}/${id}/restore`),
    history: (entity: string, id: string) => this.get<unknown[]>(`/api/v1/catalog/${entity}/${id}/history`),
  };

  inpatient = {
    list: (params?: { status?: string }) =>
      this.get<unknown[]>(`/api/v1/inpatient?${new URLSearchParams(params as Record<string, string>).toString()}`),
    // Statsionar yozuvni SAVATCHAga arxivlab o'chirish (sabab majburiy).
    deleteStay: (id: string, reason: string) =>
      this.delete<{ ok: boolean; kind: string; source_id: string }>(
        `/api/v1/inpatient/stays/${id}`,
        { reason },
        {},
      ),
    dashboard: () =>
      this.get<{
        active_stays: number;
        total_rooms: number;
        occupied_rooms: number;
        today_admissions: number;
        today_discharges: number;
        total_outstanding_uzs: number;
      }>('/api/v1/inpatient/dashboard'),
    getStay: (id: string) =>
      this.get<{
        stay: {
          id: string;
          patient_id: string;
          room_id: string | null;
          bed_no: string | null;
          admitted_at: string;
          discharged_at: string | null;
          status: string;
          planned_discharge_at: string | null;
          admission_reason: string | null;
          discharge_summary: string | null;
          discharge_reason: string | null;
          attending_notes: string | null;
          with_meal: boolean;
          meal_daily_uzs: number | null;
          is_half_day: boolean;
          daily_extras_uzs: number | null;
          attendant_daily_uzs: number | null;
          attendant_name: string | null;
          attendant_phone: string | null;
          attendant_age: number | null;
          attendant_gender: string | null;
          total_cost_uzs: number | null;
          patient: { id: string; full_name: string; phone: string | null; dob: string | null; gender: string | null; address: string | null } | null;
          room: { id: string; number: string; section: string | null; floor: number | null; building: string | null; daily_price_uzs: number | null; half_day_price_uzs: number | null; meal_daily_uzs: number | null; capacity: number; type: string | null; tier: string | null } | null;
          doctor: { id: string; full_name: string; phone: string | null } | null;
        };
        ledger: Array<{
          id: string;
          entry_kind: 'deposit' | 'charge' | 'refund' | 'adjustment';
          amount_uzs: number;
          description: string | null;
          created_at: string;
          balance_after_uzs: number | null;
        }>;
        balance: number;
        meal_periods: Array<{
          id: string;
          from_date: string;
          to_date: string | null;
          daily_uzs: number;
          created_at: string;
        }>;
        assignments: Array<{
          id: string;
          profile_id: string;
          role: string;
          assigned_at: string;
          profile: { id: string; full_name: string } | null;
        }>;
        care_items: Array<{
          id: string;
          item_type: string;
          name: string;
          scheduled_at: string;
          status: string;
          performed_at: string | null;
          notes: string | null;
        }>;
        vitals: Array<{
          id: string;
          measured_at: string;
          temperature_c: number | null;
          systolic_mmhg: number | null;
          diastolic_mmhg: number | null;
          pulse_bpm: number | null;
          respiration_rpm: number | null;
          spo2_pct: number | null;
          weight_kg: number | null;
          height_cm: number | null;
          notes: string | null;
        }>;
        services: Array<{
          transaction_id: string;
          occurred_at: string;
          paid_uzs: number;
          payment_method: string | null;
          doctor_name: string | null;
          total_uzs: number;
          items: Array<{ name: string; quantity: number; amount_uzs: number }>;
        }>;
        days: number;
        totals: {
          days: number;
          room_daily_uzs: number;
          meal_daily_uzs: number;
          attendant_daily_uzs: number;
          total_room_uzs: number;
          total_meal_uzs: number;
          total_attendant_uzs: number;
          attendant_name: string | null;
          attendant_phone: string | null;
          total_services_uzs: number;
          total_charged_uzs: number;
          total_deposited_uzs: number;
          balance_uzs: number;
          outstanding_uzs: number;
          deposit_uzs: number;
        };
      }>(`/api/v1/inpatient/stays/${id}`),
    // Bemorning faol statsionar stay'i — jurnal oynasida amallar uchun (null = statsionarda emas)
    activeStay: (patientId: string) =>
      this.get<{
        id: string;
        patient_id: string;
        full_name: string;
        room_label: string | null;
        balance: number;
        with_meal: boolean;
        attendant_daily_uzs: number;
        attendant_name: string | null;
      } | null>(`/api/v1/inpatient/active-stay?patient_id=${patientId}`),
    roomMap: () => {
      type RoomItem = {
        id: string;
        number: string;
        floor: number | null;
        section: string | null;
        building: string | null;
        capacity: number;
        daily_price_uzs: number | null;
        half_day_price_uzs: number | null;
        meal_daily_uzs: number | null;
        status: string;
        type: string | null;
        tier: 'lyuks' | 'standart' | 'comfort' | 'depozit' | null;
        includes_meals: boolean;
        notes: string | null;
        occupants: Array<{
          id: string;
          bed_no: string | null;
          patient: { id: string; full_name: string } | null;
          admitted_at: string;
        }>;
        occupied: number;
        vacancy: number;
      };
      return this.get<{
        buildings: Array<{
          building: string;
          floors: Array<{ floor: number; rooms: RoomItem[] }>;
        }>;
        floors: Array<{ floor: number; rooms: RoomItem[] }>;
      }>('/api/v1/inpatient/room-map');
    },
    admit: (body: {
      patient_id: string;
      room_id?: string;
      bed_no?: string;
      tariff_id?: string;
      attending_doctor_id?: string;
      admission_reason?: string;
      meal_plan?: string;
      with_meal?: boolean;
      meal_daily_uzs_override?: number;
      is_half_day?: boolean;
      admitted_at?: string;
      planned_discharge_at?: string;
      referral_id?: string;
      initial_deposit_uzs?: number;
      attendant_daily_uzs?: number;
      attendant_name?: string;
      attendant_phone?: string;
      attendant_age?: number;
      attendant_gender?: 'male' | 'female' | 'other';
    }) => this.post<unknown>('/api/v1/inpatient/admit', body),
    transfer: (
      id: string,
      body: { room_id: string; bed_no?: string; reason?: string; attending_doctor_id?: string | null },
    ) => this.patch<unknown>(`/api/v1/inpatient/${id}/transfer`, body),
    changeDoctor: (id: string, body: { attending_doctor_id: string | null; reason?: string }) =>
      this.patch<unknown>(`/api/v1/inpatient/${id}/doctor`, body),
    listMealPeriods: (stayId: string) =>
      this.get<
        Array<{
          id: string;
          stay_id: string;
          from_date: string;
          to_date: string | null;
          daily_uzs: number;
          created_at: string;
        }>
      >(`/api/v1/inpatient/${stayId}/meal-periods`),
    addMealPeriod: (body: {
      stay_id: string;
      from_date: string;
      to_date?: string;
      daily_uzs: number;
    }) => this.post<unknown>('/api/v1/inpatient/meal-periods', body),
    endMealPeriod: (id: string, body: { to_date: string }) =>
      this.patch<unknown>(`/api/v1/inpatient/meal-periods/${id}/end`, body),
    discharge: (
      id: string,
      body: {
        summary?: string;
        discharge_reason:
          | 'recovery'
          | 'treatment_refused'
          | 'negative_review'
          | 'admin'
          | 'transferred'
          | 'deceased'
          | 'other';
        discharge_payment_method?: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard';
        paid_amount_uzs?: number;
        force?: boolean;
        deceased_writeoff?: boolean;
        refund_deposit?: boolean;
        debt_reason?: string;
      },
    ) => this.patch<unknown>(`/api/v1/inpatient/${id}/discharge`, body),
    debtors: () =>
      this.get<{
        active: InpatientDebtor[];
        discharged: InpatientDebtor[];
        totals: { active_debt: number; discharged_debt: number };
      }>('/api/v1/inpatient/debtors'),
    balance: (stayId: string) =>
      this.get<{
        balance_uzs: number;
        outstanding_uzs: number;
        deposit_uzs: number;
        daily_extras_uzs: number;
      }>(`/api/v1/inpatient/${stayId}/balance`),
    updateExtras: (
      stayId: string,
      body: {
        daily_extras_uzs?: number;
        attendant_daily_uzs?: number;
        attendant_name?: string | null;
        attendant_phone?: string | null;
        attendant_age?: number | null;
        attendant_gender?: 'male' | 'female' | 'other' | null;
        admitted_at?: string;
      },
    ) => this.patch<unknown>(`/api/v1/inpatient/${stayId}/extras`, body),
    listIncludedServices: (roomId: string) =>
      this.get<
        Array<{
          id: string;
          room_id: string;
          service_id: string;
          frequency_per_week: number;
          notes: string | null;
          service?: { id: string; name_i18n: Record<string, string>; price_uzs: number } | null;
        }>
      >(`/api/v1/inpatient/rooms/${roomId}/included-services`),
    upsertIncludedService: (body: {
      room_id: string;
      service_id: string;
      frequency_per_week?: number;
      notes?: string;
    }) => this.post<{ id: string }>('/api/v1/inpatient/rooms/included-services', body),
    deleteIncludedService: (id: string) =>
      this.patch<{ ok: true }>(`/api/v1/inpatient/rooms/included-services/${id}/delete`, {}),
    vitals: (patientId: string, body: Record<string, unknown>) =>
      this.post<unknown>(`/api/v1/inpatient/patients/${patientId}/vitals`, body),
    careItems: (stayId: string) =>
      this.get<unknown[]>(`/api/v1/inpatient/${stayId}/care-items`),
    createCareItem: (body: {
      stay_id: string;
      kind: 'medication' | 'injection' | 'procedure' | 'examination' | 'observation' | 'note';
      title: string;
      medication_id?: string;
      dosage?: string;
      quantity?: number;
      route?: string;
      scheduled_at: string;
      assigned_to?: string;
      notes?: string;
    }) => this.post<unknown>('/api/v1/inpatient/care-items', body),
    performCareItem: (id: string, notes?: string) =>
      this.patch<unknown>(`/api/v1/inpatient/care-items/${id}/perform`, { notes }),
    skipCareItem: (id: string, reason?: string) =>
      this.patch<unknown>(`/api/v1/inpatient/care-items/${id}/skip`, { reason }),
    ledger: (patientId: string) =>
      this.get<{ entries: unknown[]; balance: number }>(`/api/v1/inpatient/patients/${patientId}/ledger`),
    addLedger: (body: {
      patient_id: string;
      stay_id?: string;
      entry_kind: 'deposit' | 'charge' | 'refund' | 'adjustment';
      amount_uzs: number;
      description?: string;
      payment_method?: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard';
      // Aralash (split) deposit/refund — har usul uchun alohida tranzaksiya.
      payments?: Array<{ method: string; amount_uzs: number }>;
    }) => this.post<unknown>('/api/v1/inpatient/ledger', body),
    // Statsionar bemorga qo'shimcha xizmat qo'shish (alohida shifokor + komissiya)
    addService: (body: {
      stay_id: string;
      patient_id: string;
      items: Array<{
        service_id: string;
        quantity?: number;
        unit_price_uzs?: number;
        discount_uzs?: number;
      }>;
      doctor_id?: string;
      settle?: 'pay' | 'balance';
      payment_method?: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard' | 'debt';
      // Aralash (split) to'lov — settle='pay' uchun.
      payments?: Array<{ method: string; amount_uzs: number }>;
    }) =>
      this.post<{ ok: boolean; transaction_id: string; total_uzs: number; settle: string }>(
        '/api/v1/inpatient/services',
        body,
      ),
    listAssignments: (stayId: string) =>
      this.get<Array<{ id: string; profile_id: string; role: string; assigned_at: string; profile: { id: string; full_name: string; role: string } | null }>>(
        `/api/v1/inpatient/${stayId}/assignments`,
      ),
    addAssignment: (stayId: string, body: { profile_id: string; role: 'doctor' | 'nurse' }) =>
      this.post<unknown>(`/api/v1/inpatient/${stayId}/assignments`, body),
    removeAssignment: (stayId: string, profileId: string) =>
      this.post<unknown>(`/api/v1/inpatient/${stayId}/assignments/${profileId}/remove`, {}),
    schedule: (date?: string) =>
      this.get<unknown[]>(`/api/v1/inpatient/schedule${date ? `?date=${date}` : ''}`),
  };

  subscription = {
    current: () => this.get<unknown>('/api/v1/subscription/current'),
    plans: () =>
      this.get<
        Array<{
          code: string;
          name: string;
          price_usd_cents: number;
          price_yearly_cents: number | null;
          price_uzs: number | null;
          price_yearly_uzs: number | null;
          max_staff: number | null;
          max_devices: number | null;
          max_patients: number | null;
          features: Record<string, boolean>;
        }>
      >('/api/v1/subscription/plans'),
    usage: () =>
      this.get<{
        staff_used: number;
        staff_limit: number | null;
        devices_used: number;
        devices_limit: number | null;
      }>('/api/v1/subscription/usage'),
    recommendation: () =>
      this.get<{
        recommended_code: string;
        staff_count: number;
        device_count: number;
        reason: string;
      }>('/api/v1/subscription/recommendation'),
    startTrial: (planCode: '25pro' | '50pro' | '120pro') =>
      this.post<{ status: string; trial_ends_at: string }>(
        '/api/v1/subscription/start-trial',
        { plan_code: planCode },
      ),
  };

  audit = {
    activity: (params?: {
      from?: string;
      to?: string;
      actor?: string;
      action?: string;
      resource_type?: string;
      resource_id?: string;
      patient_id?: string;
      limit?: number;
    }) =>
      this.get<Array<{
        id: string;
        action: string;
        resource_type: string | null;
        resource_id: string | null;
        summary_i18n: Record<string, string> | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
        actor: { full_name: string; role: string } | null;
      }>>(
        `/api/v1/audit/activity?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    activityCsvUrl: (params?: {
      from?: string;
      to?: string;
      actor?: string;
      action?: string;
      patient_id?: string;
    }) =>
      `${this.opts.baseUrl}/api/v1/audit/activity.csv?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
        ) as Record<string, string>,
      ).toString()}`,
    settings: (params?: { table?: string; actor?: string }) =>
      this.get<unknown[]>(`/api/v1/audit/settings?${new URLSearchParams(params as Record<string, string>).toString()}`),
  };

  vault = {
    list: () => this.get<unknown[]>('/api/v1/vault'),
    create: (body: unknown) => this.post<unknown>('/api/v1/vault', body),
    test: (id: string) => this.post<{ success: boolean }>(`/api/v1/vault/${id}/test`),
    revoke: (id: string) => this.delete<unknown>(`/api/v1/vault/${id}`),
  };

  journal = {
    feed: (params?: {
      from?: string;
      to?: string;
      source?:
        | 'all'
        | 'transactions'
        | 'pharmacy'
        | 'inpatient'
        | 'ledger'
        | 'appointments'
        | 'expenses'
        | 'shifts';
      search?: string;
      amount?: number;
      amount_tolerance?: number;
      include_void?: boolean;
      limit?: number;
      register?: 'reception' | 'inpatient';
    }) =>
      this.get<Array<{
        id: string;
        source:
          | 'transaction'
          | 'pharmacy_sale'
          | 'inpatient_stay'
          | 'inpatient_ledger'
          | 'inpatient_discharge'
          | 'inpatient_transfer'
          | 'appointment'
          | 'expense'
          | 'inpatient_assignment'
          | 'inpatient_doctor_change'
          | 'inpatient_meal_period'
          | 'shift_opened'
          | 'shift_closed';
        ref_id: string;
        occurred_at: string;
        patient_id: string | null;
        patient_name: string | null;
        patient_phone: string | null;
        doctor_name: string | null;
        diagnosis: string | null;
        amount_uzs: number;
        status: 'paid' | 'debt' | 'refund' | 'expense' | 'pending' | 'partial' | 'transfer';
        payment_method: string | null;
        description: string | null;
        note: string | null;
        cashier_name: string | null;
        is_void: boolean;
        department?: string | null;
        items?: Array<{ name: string; quantity: number; amount_uzs: number }>;
      }>>(
        `/api/v1/journal/feed?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    summary: (params?: { from?: string; to?: string; register?: 'reception' | 'inpatient' }) =>
      this.get<{
        revenue: number;
        refunds: number;
        expenses: number;
        payroll: number;
        commission_accrued: number;
        pharmacy_profit: number;
        profit: number;
        pharmacy_debt_window: number;
        window: { from: string; to: string };
      }>(
        `/api/v1/journal/summary?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    verifyPin: (pin: string) => this.post<{ ok: true }>('/api/v1/journal/pin/verify', { pin }),
    changePin: (current_pin: string, new_pin: string) =>
      this.post<{ ok: true }>('/api/v1/journal/pin/change', { current_pin, new_pin }),
    listNotes: (refType: string, refId: string) =>
      this.get<Array<{ id: string; note: string; created_at: string; author?: { full_name: string } | null }>>(
        `/api/v1/journal/notes/${refType}/${refId}`,
      ),
    createNote: (body: { ref_type: string; ref_id: string; note: string }) =>
      this.post<{ id: string }>('/api/v1/journal/notes', body),
    updateNote: (id: string, note: string) => this.patch<{ id: string }>(`/api/v1/journal/notes/${id}`, { note }),
    deleteNote: (id: string) => this.delete<{ ok: true }>(`/api/v1/journal/notes/${id}`),
    voidEntry: (body: { source: string; ref_id: string; pin: string }) =>
      this.post<{ ok: true }>('/api/v1/journal/void', body),

    // Layout (clinic side)
    layout: () =>
      this.get<
        Array<{
          source_key: string;
          display_label_i18n: Record<string, string>;
          color_tone: string;
          icon_key: string;
          sort_order: number;
          is_visible: boolean;
          is_locked_label: boolean;
          is_locked_color: boolean;
          is_locked_icon: boolean;
          is_locked_order: boolean;
          is_locked_visible: boolean;
        }>
      >('/api/v1/journal/layout'),
    listOverrides: () =>
      this.get<
        Array<{
          id: string;
          clinic_id: string;
          source_key: string;
          display_label_i18n: Record<string, string> | null;
          color_tone: string | null;
          icon_key: string | null;
          sort_order: number | null;
          is_visible: boolean | null;
        }>
      >('/api/v1/journal/layout/overrides'),
    upsertOverride: (body: {
      source_key: string;
      display_label_i18n?: Record<string, string> | null;
      color_tone?: string | null;
      icon_key?: string | null;
      sort_order?: number | null;
      is_visible?: boolean | null;
    }) => this.post<unknown>('/api/v1/journal/layout/overrides', body),
    deleteOverride: (sourceKey: string) =>
      this.delete<{ ok: true }>(`/api/v1/journal/layout/overrides/${sourceKey}`),
  };

  // Super admin: jurnal layout defaultlari
  adminJournalLayout = {
    listDefaults: () =>
      this.get<
        Array<{
          id: string;
          source_key: string;
          display_label_i18n: Record<string, string>;
          color_tone: string;
          icon_key: string;
          sort_order: number;
          is_visible: boolean;
          lock_label: boolean;
          lock_color: boolean;
          lock_icon: boolean;
          lock_order: boolean;
          lock_visible: boolean;
        }>
      >('/api/admin/journal-layout/defaults'),
    upsertDefault: (body: {
      source_key: string;
      display_label_i18n?: Record<string, string>;
      color_tone?: string;
      icon_key?: string;
      sort_order?: number;
      is_visible?: boolean;
      lock_label?: boolean;
      lock_color?: boolean;
      lock_icon?: boolean;
      lock_order?: boolean;
      lock_visible?: boolean;
    }) => this.post<unknown>('/api/admin/journal-layout/defaults', body),
    deleteDefault: (sourceKey: string) =>
      this.delete<{ ok: true }>(`/api/admin/journal-layout/defaults/${sourceKey}`),
  };

  transactions = {
    get: (id: string) =>
      this.get<{
        id: string;
        occurred_at: string;
        patient_name: string | null;
        patient_phone: string | null;
        doctor_id: string | null;
        doctor_name: string | null;
        cashier_name: string | null;
        payment_method: string | null;
        notes: string | null;
        is_void: boolean;
        items: Array<{
          service_id: string | null;
          name: string;
          quantity: number;
          unit_price_uzs: number;
          discount_uzs: number;
          final_amount_uzs: number;
        }>;
        total_uzs: number;
        paid_uzs: number;
        debt_uzs: number;
        status: 'paid' | 'partial' | 'debt';
      }>(`/api/v1/transactions/${id}`),
    editItems: (
      id: string,
      body: {
        items: Array<{
          service_id: string;
          quantity: number;
          unit_price_uzs: number;
          discount_uzs?: number;
        }>;
        notes?: string;
        // Tranzaksiya shifokori — kelmasa tegilmaydi; null — o'chirish.
        doctor_id?: string | null;
        // Aralash (split) to'lov — to'langan qismni usul bo'yicha bo'lish.
        payments?: Array<{ method: string; amount_uzs: number }>;
      },
    ) =>
      this.patch<{
        ok: boolean;
        transaction_id: string;
        old_amount_uzs: number;
        new_amount_uzs: number;
        paid_uzs: number;
        debt_uzs: number;
        diff_uzs: number;
        items_count: number;
      }>(`/api/v1/transactions/${id}/items`, body),
    // O'chirish — SAVATCHAga arxivlanadi (sabab majburiy). 3-arg `{}` — `delete`
    // helper'i string-qiymatli body'ni header deb o'ylamasligi uchun.
    delete: (id: string, reason: string) =>
      this.delete<{ ok: boolean; kind: string; source_id: string }>(
        `/api/v1/transactions/${id}`,
        { reason },
        {},
      ),
    void: (id: string, body: { reason: string }) =>
      this.patch<{
        ok: boolean;
        transaction_id: string;
        voided_amount_uzs: number;
      }>(`/api/v1/transactions/${id}/void`, body),
  };

  staffProfiles = {
    list: (params?: { position?: string; active?: boolean }) =>
      this.get<Array<{
        id: string;
        clinic_id: string;
        profile_id: string | null;
        last_name: string;
        first_name: string;
        patronymic: string | null;
        phone: string | null;
        email: string | null;
        position: string;
        specialization: string | null;
        education_level: string | null;
        diploma_url: string | null;
        certificates: string[];
        photos: string[];
        salary_type: 'fixed' | 'percent' | 'weekly' | 'bonus' | 'mixed';
        salary_fixed_uzs: number;
        salary_percent: number;
        salary_bonus_uzs: number;
        payday_kind: 'monthly' | 'weekly';
        payday_day: number;
        show_in_reception: boolean;
        inpatient_payroll_mode: 'off' | 'percent' | 'monthly' | 'bonus';
        inpatient_percent: number;
        inpatient_monthly_uzs: number;
        inpatient_admission_bonus_uzs: number;
        is_active: boolean;
        notes: string | null;
        created_at: string;
        profile?: { id: string; full_name: string; role: string; email: string } | null;
      }>>(
        `/api/v1/staff-profiles?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {})
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    one: (id: string) => this.get<unknown>(`/api/v1/staff-profiles/${id}`),
    create: (body: Record<string, unknown>) =>
      this.post<{ id: string }>('/api/v1/staff-profiles', body),
    update: (id: string, body: Record<string, unknown>) =>
      this.patch<{ id: string }>(`/api/v1/staff-profiles/${id}`, body),
    remove: (id: string) => this.delete<{ ok: true }>(`/api/v1/staff-profiles/${id}`),
    // Butunlay o'chirish — bazadan butunlay yo'q qiladi.
    hardDelete: (id: string) => this.delete<{ ok: true }>(`/api/v1/staff-profiles/${id}/hard`),
    // Maosh xodimiga ilovaga kirish huquqi berish — login akkaunt yaratiladi.
    grantAccess: (id: string, body: { email: string; role: string }) =>
      this.post<{ id: string; profile_id: string }>(
        `/api/v1/staff-profiles/${id}/grant-access`,
        body,
      ),
  };

  publicApi = {
    newsletter: (body: unknown) => this.post<{ ok: true }>('/api/v1/public/newsletter', body),
    signup: (body: unknown) => this.post<{ userId: string; next: string }>('/api/v1/public/signup', body),
    contact: (body: unknown) => this.post<{ ok: true }>('/api/v1/public/contact', body),
    demoRequest: (body: unknown) => this.post<{ ok: true }>('/api/v1/public/demo-request', body),
  };

  paymentQr = {
    create: (body: {
      provider: 'click' | 'payme';
      amount_uzs: number;
      flow?: 'merchant_qr' | 'customer_scan';
      patient_id?: string | null;
      transaction_id?: string | null;
      shift_id?: string | null;
      idempotency_key?: string;
      expires_in_sec?: number;
    }) =>
      this.post<{
        id: string;
        provider: string;
        flow: string;
        status: string;
        qr_payload: string | null;
        deep_link: string | null;
        amount_uzs: number;
        expires_at: string | null;
      }>('/api/v1/payment-qr', body),
    status: (id: string) =>
      this.get<{
        id: string;
        status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'expired';
        paid_at: string | null;
      }>(`/api/v1/payment-qr/${id}/status`),
    verifyPass: (id: string, customerToken: string) =>
      this.post<{ status: string; paid_at: string | null }>(`/api/v1/payment-qr/${id}/verify-pass`, {
        customer_token: customerToken,
      }),
    cancel: (id: string) => this.post<unknown>(`/api/v1/payment-qr/${id}/cancel`),
  };

  reception = {
    openAppointments: (patientId: string) =>
      this.get<
        Array<{
          id: string;
          doctor_id: string | null;
          doctor?: { full_name: string } | null;
          service_name_snapshot: string | null;
          status: string;
          scheduled_at: string | null;
          checked_in_at: string | null;
        }>
      >(`/api/v1/reception/open-appointments?patient_id=${encodeURIComponent(patientId)}`),
    checkout: (body: {
      patient: Record<string, unknown>;
      doctor_id?: string | null;
      items: Array<{ service_id: string; quantity: number; unit_price_uzs?: number; discount_uzs?: number }>;
      payment_method: string;
      paid_amount_uzs: number;
      debt_uzs?: number;
      // Aralash (split) to'lov — naqd + karta/transfer bo'laklari.
      payments?: Array<{ method: string; amount_uzs: number }>;
      notes?: string;
      add_to_queue?: boolean;
      shift_id?: string | null;
      provider_reference?: string;
      existing_appointment_id?: string | null;
    }) =>
      this.post<{
        patient_id: string;
        transaction_id: string;
        total_uzs: number;
        paid_uzs: number;
        debt_uzs: number;
        appointment_id: string | null;
        queue_id: string | null;
        ticket_no: string | null;
        shift_id: string | null;
        doctor_name: string | null;
        doctor_specialty: string | null;
        cashier_name: string | null;
      }>('/api/v1/reception/checkout', body),
  };

  doctors = {
    list: () =>
      this.get<Array<{ id: string; full_name: string; role: string; phone?: string; avatar_url?: string; position?: string; specialization?: string | null }>>(
        '/api/v1/doctors',
      ),
    // Hisob-kitob uchun — anketadagi shifokorlarni ghost profile bilan ulaydi
    // va barcha doctor profillarni qaytaradi (faqat profiles.id'lar).
    payrollList: () =>
      this.get<Array<{ id: string; full_name: string; role: string; phone?: string; avatar_url?: string }>>(
        '/api/v1/doctors/payroll-list',
      ),
  };

  services = {
    list: (params?: { category?: string; q?: string }) =>
      this.get<
        Array<{
          id: string;
          name_i18n: Record<string, string>;
          description_i18n?: Record<string, string>;
          price_uzs: number;
          duration_min: number;
          doctor_required: boolean;
          category_id?: string | null;
          sort_order: number;
        }>
      >(`/api/v1/services?${new URLSearchParams(params as Record<string, string>).toString()}`),
  };

  // Stomatologiya — dental chart (tish sxemasi) + davolash rejasi + to'lov
  dental = {
    chart: (patientId: string) =>
      this.get<DentalChartResponse>(`/api/v1/dental/chart?patient_id=${patientId}`),
    updateTooth: (body: {
      patient_id: string;
      fdi_number: number;
      status?: string;
      surfaces?: Record<string, string>;
      color_hex?: string | null;
      notes?: string | null;
    }) => this.patch<DentalToothRow>('/api/v1/dental/tooth', body),
    plans: (patientId: string) =>
      this.get<DentalPlan[]>(`/api/v1/dental/plans?patient_id=${patientId}`),
    getPlan: (id: string) => this.get<DentalPlan>(`/api/v1/dental/plans/${id}`),
    createPlan: (body: { patient_id: string; doctor_id?: string | null; title?: string; notes?: string | null }) =>
      this.post<DentalPlan>('/api/v1/dental/plans', body),
    updatePlan: (
      id: string,
      body: { title?: string; status?: string; doctor_id?: string | null; notes?: string | null },
    ) => this.patch<DentalPlan>(`/api/v1/dental/plans/${id}`, body),
    addItem: (
      planId: string,
      body: {
        fdi_number?: number | null;
        surfaces?: Record<string, string> | null;
        service_id?: string | null;
        service_name?: string;
        price_uzs?: number;
        quantity?: number;
        notes?: string | null;
      },
    ) => this.post<{ ok: boolean; id: string }>(`/api/v1/dental/plans/${planId}/items`, body),
    updateItem: (
      id: string,
      body: {
        status?: string;
        scheduled_at?: string | null;
        price_uzs?: number;
        quantity?: number;
        notes?: string | null;
      },
    ) => this.patch<{ ok: boolean }>(`/api/v1/dental/items/${id}`, body),
    removeItem: (id: string) => this.delete<{ ok: boolean }>(`/api/v1/dental/items/${id}`),
    payPlan: (
      planId: string,
      body: { payments: Array<{ method: string; amount_uzs: number }>; notes?: string },
    ) => this.post<{ ok: boolean; transaction_id: string; paid_uzs: number }>(
      `/api/v1/dental/plans/${planId}/pay`,
      body,
    ),
    files: (patientId: string) =>
      this.get<DentalFile[]>(`/api/v1/dental/files?patient_id=${patientId}`),
    addFile: (body: {
      patient_id: string;
      storage_path: string;
      kind?: string;
      file_name?: string;
      mime_type?: string;
      size_bytes?: number;
      fdi_number?: number | null;
      plan_id?: string | null;
      taken_at?: string;
      notes?: string;
    }) => this.post<{ ok: boolean; id: string }>('/api/v1/dental/files', body),
    removeFile: (id: string) => this.delete<{ ok: boolean }>(`/api/v1/dental/files/${id}`),
    labOrders: (params?: { patient_id?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.patient_id) qs.set('patient_id', params.patient_id);
      if (params?.status) qs.set('status', params.status);
      return this.get<DentalLabOrder[]>(`/api/v1/dental/lab-orders${qs.toString() ? `?${qs}` : ''}`);
    },
    createLabOrder: (body: {
      patient_id: string;
      lab_name: string;
      order_type?: string;
      tooth_numbers?: number[];
      doctor_id?: string | null;
      plan_id?: string | null;
      item_id?: string | null;
      shade?: string | null;
      material?: string | null;
      price_uzs?: number;
      due_at?: string | null;
      notes?: string | null;
    }) => this.post<DentalLabOrder>('/api/v1/dental/lab-orders', body),
    updateLabOrder: (
      id: string,
      body: {
        status?: string;
        lab_name?: string;
        order_type?: string;
        doctor_id?: string | null;
        tooth_numbers?: number[];
        shade?: string | null;
        material?: string | null;
        price_uzs?: number;
        due_at?: string | null;
        notes?: string | null;
      },
    ) => this.patch<DentalLabOrder>(`/api/v1/dental/lab-orders/${id}`, body),
    removeLabOrder: (id: string) => this.delete<{ ok: boolean }>(`/api/v1/dental/lab-orders/${id}`),
    report: (from: string, to: string) =>
      this.get<DentalReport>(`/api/v1/dental/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  };

  // Xavfli zona — moliyaviy ma'lumotlarni arxivlab o'chirish + undo (owner)
  dataAdmin = {
    counts: (section: string, from: string, to: string) =>
      this.get<{ section: string; total: number; tables: Array<{ table: string; count: number }> }>(
        `/api/v1/data-admin/counts?section=${section}&from=${from}&to=${to}`,
      ),
    purge: (body: { section: string; from: string; to: string; pin: string; confirm: 'DELETE' }) =>
      this.post<{ batch_id: string; deleted_count: number }>('/api/v1/data-admin/purge', body),
    batches: (limit = 50) =>
      this.get<Array<{
        batch_id: string;
        section: string;
        deleted_at: string;
        restored_at: string | null;
        deleted_by_name: string | null;
        record_count: number;
      }>>(`/api/v1/data-admin/batches?limit=${limit}`),
    restore: (body: { batch_id: string; pin: string }) =>
      this.post<{ restored_count: number }>('/api/v1/data-admin/restore', body),
  };

  // Savatcha — bittalab o'chirilgan yozuvlar (jurnal/dorixona/statsionar) + qaytarish
  trash = {
    list: (params?: { kind?: 'transaction' | 'pharmacy_sale' | 'inpatient'; includeRestored?: boolean }) =>
      this.get<
        Array<{
          id: string;
          kind: 'transaction' | 'pharmacy_sale' | 'inpatient';
          source_id: string;
          reason: string;
          summary: {
            title: string;
            occurred_at: string | null;
            patient_name: string | null;
            doctor_name: string | null;
            shift_label: string | null;
            services: Array<{ name: string; type: string | null; qty: number; amount: number }>;
            total_uzs: number;
            paid_uzs: number;
            debt_uzs: number;
          };
          deleted_at: string;
          restored_at: string | null;
          deleted_by_name: string | null;
        }>
      >(
        `/api/v1/trash?${new URLSearchParams({
          ...(params?.kind ? { kind: params.kind } : {}),
          ...(params?.includeRestored ? { include_restored: 'true' } : {}),
        }).toString()}`,
      ),
    restore: (id: string) => this.post<{ ok: boolean; id: string }>('/api/v1/trash/restore', { id }),
  };

  shifts = {
    active: () =>
      this.get<{ id: string; opened_at: string; operator?: { id: string; full_name: string; role: string } } | null>(
        '/api/v1/shifts/active',
      ),
    recentClosed: (limit = 5) =>
      this.get<Array<{
        id: string;
        operator_name: string | null;
        opened_at: string;
        closed_at: string;
        expected_cash_uzs: number;
        actual_cash_uzs: number;
        diff_uzs: number;
      }>>(`/api/v1/shifts/recent-closed?limit=${limit}`),
    expectedCash: (shiftId: string) =>
      this.get<{
        shift_id: string;
        opening_cash_uzs: number;
        cash_in_uzs: number;
        card_in_uzs: number;
        electronic_in_uzs: number;
        expected_cash_uzs: number;
        opened_at: string;
        closed_at: string | null;
      }>(`/api/v1/shifts/${shiftId}/expected-cash`),
    // Faol smenadagi operator PIN'ini tekshirish — daromad maydonlarini
    // ochish, maxfiy amallar uchun. Smenani kim ochgan bo'lsa o'sha PIN.
    verifyActivePin: (pin: string) =>
      this.post<{ ok: boolean }>('/api/v1/shifts/active/verify-pin', { pin }),
    list: (params?: { from?: string; to?: string }) =>
      this.get<
        Array<{
          id: string;
          opened_at: string;
          closed_at: string | null;
          status: string;
          opening_cash_uzs: number | null;
          actual_cash_uzs: number | null;
          expected_cash_uzs: number | null;
          cash_diff_uzs: number | null;
          closing_notes: string | null;
          operator?: { id: string; full_name: string; role: string } | null;
        }>
      >(`/api/v1/shifts?${new URLSearchParams(params as Record<string, string>).toString()}`),
    open: (body: {
      operator_id: string;
      schedule_id?: string;
      pin: string;
      opening_cash_uzs?: number;
      opened_via?: string;
    }) => this.post<{ id: string }>('/api/v1/shifts/open', body),
    close: (id: string, body: { actual_cash_uzs: number; closing_notes?: string }) =>
      this.patch<unknown>(`/api/v1/shifts/${id}/close`, body),
    // Smena yopish hisoboti — amallar, xodimlar, maosh, sof foyda.
    report: (id: string) =>
      this.get<{
        shift: Record<string, unknown>;
        operator_name: string | null;
        opened_at: string;
        closed_at: string | null;
        transactions: Array<{
          id: string;
          occurred_at: string;
          patient_name: string | null;
          service_name: string | null;
          doctor_name: string | null;
          cashier_name: string | null;
          payment_method: string;
          kind: string;
          amount_uzs: number;
          is_void: boolean;
          source: 'cash_drawer' | 'safe';
          is_encashment: boolean;
          notes: string | null;
        }>;
        pharmacy_sales: Array<{
          id: string;
          occurred_at: string;
          patient_name: string;
          total_uzs: number;
          paid_uzs: number;
          is_void: boolean;
        }>;
        expenses: Array<{
          id: string;
          occurred_at: string;
          source: 'cash_drawer' | 'safe';
          category: string;
          description: string | null;
          payment_method: string | null;
          recorder_name: string | null;
          amount_uzs: number;
        }>;
        staff: Array<{
          name: string;
          role: string;
          appointments: number;
          queue: number;
        }>;
        salary_payouts: Array<{
          id: string;
          doctor_name: string;
          net_uzs: number;
          paid_at: string;
          source: 'cash_drawer' | 'safe';
        }>;
        shift_commissions: Array<{ doctor_name: string; amount_uzs: number }>;
        totals: {
          revenue: number;
          refunds: number;
          expenses: number;
          commission_accrued: number;
          net_profit: number;
          // Maosh to'lovlari — pul harakati (foydaga kirmaydi)
          salaries: number;
          payouts_cash: number;
          payouts_safe: number;
          encashment: number;
          total_expense: number;
        };
      }>(`/api/v1/shifts/${id}/report`),
    // Kunlik Z-hisobot — kun bo'yicha barcha smenalar yopilishi.
    dayReport: (date?: string, register?: 'reception' | 'inpatient') =>
      this.get<{
        date: string;
        register: string;
        by_method: Array<{ method: string; revenue_uzs: number; refund_uzs: number; net_uzs: number }>;
        transfers_uzs: number;
        totals: {
          revenue_uzs: number;
          refund_uzs: number;
          expenses_uzs: number;
          payroll_uzs: number;
          pharmacy_paid_uzs: number;
          net_uzs: number;
        };
        cash: {
          opening_uzs: number;
          expected_uzs: number;
          actual_uzs: number;
          difference_uzs: number;
          open_shifts_count: number;
        };
        shifts: Array<{
          operator_name: string | null;
          opened_at: string;
          closed_at: string | null;
          opening_cash_uzs: number;
          expected_cash_uzs: number;
          actual_cash_uzs: number | null;
          difference_uzs: number | null;
          closing_notes: string | null;
        }>;
      }>(
        `/api/v1/shifts/day-report?${new URLSearchParams(
          Object.fromEntries(
            Object.entries({ date, register })
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>,
        ).toString()}`,
      ),
  };

  shiftOperators = {
    list: (includeArchived = false) =>
      this.get<
        Array<{
          id: string;
          full_name: string;
          phone?: string | null;
          role: string;
          color?: string | null;
          is_active: boolean;
          sort_order: number;
          pin_locked_until?: string | null;
        }>
      >(`/api/v1/shift-operators${includeArchived ? '?includeArchived=true' : ''}`),
    create: (body: {
      full_name: string;
      phone?: string;
      role?: string;
      color?: string;
      pin: string;
      profile_id?: string | null;
      sort_order?: number;
    }) => this.post<unknown>('/api/v1/shift-operators', body),
    update: (id: string, body: Record<string, unknown>) => this.patch<unknown>(`/api/v1/shift-operators/${id}`, body),
    changePin: (id: string, pin: string) => this.post<unknown>(`/api/v1/shift-operators/${id}/pin`, { pin }),
    archive: (id: string) => this.delete<unknown>(`/api/v1/shift-operators/${id}`),
  };

  shiftSchedules = {
    list: (includeArchived = false) =>
      this.get<
        Array<{
          id: string;
          name_i18n: Record<string, string>;
          code?: string | null;
          color?: string | null;
          start_time: string;
          end_time: string;
          days_of_week: number[];
        }>
      >(`/api/v1/shift-schedules${includeArchived ? '?includeArchived=true' : ''}`),
    forDate: (date?: string) =>
      this.get<
        Array<{
          id: string;
          name_i18n: Record<string, string>;
          start_time: string;
          end_time: string;
          operators: Array<{ operator: { id: string; full_name: string; role: string; color?: string | null } }>;
        }>
      >(`/api/v1/shift-schedules/for-date${date ? `?date=${date}` : ''}`),
    create: (body: unknown) => this.post<unknown>('/api/v1/shift-schedules', body),
    update: (id: string, body: unknown) => this.patch<unknown>(`/api/v1/shift-schedules/${id}`, body),
    archive: (id: string) => this.delete<unknown>(`/api/v1/shift-schedules/${id}`),
    assignments: (id: string) => this.get<unknown[]>(`/api/v1/shift-schedules/${id}/assignments`),
    addAssignment: (id: string, body: { operator_id: string; is_primary?: boolean }) =>
      this.post<unknown>(`/api/v1/shift-schedules/${id}/assignments`, body),
    removeAssignment: (assignmentId: string) =>
      this.delete<unknown>(`/api/v1/shift-schedules/assignments/${assignmentId}`),
  };

  lab = {
    list: (params?: { status?: string; patient_id?: string; date?: string }) =>
      this.get<unknown[]>(`/api/v1/lab/orders?${new URLSearchParams(params as Record<string, string>).toString()}`),
    kanban: (date?: string) =>
      this.get<{ date: string; by_status: Record<string, unknown[]> }>(
        `/api/v1/lab/kanban${date ? `?date=${date}` : ''}`,
      ),
    get: (id: string) => this.get<unknown>(`/api/v1/lab/orders/${id}`),
    create: (body: {
      patient_id: string;
      test_ids?: string[];
      panel_ids?: string[];
      urgency?: 'routine' | 'urgent' | 'stat';
      clinical_notes?: string;
      appointment_id?: string;
      stay_id?: string;
      referral_id?: string;
      notify_sms?: boolean;
    }) => this.post<unknown>('/api/v1/lab/orders', body),
    // FAZA 1 — panellar, ICD-10 tavsiya, LOINC qidiruv
    panels: () =>
      this.get<
        Array<{
          id: string;
          code: string;
          name_i18n: Record<string, string>;
          description: string | null;
          items: Array<{
            id: string;
            sort_order: number;
            test: { id: string; name_i18n: Record<string, string>; price_uzs: number; unit: string | null } | null;
          }>;
        }>
      >('/api/v1/lab/panels'),
    recommend: (icd10: string) =>
      this.get<
        Array<{
          loinc_code: string;
          priority: number;
          rationale: string | null;
          name: string;
          category: string | null;
          available: boolean;
          test_id: string | null;
          price_uzs: number | null;
        }>
      >(`/api/v1/lab/recommend?icd10=${encodeURIComponent(icd10)}`),
    loincSearch: (q: string, limit = 20) =>
      this.get<
        Array<{
          loinc_code: string;
          short_name: string;
          long_name: string;
          component: string;
          unit: string | null;
          category: string;
        }>
      >(`/api/v1/lab/loinc/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    collect: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/collect`),
    start: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/start`),
    complete: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/complete`),
    report: (id: string, channel: 'sms' | 'telegram' = 'sms') =>
      this.patch<unknown>(`/api/v1/lab/orders/${id}/report`, { channel }),
    deliver: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/deliver`),
    cancel: (id: string, reason?: string) =>
      this.patch<unknown>(`/api/v1/lab/orders/${id}/cancel`, { reason }),
    recordResult: (body: {
      order_item_id: string;
      value: string;
      unit?: string;
      reference_range?: string;
      interpretation?: string;
      is_abnormal?: boolean;
      is_final?: boolean;
      attachment_url?: string;
      attachment_mime?: string;
      numeric_value?: number | null;
      loinc_code?: string | null;
      flag?: 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high' | null;
    }) => this.post<unknown>('/api/v1/lab/results', body),
    // FAZA 2 — namuna (tube) kuzatuvi
    createSample: (body: {
      order_id: string;
      sample_type?: 'blood' | 'urine' | 'stool' | 'swab' | 'tissue' | 'other';
    }) =>
      this.post<{
        id: string;
        order_id: string;
        tube_id: string;
        barcode: string;
        sample_type: string;
        status: string;
      }>('/api/v1/lab/samples', body),
    orderSamples: (orderId: string) =>
      this.get<
        Array<{
          id: string;
          tube_id: string;
          barcode: string;
          sample_type: string;
          status: string;
          collected_at: string | null;
        }>
      >(`/api/v1/lab/orders/${orderId}/samples`),
    scanSample: (code: string) =>
      this.get<{ sample: unknown; order: unknown }>(
        `/api/v1/lab/samples/scan/${encodeURIComponent(code)}`,
      ),
    updateSampleStatus: (
      id: string,
      status: 'collected' | 'received' | 'rejected',
      reason?: string,
    ) => this.patch<unknown>(`/api/v1/lab/samples/${id}/status`, { status, reason }),
    // FAZA 3 — validatsiya, dashboard, trend
    validateResult: (id: string, note?: string) =>
      this.patch<{ ok: boolean; decision: string }>(
        `/api/v1/lab/results/${id}/validate`,
        { note },
      ),
    rejectResult: (id: string, note?: string) =>
      this.patch<{ ok: boolean; decision: string }>(
        `/api/v1/lab/results/${id}/reject`,
        { note },
      ),
    dashboard: () =>
      this.get<{
        pending?: number;
        running?: number;
        urgent?: number;
        completed_today?: number;
        doctor_waiting?: number;
        avg_turnaround_min?: number;
      }>('/api/v1/lab/dashboard'),
    trend: (patientId: string, loinc: string) =>
      this.get<
        Array<{
          id: string;
          numeric_value: number;
          value: string;
          unit: string | null;
          flag: string | null;
          reported_at: string;
        }>
      >(
        `/api/v1/lab/trend?patient_id=${encodeURIComponent(patientId)}&loinc=${encodeURIComponent(loinc)}`,
      ),
  };

  notifications = {
    outbox: (status?: string) =>
      this.get<unknown[]>(`/api/v1/notifications/outbox${status ? `?status=${status}` : ''}`),
    // In-app bildirishnoma feed'i — global notification markazi (har rol).
    feed: (unread = false) =>
      this.get<
        Array<{
          id: string;
          kind: string;
          severity: 'info' | 'warning' | 'urgent';
          title: string;
          body: string | null;
          ref_resource: string | null;
          ref_id: string | null;
          is_read: boolean;
          created_at: string;
        }>
      >(`/api/v1/notifications${unread ? '?unread=true' : ''}`),
    feedCount: () => this.get<{ unread: number }>('/api/v1/notifications/count'),
    markRead: (id: string | 'all') =>
      this.post<{ ok: true }>(`/api/v1/notifications/${id}/read`, {}),
  };

  payroll = {
    balances: () =>
      this.get<Array<{
        clinic_id: string;
        doctor_id: string;
        full_name: string;
        accrued_uzs: number;
        ledger_uzs: number;
        paid_uzs: number;
        balance_uzs: number;
      }>>('/api/v1/payroll/balances'),
    listRates: (doctorId?: string) =>
      this.get<Array<{
        id: string;
        doctor_id: string;
        service_id: string | null;
        percent: number;
        fixed_uzs: number;
        valid_from: string;
        valid_to: string | null;
        doctor: { full_name: string } | null;
        service: { name: string } | null;
      }>>(`/api/v1/payroll/rates${doctorId ? `?doctor_id=${doctorId}` : ''}`),
    setRate: (body: {
      doctor_id: string;
      service_id?: string | null;
      percent: number;
      fixed_uzs?: number;
      monthly_base_uzs?: number;
      valid_from?: string;
      valid_to?: string | null;
    }) => this.post<unknown>('/api/v1/payroll/rates', body),
    archiveRate: (id: string) => this.post<unknown>(`/api/v1/payroll/rates/${id}/archive`, {}),
    listLedger: (doctorId?: string) =>
      this.get<Array<{
        id: string;
        doctor_id: string;
        kind: string;
        amount_uzs: number;
        notes: string | null;
        reference: string | null;
        status: string;
        payout_id: string | null;
        created_at: string;
        doctor: { full_name: string } | null;
      }>>(`/api/v1/payroll/ledger${doctorId ? `?doctor_id=${doctorId}` : ''}`),
    createLedger: (body: {
      doctor_id: string;
      kind: 'advance' | 'bonus' | 'penalty' | 'adjustment' | 'debt_write_off';
      amount_uzs: number;
      notes?: string;
      reference?: string;
    }) => this.post<unknown>('/api/v1/payroll/ledger', body),
    listPayouts: (doctorId?: string) =>
      this.get<Array<{
        id: string;
        doctor_id: string;
        period_start: string;
        period_end: string;
        period_label: string | null;
        gross_commission_uzs: number;
        advances_uzs: number;
        adjustments_uzs: number;
        net_uzs: number;
        status: string;
        paid_at: string | null;
        method: string | null;
        doctor: { full_name: string } | null;
      }>>(`/api/v1/payroll/payouts${doctorId ? `?doctor_id=${doctorId}` : ''}`),
    getPayout: (id: string) =>
      this.get<{
        payout: Record<string, unknown>;
        commissions: Array<Record<string, unknown>>;
        ledger: Array<Record<string, unknown>>;
      }>(`/api/v1/payroll/payouts/${id}`),
    createPayout: (body: {
      doctor_id: string;
      period_start: string;
      period_end: string;
      period_label?: string;
      notes?: string;
    }) => this.post<{ id: string }>('/api/v1/payroll/payouts', body),
    pay: (id: string, body: { method: string; reference?: string; source?: 'cash_drawer' | 'safe' }) =>
      this.post<unknown>(`/api/v1/payroll/payouts/${id}/pay`, body),
    cancel: (id: string) => this.post<unknown>(`/api/v1/payroll/payouts/${id}/cancel`, {}),
    accrue: (transaction_id: string) =>
      this.post<unknown>('/api/v1/payroll/accrue', { transaction_id }),
    // Stavkasi sozlanmagan tranzaksiyalar — admin tekshiradi
    unaccrued: (doctor_id?: string) =>
      this.get<Array<{
        clinic_id: string;
        transaction_id: string;
        doctor_id: string;
        doctor_name: string | null;
        service_id: string | null;
        service_name: string | null;
        amount_uzs: number;
        created_at: string;
      }>>(
        `/api/v1/payroll/unaccrued${doctor_id ? `?doctor_id=${doctor_id}` : ''}`,
      ),
    // Bir shifokor uchun period (oy) summary
    periodSummary: (doctor_id: string, from: string, to: string) =>
      this.get<{
        doctor_id: string;
        period_from: string;
        period_to: string;
        commissions_uzs: number;
        monthly_base_uzs: number;
        bonuses_uzs: number;
        advances_uzs: number;
        penalties_uzs: number;
        gross_uzs: number;
        deductions_uzs: number;
        net_uzs: number;
        rate_configured: boolean;
        unaccrued_count: number;
      }>(
        `/api/v1/payroll/period-summary?doctor_id=${doctor_id}&from=${from}&to=${to}`,
      ),
    // Klinika bo'yicha barcha shifokorlar period summary
    clinicPeriodSummary: (from: string, to: string) =>
      this.get<Array<{
        doctor_id: string;
        doctor_name: string;
        commissions_uzs: number;
        monthly_base_uzs: number;
        bonuses_uzs: number;
        advances_uzs: number;
        penalties_uzs: number;
        gross_uzs: number;
        deductions_uzs: number;
        net_uzs: number;
        rate_configured: boolean;
        unaccrued_count: number;
      }>>(
        `/api/v1/payroll/clinic-period-summary?from=${from}&to=${to}`,
      ),
    inpatientPayrollByPeriod: (from: string, to: string) =>
      this.get<Record<string, number>>(
        `/api/v1/payroll/inpatient-payroll-by-period?from=${from}&to=${to}`,
      ),
    paydayStatus: (from: string, to: string) =>
      this.get<Array<{
        doctor_id: string;
        doctor_name: string;
        net_uzs: number;
        paid_uzs: number;
        unpaid_uzs: number;
        payday_kind: 'monthly' | 'weekly';
        payday_day: number;
        position: string | null;
        paid: boolean;
        paid_at: string | null;
        due: boolean;
        due_date: string;
      }>>(`/api/v1/payroll/payday-status?from=${from}&to=${to}`),
    shareSummary: (from: string, to: string) =>
      this.get<{
        total_gross_uzs: number;
        total_commission_uzs: number;
        clinic_share_uzs: number;
        by_doctor: Array<{
          doctor_id: string;
          doctor_name: string;
          gross_uzs: number;
          commission_uzs: number;
          clinic_share_uzs: number;
          tx_count: number;
        }>;
      }>(`/api/v1/payroll/share-summary?from=${from}&to=${to}`),
    doctorEarnings: (doctorId: string, from: string, to: string) =>
      this.get<Array<{
        id: string;
        date: string;
        time: string;
        patient_name: string | null;
        service_name: string | null;
        gross_uzs: number;
        percent: number;
        amount_uzs: number;
        transaction_id: string;
        cashier_name: string | null;
        shift_operator: string | null;
      }>>(`/api/v1/payroll/doctor-earnings?doctor_id=${doctorId}&from=${from}&to=${to}`),
    // Xodim sahifasi — overview (staff + summary + qarzdorlik + oxirgi to'lov + kunlik)
    employeeOverview: (doctorId: string, from: string, to: string) =>
      this.get<{
        staff: {
          doctor_id: string;
          full_name: string;
          role: string;
          position?: string | null;
          salary_type?: string | null;
          salary_fixed_uzs?: number | null;
          salary_percent?: number | null;
          payday_kind?: 'monthly' | 'weekly' | null;
          payday_day?: number | null;
        };
        summary: {
          commissions_uzs: number;
          monthly_base_uzs: number;
          bonuses_uzs: number;
          advances_uzs: number;
          penalties_uzs: number;
          gross_uzs: number;
          deductions_uzs: number;
          net_uzs: number;
        } | null;
        outstanding: {
          owed_from: string;
          owed_to: string;
          last_paid_period_end: string | null;
          accrued_commissions_uzs: number;
          base_uzs: number;
          bonuses_uzs: number;
          advances_uzs: number;
          penalties_uzs: number;
          owed_uzs: number;
        } | null;
        last_payout: {
          id: string;
          period_start: string;
          period_end: string;
          net_uzs: number;
          paid_at: string | null;
          method: string | null;
        } | null;
        daily: Array<{ day: string; amount_uzs: number; tx_count: number }>;
      }>(`/api/v1/payroll/employee-overview?doctor_id=${doctorId}&from=${from}&to=${to}`),
    // Davriy daromadlar — oylik baza, statsionar kunlik bonuslar, boshqa bonuslar
    employeePeriodic: (doctorId: string, from: string, to: string) =>
      this.get<{
        monthly_base: Array<{ month: string; amount_uzs: number }>;
        inpatient: Array<{
          id: string; kind: string; amount_uzs: number; notes: string | null;
          reference: string | null; status: string; created_at: string;
        }>;
        other_bonuses: Array<{
          id: string; kind: string; amount_uzs: number; notes: string | null;
          reference: string | null; status: string; created_at: string;
        }>;
      }>(`/api/v1/payroll/employee-periodic?doctor_id=${doctorId}&from=${from}&to=${to}`),
    outstanding: (to: string) =>
      this.get<Array<{
        doctor_id: string;
        doctor_name: string;
        owed_from: string;
        owed_to: string;
        last_paid_period_end: string | null;
        accrued_commissions_uzs: number;
        base_uzs: number;
        bonuses_uzs: number;
        advances_uzs: number;
        penalties_uzs: number;
        owed_uzs: number;
      }>>(`/api/v1/payroll/outstanding?to=${to}`),
  };

  staff = {
    catalog: () =>
      this.get<{
        groups: Record<string, string[]>;
        all: string[];
        role_defaults: Record<string, string[]>;
      }>('/api/v1/staff/permissions/catalog'),
    list: () =>
      this.get<Array<{
        id: string;
        email: string;
        full_name: string;
        phone: string | null;
        role: string;
        is_active: boolean;
        last_sign_in_at: string | null;
        custom_role_id: string | null;
        permissions_override: Record<string, boolean> | null;
        custom_role: { id: string; name: string; permissions: Record<string, boolean> } | null;
        effective_permissions: Record<string, boolean>;
      }>>('/api/v1/staff'),
    seatUsage: () =>
      this.get<{ used: number; max: number | null }>('/api/v1/staff/seat-usage'),
    invite: (body: {
      email: string;
      full_name: string;
      phone?: string;
      role: string;
      locale?: string;
      permissions_override?: Record<string, boolean>;
      photo_url?: string;
      documents?: Array<{
        type: 'diploma' | 'certificate' | 'license' | 'id' | 'other';
        name: string;
        url: string;
        uploaded_at?: string;
      }>;
    }) => this.post<unknown>('/api/v1/staff/invite', body),
    update: (
      id: string,
      body: {
        full_name?: string;
        phone?: string;
        role?: string;
        is_active?: boolean;
        custom_role_id?: string | null;
        permissions_override?: Record<string, boolean>;
      },
    ) => this.patch<unknown>(`/api/v1/staff/${id}`, body),
    listRoles: () =>
      this.get<Array<{
        id: string;
        name: string;
        description: string | null;
        base_role: string;
        permissions: Record<string, boolean>;
      }>>('/api/v1/staff/roles'),
    createRole: (body: {
      name: string;
      description?: string;
      base_role?: string;
      permissions: Record<string, boolean>;
    }) => this.post<{ id: string }>('/api/v1/staff/roles', body),
    updateRole: (
      id: string,
      body: { name?: string; description?: string; base_role?: string; permissions?: Record<string, boolean> },
    ) => this.patch<unknown>(`/api/v1/staff/roles/${id}`, body),
    archiveRole: (id: string) => this.post<unknown>(`/api/v1/staff/roles/${id}/archive`, {}),
  };

  marketing = {
    ltv: () =>
      this.get<{
        totals: { patients: number; revenue_uzs: number; avg_ltv_uzs: number };
        lifecycle: Record<string, { count: number; revenue: number }>;
      }>('/api/v1/marketing/ltv'),
    listSegments: () =>
      this.get<Array<{
        id: string;
        name: string;
        description: string | null;
        filter_query: Record<string, unknown>;
        patient_count_cached: number | null;
        created_at: string;
      }>>('/api/v1/marketing/segments'),
    createSegment: (body: {
      name: string;
      description?: string;
      filter_query: Record<string, unknown>;
      is_dynamic?: boolean;
    }) => this.post<unknown>('/api/v1/marketing/segments', body),
    previewSegment: (body: { filter_query: Record<string, unknown> }, limit = 25) =>
      this.post<{
        count: number;
        sample: Array<{
          patient_id: string;
          full_name: string;
          phone: string | null;
          lifecycle_stage: string;
          total_spent_uzs: number;
          visits_total: number;
          last_activity_at: string | null;
        }>;
      }>(`/api/v1/marketing/segments/preview?limit=${limit}`, body),
    listCampaigns: () =>
      this.get<Array<{
        id: string;
        name: string;
        kind: string;
        channel: string;
        status: string;
        stats: Record<string, number> | null;
        scheduled_at: string | null;
        started_at: string | null;
        variants: { default?: { body: string } } | null;
        segment: { id: string; name: string; patient_count_cached: number | null } | null;
      }>>('/api/v1/marketing/campaigns'),
    createCampaign: (body: {
      name: string;
      kind?: 'oneshot' | 'drip' | 'triggered';
      channel?: 'sms' | 'email' | 'push' | 'multi';
      target_segment_id?: string;
      filter_query?: Record<string, unknown>;
      message_body?: string;
      scheduled_at?: string;
    }) => this.post<{ id: string }>('/api/v1/marketing/campaigns', body),
    sendCampaign: (id: string, message_body: string) =>
      this.post<{ enqueued: number; total_candidates: number }>(
        `/api/v1/marketing/campaigns/${id}/send`,
        { message_body },
      ),
    sendAdhoc: (body: {
      filter_query: Record<string, unknown>;
      message_body: string;
      dry_run?: boolean;
    }) =>
      this.post<{ dry_run: boolean; count: number; enqueued?: number; sample?: unknown[] }>(
        '/api/v1/marketing/sms/bulk',
        body,
      ),
  };

  analytics = {
    overview: (params?: { preset?: string; from?: string; to?: string }) =>
      this.get<{
        totals: {
          revenue_uzs: number;
          expenses_uzs: number;
          profit_uzs: number;
          avg_check_uzs: number;
          transactions: number;
          new_patients: number;
          appointments: number;
          pharmacy_revenue_uzs: number;
        };
        daily: Array<{ day: string; revenue: number; expenses: number; pharmacy: number }>;
        appointment_status: Record<string, number>;
      }>(`/api/v1/analytics/overview?${new URLSearchParams(params as Record<string, string>).toString()}`),
    doctors: (params?: { preset?: string; from?: string; to?: string }) =>
      this.get<
        Array<{
          doctor_id: string | null;
          doctor_name: string;
          visits: number;
          patients: number;
          revenue: number;
        }>
      >(`/api/v1/analytics/doctors?${new URLSearchParams(params as Record<string, string>).toString()}`),
    heatmap: (params?: { preset?: string; from?: string; to?: string }) =>
      this.get<{ grid: number[][] }>(
        `/api/v1/analytics/heatmap?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    topServices: (params?: { preset?: string; from?: string; to?: string }) =>
      this.get<Array<{ service_name: string; count: number; revenue: number }>>(
        `/api/v1/analytics/top-services?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    allDoctors: (params?: { preset?: string; from?: string; to?: string }) =>
      this.get<
        Array<{
          doctor_id: string;
          doctor_name: string;
          visits: number;
          patients: number;
          revenue_uzs: number;
          commission_uzs: number;
        }>
      >(`/api/v1/analytics/all-doctors?${new URLSearchParams(params as Record<string, string>).toString()}`),
    serviceDetail: (params?: { preset?: string; from?: string; to?: string }) =>
      this.get<
        Array<{
          service_id: string;
          service_name: string;
          count: number;
          revenue: number;
          doctors: Array<{ name: string; times: number }>;
          daily: Array<{ day: string; count: number; revenue: number }>;
        }>
      >(`/api/v1/analytics/service-detail?${new URLSearchParams(params as Record<string, string>).toString()}`),
    newPatientsTrend: () =>
      this.get<Array<{ day: string; count: number }>>(
        '/api/v1/analytics/new-patients-trend',
      ),
    upcomingBirthdays: (days = 7) =>
      this.get<Array<{
        id: string;
        full_name: string | null;
        phone: string | null;
        dob: string;
        next_birthday: string;
        days_until: number;
      }>>(`/api/v1/analytics/upcoming-birthdays?days=${days}`),
    // Faza 1: Money Intelligence
    cashAnomalies: (limit = 20) =>
      this.get<Array<{
        id: string;
        opened_at: string;
        closed_at: string;
        expected_cash_uzs: number;
        actual_cash_uzs: number;
        diff_uzs: number;
        abs_diff: number;
        anomaly_level: 'normal' | 'medium_anomaly' | 'high_anomaly' | 'insufficient_data';
        operator: { full_name: string } | null;
      }>>(`/api/v1/analytics/cash-anomalies?limit=${limit}`),
    refundFraudAlerts: () =>
      this.get<Array<{
        cashier_id: string;
        week_start: string;
        refunds_count: number;
        payments_count: number;
        refunds_amount_uzs: number;
        refund_ratio_pct: number;
        risk_level: 'normal' | 'medium_risk' | 'high_risk' | 'insufficient_data';
        cashier: { full_name: string } | null;
      }>>('/api/v1/analytics/refund-fraud-alerts'),
    cashForecast: () =>
      this.get<{
        history: Array<{ day: string; dow: number; revenue_uzs: number; tx_count: number }>;
        forecast: Array<{ day: string; dow: number; predicted_uzs: number }>;
        trend_factor: number;
        last_7d_avg: number;
        prev_7d_avg: number;
      }>('/api/v1/analytics/cash-forecast'),
    // Faza 4: AI Layer
    aiDailyInsight: () =>
      this.get<{ lines: string[]; cached: boolean }>('/api/v1/ai/daily-insight'),
    aiIcd10Suggest: (diagnosis: string) =>
      this.post<{ suggestions: Array<{ code: string; description: string }> }>(
        '/api/v1/ai/icd10-suggest',
        { diagnosis },
      ),
    // Faza 5A: AI Copilot (read-only tool-use suhbat, faqat admin/owner)
    aiCopilot: (messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
      this.post<{ reply: string; tool_calls: string[]; refused: boolean }>(
        '/api/v1/ai/copilot',
        { messages },
      ),
    // Faza 5B: Self-serve BI — Report Builder (oq-ro'yxatli agregatsiya, admin/owner)
    query: (params: {
      dimension: 'time' | 'payment_method' | 'register' | 'source' | 'cashier';
      grain?: 'day' | 'week' | 'month';
      from: string;
      to: string;
    }) =>
      this.post<{
        dimension: string;
        grain: string;
        rows: Array<{
          bucket: string;
          revenue_uzs: number;
          tx_count: number;
          avg_check_uzs: number;
        }>;
      }>('/api/v1/analytics/query', params),
    // Faza 3: Operatsion analitika
    doctorAnomalies: () =>
      this.get<{
        summary: {
          total_doctors: number;
          below_expected: number;
          above_expected: number;
          normal: number;
        };
        doctors: Array<{
          doctor_id: string;
          doctor_name: string;
          total_visits: number;
          total_patients: number;
          total_revenue: number;
          avg_check_uzs: number;
          working_days: number;
          performance_flag: 'below_expected' | 'normal' | 'above_expected' | 'insufficient_data';
        }>;
      }>('/api/v1/analytics/doctor-anomalies'),
    // Faza 2: CRM segmentation
    patientSegments: () =>
      this.get<{
        summary: {
          total: number;
          by_ltv: { vip: number; regular: number; occasional: number; new: number };
          by_churn: { active: number; at_risk: number; churned: number; never_visited: number };
          total_ltv_uzs: number;
        };
        at_risk_top: Array<{
          id: string;
          full_name: string | null;
          phone: string | null;
          ltv_uzs: number;
          visit_count: number;
          last_visit: string | null;
          days_since_last_activity: number;
        }>;
        vip_top: Array<{
          id: string;
          full_name: string | null;
          phone: string | null;
          ltv_uzs: number;
          visit_count: number;
          avg_check_uzs: number;
        }>;
      }>('/api/v1/analytics/patient-segments'),
    inpatientShare: (params?: { preset?: string; from?: string; to?: string }) =>
      this.get<{
        rooms: Array<{
          room_id: string;
          room_number: string;
          room_type: string | null;
          current_stays: number;
          revenue_uzs: number;
        }>;
        period: { total_uzs: number; count: number };
      }>(
        `/api/v1/analytics/inpatient-share?${new URLSearchParams(
          params as Record<string, string>,
        ).toString()}`,
      ),
  };

  // Faza 5C: Jadvallashtirilgan hisobot eksporti (Telegram CSV, admin/owner)
  reportSchedules = {
    list: () =>
      this.get<{
        schedules: Array<{
          id: string;
          name: string;
          dimension: string;
          grain: string;
          cadence: 'daily' | 'weekly' | 'monthly';
          send_hour: number;
          channel: string;
          format: string;
          is_active: boolean;
          last_run_on: string | null;
        }>;
        telegram_connected: boolean;
      }>('/api/v1/report-schedules'),
    create: (body: {
      name: string;
      dimension: string;
      grain: string;
      cadence: 'daily' | 'weekly' | 'monthly';
      send_hour: number;
    }) => this.post<{ id: string }>('/api/v1/report-schedules', body),
    toggle: (id: string, is_active: boolean) =>
      this.patch<{ ok: boolean }>(`/api/v1/report-schedules/${id}`, { is_active }),
    remove: (id: string) => this.delete<{ ok: boolean }>(`/api/v1/report-schedules/${id}`),
    runNow: (id: string) =>
      this.post<{ ok: boolean; reason?: string }>(`/api/v1/report-schedules/${id}/run-now`, {}),
  };

  // Faza 8: Accounting Spine — double-entry General Ledger hisobotlari (admin/owner)
  accounting = {
    chart: () =>
      this.get<Array<{ code: string; name: string; type: string; debit: number; credit: number; balance: number }>>(
        '/api/v1/accounting/chart',
      ),
    trialBalance: (params: { preset?: string; from?: string; to?: string } = {}) =>
      this.get<{
        accounts: Array<{ code: string; name: string; type: string; debit: number; credit: number }>;
        total_debit: number;
        total_credit: number;
        balanced: boolean;
      }>(`/api/v1/accounting/trial-balance?${new URLSearchParams(params as Record<string, string>).toString()}`),
    pnl: (params: { preset?: string; from?: string; to?: string } = {}) =>
      this.get<{
        income: Array<{ code: string; name: string; amount: number }>;
        expense: Array<{ code: string; name: string; amount: number }>;
        total_income: number;
        total_expense: number;
        net_profit: number;
      }>(`/api/v1/accounting/pnl?${new URLSearchParams(params as Record<string, string>).toString()}`),
    cashFlow: (params: { preset?: string; from?: string; to?: string } = {}) =>
      this.get<{
        accounts: Array<{ code: string; name: string; inflow: number; outflow: number; net: number }>;
        net: number;
      }>(`/api/v1/accounting/cash-flow?${new URLSearchParams(params as Record<string, string>).toString()}`),
    balanceSheet: (asOf?: string) =>
      this.get<{
        as_of: string;
        assets: Array<{ code: string; name: string; balance: number }>;
        liabilities: Array<{ code: string; name: string; balance: number }>;
        equity: Array<{ code: string; name: string; balance: number }>;
        retained_earnings: number;
        total_assets: number;
        total_liabilities: number;
        total_equity: number;
        balanced: boolean;
      }>(`/api/v1/accounting/balance-sheet${asOf ? `?as_of=${asOf}` : ''}`),
    journals: (params: { preset?: string; from?: string; to?: string } = {}) =>
      this.get<Array<{
        id: string;
        journal_date: string;
        type: string;
        memo: string | null;
        source_table: string | null;
        source_id: string | null;
        lines: Array<{ debit_uzs: number; credit_uzs: number; account: { code: string; name: string } | null }>;
      }>>(`/api/v1/accounting/journals?${new URLSearchParams(params as Record<string, string>).toString()}`),
  };

  // Faza 9: Procurement — Purchase Order workflow (admin/owner/pharmacist)
  procurement = {
    orders: () =>
      this.get<Array<{
        id: string; po_no: string; status: string; supplier_id: string | null;
        ordered_at: string; expected_at: string | null; subtotal_uzs: number; notes: string | null;
        supplier: { name: string } | null;
        items: Array<{ id: string; medication_id: string | null; name_snapshot: string; qty_ordered: number; unit_cost_uzs: number; qty_received: number }>;
      }>>('/api/v1/procurement/orders'),
    getOrder: (id: string) =>
      this.get<Record<string, unknown>>(`/api/v1/procurement/orders/${id}`),
    createOrder: (body: {
      supplier_id?: string; expected_at?: string; notes?: string;
      items: Array<{ medication_id?: string; name_snapshot: string; qty_ordered: number; unit_cost_uzs: number }>;
    }) => this.post<{ id: string; po_no: string }>('/api/v1/procurement/orders', body),
    approve: (id: string) => this.post<{ ok: boolean }>(`/api/v1/procurement/orders/${id}/approve`, {}),
    cancel: (id: string) => this.post<{ ok: boolean }>(`/api/v1/procurement/orders/${id}/cancel`, {}),
    receive: (id: string, body: {
      paid_uzs?: number; payment_method?: string;
      items: Array<{ medication_id: string; quantity: number; unit_cost_uzs: number; batch_no?: string; expiry_date?: string; profit_percent?: number }>;
    }) => this.post<{ ok: boolean; status: string }>(`/api/v1/procurement/orders/${id}/receive`, body),
    reorderSuggestions: () =>
      this.get<Array<{ medication_id: string; name: string; qty_in_stock: number; reorder_level: number; suggested_qty: number }>>(
        '/api/v1/procurement/reorder-suggestions',
      ),
  };

  cashier = {
    kpis: (register?: string) =>
      this.get<{
        today: number;
        yesterday: number;
        today_total: number;
        yesterday_total: number;
        month_revenue: number;
        month_expenses: number;
        month_payroll: number;
        month_commission_accrued: number;
        month_pharmacy_profit: number;
        month_profit: number;
        by_payment_method_today: Record<string, number>;
        by_payment_method_today_total: Record<string, number>;
        open_shifts: number;
        pharmacy_debt: number;
        inpatient_debt: number;
      }>(`/api/v1/cashier/kpis${register ? `?register=${register}` : ''}`),
    topDebtors: (limit = 5) =>
      this.get<Array<{
        patient_id: string;
        full_name: string | null;
        phone: string | null;
        debt_uzs: number;
      }>>(`/api/v1/cashier/top-debtors?limit=${limit}`),
    safeBalance: (register?: string) =>
      this.get<{
        encashed_total_uzs: number;
        manual_deposited_uzs: number;
        total_in_uzs: number;
        withdrawn_from_safe_uzs: number;
        safe_balance_uzs: number;
      }>(`/api/v1/cashier/safe-balance${register ? `?register=${register}` : ''}`),
    cashOnHand: (register?: string) =>
      this.get<{
        cash_on_hand_uzs: number;
        cash_in_uzs: number;
        encashed_to_safe_uzs: number;
        cash_out_uzs: number;
        adjustments_uzs: number;
      }>(`/api/v1/cashier/cash-on-hand${register ? `?register=${register}` : ''}`),
    cashOnHandEntries: (register?: string) =>
      this.get<Array<{
        id: string;
        ref_type: 'cash_payment' | 'cash_refund' | 'encashment' | 'cash_adjustment' | 'cash_expense';
        direction: 'in' | 'out';
        amount_uzs: number;
        reason: string;
        created_at: string;
        author: string | null;
      }>>(`/api/v1/cashier/cash-on-hand-entries${register ? `?register=${register}` : ''}`),
    safeEntries: (limit = 200, register?: string) =>
      this.get<Array<{
        id: string;
        ref_type:
          | 'encashment'
          | 'manual_deposit'
          | 'safe_refund'
          | 'safe_expense'
          | 'safe_adjustment'
          | 'safe_payroll';
        ref_id: string;
        direction: 'in' | 'out';
        amount_uzs: number;
        reason: string;
        created_at: string;
        author: string | null;
        editable: boolean;
      }>>(`/api/v1/cashier/safe-entries?limit=${limit}${register ? `&register=${register}` : ''}`),
    addSafeDeposit: (body: { amount_uzs: number; reason: string; register?: string }) =>
      this.post<{
        id: string;
        amount_uzs: number;
        reason: string;
        created_at: string;
      }>('/api/v1/cashier/safe-deposit', body),
    updateSafeDeposit: (id: string, body: { amount_uzs?: number; reason?: string }) =>
      this.patch<{ ok: boolean }>(`/api/v1/cashier/safe-deposit/${id}`, body),
    deleteSafeDeposit: (id: string) =>
      this.delete<{ ok: boolean }>(`/api/v1/cashier/safe-deposit/${id}`),
    cashFlow: (params?: { from?: string; to?: string; register?: string }) =>
      this.get<Array<{
        method: string;
        in_uzs: number;
        out_uzs: number;
        net_uzs: number;
      }>>(
        `/api/v1/cashier/cash-flow?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    encash: (body: { amount_uzs: number; destination: string; notes?: string; register?: string }) =>
      this.post<{
        ok: boolean;
        transaction_id: string;
        amount_uzs: number;
        destination: string;
      }>('/api/v1/cashier/encash', body),
    adjustment: (body: {
      type: 'cash_correction' | 'patient_balance_correction';
      amount_uzs: number;
      payment_method: string;
      reason: string;
      patient_id?: string;
    }) =>
      this.post<{
        ok: boolean;
        transaction_id: string;
        amount_uzs: number;
        type: string;
      }>('/api/v1/cashier/adjustment', body),
    transactions: (params?: {
      from?: string;
      to?: string;
      method?: string;
      kind?: string;
      include_void?: boolean;
      amount?: number;
      search?: string;
      limit?: number;
      register?: string;
    }) =>
      this.get<unknown[]>(
        `/api/v1/cashier/transactions?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    expenses: (params?: { from?: string; to?: string; category?: string; register?: string }) =>
      this.get<unknown[]>(
        `/api/v1/cashier/expenses?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    createExpense: (body: {
      category_id?: string;
      amount_uzs: number;
      description?: string;
      supplier_id?: string;
      payment_method?: string;
      expense_date?: string;
      receipt_url?: string;
      source?: 'cash_drawer' | 'safe';
      register?: 'reception' | 'inpatient';
    }) => this.post<unknown>('/api/v1/cashier/expenses', body),
    voidExpense: (id: string) => this.patch<unknown>(`/api/v1/cashier/expenses/${id}/void`),
    shiftBreakdown: (id: string) =>
      this.get<Record<string, { in: number; out: number; net: number }>>(
        `/api/v1/cashier/shifts/${id}/breakdown`,
      ),

    // Vozvrat — mijozga pul qaytarish
    refund: (body: {
      patient_id: string;
      amount_uzs: number;
      payment_method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard' | 'uzum' | 'kaspi';
      reason: string;
      refund_of_transaction_id?: string;
      source?: 'cash_drawer' | 'safe';
    }) => this.post<{ id: string }>('/api/v1/cashier/refund', body),

    // Bemor depozitidan naqd pul chiqarish
    depositWithdraw: (body: {
      patient_id: string;
      amount_uzs: number;
      payment_method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard' | 'uzum' | 'kaspi';
      reason?: string;
      source?: 'cash_drawer' | 'safe';
    }) =>
      this.post<{ id: string; new_balance_uzs: number }>(
        '/api/v1/cashier/deposit-withdraw',
        body,
      ),

    // Qarzdorlar ro'yxati
    debtors: () =>
      this.get<
        Array<{
          id: string;
          full_name: string;
          phone: string | null;
          dob: string | null;
          debt_uzs: number;
        }>
      >('/api/v1/cashier/debtors'),

    // Qarz to'lash
    debtPayment: (body: {
      patient_id: string;
      amount_uzs: number;
      payment_method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'humo' | 'uzcard' | 'uzum' | 'kaspi';
      notes?: string;
    }) => this.post<{ id: string; balance_after_uzs: number }>('/api/v1/cashier/debt-payment', body),

    // Qarzini berganlar — qarz to'lovlari tarixi
    debtPayments: (params: { limit?: number; from?: string; to?: string } = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)] as [string, string]),
      ).toString();
      return this.get<
        Array<{
          transaction_id: string;
          patient_id: string | null;
          full_name: string | null;
          phone: string | null;
          amount_uzs: number;
          payment_method: string;
          created_at: string;
          notes: string | null;
        }>
      >(`/api/v1/cashier/debt-payments${qs ? `?${qs}` : ''}`);
    },

    // Bemor balansi (depozit qoldig'i)
    patientBalance: (patientId: string) =>
      this.get<{ patient_id: string; balance_uzs: number }>(
        `/api/v1/cashier/patients/${patientId}/balance`,
      ),
  };

  pharmacy = {
    dashboard: () =>
      this.get<{
        totals: {
          qty_in_stock: number;
          stock_value_uzs: number;
          today_revenue_uzs: number;
          today_debt_uzs: number;
          low_stock_count: number;
          expiring_count: number;
          expired_count: number;
        };
        low_stock: Array<{ medication_id: string; name: string; qty_in_stock: number; reorder_level: number | null }>;
        expiring: Array<{
          id: string;
          medication: { name: string } | null;
          batch_no: string | null;
          expiry_date: string | null;
          qty_remaining: number;
        }>;
        expired: Array<{
          id: string;
          medication: { name: string } | null;
          batch_no: string | null;
          expiry_date: string | null;
          qty_remaining: number;
        }>;
      }>('/api/v1/pharmacy/dashboard'),
    searchMedications: (q?: string) =>
      this.get<
        Array<{
          medication_id: string;
          name: string;
          form: string | null;
          price_uzs: number;
          qty_in_stock: number;
          reorder_level: number | null;
          barcode?: string | null;
          manufacturer?: string | null;
        }>
      >(`/api/v1/pharmacy/medications/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    reconcileStock: () =>
      this.post<{ ok: boolean; updated: number }>('/api/v1/pharmacy/reconcile-stock', {}),
    returnSaleItems: (id: string, body: { items: Array<{ sale_item_id: string; qty: number }>; reason?: string }) =>
      this.post<{ ok: boolean }>(`/api/v1/pharmacy/sales/${id}/return`, body),
    listSales: (params?: { from?: string; to?: string; patient_id?: string }) =>
      this.get<unknown[]>(
        `/api/v1/pharmacy/sales?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    salesReport: (params?: { from?: string; to?: string; pharmacy_clinic_id?: string; pharmacy_doctor_id?: string }) =>
      this.get<{
        totals: { revenue: number; qty: number; profit: number; doctor_share: number; sales_count: number };
        by_doctor: Array<{ doctor_id: string | null; doctor_name: string; revenue: number; qty: number; profit: number; doctor_share: number; sales_count: number }>;
        sales: Array<{
          id: string; created_at: string; total_uzs: number; paid_uzs: number; debt_uzs: number;
          payment_method: string; clinic_name: string | null; doctor_name: string | null; items_count: number; qty: number;
        }>;
      }>(`/api/v1/pharmacy/sales-report?${new URLSearchParams((params ?? {}) as Record<string, string>).toString()}`),
    getSale: (id: string) =>
      this.get<{
        id: string;
        total_uzs: number;
        paid_uzs: number;
        debt_uzs: number;
        discount_uzs: number;
        is_void: boolean;
        created_at: string;
        payment_method: string;
        notes: string | null;
        pharmacy_clinic_id: string | null;
        pharmacy_doctor_id: string | null;
        clinic_name: string | null;
        doctor_name: string | null;
        cashier_name: string | null;
        patient: { id: string; full_name: string; phone: string | null } | null;
        items: Array<{
          id: string;
          name_snapshot: string;
          price_snapshot: number;
          quantity: number;
          returned_qty: number;
          subtotal_uzs: number;
        }>;
      }>(`/api/v1/pharmacy/sales/${id}`),
    createSale: (body: {
      patient_id?: string;
      pharmacy_clinic_id?: string;
      pharmacy_doctor_id?: string;
      prescription_id?: string;
      items: Array<{ medication_id: string; quantity: number; unit_price_override_uzs?: number }>;
      payment_method: string;
      paid_uzs?: number;
      debt_uzs?: number;
      discount_uzs?: number;
      notes?: string;
      shift_id?: string;
    }) => this.post<unknown>('/api/v1/pharmacy/sales', body),
    prescriptionsPending: () => this.get<unknown[]>('/api/v1/pharmacy/prescriptions/pending'),
    findByBarcode: (code: string) =>
      this.get<{ id: string; name: string; form: string | null; price_uzs: number; stock: number; barcode: string | null; image_url: string | null }>(
        `/api/v1/pharmacy/medications/barcode/${encodeURIComponent(code)}`,
      ),
    importCsv: (rows: Array<{ name: string; barcode?: string; manufacturer?: string; strength?: string; form?: string; price_uzs: number; cost_uzs?: number; reorder_level?: number }>) =>
      this.post<{ inserted: number; updated: number; errors: Array<{ row: number; message: string }> }>('/api/v1/pharmacy/medications/import-csv', { rows }),
    receipt: (body: {
      supplier_id?: string;
      receipt_no?: string;
      received_at?: string;
      paid_uzs?: number;
      notes?: string;
      items: Array<{
        medication_id: string;
        quantity: number;
        unit_cost_uzs: number;
        profit_percent?: number;
        doctor_share_percent?: number;
        doctor_share_bonus_uzs?: number;
        manufacturer?: string;
        manufacture_date?: string;
        batch_no?: string;
        expiry_date?: string;
        unit_price_uzs?: number;
      }>;
    }) => this.post<unknown>('/api/v1/pharmacy/receipts', body),
    // Mijoz-klinikalar (B2B)
    listClinics: () =>
      this.get<Array<{
        id: string;
        name: string;
        contact_person: string | null;
        phone: string | null;
        notes: string | null;
        debt_uzs: number;
        doctors: Array<{ id: string; full_name: string; phone: string | null }>;
      }>>('/api/v1/pharmacy/clinics'),
    createClinic: (body: { name: string; contact_person?: string; phone?: string; notes?: string }) =>
      this.post<{ id: string }>('/api/v1/pharmacy/clinics', body),
    updateClinic: (id: string, body: { name?: string; contact_person?: string; phone?: string; notes?: string }) =>
      this.patch<unknown>(`/api/v1/pharmacy/clinics/${id}`, body),
    archiveClinic: (id: string) => this.delete<{ ok: true }>(`/api/v1/pharmacy/clinics/${id}`),
    addClinicDoctor: (clinicId: string, body: { full_name: string; phone?: string }) =>
      this.post<{ id: string }>(`/api/v1/pharmacy/clinics/${clinicId}/doctors`, body),
    archiveClinicDoctor: (id: string) => this.delete<{ ok: true }>(`/api/v1/pharmacy/doctors/${id}`),
    clinicLedger: (id: string) =>
      this.get<{ entries: Array<Record<string, unknown>>; debt_uzs: number }>(`/api/v1/pharmacy/clinics/${id}/ledger`),
    payClinicDebt: (id: string, body: { amount_uzs: number; payment_method?: string; notes?: string }) =>
      this.post<unknown>(`/api/v1/pharmacy/clinics/${id}/payment`, body),
    voidSale: (id: string, body?: { reason?: string }) =>
      this.post<{ ok: true }>(`/api/v1/pharmacy/sales/${id}/void`, body ?? {}),
    // Savdoni SAVATCHAga arxivlab o'chirish (sabab majburiy).
    deleteSale: (id: string, reason: string) =>
      this.delete<{ ok: boolean; kind: string; source_id: string }>(
        `/api/v1/pharmacy/sales/${id}`,
        { reason },
        {},
      ),
    finance: () =>
      this.get<{
        month_revenue: number;
        month_profit: number;
        month_purchases: number;
        supplier_debt_total: number;
        customer_debt_total: number;
        supplier_debts: Array<{ supplier_id: string; name: string; debt_uzs: number }>;
        customer_debts: Array<{ pharmacy_clinic_id: string; name: string; debt_uzs: number }>;
      }>('/api/v1/pharmacy/finance'),
    paySupplier: (body: { supplier_id: string; amount_uzs: number; payment_method?: string; notes?: string }) =>
      this.post<{ ok: true; applied: number }>('/api/v1/pharmacy/supplier-payment', body),
    // Yetkazib beruvchi firmalar + oldi-berdi (ledger)
    listSuppliers: () =>
      this.get<Array<{
        id: string; name: string; contact_person: string | null;
        phone: string | null; address: string | null; debt_uzs: number;
      }>>('/api/v1/pharmacy/suppliers'),
    createSupplier: (body: { name: string; contact_person?: string; phone?: string; address?: string }) =>
      this.post<{ id: string; name: string }>('/api/v1/pharmacy/suppliers', body),
    updateSupplier: (id: string, body: { name?: string; contact_person?: string; phone?: string; address?: string }) =>
      this.patch<{ id: string }>(`/api/v1/pharmacy/suppliers/${id}`, body),
    archiveSupplier: (id: string) =>
      this.delete<{ ok: true }>(`/api/v1/pharmacy/suppliers/${id}`),
    supplierLedger: (id: string, params?: { from?: string; to?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      if (params?.q) qs.set('q', params.q);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return this.get<{
        balance: number;
        entries: Array<{
          id: string; entry_kind: 'purchase' | 'payment' | 'debt' | 'adjustment';
          amount_uzs: number; payment_method: string | null; invoice_no: string | null;
          receipt_id: string | null; occurred_at: string; notes: string | null; created_at: string;
        }>;
      }>(`/api/v1/pharmacy/suppliers/${id}/ledger${suffix}`);
    },
    addSupplierEntry: (id: string, body: {
      entry_kind: 'payment' | 'debt' | 'adjustment'; amount_uzs: number;
      payment_method?: string; invoice_no?: string; occurred_at?: string; notes?: string;
    }) => this.post<{ id: string }>(`/api/v1/pharmacy/suppliers/${id}/ledger`, body),
    // Dorilar — to'liq boshqaruv
    listMedicationsFull: (q?: string) =>
      this.get<Array<{
        id: string; name: string; category_id: string | null; manufacturer: string | null;
        strength: string | null; form: string | null; barcode: string | null;
        price_uzs: number; cost_uzs: number | null; reorder_level: number | null;
        requires_prescription: boolean; image_url: string | null;
        qty_in_stock: number; earliest_expiry: string | null; category_name: string | null;
      }>>(`/api/v1/pharmacy/medications-full${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    createMedication: (body: Record<string, unknown>) =>
      this.post<{ id: string }>('/api/v1/pharmacy/medications', body),
    updateMedication: (id: string, body: Record<string, unknown>) =>
      this.patch<unknown>(`/api/v1/pharmacy/medications/${id}`, body),
    archiveMedication: (id: string) =>
      this.delete<{ ok: true }>(`/api/v1/pharmacy/medications/${id}`),
    listMedCategories: () =>
      this.get<Array<{ id: string; name: string }>>('/api/v1/pharmacy/medication-categories'),
    createMedCategory: (body: { name: string }) =>
      this.post<{ id: string; name: string }>('/api/v1/pharmacy/medication-categories', body),
  };

  admin = {
    overview: () =>
      this.get<{
        totals: {
          tenants: number;
          active_tenants: number;
          doctors: number;
          medications: number;
          active_subscriptions: number;
          trial_subscriptions: number;
          open_tickets: number;
          total_revenue_usd: number;
          last_30d_uzs: number;
          debt_uzs: number;
        };
        recent_clinics: Array<{
          id: string;
          name: string;
          created_at: string;
          is_suspended: boolean;
        }>;
        daily_revenue: Array<{ day: string; amount_uzs: number }>;
      }>('/api/v1/admin/overview'),
    listDoctors: (params?: { q?: string; clinic_id?: string }) =>
      this.get<Array<{
        id: string;
        full_name: string;
        email: string;
        phone: string | null;
        role: string;
        is_active: boolean;
        last_sign_in_at: string | null;
        created_at: string;
        clinic_id: string;
        clinic: { id: string; name: string } | null;
      }>>(
        `/api/v1/admin/doctors?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== ''),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    listPharmacies: (clinicId?: string) =>
      this.get<Array<{
        clinic_id: string;
        clinic_name: string;
        medications_count: number;
        low_stock: number;
        sales_30d_uzs: number;
      }>>(`/api/v1/admin/pharmacies${clinicId ? `?clinic_id=${clinicId}` : ''}`),
    platformAnalytics: (days = 30) =>
      this.get<{
        series: Array<{ day: string; revenue: number; expenses: number }>;
        leaderboard: Array<{
          clinic_id: string;
          clinic_name: string;
          revenue: number;
          expenses: number;
          profit: number;
        }>;
      }>(`/api/v1/admin/analytics?days=${days}`),
    listTenants: (params?: { q?: string; include_deleted?: boolean }) =>
      this.get<Array<{
        id: string;
        name: string;
        slug: string;
        current_plan: string;
        subscription_status: string;
        is_suspended: boolean;
        deleted_at: string | null;
        created_at: string;
      }>>(
        `/api/v1/admin/tenants?${new URLSearchParams(
          Object.fromEntries(
            Object.entries({
              q: params?.q,
              include_deleted: params?.include_deleted ? 'true' : undefined,
            }).filter(([, v]) => v !== undefined && v !== ''),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    updateTenant: (id: string, body: { name?: string; slug?: string }) =>
      this.patch<unknown>(`/api/v1/admin/tenants/${id}`, body),
    // Admin paneldan yangi klinika ochish — egasiga magic-link qaytaradi.
    createTenant: (body: {
      name: string;
      slug: string;
      city?: string;
      plan?: 'demo' | '25pro' | '50pro' | '120pro';
      owner_email: string;
      owner_full_name?: string;
    }) =>
      this.post<{
        clinic: { id: string; name: string; slug: string };
        owner_user_id: string;
        magic_link: string | null;
      }>('/api/v1/admin/tenants', body),
    deleteTenant: (id: string) =>
      this.delete<unknown>(`/api/v1/admin/tenants/${id}`),
    hardDeleteTenant: (id: string, confirmName: string, password: string) =>
      this.delete<{ ok: boolean; deleted_clinic_id: string; deleted_name: string }>(
        `/api/v1/admin/tenants/${id}/hard`,
        { confirm_name: confirmName, password },
      ),
    restoreTenant: (id: string) =>
      this.post<unknown>(`/api/v1/admin/tenants/${id}/restore`, {}),
    suspendTenant: (id: string, reason: string) =>
      this.post<unknown>(`/api/v1/admin/tenants/${id}/suspend`, { reason }),
    unsuspendTenant: (id: string) =>
      this.post<unknown>(`/api/v1/admin/tenants/${id}/unsuspend`, {}),
    impersonate: (targetUserId: string, reason: string) =>
      this.post<{
        session: unknown;
        target: { id: string; email: string; clinic_id: string; role: string };
        action_link: string | null;
      }>('/api/v1/admin/impersonate/token', { target_user_id: targetUserId, reason }),
    listPatients: (params?: { q?: string; clinic_id?: string; limit?: number; offset?: number }) =>
      this.get<{
        data: Array<{
          id: string;
          full_name: string;
          phone: string | null;
          birth_date: string | null;
          gender: string | null;
          created_at: string;
          clinic_id: string;
          clinic: { id: string; name: string } | null;
        }>;
        total: number;
      }>(
        `/api/v1/admin/patients?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== ''),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    patientTimeline: (id: string) =>
      this.get<{
        patient: {
          id: string;
          clinic_id: string;
          full_name: string;
          phone: string | null;
          birth_date: string | null;
          gender: string | null;
          created_at: string;
          clinic: { id: string; name: string } | null;
        };
        appointments: Array<Record<string, unknown>>;
        lab_orders: Array<Record<string, unknown>>;
        prescriptions: Array<Record<string, unknown>>;
        diagnostic_orders: Array<Record<string, unknown>>;
        transactions: Array<Record<string, unknown>>;
        home_nurse_visits: Array<Record<string, unknown>>;
      }>(`/api/v1/admin/patients/${id}/timeline`),
    financeOverview: (days = 30) =>
      this.get<{
        totals: {
          revenue_uzs: number;
          expenses_uzs: number;
          debts_uzs: number;
          profit_uzs: number;
          subscriptions_usd: number;
        };
        by_method: Array<{ method: string; amount_uzs: number }>;
        leaderboard: Array<{
          clinic_id: string;
          clinic_name: string;
          revenue: number;
          expenses: number;
          debts: number;
          profit: number;
        }>;
      }>(`/api/v1/admin/finance/overview?days=${days}`),
    medicationsRanking: (limit = 100) =>
      this.get<Array<{
        name: string;
        qty: number;
        revenue: number;
        clinic_id: string;
        clinic_name: string;
      }>>(`/api/v1/admin/medications/ranking?limit=${limit}`),
    diagnosticsPopularity: () =>
      this.get<Array<{
        equipment_id: string;
        name: string;
        modality: string;
        orders: number;
        clinic_id: string;
        clinic_name: string;
      }>>('/api/v1/admin/diagnostics/popularity'),
    listSupport: (params?: { status?: string; category?: string; clinic_id?: string; q?: string; limit?: number; offset?: number }) =>
      this.get<{
        data: Array<{
          id: string;
          clinic_id: string;
          subject: string;
          status: string;
          priority: string;
          category: string | null;
          created_at: string;
          updated_at: string;
          clinic: { id: string; name: string } | null;
        }>;
        total: number;
      }>(
        `/api/v1/admin/support/threads?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== ''),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    patchSupport: (id: string, body: { status?: string; priority?: string; category?: string }) =>
      this.post<unknown>(`/api/v1/admin/support/threads/${id}`, body),

    // --- Plans (tariflar) ---
    listPlans: () =>
      this.get<Array<{
        id: string;
        code: string;
        name: string;
        price_usd_cents: number;
        price_uzs: number | null;
        price_yearly_uzs: number | null;
        max_staff: number | null;
        max_devices: number | null;
        max_patients: number | null;
        features: Record<string, unknown>;
        is_active: boolean;
        sort_order: number;
      }>>('/api/v1/admin/plans'),
    updatePlan: (
      code: string,
      body: {
        name?: string;
        price_uzs?: number;
        price_yearly_uzs?: number;
        max_staff?: number | null;
        max_devices?: number | null;
        max_patients?: number | null;
        is_active?: boolean;
      },
    ) => this.patch<unknown>(`/api/v1/admin/plans/${code}`, body),

    // --- Support chat messages ---
    listSupportMessages: (threadId: string) =>
      this.get<Array<{
        id: string;
        thread_id: string;
        sender_user_id: string | null;
        sender_role: string;
        body: string;
        attachments: unknown[];
        created_at: string;
      }>>(`/api/v1/admin/support/threads/${threadId}/messages`),
    sendSupportMessage: (threadId: string, body: string) =>
      this.post<unknown>(`/api/v1/admin/support/threads/${threadId}/messages`, { body }),

    // --- Telegram bots ---
    listTelegramBots: () =>
      this.get<Array<{
        id: string;
        clinic_id: string;
        bot_username: string;
        is_active: boolean;
        registered_at: string;
        clinic: { id: string; name: string } | null;
      }>>('/api/v1/admin/telegram-bots'),
    toggleTelegramBot: (id: string, isActive: boolean) =>
      this.post<unknown>(`/api/v1/admin/telegram-bots/${id}/toggle`, { is_active: isActive }),

    // --- Sales leads (web kontakt formasidan) ---
    listLeads: (params?: { status?: string; q?: string; limit?: number; offset?: number }) =>
      this.get<{
        items: Array<{
          id: string;
          full_name: string;
          email: string;
          phone: string | null;
          clinic_name: string | null;
          message: string | null;
          source: string | null;
          status: string;
          notes: string | null;
          assigned_to: string | null;
          created_at: string;
        }>;
        total: number;
      }>(
        `/api/v1/admin/leads?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {})
              .filter(([, v]) => v !== undefined && v !== '')
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    updateLead: (
      id: string,
      body: { status?: string; notes?: string; assigned_to?: string | null },
    ) => this.patch<unknown>(`/api/v1/admin/leads/${id}`, body),
    // Hisobot bot so'rovlari — markaziy botdan kelgan ega ro'yxat so'rovlari.
    listOwnerRequests: () =>
      this.get<Array<{
        id: string;
        telegram_chat_id: number;
        telegram_username: string | null;
        full_name: string | null;
        phone: string | null;
        clinic_name: string | null;
        message: string | null;
        status: 'pending' | 'approved' | 'rejected';
        clinic_id: string | null;
        created_at: string;
      }>>('/api/v1/admin/telegram-reports/requests'),
    approveOwnerRequest: (id: string, clinicId?: string) =>
      this.post<unknown>(`/api/v1/admin/telegram-reports/requests/${id}/approve`, {
        clinic_id: clinicId,
      }),
    rejectOwnerRequest: (id: string) =>
      this.post<unknown>(`/api/v1/admin/telegram-reports/requests/${id}/reject`, {}),
    setupCentralBot: () =>
      this.post<{ ok: boolean; bot?: string; webhook_url: string }>(
        '/api/v1/admin/telegram-reports/central/setup',
        {},
      ),
    // Admin amallar auditi — barcha mutatsion /admin/* chaqiriqlar.
    listAdminActions: (params?: { days?: number; limit?: number }) =>
      this.get<Array<{
        id: string;
        method: string;
        path: string;
        body_excerpt: string | null;
        ip: string | null;
        created_at: string;
        admin_name: string;
      }>>(
        `/api/v1/admin/audit/actions?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {})
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    // Impersonatsiya tarixi — kim qachon qaysi klinikaga kirgan.
    listImpersonations: (params?: { clinic_id?: string; days?: number; limit?: number }) =>
      this.get<Array<{
        id: string;
        reason: string;
        started_at: string;
        ended_at: string | null;
        support_ticket_id: string | null;
        admin_name: string;
        target_name: string;
        clinic_id: string | null;
        clinic_name: string;
      }>>(
        `/api/v1/admin/impersonations?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {})
              .filter(([, v]) => v !== undefined && v !== '')
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    // Sayt lidlari — `leads` jadvali (footer obuna, exit-intent); sales_leads'dan alohida.
    listSiteLeads: (params?: { status?: string; source?: string; q?: string; limit?: number }) =>
      this.get<{
        data: Array<{
          id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
          clinic_name: string | null;
          message: string | null;
          source: string;
          status: string;
          notes: string | null;
          utm_source: string | null;
          utm_campaign: string | null;
          created_at: string;
        }>;
        total: number;
      }>(
        `/api/v1/admin/leads-site?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {})
              .filter(([, v]) => v !== undefined && v !== '')
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    updateSiteLead: (id: string, body: { status?: string; notes?: string }) =>
      this.patch<unknown>(`/api/v1/admin/leads-site/${id}`, body),
    listNewsletter: () =>
      this.get<Array<{
        id: string;
        email: string;
        locale: string | null;
        source: string | null;
        subscribed_at: string;
        unsubscribed_at: string | null;
      }>>('/api/v1/admin/newsletter'),
    newsletterCsv: () => this.get<{ csv: string }>('/api/v1/admin/newsletter?format=csv'),
  };

  site = {
    publicContent: (locale = 'uz-Latn') =>
      this.get<{
        locale: string;
        entries: Array<{
          key: string;
          kind: string;
          sort_order: number;
          content: Record<string, unknown>;
          content_i18n: Record<string, Record<string, unknown>>;
          data: Record<string, unknown>;
        }>;
        by_kind: Record<string, Array<Record<string, unknown>>>;
        by_key: Record<string, Record<string, unknown>>;
        media: Array<{
          id: string;
          kind: string;
          url: string;
          poster_url: string | null;
          alt_i18n: Record<string, string>;
          width: number | null;
          height: number | null;
          tags: string[];
          created_at: string;
        }>;
      }>(`/api/v1/site/content?locale=${encodeURIComponent(locale)}`),
    adminListEntries: () =>
      this.get<Array<{
        id: string;
        key: string;
        kind: string;
        content_i18n: Record<string, Record<string, unknown>>;
        draft_content_i18n: Record<string, Record<string, unknown>> | null;
        data: Record<string, unknown>;
        draft_data: Record<string, unknown> | null;
        sort_order: number;
        status: 'draft' | 'published' | 'archived';
        is_visible: boolean;
        published_at: string | null;
        version: number;
      }>>('/api/v1/admin/site/entries'),
    adminCreate: (body: {
      key: string;
      kind: string;
      content_i18n?: Record<string, Record<string, unknown>>;
      data?: Record<string, unknown>;
      sort_order?: number;
      is_visible?: boolean;
    }) => this.post<{ id: string }>('/api/v1/admin/site/entries', body),
    adminUpdate: (
      id: string,
      body: {
        content_i18n?: Record<string, Record<string, unknown>>;
        data?: Record<string, unknown>;
        sort_order?: number;
        is_visible?: boolean;
        kind?: string;
      },
    ) => this.post<unknown>(`/api/v1/admin/site/entries/${id}/update`, body),
    adminPublish: (id: string, comment?: string) =>
      this.post<unknown>(`/api/v1/admin/site/entries/${id}/publish`, { comment }),
    adminArchive: (id: string) =>
      this.post<unknown>(`/api/v1/admin/site/entries/${id}/archive`, {}),
    adminRevisions: (id: string) =>
      this.get<Array<Record<string, unknown>>>(`/api/v1/admin/site/entries/${id}/revisions`),
    adminMedia: () =>
      this.get<Array<{
        id: string;
        kind: string;
        url: string;
        poster_url: string | null;
        alt_i18n: Record<string, string>;
        width: number | null;
        height: number | null;
        tags: string[];
        created_at: string;
      }>>('/api/v1/admin/site/media'),
    adminAddMedia: (body: {
      kind: 'image' | 'video' | 'document';
      url: string;
      poster_url?: string | null;
      alt_i18n?: Record<string, string>;
      tags?: string[];
    }) => this.post<unknown>('/api/v1/admin/site/media', body),
    adminDeleteMedia: (id: string) =>
      this.post<unknown>(`/api/v1/admin/site/media/${id}/delete`, {}),
    // Landing saytni qayta qurish (deploy) — CMS o'zgarishlari shundan keyin ko'rinadi.
    rebuild: () =>
      this.post<{ id: string; status: string; started_at: string }>(
        '/api/v1/admin/site/rebuild',
        {},
      ),
    rebuildStatus: () =>
      this.get<{
        enabled: boolean;
        last_build: {
          id: string;
          status: 'running' | 'success' | 'failed';
          started_at: string;
          finished_at: string | null;
          log_tail: string | null;
        } | null;
      }>('/api/v1/admin/site/rebuild/status'),
  };

  diagnostics = {
    listOrders: () =>
      this.get<Array<{
        id: string;
        name_snapshot: string;
        status: string;
        urgency: string;
        scheduled_at?: string;
      }>>('/api/v1/diagnostics/orders'),
    listEquipment: (includeInactive = false) =>
      this.get<
        Array<{
          id: string;
          clinic_id: string;
          name_i18n: Record<string, string>;
          category: string;
          model: string | null;
          manufacturer: string | null;
          serial_no: string | null;
          room_id: string | null;
          service_id: string | null;
          diagnostic_type_id: string | null;
          price_uzs: number | null;
          duration_min: number;
          preparation_i18n: Record<string, string>;
          is_active: boolean;
          metadata: Record<string, unknown>;
          created_at: string;
          room?: { id: string; name: string } | null;
          service?: { id: string; name_i18n: Record<string, string> } | null;
          diagnostic_type?: { id: string; name_i18n: Record<string, string> } | null;
        }>
      >(`/api/v1/diagnostics/equipment${includeInactive ? '?include_inactive=true' : ''}`),
    createEquipment: (body: {
      name_i18n: Record<string, string>;
      category: string;
      model?: string;
      manufacturer?: string;
      serial_no?: string;
      room_id?: string | null;
      service_id?: string | null;
      diagnostic_type_id?: string | null;
      price_uzs?: number;
      duration_min?: number;
      preparation_i18n?: Record<string, string>;
      metadata?: Record<string, unknown>;
    }) => this.post<{ id: string }>('/api/v1/diagnostics/equipment', body),
    updateEquipment: (
      id: string,
      body: Partial<{
        name_i18n: Record<string, string>;
        category: string;
        model: string;
        manufacturer: string;
        serial_no: string;
        room_id: string | null;
        service_id: string | null;
        diagnostic_type_id: string | null;
        price_uzs: number;
        duration_min: number;
        preparation_i18n: Record<string, string>;
        is_active: boolean;
      }>,
    ) => this.patch<{ id: string }>(`/api/v1/diagnostics/equipment/${id}`, body),
    archiveEquipment: (id: string) =>
      this.delete<{ ok: boolean }>(`/api/v1/diagnostics/equipment/${id}`),
  };

  nursePortalClinic = {
    listRequests: (status?: string) =>
      this.get<
        Array<{
          id: string;
          portal_user_id: string;
          clinic_id: string;
          service: string;
          requester_name: string;
          requester_phone: string;
          address: string;
          address_notes: string | null;
          geo_lat: number | null;
          geo_lng: number | null;
          requested_at: string;
          preferred_at: string | null;
          is_urgent: boolean;
          notes: string | null;
          status: string;
          quoted_price_uzs: number | null;
          estimate_total_uzs: number | null;
          created_at: string;
          assigned_nurse_profile_id: string | null;
          patient: { id: string; full_name: string; phone: string | null } | null;
          assigned_nurse: { id: string; full_name: string; phone: string | null } | null;
        }>
      >(`/api/v1/clinic/nurse-portal/requests${status ? `?status=${status}` : ''}`),
    listNurses: () =>
      this.get<Array<{ id: string; full_name: string; phone: string | null; role: string }>>(
        '/api/v1/clinic/nurse-portal/nurses',
      ),
    assign: (body: {
      request_id: string;
      nurse_profile_id: string;
      quoted_price_uzs?: number;
      scheduled_times?: string[];
      sessions_per_day?: number;
      days_count?: number;
    }) => this.post<unknown>('/api/v1/clinic/nurse-portal/assign-nurse', body),
    listMessages: (id: string) =>
      this.get<Array<{ id: string; sender_kind: string; body: string | null; attachments: unknown[]; created_at: string }>>(
        `/api/v1/clinic/nurse-portal/requests/${id}/messages`,
      ),
    sendMessage: (id: string, body: { body?: string; attachments?: Array<{ type: 'image' | 'file'; url: string; name?: string }> }) =>
      this.post<unknown>(`/api/v1/clinic/nurse-portal/requests/${id}/messages`, body),
  };

  nurse = {
    listTasks: (params?: { assigned_to?: string; status?: string; patient_id?: string; mine?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.assigned_to) qs.set('assigned_to', params.assigned_to);
      if (params?.status) qs.set('status', params.status);
      if (params?.patient_id) qs.set('patient_id', params.patient_id);
      if (params?.mine) qs.set('mine', 'true');
      return this.get<
        Array<{
          id: string;
          title: string;
          notes: string | null;
          category: string;
          priority: number;
          status: string;
          due_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          result_notes: string | null;
          patient_id: string | null;
          assigned_to: string | null;
          stay_id: string | null;
          created_at: string;
          patient?: { id: string; full_name: string; phone: string | null } | null;
          assignee?: { id: string; full_name: string } | null;
        }>
      >(`/api/v1/nurse/tasks${qs.toString() ? `?${qs}` : ''}`);
    },
    createTask: (body: {
      patient_id?: string | null;
      stay_id?: string | null;
      assigned_to?: string | null;
      title: string;
      notes?: string;
      category?: string;
      priority?: number;
      due_at?: string;
    }) => this.post<{ id: string }>('/api/v1/nurse/tasks', body),
    updateTask: (
      id: string,
      body: {
        title?: string;
        notes?: string | null;
        category?: string;
        priority?: number;
        due_at?: string | null;
        assigned_to?: string | null;
        status?: 'pending' | 'in_progress' | 'done' | 'skipped' | 'canceled';
        result_notes?: string | null;
      },
    ) => this.patch<{ id: string }>(`/api/v1/nurse/tasks/${id}`, body),
    // Hamshira vazifani o'ziga biriktiradi ("Vazifa qabul qilish").
    claimTask: (id: string) =>
      this.post<{ id: string }>(`/api/v1/nurse/tasks/${id}/claim`, {}),
    listEmergencies: (all = false) =>
      this.get<
        Array<{
          id: string;
          clinic_id: string;
          room_id: string | null;
          patient_id: string | null;
          initiated_by: string;
          message: string;
          severity: 'normal' | 'high' | 'critical';
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          broadcast_at: string;
          profiles?: { id: string; full_name: string } | null;
          room?: { id: string; name: string } | null;
        }>
      >(`/api/v1/nurse/emergencies${all ? '?all=true' : ''}`),
    triggerEmergency: (body: {
      room_id?: string | null;
      patient_id?: string | null;
      message?: string;
      severity?: 'normal' | 'high' | 'critical';
    }) => this.post<{ id: string }>('/api/v1/nurse/emergencies', body),
    ackEmergency: (id: string) => this.post<{ id: string }>(`/api/v1/nurse/emergencies/${id}/ack`, {}),
    resolveEmergency: (id: string) =>
      this.post<{ id: string }>(`/api/v1/nurse/emergencies/${id}/resolve`, {}),

    // Sprint 2A: nurse_schedules (floor x day_of_week routing)
    listSchedules: () =>
      this.get<
        Array<{
          id: string;
          nurse_id: string;
          floor: number;
          day_of_week: number;
          start_time: string;
          end_time: string;
          is_active: boolean;
          nurse?: { id: string; full_name: string; role: string } | null;
        }>
      >('/api/v1/nurse/schedules'),
    upsertSchedule: (body: {
      nurse_id: string;
      floor: number;
      day_of_week: number;
      start_time?: string;
      end_time?: string;
      is_active?: boolean;
    }) => this.post<{ id: string }>('/api/v1/nurse/schedules', body),
    deleteSchedule: (id: string) =>
      this.patch<{ ok: true }>(`/api/v1/nurse/schedules/${id}/delete`, {}),
  };

  telegram = {
    getBot: () =>
      this.get<{
        id: string;
        bot_username: string;
        is_active: boolean;
        webhook_secret: string;
        registered_at: string;
      } | null>('/api/v1/telegram/bot'),
    registerBot: (body: { bot_token: string; bot_username: string }) =>
      this.post<{ id: string; bot_username: string; webhook_url: string }>(
        '/api/v1/telegram/bot/register',
        body,
      ),
    unregisterBot: () => this.post<{ ok: true }>('/api/v1/telegram/bot/unregister', {}),
  };

  // Hisobot bot — klinika egasi uchun Telegram hisobotlar (bemor botidan alohida).
  telegramReports = {
    getBot: () =>
      this.get<{
        id: string;
        bot_username: string;
        is_active: boolean;
        bind_code: string | null;
        bind_code_expires_at: string | null;
        events: Record<string, boolean>;
        registered_at: string;
      } | null>('/api/v1/telegram-reports/bot'),
    registerBot: (body: { bot_token: string; bot_username: string }) =>
      this.post<{
        id: string;
        bot_username: string;
        webhook_url: string;
        bind_code: string;
        bind_code_expires_at: string;
      }>('/api/v1/telegram-reports/bot/register', body),
    unregisterBot: () => this.post<{ ok: true }>('/api/v1/telegram-reports/bot/unregister', {}),
    newBindCode: () =>
      this.post<{ bind_code: string; bind_code_expires_at: string }>(
        '/api/v1/telegram-reports/bot/bind-code',
        {},
      ),
    listChats: () =>
      this.get<Array<{
        id: string;
        chat_id: number;
        username: string | null;
        first_name: string | null;
        is_active: boolean;
        bound_at: string;
      }>>('/api/v1/telegram-reports/chats'),
    removeChat: (id: string) => this.delete<{ ok: true }>(`/api/v1/telegram-reports/chats/${id}`),
    updateEvents: (body: Partial<Record<'shift' | 'encash' | 'expense' | 'refund' | 'safe', boolean>>) =>
      this.patch<{ events: Record<string, boolean> }>('/api/v1/telegram-reports/events', body),
  };

  doctor = {
    dashboard: (doctorId?: string) =>
      this.get<{
        queue: {
          waiting: Array<{
            id: string;
            ticket_no: string | null;
            status: string;
            joined_at: string;
            patient: { id: string; full_name: string; phone: string | null } | null;
          }>;
          called: Array<{
            id: string;
            ticket_no: string | null;
            status: string;
            joined_at: string;
            patient: { id: string; full_name: string; phone: string | null } | null;
          }>;
          serving: Array<{
            id: string;
            ticket_no: string | null;
            status: string;
            joined_at: string;
            patient: { id: string; full_name: string; phone: string | null } | null;
          }>;
          served_today: number;
        };
        today_income_uzs: number;
        pending_lab: number;
        pending_reports: number;
        recent_patients: Array<{
          id: string;
          scheduled_at: string;
          patient: { id: string; full_name: string; phone: string | null } | null;
        }>;
      }>(`/api/v1/doctor/dashboard${doctorId ? `?doctor_id=${doctorId}` : ''}`),
    patientClinical: (patientId: string) =>
      this.get<{
        vitals: Array<{
          id: string;
          recorded_at: string;
          temperature_c: number | null;
          pulse_bpm: number | null;
          systolic_mmhg: number | null;
          diastolic_mmhg: number | null;
          respiration_rate: number | null;
          oxygen_saturation: number | null;
          weight_kg: number | null;
          height_cm: number | null;
          notes: string | null;
        }>;
        notes: Array<{
          id: string;
          soap_subjective: string | null;
          soap_objective: string | null;
          soap_assessment: string | null;
          soap_plan: string | null;
          diagnosis_code: string | null;
          diagnosis_text: string | null;
          is_final: boolean;
          signed_at: string | null;
          created_at: string;
          author: { full_name: string } | null;
        }>;
      }>(`/api/v1/doctor/patients/${patientId}/clinical`),
    recordVitals: (body: {
      patient_id: string;
      appointment_id?: string | null;
      temperature_c?: number | null;
      pulse_bpm?: number | null;
      systolic_mmhg?: number | null;
      diastolic_mmhg?: number | null;
      respiration_rate?: number | null;
      oxygen_saturation?: number | null;
      weight_kg?: number | null;
      height_cm?: number | null;
      notes?: string | null;
    }) => this.post<{ id: string }>('/api/v1/doctor/vitals', body),
    saveConsultation: (body: {
      patient_id: string;
      appointment_id?: string | null;
      soap_subjective?: string | null;
      soap_objective?: string | null;
      soap_assessment?: string | null;
      soap_plan?: string | null;
      diagnosis_code?: string | null;
      diagnosis_text?: string | null;
      sign?: boolean;
    }) => this.post<{ id: string }>('/api/v1/doctor/consultation', body),

    // FAZA 2 — medical history
    getHistory: (patientId: string) =>
      this.get<{
        allergies?: string[];
        chronic_conditions?: string[];
        surgeries?: Array<{ name: string; year?: string; notes?: string }>;
        current_medications?: Array<{ name: string; dose?: string; notes?: string }>;
        blood_type?: string | null;
        medical_notes?: string | null;
      }>(`/api/v1/doctor/patients/${patientId}/history`),
    updateHistory: (
      patientId: string,
      body: {
        allergies?: string[];
        chronic_conditions?: string[];
        surgeries?: Array<{ name: string; year?: string; notes?: string }>;
        current_medications?: Array<{ name: string; dose?: string; notes?: string }>;
        blood_type?: string | null;
        medical_notes?: string | null;
      },
    ) => this.post<unknown>(`/api/v1/doctor/patients/${patientId}/history`, body),

    // FAZA 2 — files
    listFiles: (patientId: string) =>
      this.get<
        Array<{
          id: string;
          kind: string;
          title: string;
          url: string;
          mime_type: string | null;
          size_bytes: number | null;
          notes: string | null;
          created_at: string;
        }>
      >(`/api/v1/doctor/patients/${patientId}/files`),
    addFile: (body: {
      patient_id: string;
      kind: 'xray' | 'mri' | 'ct' | 'ultrasound' | 'lab' | 'prescription' | 'photo' | 'document' | 'other';
      title: string;
      url: string;
      mime_type?: string | null;
      size_bytes?: number | null;
      notes?: string | null;
    }) => this.post<{ id: string }>('/api/v1/doctor/files', body),
    deleteFile: (id: string) => this.post<{ ok: true }>(`/api/v1/doctor/files/${id}/delete`, {}),

    // FAZA 2 — diagnosis templates
    listTemplates: () =>
      this.get<
        Array<{
          id: string;
          name: string;
          diagnosis_code: string | null;
          diagnosis_text: string | null;
          soap_subjective: string | null;
          soap_objective: string | null;
          soap_assessment: string | null;
          soap_plan: string | null;
          usage_count: number;
        }>
      >('/api/v1/doctor/templates'),
    createTemplate: (body: {
      name: string;
      diagnosis_code?: string | null;
      diagnosis_text?: string | null;
      soap_subjective?: string | null;
      soap_objective?: string | null;
      soap_assessment?: string | null;
      soap_plan?: string | null;
    }) => this.post<{ id: string }>('/api/v1/doctor/templates', body),
    deleteTemplate: (id: string) =>
      this.post<{ ok: true }>(`/api/v1/doctor/templates/${id}/delete`, {}),
    useTemplate: (id: string) =>
      this.post<{ ok: true }>(`/api/v1/doctor/templates/${id}/use`, {}),

    // FAZA 2 — financial
    financial: (patientId: string) =>
      this.get<{
        ledger_balance_uzs: number;
        outstanding_debt_uzs: number;
        total_paid_uzs: number;
      }>(`/api/v1/doctor/patients/${patientId}/financial`),

    // FAZA 3 — analytics
    analytics: (doctorId?: string) =>
      this.get<{
        period_days: number;
        total_appointments: number;
        completed_appointments: number;
        unique_patients: number;
        repeat_patients: number;
        income_uzs: number;
        avg_per_day: number;
        daily_patients: Array<{ day: string; count: number }>;
        top_diagnoses: Array<{ code: string; text: string; count: number }>;
      }>(`/api/v1/doctor/analytics${doctorId ? `?doctor_id=${doctorId}` : ''}`),

    // Notifications feed
    notifications: (unread = false) =>
      this.get<
        Array<{
          id: string;
          kind: string;
          severity: 'info' | 'warning' | 'urgent';
          title: string;
          body: string | null;
          ref_resource: string | null;
          ref_id: string | null;
          is_read: boolean;
          created_at: string;
        }>
      >(`/api/v1/doctor/notifications${unread ? '?unread=true' : ''}`),
    notificationsCount: () =>
      this.get<{ unread: number }>('/api/v1/doctor/notifications/count'),
    markNotificationRead: (id: string | 'all') =>
      this.post<{ ok: true }>(`/api/v1/doctor/notifications/${id}/read`, {}),
  };

  icd10 = {
    search: (q: string, limit = 20) =>
      this.get<
        Array<{
          code: string;
          name_uz: string;
          name_ru: string;
          name_en: string;
          category: string;
        }>
      >(`/api/v1/icd10/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  };

  printers = {
    list: () =>
      this.get<
        Array<{
          id: string;
          name: string;
          connection_type: 'lan' | 'usb' | 'bluetooth';
          ip_address: string | null;
          port: number;
          usb_vendor_id: string | null;
          usb_product_id: string | null;
          bt_mac: string | null;
          bt_name: string | null;
          paper_width_mm: 58 | 80;
          is_default: boolean;
          is_active: boolean;
          location: string | null;
          has_cutter: boolean;
          has_cash_drawer: boolean;
          purpose: 'receipt' | 'queue' | 'report' | 'label';
          preset_key: string | null;
          encoding: 'CP1251' | 'UTF-8' | 'CP866';
        }>
      >('/api/v1/thermal-printers'),
    defaultByPurpose: (purpose: 'receipt' | 'queue' | 'report' | 'label' = 'receipt') =>
      this.get<{
        id: string;
        connection_type: 'lan' | 'usb' | 'bluetooth';
        ip_address: string | null;
        port: number;
        usb_vendor_id: string | null;
        usb_product_id: string | null;
        bt_mac: string | null;
        paper_width_mm: 58 | 80;
        has_cutter: boolean;
        has_cash_drawer: boolean;
        encoding: 'CP1251' | 'UTF-8' | 'CP866';
        purpose: 'receipt' | 'queue' | 'report' | 'label';
      } | null>(`/api/v1/thermal-printers/default?purpose=${purpose}`),
    create: (body: {
      name: string;
      connection_type: 'lan' | 'usb' | 'bluetooth';
      ip_address?: string;
      port?: number;
      usb_vendor_id?: string;
      usb_product_id?: string;
      bt_mac?: string;
      bt_name?: string;
      paper_width_mm?: 58 | 80;
      is_default?: boolean;
      location?: string;
      has_cutter?: boolean;
      has_cash_drawer?: boolean;
      purpose?: 'receipt' | 'queue' | 'report' | 'label';
      preset_key?: string;
      encoding?: 'CP1251' | 'UTF-8' | 'CP866';
    }) => this.post<{ id: string }>('/api/v1/thermal-printers', body),
    update: (id: string, body: Record<string, unknown>) =>
      this.patch<unknown>(`/api/v1/thermal-printers/${id}`, body),
    remove: (id: string) =>
      this.patch<{ ok: true }>(`/api/v1/thermal-printers/${id}/delete`, {}),
    print: (body: {
      printer_id?: string;
      kind: 'queue_ticket' | 'receipt' | 'lab_summary' | 'rx_summary' | 'other';
      reference_id?: string;
      content: {
        header?: string;
        subheader?: string;
        title?: string;
        lines?: Array<{ text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; double?: boolean }>;
        items?: Array<{ name: string; qty?: number; amount?: number }>;
        total_uzs?: number;
        paid_uzs?: number;
        debt_uzs?: number;
        footer?: string;
        cut?: boolean;
      };
    }) => this.post<{ ok: boolean; job_id: string; status: string }>(
      '/api/v1/thermal-printers/print',
      body,
    ),
  };

  // ── Patient portal (mobile app) — SMS OTP auth + public clinic browsing ─────
  // Auth oqimi xodimnikidan farqli: Supabase session emas, maxsus OTP JWT.
  // Token AsyncStorage'da saqlanadi va getAccessToken orqali Bearer sifatida
  // uzatiladi. DEV rejimda (ESKIZ_EMAIL yo'q) requestOtp `dev_code` qaytaradi.
  patient = {
    requestOtp: (phone: string) =>
      this.post<{ session_id: string; phone: string; expires_in_sec: number; dev_code?: string }>(
        '/api/v1/patient/auth/otp/request',
        { phone },
      ),
    verifyOtp: (phone: string, code: string) =>
      this.post<{
        access_token: string;
        token_type: 'Bearer';
        expires_in_sec: number;
        user: { id: string; phone: string; full_name: string; is_verified: boolean };
      }>('/api/v1/patient/auth/otp/verify', { phone, code }),

    searchClinics: (params?: {
      query?: string;
      city?: string;
      specialty?: string;
      min_rating?: number;
      page?: number;
    }) =>
      this.get<{ data: unknown[]; total: number }>(
        `/api/v1/patient/clinics?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {})
              .filter(([, v]) => v !== undefined && v !== null && v !== '')
              .map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>,
        ).toString()}`,
      ),
    nearbyClinics: (city: string) =>
      this.get<unknown[]>(`/api/v1/patient/clinics/nearby?city=${encodeURIComponent(city)}`),
    getClinic: (slug: string) => this.get<unknown>(`/api/v1/patient/clinics/${encodeURIComponent(slug)}`),
    getSlots: (slug: string, params: { from: string; to: string; doctor_id?: string }) =>
      this.get<unknown[]>(
        `/api/v1/patient/clinics/${encodeURIComponent(slug)}/slots?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
          ),
        ).toString()}`,
      ),

    getReviews: (slug: string, page = 1) =>
      this.get<unknown>(`/api/v1/patient/clinics/${encodeURIComponent(slug)}/reviews?page=${page}`),
    createReview: (slug: string, body: { rating: number; comment?: string; booking_id?: string }) =>
      this.post<unknown>(`/api/v1/patient/clinics/${encodeURIComponent(slug)}/reviews`, body),
    toggleReviewHelpful: (id: string) => this.post<unknown>(`/api/v1/patient/reviews/${id}/helpful`),

    queueStatus: (bookingId: string) => this.get<unknown>(`/api/v1/patient/queue/${bookingId}`),

    nurseTariffs: (params?: { city?: string; service?: string }) =>
      this.get<unknown[]>(
        `/api/v1/patient/nurse/tariffs?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params ?? {}).filter(([, v]) => v !== undefined) as [string, string][],
          ),
        ).toString()}`,
      ),

    // Tibbiy ma'lumotlar — bemor telefoni orqali klinika yozuvlariga bog'lanadi
    medicalRecords: () =>
      this.get<{
        patients: Array<{ id: string; full_name: string; clinic: { name: string; slug: string; logo_url: string | null } | null }>;
        diagnoses: Array<{
          id: string;
          source: 'treatment_note' | 'prescription';
          patient_name: string | null;
          clinic: { name: string; slug: string; logo_url: string | null } | null;
          doctor_name: string | null;
          diagnosis_code: string | null;
          diagnosis_text: string | null;
          assessment: string | null;
          plan: string | null;
          is_final: boolean;
          occurred_at: string | null;
        }>;
        labs: Array<{
          id: string;
          patient_name: string | null;
          clinic: { name: string; slug: string; logo_url: string | null } | null;
          status: string;
          urgency: string | null;
          occurred_at: string | null;
          items: Array<{
            name: string;
            status: string;
            results: Array<{
              value: string | null;
              unit: string | null;
              reference_range: string | null;
              flag: string | null;
              is_abnormal: boolean | null;
              interpretation: string | null;
            }>;
          }>;
        }>;
        diagnostics: Array<{
          id: string;
          patient_name: string | null;
          clinic: { name: string; slug: string; logo_url: string | null } | null;
          name: string | null;
          status: string;
          occurred_at: string | null;
          results: Array<{ findings: string | null; impression: string | null; is_final: boolean }>;
        }>;
      }>('/api/v1/patient/medical/records'),

    // Navbat so'rovi (slotsiz — klinika tasdiqlaydi)
    requestAppointment: (body: {
      clinic_id: string;
      doctor_id?: string | null;
      preferred_at?: string;
      preferred_note?: string;
      reason?: string;
    }) => this.post<{ id: string; status: string }>('/api/v1/patient/appointments/request', body),
    myAppointments: () =>
      this.get<
        Array<{
          id: string;
          status: 'pending' | 'confirmed' | 'rejected' | 'canceled' | 'completed';
          doctor_id: string | null;
          doctor_name: string | null;
          preferred_at: string | null;
          preferred_note: string | null;
          reason: string | null;
          response_note: string | null;
          scheduled_at: string | null;
          created_at: string;
          clinic: { name: string; slug: string; logo_url: string | null } | null;
        }>
      >('/api/v1/patient/appointments/mine'),
    cancelAppointment: (id: string) =>
      this.post<{ id: string; status: string }>(`/api/v1/patient/appointments/${id}/cancel`),

    listBookings: () => this.get<unknown[]>('/api/v1/patient/bookings'),
    createBooking: (body: { slot_id: string; reason?: string }) =>
      this.post<unknown>('/api/v1/patient/bookings', body),
    cancelBooking: (id: string, reason?: string) =>
      this.post<unknown>(`/api/v1/patient/bookings/${id}/cancel`, { reason }),

    createNurseRequest: (body: {
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
    }) => this.post<{ id: string; status: string }>('/api/v1/patient/nurse/requests', body),
    listMyNurseRequests: () =>
      this.get<
        Array<{
          id: string;
          service: string;
          status: string;
          address: string;
          geo_lat: number | null;
          geo_lng: number | null;
          is_urgent: boolean;
          notes: string | null;
          preferred_at: string | null;
          quoted_price_uzs: number | null;
          estimate_total_uzs: number | null;
          created_at: string;
        }>
      >('/api/v1/patient/nurse/requests/mine'),
  };

  // ── KLINIKA: bemorlardan kelgan navbat so'rovlari (appointment_requests) ────
  clinicAppointments = {
    list: (status?: string) =>
      this.get<
        Array<{
          id: string;
          status: 'pending' | 'confirmed' | 'rejected' | 'canceled' | 'completed';
          doctor_id: string | null;
          doctor_name: string | null;
          patient_name_snapshot: string;
          patient_phone_snapshot: string;
          preferred_at: string | null;
          preferred_note: string | null;
          reason: string | null;
          response_note: string | null;
          scheduled_at: string | null;
          created_at: string;
        }>
      >(`/api/v1/clinic/appointment-requests${status ? `?status=${status}` : ''}`),
    respond: (
      id: string,
      body: { action: 'confirm' | 'reject'; scheduled_at?: string; response_note?: string },
    ) => this.patch<{ id: string; status: string }>(`/api/v1/clinic/appointment-requests/${id}/respond`, body),
  };

  // ── HAMSHIRA (self): biriktirilgan uy chaqiruvlari (nurse-portal) ──────────
  nursePortal = {
    myStatus: () => this.get<unknown>('/api/v1/nurse-portal/me'),
    myProfile: () =>
      this.get<{
        id: string;
        full_name: string | null;
        email: string | null;
        phone: string | null;
        photo_url: string | null;
        role: string;
        position: string | null;
        specialization: string | null;
        education_level: string | null;
        clinic_id: string | null;
        clinic: { id: string; name: string; city: string | null; logo_url: string | null } | null;
      }>('/api/v1/nurse-portal/me/profile'),
    tasks: (status?: string) =>
      this.get<
        Array<{
          id: string;
          service: string;
          status: string;
          requester_name: string;
          requester_phone: string;
          address: string;
          address_notes: string | null;
          geo_lat: number | null;
          geo_lng: number | null;
          is_urgent: boolean;
          notes: string | null;
          preferred_at: string | null;
          quoted_price_uzs: number | null;
          sessions_per_day: number | null;
          days_count: number | null;
          created_at: string;
          clinic?: { name: string } | null;
        }>
      >(`/api/v1/nurse-portal/tasks${status ? `?status=${status}` : ''}`),
    startTask: (id: string) => this.patch<unknown>(`/api/v1/nurse-portal/tasks/${id}/start`),
    completeTask: (id: string, body?: { notes?: string; proof_image_url?: string }) =>
      this.patch<unknown>(`/api/v1/nurse-portal/tasks/${id}/complete`, body ?? {}),
    taskMessages: (id: string) =>
      this.get<Array<{ id: string; sender_kind: string; body: string | null; created_at: string }>>(
        `/api/v1/nurse-portal/tasks/${id}/messages`,
      ),
    sendTaskMessage: (id: string, body: { body: string }) =>
      this.post<unknown>(`/api/v1/nurse-portal/tasks/${id}/messages`, body),
  };
}

export function createClient(opts: ClaryApiClientOptions) {
  return new ClaryApiClient(opts);
}
