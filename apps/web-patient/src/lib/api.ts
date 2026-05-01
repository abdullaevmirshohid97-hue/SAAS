import { supabase } from './supabase';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'API error');
  }
  return res.json() as Promise<T>;
}

// ── Clinics ────────────────────────────────────────────────────────────────

export interface ClinicPublic {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  region: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  primary_color: string;
  organization_type: string;
  is_active: boolean;
}

export interface DoctorPublic {
  id: string;
  full_name: string;
  specialization: string | null;
  photo_url: string | null;
  experience_years: number | null;
}

export interface SlotPublic {
  id: string;
  starts_at: string;
  duration_min: number;
  capacity: number;
  booked_count: number;
  doctor_id: string | null;
  price_snapshot_uzs: number | null;
}

export const clinicsApi = {
  search: (params: { city?: string; query?: string; specialty?: string; page?: number }) =>
    apiFetch<{ data: ClinicPublic[]; total: number }>(
      `/patient/clinics?${new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
      )}`,
    ),

  detail: (slug: string) =>
    apiFetch<ClinicPublic & { doctors: DoctorPublic[] }>(`/patient/clinics/${slug}`),

  slots: (slug: string, params: { from: string; to: string; doctor_id?: string }) =>
    apiFetch<SlotPublic[]>(
      `/patient/clinics/${slug}/slots?${new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
      )}`,
    ),
};

// ── Bookings ───────────────────────────────────────────────────────────────

export interface BookingInput {
  slot_id: string;
  reason?: string;
}

export interface BookingPublic {
  id: string;
  slot_id: string;
  clinic_id: string;
  status: string;
  created_at: string;
  slot: SlotPublic;
  clinic: Pick<ClinicPublic, 'name' | 'slug' | 'logo_url'>;
}

export const bookingsApi = {
  create: (input: BookingInput) =>
    apiFetch<BookingPublic>('/patient/bookings', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  list: () => apiFetch<BookingPublic[]>('/patient/bookings'),

  cancel: (id: string, reason?: string) =>
    apiFetch<BookingPublic>(`/patient/bookings/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

// ── Home-nurse ─────────────────────────────────────────────────────────────

export interface NurseTariff {
  id: string;
  clinic_id: string;
  service: string;
  name_i18n: Record<string, string>;
  base_uzs: number;
  per_km_uzs: number;
  urgent_bonus_uzs: number;
  clinic: Pick<ClinicPublic, 'name' | 'slug' | 'logo_url' | 'city'>;
}

export interface NurseRequestInput {
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
}

export const nurseApi = {
  tariffs: (params?: { city?: string; service?: string }) =>
    apiFetch<NurseTariff[]>(
      `/patient/nurse/tariffs${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`,
    ),

  request: (input: NurseRequestInput) =>
    apiFetch('/patient/nurse/requests', { method: 'POST', body: JSON.stringify(input) }),

  myRequests: () => apiFetch('/patient/nurse/requests/mine'),
};

// ── Queue status ───────────────────────────────────────────────────────────

export interface QueueStatus {
  booking_id: string;
  status: string;
  position: number | null;
  queue_ahead: number;
  estimated_wait_min: number | null;
  slot: SlotPublic;
  clinic: Pick<ClinicPublic, 'name' | 'logo_url'>;
}

export const queueApi = {
  status: (bookingId: string) => apiFetch<QueueStatus>(`/patient/queue/${bookingId}`),
};
