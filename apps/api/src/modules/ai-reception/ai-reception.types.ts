import type { ScheduleRule } from '@clary/utils';

// =============================================================================
// AI qabulxona — umumiy turlar
// =============================================================================

export type ReceptionMode = 'off' | 'voicemail' | 'ai';
export type CallChannel = 'phone' | 'telegram' | 'simulator';
export type CallOutcome =
  | 'booked'
  | 'cancelled'
  | 'info'
  | 'callback'
  | 'transferred'
  | 'voicemail'
  | 'abandoned'
  | 'failed';
export type BookingSource = 'staff' | 'ai_phone' | 'telegram' | 'ai_chat' | 'portal';

export interface AiReceptionSettings {
  clinic_id: string;
  mode: ReceptionMode;
  after_hours_mode: 'same' | 'voicemail';
  ai_allowed: boolean;
  monthly_call_limit: number;
  assistant_name: string;
  greeting: string | null;
  voicemail_prompt: string | null;
  russian_hint: boolean;
  voice: string | null;
  speech_speed: number;
  booking_horizon_days: number;
  min_lead_minutes: number;
  allow_new_patients: boolean;
  transfer_phone: string | null;
  extra_instructions: string | null;
  record_calls: boolean;
  max_call_seconds: number;
  notify_owner_telegram: boolean;
  telegram_ai_chat: boolean;
  confirm_telegram: boolean;
  confirm_sms: boolean;
  reminder_enabled: boolean;
  reminder_hour: number;
  reminder_sms: boolean;
  mark_no_show: boolean;
  updated_at: string | null;
}

export const DEFAULT_SETTINGS: Omit<AiReceptionSettings, 'clinic_id'> = {
  mode: 'off',
  after_hours_mode: 'same',
  ai_allowed: false,
  monthly_call_limit: 0,
  assistant_name: 'Malika',
  greeting: null,
  voicemail_prompt: null,
  russian_hint: true,
  voice: null,
  speech_speed: 1,
  booking_horizon_days: 14,
  min_lead_minutes: 60,
  allow_new_patients: true,
  transfer_phone: null,
  extra_instructions: null,
  record_calls: true,
  max_call_seconds: 300,
  notify_owner_telegram: true,
  telegram_ai_chat: true,
  confirm_telegram: true,
  confirm_sms: false,
  reminder_enabled: true,
  reminder_hour: 18,
  reminder_sms: false,
  mark_no_show: true,
  updated_at: null,
};

export interface ClinicContext {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  slug: string | null;
  /** "Du, Se, Ch, Pa, Ju 08:00–18:00; Sh 09:00–14:00" yoki null */
  working_hours_text: string | null;
  /** Ish vaqti qoidalari (hafta kuni bo'yicha) — "ish vaqtidan tashqari" uchun */
  working_hours: ScheduleRule[];
  /** Yopiq sanalar (bayram) — keyingi 120 kun, mahalliy 'YYYY-MM-DD' */
  closed_dates: string[];
}

export interface DoctorRule extends ScheduleRule {
  id?: string;
  capacity: number;
}

export interface DoctorTimeOff {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface DoctorEntry {
  staff_id: string;
  clinic_id: string;
  profile_id: string | null;
  full_name: string;
  position: string;
  specialization: string | null;
  specialty_key: string | null;
  specialty_group: string;
  specialty_label: string;
  photo_url: string | null;
  booking_enabled: boolean;
  medical_category: string | null;
  academic_degree: string | null;
  academic_title: string | null;
  experience_years: number | null;
  slot_minutes: number;
  keywords: string[];
  public_note: string | null;
  service_id: string | null;
  service_name: string | null;
  service_price_uzs: number | null;
  sort_order: number;
  rules: DoctorRule[];
  time_off: DoctorTimeOff[];
  credentials: string;
  schedule_summary: string;
}

export interface BrainTurnResult {
  /** Bemorga aytiladigan/yoziladigan matn */
  say: string;
  /** Javob tili (TTS/STT uchun) */
  lang: 'uz' | 'ru';
  /** Suhbat tugadi (javobdan keyin go'shakni qo'yish) */
  end: boolean;
  action: 'none' | 'transfer' | 'hangup';
  transfer_to: string | null;
  outcome: CallOutcome | null;
  appointment_id: string | null;
}
