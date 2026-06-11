-- ============================================================================
-- Clary Hisobot Bot — klinika egalari uchun Telegram hisobot tizimi.
--   telegram_owner_requests — markaziy botdan ro'yxatdan o'tish so'rovlari
--   telegram_report_bots    — har klinikaning hisobot boti (bemor botidan alohida)
--   telegram_owner_chats    — hisobot botga bog'langan ega chatlari
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Markaziy botdan kelgan ro'yxat so'rovlari (super-admin tasdiqlaydi)
CREATE TABLE IF NOT EXISTS public.telegram_owner_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id bigint NOT NULL,
  telegram_username text,
  full_name text,
  phone text,
  clinic_name text,
  message text,
  -- draft: /start bosgan, hali klinika ma'lumotini yubormagan (conversation state)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Bitta chat uchun bitta ochiq so'rov (draft/pending) — upsert kaliti
CREATE UNIQUE INDEX IF NOT EXISTS uq_tg_owner_requests_open_chat
  ON public.telegram_owner_requests (telegram_chat_id)
  WHERE status IN ('draft', 'pending');
CREATE INDEX IF NOT EXISTS idx_tg_owner_requests_status
  ON public.telegram_owner_requests (status, created_at DESC);

-- 2) Hisobot bot — har klinika uchun bitta (super-admin token beradi)
CREATE TABLE IF NOT EXISTS public.telegram_report_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  bot_token text NOT NULL,
  bot_username text NOT NULL,
  webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  bind_code text,
  bind_code_expires_at timestamptz,
  -- Qaysi hodisalar haqida xabar yuborilsin (clinic app'da toggle)
  events jsonb NOT NULL DEFAULT '{"shift": true, "encash": true, "expense": true, "refund": true, "safe": true}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Hisobot botga bog'langan ega chatlari (bir klinikada bir nechta ega bo'lishi mumkin)
CREATE TABLE IF NOT EXISTS public.telegram_owner_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  username text,
  first_name text,
  is_active boolean NOT NULL DEFAULT true,
  bound_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_owner_chats_clinic
  ON public.telegram_owner_chats (clinic_id) WHERE is_active;

-- RLS — barcha amallar API service_role orqali; tenant o'qishi uchun policy
ALTER TABLE public.telegram_owner_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_report_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_owner_chats ENABLE ROW LEVEL SECURITY;
