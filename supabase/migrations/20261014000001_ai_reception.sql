-- =============================================================================
-- AI QABULXONA + NAVBAT DVIGATELI (telefon · Telegram · qabulxona)
-- =============================================================================
-- Klinika raqamiga qo'ng'iroq → (javob bo'lmasa pereadresatsiya) → AI liniya →
-- AI shifokor jadvaliga qarab navbat beradi. Xuddi shu dvigatel Telegram bot va
-- qabulxona "qo'lda yozish" uchun ham ishlaydi.
--
--   A) doctor_booking_profiles — shifokorning navbat profili: navbat ochiqmi,
--      toifa (oliy/1/2), ilmiy daraja (PhD/DSc), unvon (dotsent/professor),
--      tajriba, slot davomiyligi, AI uchun izoh, asosiy xizmat (narx)
--   B) doctor_schedule_rules   — haftalik jadval (kun × vaqt × sig'im)
--   C) doctor_time_off         — ta'til / kasallik / bo'sh emas oraliqlar
--   D) appointments            — source (kim yozdi), ai_call_id, bemor tasdig'i
--   E) ai_reception_settings   — klinika sozlamasi (rejim, salomlashuv, eslatma...)
--   F) ai_phone_lines          — AI liniyalari (GoIP SIM / SIP DID) → klinika
--   G) ai_calls                — har qo'ng'iroq/suhbat: transkript, natija, xarajat
--   H) call-recordings         — yozuvlar (private bucket)
--   I) booking_reserve()       — navbatni ATOMIK band qilish (ikki marta yozilmaydi)
--
-- NEGA staff_profiles'ga ustun qo'shilmadi: anketa formasi (create/update) zod
-- sxemani to'g'ridan-to'g'ri insert qiladi — migratsiyasiz deploy bo'lsa BUTUN
-- xodimlar anketasi yiqilardi. Alohida jadval → faqat yangi funksiya ta'sirlanadi.
--
-- Hammasi idempotent (IF NOT EXISTS) — qayta ishga tushirish xavfsiz.
-- Jadvallar RLS yoqilgan, policy YO'Q — faqat API (service_role).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Shifokor navbat profili
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctor_booking_profiles (
  staff_id          uuid PRIMARY KEY REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  clinic_id         uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  booking_enabled   boolean NOT NULL DEFAULT false,
  medical_category  text,
  academic_degree   text,
  academic_title    text,
  experience_years  smallint,
  slot_minutes      smallint NOT NULL DEFAULT 30,
  -- Qo'shimcha kalit so'zlar (AI va qidiruv uchun): "UZI", "bolalar", "homiladorlik"
  keywords          text[] NOT NULL DEFAULT '{}',
  -- AI bemorga aytadigan izoh: "faqat kattalar", "3 yoshdan katta bolalar"
  public_note       text,
  -- Asosiy qabul xizmati — narx va xizmat nomi shu yerdan olinadi
  service_id        uuid REFERENCES public.services(id) ON DELETE SET NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT dbp_category_chk CHECK (
    medical_category IS NULL OR medical_category IN ('highest', 'first', 'second', 'none')),
  CONSTRAINT dbp_degree_chk CHECK (academic_degree IS NULL OR academic_degree IN ('phd', 'dsc')),
  CONSTRAINT dbp_title_chk CHECK (academic_title IS NULL OR academic_title IN ('docent', 'professor')),
  CONSTRAINT dbp_experience_chk CHECK (experience_years IS NULL OR experience_years BETWEEN 0 AND 70),
  CONSTRAINT dbp_slot_chk CHECK (slot_minutes BETWEEN 5 AND 240)
);
CREATE INDEX IF NOT EXISTS idx_dbp_clinic_enabled
  ON public.doctor_booking_profiles (clinic_id) WHERE booking_enabled;

COMMENT ON TABLE public.doctor_booking_profiles IS
  'Shifokor navbat profili (AI qabulxona / Telegram / qabulxona). staff_profiles 1-1.';

-- ---------------------------------------------------------------------------
-- B) Haftalik jadval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctor_schedule_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  -- 0 = yakshanba ... 6 = shanba (working_hours bilan bir xil, JS getDay)
  weekday     smallint NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  -- Bir vaqtga necha bemor (jonli navbatli klinikalar uchun > 1)
  capacity    smallint NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dsr_weekday_chk CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT dsr_range_chk CHECK (end_time > start_time),
  CONSTRAINT dsr_capacity_chk CHECK (capacity BETWEEN 1 AND 50)
);
CREATE INDEX IF NOT EXISTS idx_dsr_staff ON public.doctor_schedule_rules (clinic_id, staff_id, weekday);

-- ---------------------------------------------------------------------------
-- C) Ta'til / band oraliqlar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctor_time_off (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dto_range_chk CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_dto_staff ON public.doctor_time_off (clinic_id, staff_id, ends_at);

-- ---------------------------------------------------------------------------
-- D) appointments — kim yozdi, qaysi suhbatdan, bemor tasdiqladimi
-- ---------------------------------------------------------------------------
-- Doimiy DEFAULT bilan ustun qo'shish PG11+ da jadvalni qayta yozmaydi (tez).
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_call_id uuid;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS patient_confirmed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_source_chk') THEN
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_source_chk
      CHECK (source IN ('staff', 'ai_phone', 'telegram', 'ai_chat', 'portal'));
  END IF;
END $$;

-- Oldindan yozilganlar (eslatma, "kelmadi" belgisi, qabulxona ro'yxati)
CREATE INDEX IF NOT EXISTS idx_appointments_booked
  ON public.appointments (clinic_id, scheduled_at)
  WHERE status = 'scheduled';

-- ---------------------------------------------------------------------------
-- E) Klinika sozlamasi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_reception_settings (
  clinic_id              uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  -- off: o'chiq · voicemail: ovozli xabar qoldirish (bepul) · ai: AI suhbat
  mode                   text NOT NULL DEFAULT 'off',
  -- Ish vaqtidan tashqari: same (yuqoridagi rejim) · voicemail
  after_hours_mode       text NOT NULL DEFAULT 'same',
  -- Premium: AI rejimini faqat super admin yoqadi (klinika o'zi yoqa olmaydi)
  ai_allowed             boolean NOT NULL DEFAULT false,
  -- Oylik AI qo'ng'iroqlar chegarasi (0 = cheksiz). Oshsa — ovozli xabar rejimi.
  monthly_call_limit     integer NOT NULL DEFAULT 0,
  assistant_name         text NOT NULL DEFAULT 'Malika',
  greeting               text,
  voicemail_prompt       text,
  russian_hint           boolean NOT NULL DEFAULT true,
  voice                  text,
  speech_speed           numeric(3, 2) NOT NULL DEFAULT 1.0,
  booking_horizon_days   smallint NOT NULL DEFAULT 14,
  min_lead_minutes       smallint NOT NULL DEFAULT 60,
  allow_new_patients     boolean NOT NULL DEFAULT true,
  -- Odamga ulash raqami. DIQQAT: pereadresatsiya qilinayotgan asosiy raqam
  -- BO'LMASIN (javob bo'lmasa yana AI'ga qaytadi — aylanib qoladi).
  transfer_phone         text,
  -- Klinikaga xos qo'shimcha ma'lumot (mo'ljal, parkovka, to'lov turlari...)
  extra_instructions     text,
  record_calls           boolean NOT NULL DEFAULT true,
  max_call_seconds       smallint NOT NULL DEFAULT 300,
  notify_owner_telegram  boolean NOT NULL DEFAULT true,
  telegram_ai_chat       boolean NOT NULL DEFAULT true,
  confirm_telegram       boolean NOT NULL DEFAULT true,
  confirm_sms            boolean NOT NULL DEFAULT false,
  reminder_enabled       boolean NOT NULL DEFAULT true,
  -- Eslatma qabul kunidan BIR KUN OLDIN shu soatda (mahalliy) yuboriladi
  reminder_hour          smallint NOT NULL DEFAULT 18,
  reminder_sms           boolean NOT NULL DEFAULT false,
  -- Kelmagan (AI/Telegram yozgan) qabullar tunda "kelmadi" bo'ladi
  mark_no_show           boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,
  CONSTRAINT ars_mode_chk CHECK (mode IN ('off', 'voicemail', 'ai')),
  CONSTRAINT ars_after_hours_chk CHECK (after_hours_mode IN ('same', 'voicemail')),
  CONSTRAINT ars_limit_chk CHECK (monthly_call_limit >= 0),
  CONSTRAINT ars_speed_chk CHECK (speech_speed BETWEEN 0.5 AND 2.0),
  CONSTRAINT ars_horizon_chk CHECK (booking_horizon_days BETWEEN 1 AND 90),
  CONSTRAINT ars_lead_chk CHECK (min_lead_minutes BETWEEN 0 AND 1440),
  CONSTRAINT ars_max_call_chk CHECK (max_call_seconds BETWEEN 60 AND 1200),
  CONSTRAINT ars_reminder_hour_chk CHECK (reminder_hour BETWEEN 6 AND 22)
);

-- ---------------------------------------------------------------------------
-- F) AI liniyalari — qaysi liniya qaysi klinikaniki
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_phone_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  -- Asterisk endpoint nomi (goip1, goip2 ...) YOKI DID raqamning oxirgi 9 raqami
  line_key        text NOT NULL,
  -- AI liniyasining raqami — klinika raqami SHU raqamga pereadresatsiya qilinadi
  phone_number    text,
  -- Klinikaning bemorlar biladigan asosiy raqami
  forwarded_from  text,
  label           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_phone_lines_key_uniq UNIQUE (line_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_phone_lines_clinic ON public.ai_phone_lines (clinic_id);

-- ---------------------------------------------------------------------------
-- G) Qo'ng'iroqlar / suhbatlar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_calls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  line_id            uuid REFERENCES public.ai_phone_lines(id) ON DELETE SET NULL,
  channel            text NOT NULL DEFAULT 'phone',
  mode               text NOT NULL DEFAULT 'ai',
  status             text NOT NULL DEFAULT 'active',
  -- Asterisk qo'ng'iroq UUID'i yoki Telegram chat_id
  external_id        text,
  caller_phone       text,
  patient_id         uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id     uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  outcome            text,
  needs_callback     boolean NOT NULL DEFAULT false,
  callback_note      text,
  callback_done_at   timestamptz,
  callback_done_by   uuid,
  started_at         timestamptz NOT NULL DEFAULT now(),
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  duration_sec       integer,
  -- [{ role: 'caller'|'agent'|'system', text, at }]
  transcript         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Claude suhbat holati (messages) — faqat API o'qiydi
  llm_state          jsonb,
  summary            text,
  recording_path     text,
  stt_seconds        numeric(10, 2) NOT NULL DEFAULT 0,
  tts_chars          integer NOT NULL DEFAULT 0,
  llm_input_tokens   integer NOT NULL DEFAULT 0,
  llm_output_tokens  integer NOT NULL DEFAULT 0,
  est_cost_uzs       integer NOT NULL DEFAULT 0,
  meta               jsonb NOT NULL DEFAULT '{}'::jsonb,
  error              text,
  CONSTRAINT ai_calls_channel_chk CHECK (channel IN ('phone', 'telegram', 'simulator')),
  CONSTRAINT ai_calls_mode_chk CHECK (mode IN ('ai', 'voicemail', 'reject')),
  CONSTRAINT ai_calls_status_chk CHECK (status IN ('active', 'ended', 'failed')),
  CONSTRAINT ai_calls_outcome_chk CHECK (outcome IS NULL OR outcome IN (
    'booked', 'cancelled', 'info', 'callback', 'transferred', 'voicemail', 'abandoned', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_clinic_started ON public.ai_calls (clinic_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_calls_callback
  ON public.ai_calls (clinic_id, started_at DESC)
  WHERE needs_callback AND callback_done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_calls_external ON public.ai_calls (external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_calls_active ON public.ai_calls (last_activity_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- H) Qo'ng'iroq yozuvlari — private bucket (faqat API imzolangan havola beradi)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('call-recordings', 'call-recordings', false, 20971520,
        ARRAY['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS: yoqilgan, policy YO'Q → faqat service_role (API)
-- ---------------------------------------------------------------------------
ALTER TABLE public.doctor_booking_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_schedule_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_time_off         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reception_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_phone_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_calls                ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.doctor_booking_profiles FROM anon, authenticated;
REVOKE ALL ON public.doctor_schedule_rules   FROM anon, authenticated;
REVOKE ALL ON public.doctor_time_off         FROM anon, authenticated;
REVOKE ALL ON public.ai_reception_settings   FROM anon, authenticated;
REVOKE ALL ON public.ai_phone_lines          FROM anon, authenticated;
REVOKE ALL ON public.ai_calls                FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- I) Navbatni atomik band qilish
-- ---------------------------------------------------------------------------
-- Bir shifokorga parallel yozish (AI telefon + Telegram + qabulxona) — advisory
-- lock bilan ketma-ket. Band bo'lsa 'SLOT_TAKEN', shu bemor shu kuni shu
-- shifokorga allaqachon yozilgan bo'lsa 'ALREADY_BOOKED', o'tgan vaqt —
-- 'SLOT_IN_PAST' (hammasi ERRCODE P0001, matn API'da tarjima qilinadi).
-- Jadvalga moslik (ish vaqti, ta'til) API'da tekshiriladi — bu funksiya faqat
-- poyga holatidan (race) himoya qiladi.
CREATE OR REPLACE FUNCTION public.booking_reserve(
  p_clinic_id      uuid,
  p_doctor_id      uuid,
  p_patient_id     uuid,
  p_start          timestamptz,
  p_minutes        integer,
  p_capacity       integer,
  p_source         text,
  p_created_by     uuid,
  p_service_id     uuid DEFAULT NULL,
  p_service_name   text DEFAULT NULL,
  p_service_price  bigint DEFAULT NULL,
  p_reason         text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_call_id        uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_minutes integer := GREATEST(5, LEAST(COALESCE(p_minutes, 30), 480));
  v_taken   integer;
  v_id      uuid;
BEGIN
  IF p_start <= now() THEN
    RAISE EXCEPTION 'SLOT_IN_PAST' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || p_doctor_id::text, 0));

  SELECT count(*) INTO v_taken
    FROM public.appointments a
   WHERE a.clinic_id = p_clinic_id
     AND a.doctor_id = p_doctor_id
     AND a.status IN ('scheduled', 'checked_in', 'in_progress')
     AND a.scheduled_at < p_start + make_interval(mins => v_minutes)
     AND a.scheduled_at + make_interval(mins => COALESCE(a.duration_min, 30)) > p_start;
  IF v_taken >= GREATEST(COALESCE(p_capacity, 1), 1) THEN
    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments a
     WHERE a.clinic_id = p_clinic_id
       AND a.doctor_id = p_doctor_id
       AND a.patient_id = p_patient_id
       AND a.status = 'scheduled'
       AND (a.scheduled_at AT TIME ZONE 'Asia/Tashkent')::date
           = (p_start AT TIME ZONE 'Asia/Tashkent')::date
  ) THEN
    RAISE EXCEPTION 'ALREADY_BOOKED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.appointments (
    clinic_id, patient_id, doctor_id, service_id, scheduled_at, duration_min, status,
    service_name_snapshot, service_price_snapshot, reason, notes, created_by, source, ai_call_id
  ) VALUES (
    p_clinic_id, p_patient_id, p_doctor_id, p_service_id, p_start, v_minutes, 'scheduled',
    p_service_name, p_service_price, p_reason, p_notes, p_created_by,
    COALESCE(p_source, 'staff'), p_call_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.booking_reserve(
  uuid, uuid, uuid, timestamptz, integer, integer, text, uuid, uuid, text, bigint, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_reserve(
  uuid, uuid, uuid, timestamptz, integer, integer, text, uuid, uuid, text, bigint, text, text, uuid
) TO service_role;

NOTIFY pgrst, 'reload schema';
