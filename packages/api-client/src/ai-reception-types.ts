// =============================================================================
// AI qabulxona + navbat dvigateli — API turlari (apps/api/src/modules/ai-reception)
// =============================================================================

export type AiReceptionMode = 'off' | 'voicemail' | 'ai';
export type AiCallChannel = 'phone' | 'telegram' | 'simulator';
export type AiCallOutcome =
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
  mode: AiReceptionMode;
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

export type AiReceptionSettingsPatch = Partial<
  Omit<AiReceptionSettings, 'clinic_id' | 'ai_allowed' | 'monthly_call_limit' | 'updated_at'>
>;

export interface AiPhoneLine {
  id: string;
  clinic_id: string;
  line_key: string;
  phone_number: string | null;
  forwarded_from: string | null;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AiReceptionUsage {
  calls: number;
  ai_calls: number;
  minutes: number;
  booked: number;
  cost_uzs: number;
}

export interface AiReceptionOverview {
  settings: AiReceptionSettings;
  ai_effective: boolean;
  lines: AiPhoneLine[];
  usage: AiReceptionUsage;
  model: string;
  clinic: { name: string; phone: string | null; slug: string | null };
  telegram_bot: string | null;
  telegram_link: string | null;
}

export interface BookingRule {
  id?: string;
  weekday: number;
  start_time: string;
  end_time: string;
  capacity: number;
}

export interface BookingTimeOff {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface BookingDoctor {
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
  medical_category: 'highest' | 'first' | 'second' | 'none' | null;
  academic_degree: 'phd' | 'dsc' | null;
  academic_title: 'docent' | 'professor' | null;
  experience_years: number | null;
  slot_minutes: number;
  keywords: string[];
  public_note: string | null;
  service_id: string | null;
  service_name: string | null;
  service_price_uzs: number | null;
  sort_order: number;
  rules: BookingRule[];
  time_off: BookingTimeOff[];
  credentials: string;
  schedule_summary: string;
}

export interface BookingDoctorPatch {
  booking_enabled?: boolean;
  medical_category?: BookingDoctor['medical_category'];
  academic_degree?: BookingDoctor['academic_degree'];
  academic_title?: BookingDoctor['academic_title'];
  experience_years?: number | null;
  slot_minutes?: number;
  keywords?: string[];
  public_note?: string | null;
  service_id?: string | null;
  sort_order?: number;
  rules?: Array<{ weekday: number; start_time: string; end_time: string; capacity?: number }>;
}

export interface BookingSlot {
  start: string;
  end: string;
  date: string;
  time: string;
  capacity: number;
  taken: number;
}

export interface BookedAppointment {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: string;
  source: BookingSource;
  reason: string | null;
  patient_confirmed_at: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  service_name_snapshot: string | null;
  service_price_snapshot: number | null;
  patient: { id: string; full_name: string; phone: string | null } | null;
  doctor: { id: string; full_name: string } | null;
}

export interface AiCallListItem {
  id: string;
  channel: AiCallChannel;
  mode: 'ai' | 'voicemail' | 'reject';
  status: 'active' | 'ended' | 'failed';
  caller_phone: string | null;
  outcome: AiCallOutcome | null;
  needs_callback: boolean;
  callback_note: string | null;
  callback_done_at: string | null;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  est_cost_uzs: number;
  has_recording: boolean;
  patient: { id: string; full_name: string } | null;
  appointment: { id: string; scheduled_at: string; status: string } | null;
}

export interface AiCallDetail extends Omit<AiCallListItem, 'has_recording' | 'patient'> {
  transcript: Array<{ role: 'caller' | 'agent' | 'system'; text: string; at: string }>;
  summary: string | null;
  stt_seconds: number;
  tts_chars: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  meta: Record<string, unknown>;
  error: string | null;
  recording_url: string | null;
  patient: { id: string; full_name: string; phone: string | null } | null;
}

export interface AiCallStats {
  from: string;
  to: string;
  phone_calls: number;
  phone_ai: number;
  phone_voicemail: number;
  telegram_chats: number;
  by_outcome: Record<string, number>;
  avg_duration_sec: number;
  total_minutes: number;
  cost_uzs: number;
  pending_callbacks: number;
  bookings_total: number;
  bookings_by_source: Record<string, number>;
  bookings_no_show: number;
  bookings_canceled: number;
}

export interface AiBrainReply {
  say: string;
  lang: 'uz' | 'ru';
  end: boolean;
  action: 'none' | 'transfer' | 'hangup';
  transfer_to: string | null;
  outcome: AiCallOutcome | null;
  appointment_id: string | null;
}

export interface AdminAiReception {
  settings: AiReceptionSettings;
  usage: AiReceptionUsage;
  lines: AiPhoneLine[];
}
