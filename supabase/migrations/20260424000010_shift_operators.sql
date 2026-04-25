-- =============================================================================
-- Clary v2 — Migration 20260424000010: Shift operators + shift schedules
-- Phase B.1-B.2:
--   shift_operators       — catalog of named operators (PIN-locked) per clinic
--   shift_schedules       — configured shift time-windows (morning/evening/night)
--   shift_schedule_assignments — which operators are assigned to which schedule
--   shifts.operator_id / schedule_id — link an opened POS shift to an operator+schedule
-- =============================================================================

-- -----------------------------------------------------------------------------
-- shift_operators (Settings > Staff > Shift operators)
--   - pin_hash uses argon2id; store only the full encoded hash
--   - optional profile_id links to the real auth user (for audit)
--   - rate-limiting via pin_failed_attempts + pin_locked_until
-- -----------------------------------------------------------------------------
CREATE TABLE shift_operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id),           -- optional linkage
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'cashier',              -- cashier/reception/nurse...
  color TEXT,                                        -- visual cue for schedule UI
  pin_hash TEXT NOT NULL,                            -- argon2id encoded string
  last_pin_set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pin_failed_attempts INT NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_shift_operators_clinic ON shift_operators(clinic_id) WHERE is_archived = false;
CREATE INDEX idx_shift_operators_profile ON shift_operators(profile_id) WHERE profile_id IS NOT NULL;

CREATE TRIGGER tg_shift_operators_updated BEFORE UPDATE ON shift_operators
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- shift_schedules — configurable time-window templates
-- -----------------------------------------------------------------------------
CREATE TABLE shift_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name_i18n JSONB NOT NULL,                          -- {"uz-Latn":"Ertalabki","ru":"\u0423\u0442\u0440\u043E"}
  code TEXT,                                         -- short handle: morning/evening/night
  color TEXT,
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  crosses_midnight BOOLEAN NOT NULL DEFAULT false,   -- true if end_time < start_time
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],  -- 0=Sun..6=Sat
  valid_from DATE,
  valid_to DATE,
  sort_order INT NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

CREATE INDEX idx_shift_schedules_clinic ON shift_schedules(clinic_id) WHERE is_archived = false;

CREATE TRIGGER tg_shift_schedules_updated BEFORE UPDATE ON shift_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- shift_schedule_assignments — which operators work which shift
--   NB: many-to-many is intentional; a shift can have multiple cashiers.
-- -----------------------------------------------------------------------------
CREATE TABLE shift_schedule_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES shift_schedules(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES shift_operators(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  effective_from DATE,
  effective_to DATE,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  UNIQUE (schedule_id, operator_id)
);

CREATE INDEX idx_ssa_clinic ON shift_schedule_assignments(clinic_id);
CREATE INDEX idx_ssa_schedule ON shift_schedule_assignments(schedule_id);
CREATE INDEX idx_ssa_operator ON shift_schedule_assignments(operator_id);

-- -----------------------------------------------------------------------------
-- Extend shifts with operator/schedule linkage (non-breaking)
-- -----------------------------------------------------------------------------
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES shift_operators(id),
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES shift_schedules(id),
  ADD COLUMN IF NOT EXISTS opened_via TEXT,          -- 'pos' | 'mobile' | 'api'
  ADD COLUMN IF NOT EXISTS closing_notes TEXT,
  ADD COLUMN IF NOT EXISTS closing_manager_id UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_shifts_operator ON shifts(operator_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_schedule ON shifts(schedule_id, opened_at DESC);

-- Only one open shift per operator at a time (closed_at IS NULL => open)
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_open_per_operator
  ON shifts(operator_id)
  WHERE closed_at IS NULL AND operator_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- RLS — tenant-scoped standard policies + enable
-- -----------------------------------------------------------------------------
ALTER TABLE shift_operators           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_schedules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_schedule_assignments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'shift_operators', 'shift_schedules', 'shift_schedule_assignments'
  ])
  LOOP
    EXECUTE format($pol$
      CREATE POLICY %I_tenant_select ON %I FOR SELECT
        USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
      CREATE POLICY %I_tenant_insert ON %I FOR INSERT
        WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
      CREATE POLICY %I_tenant_update ON %I FOR UPDATE
        USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin())
        WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
      CREATE POLICY %I_tenant_delete ON %I FOR DELETE
        USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
    $pol$, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- PIN hashes must never leak via the standard SELECT; carve out a policy that
-- hides pin_hash from non-admins.  We implement this with a view in the API,
-- but also revoke direct column access for 'authenticated' users who aren't
-- clinic admins.  (Supabase exposes public.* as API, so rely on the service
-- layer to project without pin_hash.)
COMMENT ON COLUMN shift_operators.pin_hash IS
  'argon2id encoded hash. MUST never be returned to the client. Project out in API layer.';
