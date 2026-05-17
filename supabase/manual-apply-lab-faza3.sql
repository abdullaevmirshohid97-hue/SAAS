-- =============================================================================
-- Laboratoriya moduli — FAZA 3: Natija validatsiya oqimi + audit
-- =============================================================================
-- Validatsiyalanmagan natija shifokorga/bemorga ko'rinmasligi kerak.
-- Oqim: laborant kiritadi (draft) → validator tasdiqlaydi → shifokor ko'radi.
--
-- DIQQAT: lab_results'da no_update_final qoidasi bor (is_final=true bo'lsa
-- UPDATE bloklangan). Shu sabab validatsiya validation_status ustuni orqali
-- ishlaydi va natija validatsiyagacha is_final=false (draft) bo'lib turadi.

-- -----------------------------------------------------------------------------
-- 1) lab_results — validatsiya holati
-- -----------------------------------------------------------------------------
ALTER TABLE lab_results
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'validated'
    CHECK (validation_status IN ('draft', 'review_pending', 'validated', 'rejected')),
  ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;

-- Eski natijalar 'validated' deb hisoblanadi (default) — orqaga moslik buzilmaydi.

CREATE INDEX IF NOT EXISTS idx_lab_results_validation
  ON lab_results(clinic_id, validation_status);

COMMENT ON COLUMN lab_results.validation_status IS
  'Validatsiya holati: draft (laborant kiritdi) → review_pending → validated '
  '(shifokorga ko''rinadi) yoki rejected. Eski natijalar default validated.';

-- -----------------------------------------------------------------------------
-- 2) lab_validation_logs — kim natijani kiritdi/tekshirdi/tasdiqladi (audit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_validation_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  result_id   UUID NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES profiles(id),
  actor_role  TEXT,                       -- lab_technician / validator / pathologist
  action      TEXT NOT NULL CHECK (action IN ('entered','submitted','validated','rejected')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_validation_logs_result
  ON lab_validation_logs(result_id);
CREATE INDEX IF NOT EXISTS idx_lab_validation_logs_clinic
  ON lab_validation_logs(clinic_id, created_at DESC);

ALTER TABLE lab_validation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_validation_logs_tenant ON lab_validation_logs;
CREATE POLICY p_lab_validation_logs_tenant ON lab_validation_logs
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE lab_validation_logs IS
  'Laboratoriya natija validatsiya jurnali — kim kiritdi, kim tasdiqladi/rad etdi. '
  'Tibbiy javobgarlik va audit uchun o''zgarmas yozuv.';

-- -----------------------------------------------------------------------------
-- 3) lab_dashboard_stats — realtime dashboard uchun yagona RPC
-- -----------------------------------------------------------------------------
-- Bitta so'rovda dashboard kartalari: kutilayotgan, shoshilinch, kechikkan,
-- shifokor kutmoqda, bugun tugatilgan + o'rtacha turnaround.
CREATE OR REPLACE FUNCTION lab_dashboard_stats(p_clinic UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_today_start TIMESTAMPTZ := date_trunc('day', now());
BEGIN
  SELECT jsonb_build_object(
    'pending',        COUNT(*) FILTER (WHERE status IN ('pending','collected')),
    'running',        COUNT(*) FILTER (WHERE status = 'running'),
    'urgent',         COUNT(*) FILTER (WHERE urgency IN ('urgent','stat')
                          AND status NOT IN ('reported','delivered','canceled')),
    'completed_today',COUNT(*) FILTER (WHERE status IN ('completed','reported','delivered')
                          AND completed_at >= v_today_start),
    'doctor_waiting', COUNT(*) FILTER (WHERE status = 'completed'),
    -- O'rtacha turnaround (daqiqa) — bugun tugatilganlar bo'yicha
    'avg_turnaround_min', COALESCE(ROUND(AVG(
        EXTRACT(EPOCH FROM (completed_at - created_at)) / 60.0
      ) FILTER (WHERE completed_at >= v_today_start AND completed_at IS NOT NULL)), 0)
  )
  INTO v_result
  FROM lab_orders
  WHERE clinic_id = p_clinic;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION lab_dashboard_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lab_dashboard_stats(UUID) TO service_role;
