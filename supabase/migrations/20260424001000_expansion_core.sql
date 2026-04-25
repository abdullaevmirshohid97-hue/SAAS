-- =============================================================================
-- Clary v2 — Migration 001000: Expansion core
-- Adds: diagnostic_equipment (catalog), nurse_tasks, emergency_calls, demo_tenants
-- =============================================================================

-- -----------------------------------------------------------------------------
-- diagnostic_equipment — catalog of equipment per clinic (referenced by
-- diagnostic_orders.equipment_id which already exists as FK placeholder)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnostic_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  category TEXT NOT NULL CHECK (category IN (
    'xray','us','mri','ct','ecg','echo','eeg','emg','endoscopy','mammography',
    'densitometry','spirometry','audiometry','other'
  )),
  service_id UUID REFERENCES services(id),
  diagnostic_type_id UUID REFERENCES diagnostic_types(id),
  model TEXT,
  manufacturer TEXT,
  serial_no TEXT,
  room_id UUID REFERENCES rooms(id),
  price_uzs BIGINT,
  duration_min INT NOT NULL DEFAULT 30,
  preparation_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_diag_equip_clinic ON diagnostic_equipment(clinic_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_diag_equip_category ON diagnostic_equipment(clinic_id, category) WHERE is_active = true;

DROP TRIGGER IF EXISTS tg_diag_equip_updated ON diagnostic_equipment;
CREATE TRIGGER tg_diag_equip_updated BEFORE UPDATE ON diagnostic_equipment
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE diagnostic_equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_diag_equip_tenant ON diagnostic_equipment;
CREATE POLICY p_diag_equip_tenant ON diagnostic_equipment
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- nurse_tasks — daily tasks assigned to nurses
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nurse_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  stay_id UUID REFERENCES inpatient_stays(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
    'general','injection','iv_drip','dressing','vitals','medication','home_visit','procedure','observation'
  )),
  priority INT NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','skipped','canceled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES profiles(id),
  result_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_nurse_tasks_clinic_status ON nurse_tasks(clinic_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_nurse_tasks_assigned ON nurse_tasks(assigned_to, status, due_at) WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_nurse_tasks_patient ON nurse_tasks(patient_id, created_at DESC);

DROP TRIGGER IF EXISTS tg_nurse_tasks_updated ON nurse_tasks;
CREATE TRIGGER tg_nurse_tasks_updated BEFORE UPDATE ON nurse_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE nurse_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_nurse_tasks_tenant ON nurse_tasks;
CREATE POLICY p_nurse_tasks_tenant ON nurse_tasks
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- emergency_calls — realtime broadcast for help ("Tezkor chaqiruv")
-- Uses supabase_realtime publication so clinic clients get live events.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES profiles(id),
  room_id UUID REFERENCES rooms(id),
  patient_id UUID REFERENCES patients(id),
  message TEXT NOT NULL DEFAULT 'Tez yordam kerak!',
  severity TEXT NOT NULL DEFAULT 'high' CHECK (severity IN ('normal','high','critical')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  broadcast_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_calls_clinic ON emergency_calls(clinic_id, broadcast_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_calls_unresolved
  ON emergency_calls(clinic_id, broadcast_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE emergency_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_emergency_tenant ON emergency_calls;
CREATE POLICY p_emergency_tenant ON emergency_calls
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE emergency_calls;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- demo_tenants — ephemeral tenant sessions for public demo sandbox
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  magic_link TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  ip INET,
  user_agent TEXT,
  fingerprint TEXT,
  locale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_tenants_expiry ON demo_tenants(expires_at);
CREATE INDEX IF NOT EXISTS idx_demo_tenants_ip ON demo_tenants(ip, created_at DESC);

ALTER TABLE demo_tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_demo_tenants_admin ON demo_tenants;
CREATE POLICY p_demo_tenants_admin ON demo_tenants
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

COMMENT ON TABLE diagnostic_equipment IS 'Per-clinic catalog of diagnostic equipment (x-ray, MRI, ECG, etc.)';
COMMENT ON TABLE nurse_tasks IS 'Nurse daily task board (injections, vitals, home visits, etc.)';
COMMENT ON TABLE emergency_calls IS 'Real-time broadcast of emergency calls within a clinic';
COMMENT ON TABLE demo_tenants IS 'Ephemeral demo sandbox sessions (cleaned up by cron)';
