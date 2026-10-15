-- =============================================================================
-- CLARY BULUTLI ATS — har klinikaning IP-telefoniyasi (Uztelecom SIP) Clary'da
-- =============================================================================
-- Klinika raqami (Uztelecom IP-telefoniya) to'g'ridan-to'g'ri Clary serveridagi
-- Asterisk'ga ulanadi. Kiruvchi qo'ng'iroq qabulxonadagi IP telefon VA Clary
-- ilovasidagi (brauzer/desktop) softfonda birdan jiringlaydi; hech kim olmasa —
-- AI qabulxona. Chiquvchi — bemor kartasidan bir bosishda (klinika raqami bilan).
--
--   A) pbx_tenants     — klinika ATS sozlamasi: SIP trunk (Uztelecom login/parol),
--                        raqam (DID), jiringlash vaqti, ish vaqtidan tashqari
--   B) pbx_extensions  — ichki raqamlar (101, 102...): stol telefoni uchun va
--                        Clary softfoni (WebRTC) uchun alohida SIP akkaunt
--   C) pbx_calls       — BARCHA qo'ng'iroqlar jurnali (kim olgan, o'tkazib
--                        yuborilgan, AI olgan, yozuv)
--
-- Asterisk sozlamasi qo'lda yozilmaydi: voice-agent shu jadvallardan API orqali
-- oladi va /etc/asterisk/*_clary.conf ni generatsiya qiladi.
-- Parollar: jadvallar RLS yoqilgan, policy YO'Q (faqat service_role), anon/
-- authenticated'dan REVOKE — staff_credentials bilan bir xil himoya darajasi.
-- Idempotent (IF NOT EXISTS).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Klinika ATS sozlamasi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pbx_tenants (
  clinic_id         uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  -- Asterisk ichidagi qisqa nom (endpoint/kontekst nomlari): magnus, shifo2 ...
  code              text NOT NULL,
  enabled           boolean NOT NULL DEFAULT false,
  provider          text NOT NULL DEFAULT 'uztelecom',
  trunk_host        text,
  trunk_port        integer NOT NULL DEFAULT 5060,
  trunk_transport   text NOT NULL DEFAULT 'udp',
  trunk_username    text,
  trunk_password    text,
  -- Ba'zi operatorlar From domenini serverdan boshqa qilib talab qiladi
  trunk_from_domain text,
  -- Klinika raqami (bemorlar biladigan) — chiquvchi qo'ng'iroqda shu ko'rinadi
  did               text,
  -- Operator raqamni qanday kutadi: e164 (+998..) | digits12 (998..) | local9 (90..)
  dial_format       text NOT NULL DEFAULT 'digits12',
  -- Shuncha soniya hech kim olmasa — AI (yoki AI o'chiq bo'lsa yana jiringlaydi)
  ring_timeout_sec  smallint NOT NULL DEFAULT 20,
  -- Ish vaqtidan tashqari: ring (baribir jiringlaydi) | ai (darhol javob: AI yoki ovozli xabar)
  after_hours       text NOT NULL DEFAULT 'ai',
  -- Hech kim olmasa: voicemail (ovozli xabar — bepul, uchinchi tomonsiz) |
  -- ai (AI qabulxona, yoqilgan bo'lsa) | message ("keyinroq qo'ng'iroq qiling")
  no_answer         text NOT NULL DEFAULT 'voicemail',
  -- Bir vaqtdagi chiquvchi qo'ng'iroqlar chegarasi (firibgarlikdan himoya)
  max_outbound      smallint NOT NULL DEFAULT 4,
  -- voice-agent xabar qiladi: Registered | Unregistered | Rejected | ...
  trunk_status      text,
  trunk_status_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT pbx_tenants_code_uniq UNIQUE (code),
  CONSTRAINT pbx_tenants_code_chk CHECK (code ~ '^[a-z][a-z0-9]{2,15}$'),
  CONSTRAINT pbx_tenants_transport_chk CHECK (trunk_transport IN ('udp', 'tcp')),
  CONSTRAINT pbx_tenants_port_chk CHECK (trunk_port BETWEEN 1 AND 65535),
  CONSTRAINT pbx_tenants_format_chk CHECK (dial_format IN ('e164', 'digits12', 'local9')),
  CONSTRAINT pbx_tenants_ring_chk CHECK (ring_timeout_sec BETWEEN 5 AND 120),
  CONSTRAINT pbx_tenants_after_chk CHECK (after_hours IN ('ring', 'ai')),
  CONSTRAINT pbx_tenants_noanswer_chk CHECK (no_answer IN ('voicemail', 'ai', 'message')),
  CONSTRAINT pbx_tenants_maxout_chk CHECK (max_outbound BETWEEN 1 AND 50)
);
-- Oldingi tahrir bilan yaratilgan bo'lsa
ALTER TABLE public.pbx_tenants ADD COLUMN IF NOT EXISTS no_answer text NOT NULL DEFAULT 'voicemail'
  CHECK (no_answer IN ('voicemail', 'ai', 'message'));
-- Bitta raqam faqat bitta klinikada (boshqa klinika raqamini "o'ziniki" qila olmasin)
CREATE UNIQUE INDEX IF NOT EXISTS pbx_tenants_did_uniq
  ON public.pbx_tenants (did) WHERE did IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B) Ichki raqamlar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pbx_extensions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  -- Ichki raqam: 201 ... 899 (1XX — favqulodda raqamlar: 101–104, 112 tashqariga chiqadi)
  ext             text NOT NULL,
  label           text NOT NULL,
  -- Kimga biriktirilgan (shu foydalanuvchining Clary softfoni shu raqam bilan)
  profile_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Stol IP telefoni / Zoiper uchun (UDP/TCP)
  phone_username  text NOT NULL,
  phone_password  text NOT NULL,
  -- Clary softfoni (brauzer/desktop, WebRTC) uchun
  web_username    text NOT NULL,
  web_password    text NOT NULL,
  -- Kiruvchi qo'ng'iroqda jiringlasinmi
  in_ring_group   boolean NOT NULL DEFAULT true,
  -- Tashqariga qo'ng'iroq qila oladimi
  can_call_out    boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  -- voice-agent xabar qiladi: online | offline
  phone_status    text,
  web_status      text,
  status_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pbx_extensions_ext_chk CHECK (ext ~ '^[2-8][0-9]{2}$'),
  CONSTRAINT pbx_extensions_ext_uniq UNIQUE (clinic_id, ext),
  CONSTRAINT pbx_extensions_phone_user_uniq UNIQUE (phone_username),
  CONSTRAINT pbx_extensions_web_user_uniq UNIQUE (web_username)
);
CREATE INDEX IF NOT EXISTS idx_pbx_extensions_clinic ON public.pbx_extensions (clinic_id);
CREATE INDEX IF NOT EXISTS idx_pbx_extensions_profile
  ON public.pbx_extensions (profile_id) WHERE profile_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C) Qo'ng'iroqlar jurnali (inson ham, AI ham)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pbx_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  -- Dialplan CALL_UUID — AI olgan bo'lsa ai_calls.external_id bilan bir xil
  uuid              text NOT NULL,
  direction         text NOT NULL,
  status            text NOT NULL,
  from_number       text,
  to_number         text,
  extension_id      uuid REFERENCES public.pbx_extensions(id) ON DELETE SET NULL,
  patient_id        uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  ai_call_id        uuid REFERENCES public.ai_calls(id) ON DELETE SET NULL,
  started_at        timestamptz NOT NULL,
  answered_sec      integer,
  duration_sec      integer,
  recording_path    text,
  -- Ovozli xabar matni (o'zimizning STT serveri sozlangan bo'lsa)
  transcript        text,
  needs_callback    boolean NOT NULL DEFAULT false,
  callback_done_at  timestamptz,
  callback_done_by  uuid,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pbx_calls_uuid_uniq UNIQUE (uuid),
  CONSTRAINT pbx_calls_direction_chk CHECK (direction IN ('in', 'out', 'internal')),
  -- voicemail — hech kim olmadi, bemor ovozli xabar qoldirdi (Asterisk Record, AI'siz)
  CONSTRAINT pbx_calls_status_chk
    CHECK (status IN ('answered', 'missed', 'ai', 'voicemail', 'busy', 'failed'))
);
-- Jadval shu migratsiyaning oldingi tahriri bilan yaratilgan bo'lsa ham mos kelsin
ALTER TABLE public.pbx_calls ADD COLUMN IF NOT EXISTS transcript text;
ALTER TABLE public.pbx_calls DROP CONSTRAINT IF EXISTS pbx_calls_status_chk;
ALTER TABLE public.pbx_calls ADD CONSTRAINT pbx_calls_status_chk
  CHECK (status IN ('answered', 'missed', 'ai', 'voicemail', 'busy', 'failed'));
CREATE INDEX IF NOT EXISTS idx_pbx_calls_clinic_started ON public.pbx_calls (clinic_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pbx_calls_missed
  ON public.pbx_calls (clinic_id, started_at DESC)
  WHERE needs_callback AND callback_done_at IS NULL;

-- ---------------------------------------------------------------------------
-- Uzun suhbat yozuvlari uchun bucket chegarasi 100 MB (8 kHz WAV ≈ 1 MB/daqiqa)
-- ---------------------------------------------------------------------------
UPDATE storage.buckets SET file_size_limit = 104857600 WHERE id = 'call-recordings';

-- ---------------------------------------------------------------------------
-- RLS: yoqilgan, policy YO'Q → faqat service_role (API)
-- ---------------------------------------------------------------------------
ALTER TABLE public.pbx_tenants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbx_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbx_calls      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pbx_tenants    FROM anon, authenticated;
REVOKE ALL ON public.pbx_extensions FROM anon, authenticated;
REVOKE ALL ON public.pbx_calls      FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
