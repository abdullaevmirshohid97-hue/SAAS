-- =============================================================================
-- Clary Care — Nurse onboarding, request chat, prescription, patient SMS OTP
-- =============================================================================

-- -----------------------------------------------------------------------------
-- nurse_join_requests — nurse signs up via gmail and applies to a clinic
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nurse_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Auth identity (gmail)
  email TEXT NOT NULL,
  auth_user_id UUID,                                  -- supabase auth.users.id once verified
  -- Personal
  full_name TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  experience_years INT,
  about TEXT,
  photo_url TEXT,
  diploma_url TEXT,
  certificate_urls TEXT[] NOT NULL DEFAULT '{}',
  -- Target clinic
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT,
  -- After approval, the staff_profiles.id gets linked here
  staff_profile_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_njr_clinic_status ON nurse_join_requests(clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_njr_email ON nurse_join_requests(email);
CREATE INDEX IF NOT EXISTS idx_njr_auth_user ON nurse_join_requests(auth_user_id);

DROP TRIGGER IF EXISTS tg_njr_updated ON nurse_join_requests;
CREATE TRIGGER tg_njr_updated BEFORE UPDATE ON nurse_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE nurse_join_requests ENABLE ROW LEVEL SECURITY;

-- Nurse can read/insert their own; clinic can read/update theirs
DROP POLICY IF EXISTS p_njr_nurse_self ON nurse_join_requests;
CREATE POLICY p_njr_nurse_self ON nurse_join_requests
  FOR ALL
  USING (auth_user_id = auth.uid() OR clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (auth_user_id = auth.uid() OR clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- home_nurse_requests: prescription_url + assigned_nurse_id (link to staff)
-- -----------------------------------------------------------------------------
ALTER TABLE home_nurse_requests
  ADD COLUMN IF NOT EXISTS prescription_url TEXT,
  ADD COLUMN IF NOT EXISTS prescription_image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_nurse_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sessions_per_day INT NOT NULL DEFAULT 1 CHECK (sessions_per_day BETWEEN 1 AND 6),
  ADD COLUMN IF NOT EXISTS days_count INT NOT NULL DEFAULT 1 CHECK (days_count BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS scheduled_times TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quoted_price_uzs BIGINT;

CREATE INDEX IF NOT EXISTS idx_hn_req_nurse
  ON home_nurse_requests(assigned_nurse_profile_id, status)
  WHERE assigned_nurse_profile_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- home_nurse_request_messages — chat between patient and clinic/nurse
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS home_nurse_request_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES home_nurse_requests(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('patient','clinic','nurse','system')),
  sender_user_id UUID,                                  -- portal_user_id OR profiles.id depending on kind
  body TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{type:'image'|'file', url, name}]
  is_read_by_patient BOOLEAN NOT NULL DEFAULT false,
  is_read_by_clinic BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hnrm_request ON home_nurse_request_messages(request_id, created_at);

ALTER TABLE home_nurse_request_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_hnrm_access ON home_nurse_request_messages;
CREATE POLICY p_hnrm_access ON home_nurse_request_messages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM home_nurse_requests r
      WHERE r.id = home_nurse_request_messages.request_id
        AND (
          r.portal_user_id = auth.uid()
          OR r.clinic_id = public.get_my_clinic_id()
          OR r.assigned_nurse_profile_id = auth.uid()
          OR public.get_my_role() = 'super_admin'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM home_nurse_requests r
      WHERE r.id = home_nurse_request_messages.request_id
        AND (
          r.portal_user_id = auth.uid()
          OR r.clinic_id = public.get_my_clinic_id()
          OR r.assigned_nurse_profile_id = auth.uid()
          OR public.get_my_role() = 'super_admin'
        )
    )
  );

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE home_nurse_request_messages;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $outer$;

-- -----------------------------------------------------------------------------
-- patient_otp_sessions — phone-number SMS OTP for portal_users login
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_otp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,                              -- sha256 of code
  attempts INT NOT NULL DEFAULT 0,
  is_used BOOLEAN NOT NULL DEFAULT false,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_active
  ON patient_otp_sessions(phone, expires_at DESC)
  WHERE is_used = false;

ALTER TABLE patient_otp_sessions ENABLE ROW LEVEL SECURITY;
-- Server-side only (service_role)
DROP POLICY IF EXISTS p_otp_no_access ON patient_otp_sessions;
CREATE POLICY p_otp_no_access ON patient_otp_sessions FOR ALL USING (false) WITH CHECK (false);

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hash_otp(p_code TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(extensions.digest(p_code, 'sha256'), 'hex');
$$;

COMMENT ON TABLE nurse_join_requests IS 'Nurse onboarding — applies to a clinic via Google sign-in';
COMMENT ON TABLE home_nurse_request_messages IS 'Chat thread between patient and clinic for a home-nurse request';
COMMENT ON TABLE patient_otp_sessions IS 'SMS OTP one-time login for patient portal (phone-based)';
