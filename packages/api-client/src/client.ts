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
      const err = new Error(json.error?.message ?? res.statusText) as ClaryApiError;
      err.status = res.status;
      err.code = json.error?.code ?? 'HTTP_ERROR';
      err.details = json.error?.details;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  get<T>(path: string, extraHeaders?: Record<string, string>) { return this.request<T>('GET', path, undefined, extraHeaders); }
  post<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) { return this.request<T>('POST', path, body, extraHeaders); }
  patch<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) { return this.request<T>('PATCH', path, body, extraHeaders); }
  put<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) { return this.request<T>('PUT', path, body, extraHeaders); }
  delete<T>(path: string, extraHeaders?: Record<string, string>) { return this.request<T>('DELETE', path, undefined, extraHeaders); }

  // Typed endpoint helpers
  patients = {
    list: (params?: { page?: number; pageSize?: number; q?: string }) =>
      this.get<{ items: unknown[]; total: number }>(`/api/v1/patients?${new URLSearchParams(params as Record<string, string>).toString()}`),
    get: (id: string) => this.get<unknown>(`/api/v1/patients/${id}`),
    create: (body: unknown) => this.post<unknown>('/api/v1/patients', body),
    update: (id: string, body: unknown) => this.patch<unknown>(`/api/v1/patients/${id}`, body),
    archive: (id: string) => this.delete<unknown>(`/api/v1/patients/${id}`),
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
        appointments: Array<Record<string, unknown>>;
        transactions: Array<Record<string, unknown>>;
        prescriptions: Array<Record<string, unknown>>;
        referrals: Array<Record<string, unknown>>;
        lab_orders: Array<Record<string, unknown>>;
        inpatient_stays: Array<Record<string, unknown>>;
        pharmacy_sales: Array<Record<string, unknown>>;
        clinical_notes: Array<Record<string, unknown>>;
      }>(`/api/v1/patients/${id}/timeline`),
  };

  appointments = {
    list: (params?: { from?: string; to?: string; doctor?: string }) =>
      this.get<unknown[]>(`/api/v1/appointments?${new URLSearchParams(params as Record<string, string>).toString()}`),
    create: (body: unknown) => this.post<unknown>('/api/v1/appointments', body),
  };

  queues = {
    list: (params?: { status?: string; doctor_id?: string; date?: string }) =>
      this.get<unknown[]>(`/api/v1/queues?${new URLSearchParams(params as Record<string, string>).toString()}`),
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
    list: (params?: { status?: string; kind?: string; patient_id?: string; doctor_id?: string }) =>
      this.get<unknown[]>(`/api/v1/referrals?${new URLSearchParams(params as Record<string, string>).toString()}`),
    create: (body: {
      patient_id: string;
      referral_kind: 'diagnostic' | 'lab' | 'service' | 'inpatient' | 'other';
      target_service_id?: string;
      target_diagnostic_type_id?: string;
      target_lab_test_id?: string;
      target_room_id?: string;
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
      }>;
    }) => this.post<unknown>('/api/v1/prescriptions', body),
    sign: (id: string) => this.patch<unknown>(`/api/v1/prescriptions/${id}/sign`),
    cancel: (id: string) => this.patch<unknown>(`/api/v1/prescriptions/${id}/cancel`),
  };

  catalog = {
    list: (entity: string, params?: { page?: number; pageSize?: number; q?: string }) =>
      this.get<{ items: unknown[]; total: number }>(`/api/v1/catalog/${entity}?${new URLSearchParams(params as Record<string, string>).toString()}`),
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
    roomMap: () =>
      this.get<{
        floors: Array<{
          floor: number;
          rooms: Array<{
            id: string;
            number: string;
            floor: number | null;
            section: string | null;
            capacity: number;
            daily_price_uzs: number | null;
            status: string;
            type: string | null;
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
          }>;
        }>;
      }>('/api/v1/inpatient/room-map'),
    admit: (body: {
      patient_id: string;
      room_id?: string;
      bed_no?: string;
      tariff_id?: string;
      attending_doctor_id?: string;
      admission_reason?: string;
      meal_plan?: string;
      planned_discharge_at?: string;
      referral_id?: string;
      initial_deposit_uzs?: number;
    }) => this.post<unknown>('/api/v1/inpatient/admit', body),
    transfer: (id: string, body: { room_id: string; bed_no?: string; reason?: string }) =>
      this.patch<unknown>(`/api/v1/inpatient/${id}/transfer`, body),
    discharge: (id: string, summary?: string) =>
      this.patch<unknown>(`/api/v1/inpatient/${id}/discharge`, { summary }),
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
    }) => this.post<unknown>('/api/v1/inpatient/ledger', body),
  };

  subscription = {
    current: () => this.get<unknown>('/api/v1/subscription/current'),
    plans: () => this.get<unknown[]>('/api/v1/subscription/plans'),
    checkout: (body: { plan_code: string; email: string }) => this.post<{ url: string }>('/api/v1/subscription/checkout', body),
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
    checkout: (body: {
      patient: Record<string, unknown>;
      doctor_id?: string | null;
      items: Array<{ service_id: string; quantity: number; unit_price_uzs?: number; discount_uzs?: number }>;
      payment_method: string;
      paid_amount_uzs: number;
      debt_uzs?: number;
      notes?: string;
      add_to_queue?: boolean;
      shift_id?: string | null;
      provider_reference?: string;
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
      }>('/api/v1/reception/checkout', body),
  };

  doctors = {
    list: () =>
      this.get<Array<{ id: string; full_name: string; role: string; phone?: string; avatar_url?: string }>>(
        '/api/v1/doctors',
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

  shifts = {
    active: () =>
      this.get<{ id: string; opened_at: string; operator?: { id: string; full_name: string; role: string } } | null>(
        '/api/v1/shifts/active',
      ),
    list: (params?: { from?: string; to?: string }) =>
      this.get<unknown[]>(`/api/v1/shifts?${new URLSearchParams(params as Record<string, string>).toString()}`),
    open: (body: {
      operator_id: string;
      schedule_id?: string;
      pin: string;
      opening_cash_uzs?: number;
      opened_via?: string;
    }) => this.post<{ id: string }>('/api/v1/shifts/open', body),
    close: (id: string, body: { actual_cash_uzs: number; closing_notes?: string }) =>
      this.patch<unknown>(`/api/v1/shifts/${id}/close`, body),
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
      test_ids: string[];
      urgency?: 'routine' | 'urgent' | 'stat';
      clinical_notes?: string;
      appointment_id?: string;
      stay_id?: string;
      referral_id?: string;
      notify_sms?: boolean;
    }) => this.post<unknown>('/api/v1/lab/orders', body),
    collect: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/collect`),
    start: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/start`),
    complete: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/complete`),
    report: (id: string) => this.patch<unknown>(`/api/v1/lab/orders/${id}/report`),
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
    }) => this.post<unknown>('/api/v1/lab/results', body),
  };

  notifications = {
    outbox: (status?: string) =>
      this.get<unknown[]>(`/api/v1/notifications/outbox${status ? `?status=${status}` : ''}`),
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
    pay: (id: string, body: { method: string; reference?: string }) =>
      this.post<unknown>(`/api/v1/payroll/payouts/${id}/pay`, body),
    cancel: (id: string) => this.post<unknown>(`/api/v1/payroll/payouts/${id}/cancel`, {}),
    accrue: (transaction_id: string) =>
      this.post<unknown>('/api/v1/payroll/accrue', { transaction_id }),
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
    invite: (body: {
      email: string;
      full_name: string;
      phone?: string;
      role: string;
      locale?: string;
      permissions_override?: Record<string, boolean>;
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
    inpatientShare: () =>
      this.get<
        Array<{
          room_id: string;
          room_number: string;
          room_type: string | null;
          current_stays: number;
          revenue_uzs: number;
        }>
      >('/api/v1/analytics/inpatient-share'),
  };

  cashier = {
    kpis: () =>
      this.get<{
        today: number;
        yesterday: number;
        month_revenue: number;
        month_expenses: number;
        month_profit: number;
        by_payment_method_today: Record<string, number>;
        open_shifts: number;
      }>('/api/v1/cashier/kpis'),
    transactions: (params?: { from?: string; to?: string; method?: string; kind?: string }) =>
      this.get<unknown[]>(
        `/api/v1/cashier/transactions?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    expenses: (params?: { from?: string; to?: string; category?: string }) =>
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
    }) => this.post<unknown>('/api/v1/cashier/expenses', body),
    voidExpense: (id: string) => this.patch<unknown>(`/api/v1/cashier/expenses/${id}/void`),
    shiftBreakdown: (id: string) =>
      this.get<Record<string, { in: number; out: number; net: number }>>(
        `/api/v1/cashier/shifts/${id}/breakdown`,
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
        };
        low_stock: Array<{ medication_id: string; name: string; qty_in_stock: number; reorder_level: number | null }>;
        expiring: Array<{
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
        }>
      >(`/api/v1/pharmacy/medications/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    listSales: (params?: { from?: string; to?: string; patient_id?: string }) =>
      this.get<unknown[]>(
        `/api/v1/pharmacy/sales?${new URLSearchParams(params as Record<string, string>).toString()}`,
      ),
    getSale: (id: string) => this.get<unknown>(`/api/v1/pharmacy/sales/${id}`),
    createSale: (body: {
      patient_id?: string;
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
    receipt: (body: {
      supplier_id?: string;
      receipt_no?: string;
      received_at?: string;
      notes?: string;
      items: Array<{
        medication_id: string;
        quantity: number;
        unit_cost_uzs: number;
        batch_no?: string;
        expiry_date?: string;
        unit_price_uzs?: number;
      }>;
    }) => this.post<unknown>('/api/v1/pharmacy/receipts', body),
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
    listTenants: (q?: string) =>
      this.get<Array<{
        id: string;
        name: string;
        slug: string;
        is_suspended: boolean;
        created_at: string;
      }>>(`/api/v1/admin/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`),
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
  };
}

export function createClient(opts: ClaryApiClientOptions) {
  return new ClaryApiClient(opts);
}
