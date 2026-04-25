-- =============================================================================
-- Clary v2 — Migration 001020: Home-nurse service
-- Patients (via portal) request a nurse to come to their address.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- home_nurse_tariffs — per-clinic pricing for home nurse services
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS home_nurse_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN (
    'injection','iv_drip','dressing','wound_care','vitals','elderly_care','post_op_care','pediatric_care','other'
  )),
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_uzs BIGINT NOT NULL,
  per_km_uzs BIGINT NOT NULL DEFAULT 0,
  urgent_bonus_uzs BIGINT NOT NULL DEFAULT 0,
  night_bonus_uzs BIGINT NOT NULL DEFAULT 0,
  weekend_bonus_uzs BIGINT NOT NULL DEFAULT 0,
  min_km INT NOT NULL DEFAULT 0,
  max_km INT NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1,
  UNIQUE (clinic_id, service)
);

CREATE INDEX IF NOT EXISTS idx_hn_tariff_clinic ON home_nurse_tariffs(clinic_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS tg_hn_tariff_updated ON home_nurse_tariffs;
CREATE TRIGGER tg_hn_tariff_updated BEFORE UPDATE ON home_nurse_tariffs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE home_nurse_tariffs ENABLE ROW LEVEL SECURITY;

-- Public (portal users) can read active tariffs to pick a clinic
DROP POLICY IF EXISTS p_hn_tariff_public_read ON home_nurse_tariffs;
CREATE POLICY p_hn_tariff_public_read ON home_nurse_tariffs
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS p_hn_tariff_tenant_write ON home_nurse_tariffs;
CREATE POLICY p_hn_tariff_tenant_write ON home_nurse_tariffs
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- home_nurse_requests — patient sends a request, clinic accepts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS home_nurse_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  tariff_id UUID REFERENCES home_nurse_tariffs(id) ON DELETE SET NULL,
  service TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  address_notes TEXT,
  geo_lat NUMERIC(9,6),
  geo_lng NUMERIC(9,6),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  preferred_at TIMESTAMPTZ,
  is_urgent BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','accepted','assigned','on_the_way','in_progress','completed','canceled','rejected','expired'
  )),
  -- Status timestamps
  accepted_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  canceled_by TEXT CHECK (canceled_by IN ('patient','clinic','system')),
  canceled_reason TEXT,
  -- Estimate snapshot (tariff values at request time)
  estimate_base_uzs BIGINT,
  estimate_distance_km NUMERIC(6,2),
  estimate_total_uzs BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hn_req_patient ON home_nurse_requests(portal_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hn_req_clinic_status ON home_nurse_requests(clinic_id, status, preferred_at);

DROP TRIGGER IF EXISTS tg_hn_req_updated ON home_nurse_requests;
CREATE TRIGGER tg_hn_req_updated BEFORE UPDATE ON home_nurse_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE home_nurse_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_hn_req_access ON home_nurse_requests;
CREATE POLICY p_hn_req_access ON home_nurse_requests
  FOR ALL
  USING (
    portal_user_id = auth.uid()
    OR clinic_id = public.get_my_clinic_id()
    OR public.get_my_role() = 'super_admin'
  )
  WITH CHECK (
    portal_user_id = auth.uid()
    OR clinic_id = public.get_my_clinic_id()
    OR public.get_my_role() = 'super_admin'
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE home_nurse_requests;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- home_nurse_visits — actual visit carried out by a nurse
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS home_nurse_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES home_nurse_requests(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  nurse_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  dispatched_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_min INT,
  distance_km NUMERIC(6,2),
  addons JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_uzs BIGINT NOT NULL DEFAULT 0,
  distance_uzs BIGINT NOT NULL DEFAULT 0,
  addons_uzs BIGINT NOT NULL DEFAULT 0,
  total_uzs BIGINT NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded','canceled')),
  transaction_id UUID REFERENCES transactions(id),
  nurse_notes TEXT,
  patient_rating INT CHECK (patient_rating BETWEEN 1 AND 5),
  patient_feedback TEXT,
  -- GPS breadcrumbs for safety/audit
  gps_trace JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hn_visit_clinic ON home_nurse_visits(clinic_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hn_visit_nurse ON home_nurse_visits(nurse_id, started_at DESC);

DROP TRIGGER IF EXISTS tg_hn_visit_updated ON home_nurse_visits;
CREATE TRIGGER tg_hn_visit_updated BEFORE UPDATE ON home_nurse_visits
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE home_nurse_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_hn_visit_tenant ON home_nurse_visits;
CREATE POLICY p_hn_visit_tenant ON home_nurse_visits
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- Patient can SELECT their own visits via request ownership
DROP POLICY IF EXISTS p_hn_visit_patient_read ON home_nurse_visits;
CREATE POLICY p_hn_visit_patient_read ON home_nurse_visits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM home_nurse_requests r
      WHERE r.id = home_nurse_visits.request_id
        AND r.portal_user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Haversine distance helper (km) — pure SQL, no PostGIS dependency
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE
      6371 * 2 * asin(sqrt(
        sin(radians((lat2 - lat1) / 2)) * sin(radians((lat2 - lat1) / 2))
        + cos(radians(lat1)) * cos(radians(lat2))
        * sin(radians((lng2 - lng1) / 2)) * sin(radians((lng2 - lng1) / 2))
      ))::NUMERIC(9,3)
  END;
$$;

COMMENT ON TABLE home_nurse_tariffs IS 'Per-clinic pricing for home-nurse services';
COMMENT ON TABLE home_nurse_requests IS 'Patient requests for a home-nurse visit (portal)';
COMMENT ON TABLE home_nurse_visits IS 'Actual nurse visits with billing snapshot';
