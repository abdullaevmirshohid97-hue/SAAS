-- =============================================================================
-- Clary v2 — Migration 001040: Dental module
-- FDI-numbered tooth charts, treatment plans, periodontogram.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- dental_charts — one per patient per clinic (latest state)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_charts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES profiles(id),
  notes TEXT,
  is_adult BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1,
  UNIQUE (clinic_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_dental_charts_clinic ON dental_charts(clinic_id);
CREATE INDEX IF NOT EXISTS idx_dental_charts_patient ON dental_charts(patient_id);

DROP TRIGGER IF EXISTS tg_dental_charts_updated ON dental_charts;
CREATE TRIGGER tg_dental_charts_updated BEFORE UPDATE ON dental_charts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE dental_charts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dental_charts_tenant ON dental_charts;
CREATE POLICY p_dental_charts_tenant ON dental_charts
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- dental_teeth — per-tooth state in a chart (FDI 11..48 adult, 51..85 child)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_teeth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id UUID NOT NULL REFERENCES dental_charts(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  fdi_number INT NOT NULL CHECK (
    (fdi_number BETWEEN 11 AND 18) OR
    (fdi_number BETWEEN 21 AND 28) OR
    (fdi_number BETWEEN 31 AND 38) OR
    (fdi_number BETWEEN 41 AND 48) OR
    (fdi_number BETWEEN 51 AND 55) OR
    (fdi_number BETWEEN 61 AND 65) OR
    (fdi_number BETWEEN 71 AND 75) OR
    (fdi_number BETWEEN 81 AND 85)
  ),
  -- 5 surfaces: mesial, distal, buccal, lingual/palatal, occlusal/incisal
  surfaces JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'sound' CHECK (status IN (
    'sound','caries','filling','root_canal','crown','bridge','implant','missing','extracted',
    'erupting','impacted','mobile','fractured','discolored','sensitive','watch'
  )),
  color_hex TEXT,
  last_intervention_at TIMESTAMPTZ,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE (chart_id, fdi_number)
);

CREATE INDEX IF NOT EXISTS idx_dental_teeth_chart ON dental_teeth(chart_id);

DROP TRIGGER IF EXISTS tg_dental_teeth_updated ON dental_teeth;
CREATE TRIGGER tg_dental_teeth_updated BEFORE UPDATE ON dental_teeth
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE dental_teeth ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dental_teeth_tenant ON dental_teeth;
CREATE POLICY p_dental_teeth_tenant ON dental_teeth
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- dental_treatment_plans — a planned course of treatment
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_treatment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES profiles(id),
  title TEXT NOT NULL DEFAULT 'Davolash rejasi',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','in_progress','done','canceled')),
  total_uzs BIGINT NOT NULL DEFAULT 0,
  paid_uzs BIGINT NOT NULL DEFAULT 0,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_dtp_patient ON dental_treatment_plans(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dtp_clinic ON dental_treatment_plans(clinic_id, status);

DROP TRIGGER IF EXISTS tg_dtp_updated ON dental_treatment_plans;
CREATE TRIGGER tg_dtp_updated BEFORE UPDATE ON dental_treatment_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE dental_treatment_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dtp_tenant ON dental_treatment_plans;
CREATE POLICY p_dtp_tenant ON dental_treatment_plans
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- dental_treatment_items — line items inside a plan
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_treatment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES dental_treatment_plans(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  fdi_number INT,
  surfaces JSONB,
  service_id UUID REFERENCES services(id),
  service_name_snapshot TEXT NOT NULL,
  price_uzs BIGINT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','in_progress','done','canceled')),
  scheduled_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES profiles(id),
  sort_order INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dti_plan ON dental_treatment_items(plan_id, sort_order);

DROP TRIGGER IF EXISTS tg_dti_updated ON dental_treatment_items;
CREATE TRIGGER tg_dti_updated BEFORE UPDATE ON dental_treatment_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE dental_treatment_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dti_tenant ON dental_treatment_items;
CREATE POLICY p_dti_tenant ON dental_treatment_items
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- dental_periodontogram — probing depths per tooth (4 points: M, D, B, L)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dental_periodontogram (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id UUID NOT NULL REFERENCES dental_charts(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  fdi_number INT NOT NULL,
  mesial_mm NUMERIC(3,1),
  distal_mm NUMERIC(3,1),
  buccal_mm NUMERIC(3,1),
  lingual_mm NUMERIC(3,1),
  bleeding_on_probing BOOLEAN NOT NULL DEFAULT false,
  mobility INT CHECK (mobility BETWEEN 0 AND 3),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  measured_by UUID REFERENCES profiles(id),
  UNIQUE (chart_id, fdi_number)
);

CREATE INDEX IF NOT EXISTS idx_dperio_chart ON dental_periodontogram(chart_id);

ALTER TABLE dental_periodontogram ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dperio_tenant ON dental_periodontogram;
CREATE POLICY p_dperio_tenant ON dental_periodontogram
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- Auto-recompute total_uzs on treatment plan items
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_dtp_recalc_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE plan_id_var UUID;
BEGIN
  plan_id_var := COALESCE(NEW.plan_id, OLD.plan_id);
  UPDATE dental_treatment_plans
    SET total_uzs = COALESCE((
      SELECT SUM(price_uzs * quantity)
      FROM dental_treatment_items
      WHERE plan_id = plan_id_var AND status <> 'canceled'
    ), 0)
  WHERE id = plan_id_var;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_dti_recalc ON dental_treatment_items;
CREATE TRIGGER tg_dti_recalc
  AFTER INSERT OR UPDATE OR DELETE ON dental_treatment_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_dtp_recalc_total();

COMMENT ON TABLE dental_charts IS 'One dental chart per patient per clinic';
COMMENT ON TABLE dental_teeth IS 'Per-tooth FDI state with surfaces JSONB';
COMMENT ON TABLE dental_treatment_plans IS 'Dental treatment plan (draft → approved → done)';
COMMENT ON TABLE dental_treatment_items IS 'Line items in a dental treatment plan';
COMMENT ON TABLE dental_periodontogram IS 'Periodontal probing depths per tooth';
