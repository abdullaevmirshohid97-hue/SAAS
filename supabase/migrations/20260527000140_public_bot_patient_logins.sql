-- Bemor login akkauntlari (clinic admin tomonidan yaratiladi)
CREATE TABLE IF NOT EXISTS public.patient_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  username text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  UNIQUE (clinic_id, username)
);

CREATE INDEX IF NOT EXISTS idx_patient_logins_patient ON public.patient_logins(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_logins_clinic ON public.patient_logins(clinic_id);

ALTER TABLE public.patient_logins ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_patient_logins_tenant ON public.patient_logins
  FOR ALL
  USING (clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin');

-- Umumiy bot uchun chat sessions (state machine)
CREATE TABLE IF NOT EXISTS public.public_bot_sessions (
  telegram_chat_id bigint PRIMARY KEY,
  patient_login_id uuid REFERENCES public.patient_logins(id) ON DELETE SET NULL,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'idle'
    CHECK (state IN ('idle','awaiting_clinic_choice','awaiting_username','awaiting_password','authenticated','banned')),
  search_query text,
  selected_clinic_id uuid,
  pending_username text,
  attempt_count int NOT NULL DEFAULT 0,
  banned_until timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_bot_sessions ENABLE ROW LEVEL SECURITY;
-- Faqat service_role kira oladi (webhook backend orqali ishlaydi)

-- Magic link tokenlari (5 min TTL)
CREATE TABLE IF NOT EXISTS public.patient_magic_tokens (
  token text PRIMARY KEY,
  patient_login_id uuid NOT NULL REFERENCES public.patient_logins(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_expires ON public.patient_magic_tokens(expires_at);

ALTER TABLE public.patient_magic_tokens ENABLE ROW LEVEL SECURITY;
-- Faqat service_role kira oladi
