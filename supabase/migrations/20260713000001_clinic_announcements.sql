-- =============================================================================
-- Super-admin "Batafsil": bloklovchi e'lon (announcement) + per-user ack + eslatmalar.
-- clinic_announcements → klinika ilovasida X bosilmaguncha turadigan modal.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.clinic_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  plan_snapshot text,
  amount_uzs bigint,
  pay_date date,
  contact_phone text,
  requires_ack boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_announce_active ON public.clinic_announcements (clinic_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.clinic_announcement_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.clinic_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  acked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.clinic_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  note text NOT NULL,
  is_done boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_reminders ON public.clinic_reminders (clinic_id, created_at DESC);

ALTER TABLE public.clinic_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_announcement_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_reminders ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.clinic_announcements, public.clinic_announcement_acks, public.clinic_reminders FROM anon, authenticated;
