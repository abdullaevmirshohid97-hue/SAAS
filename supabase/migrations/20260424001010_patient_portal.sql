-- =============================================================================
-- Clary v2 — Migration 001010: Patient portal (my.clary.uz)
-- Adds: portal_users (public patient accounts), patient_home_treatments
-- =============================================================================

-- -----------------------------------------------------------------------------
-- portal_users — patient/public accounts (distinct from clinic staff profiles)
-- Linked to auth.users but NOT to any single clinic (clinic_id is NULL).
-- role claim: 'patient'.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT UNIQUE,
  email TEXT,
  full_name TEXT NOT NULL,
  dob DATE,
  gender TEXT CHECK (gender IN ('male','female','other','unknown')),
  address TEXT,
  city TEXT,
  region TEXT,
  country TEXT NOT NULL DEFAULT 'UZ',
  -- Optional geo for "nearest clinic" queries (stored as plain numerics;
  -- PostGIS can be added later without breaking schema)
  geo_lat NUMERIC(9,6),
  geo_lng NUMERIC(9,6),
  geo_consent BOOLEAN NOT NULL DEFAULT false,
  locale TEXT NOT NULL DEFAULT 'uz-Latn',
  theme TEXT NOT NULL DEFAULT 'light',
  marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  notif_push_enabled BOOLEAN NOT NULL DEFAULT true,
  notif_sms_enabled BOOLEAN NOT NULL DEFAULT true,
  notif_email_enabled BOOLEAN NOT NULL DEFAULT true,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  suspension_reason TEXT,
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_portal_users_phone ON portal_users(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_users_geo ON portal_users(geo_lat, geo_lng) WHERE geo_consent = true;

DROP TRIGGER IF EXISTS tg_portal_users_updated ON portal_users;
CREATE TRIGGER tg_portal_users_updated BEFORE UPDATE ON portal_users
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;

-- A portal user can only see/edit their own row; super_admin can see all.
DROP POLICY IF EXISTS p_portal_users_self ON portal_users;
CREATE POLICY p_portal_users_self ON portal_users
  FOR ALL
  USING (id = auth.uid() OR public.get_my_role() = 'super_admin')
  WITH CHECK (id = auth.uid() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- patient_home_treatments — treatments a patient must take at home,
-- prescribed by a clinic. Visible to home-nurses of the SAME clinic.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_home_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Optional link to a portal_user (if the patient has a portal account)
  portal_user_id UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  treatment TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
    'injection','iv_drip','pill','dressing','wound_care','physio','vitals_monitoring','other','general'
  )),
  frequency TEXT NOT NULL, -- e.g. "3x/day", "every 8h"
  dose TEXT,
  instructions TEXT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  prescribed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pht_clinic_patient ON patient_home_treatments(clinic_id, patient_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pht_portal_user ON patient_home_treatments(portal_user_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS tg_pht_updated ON patient_home_treatments;
CREATE TRIGGER tg_pht_updated BEFORE UPDATE ON patient_home_treatments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE patient_home_treatments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pht_tenant ON patient_home_treatments;
CREATE POLICY p_pht_tenant ON patient_home_treatments
  FOR ALL
  USING (
    clinic_id = public.get_my_clinic_id()
    OR public.get_my_role() = 'super_admin'
    OR portal_user_id = auth.uid()
  )
  WITH CHECK (
    clinic_id = public.get_my_clinic_id()
    OR public.get_my_role() = 'super_admin'
  );

COMMENT ON TABLE portal_users IS 'Public patient accounts (my.clary.uz) — free, not clinic-scoped';
COMMENT ON TABLE patient_home_treatments IS 'Prescribed home treatments — visible to same-clinic home nurses';
