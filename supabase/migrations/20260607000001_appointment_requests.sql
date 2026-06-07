-- Bemor (portal_user) navbat so'rovi: klinika + shifokor + qulay vaqt → klinika tasdiqlaydi.
-- Slotsiz "so'rov-model": online_queue_slots bo'sh va klinika slot yaratolmaydi.
-- (Bu jadval avval MCP orqali prod DB'ga qo'llangan; repo izchilligi uchun fayl.)

CREATE TABLE IF NOT EXISTS public.appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  portal_user_id uuid NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  patient_name_snapshot text NOT NULL,
  patient_phone_snapshot text NOT NULL,
  preferred_at timestamptz,
  preferred_note text,
  reason text,
  status text NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected | canceled | completed
  response_note text,
  scheduled_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid,
  canceled_at timestamptz,
  canceled_by text, -- 'patient' | 'clinic'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appt_requests_portal_user ON public.appointment_requests(portal_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appt_requests_clinic ON public.appointment_requests(clinic_id, status, created_at DESC);

ALTER TABLE public.appointment_requests ENABLE ROW LEVEL SECURITY;

-- Patient-portal/clinic xizmatlari service-role (admin) bilan ishlaydi → RLS bypass.
-- Klinika xodimlari uchun o'z klinikasini ko'rish siyosati:
DROP POLICY IF EXISTS appt_requests_clinic_select ON public.appointment_requests;
CREATE POLICY appt_requests_clinic_select ON public.appointment_requests
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid);
