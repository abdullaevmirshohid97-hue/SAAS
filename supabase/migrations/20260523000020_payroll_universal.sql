-- =============================================================================
-- Clary v2 — Migration: Maosh moduli universal (anketa + auth)
--
-- Muammo: doctor_balances_view va payroll_clinic_period_summary RPC
-- hardcoded WHERE p.role = 'doctor' filtriga ega. Natija — clinic_admin
-- (masalan Azamat) maosh modulida ko'rinmaydi.
--
-- Yechim: is_payroll_eligible_role(role) helper, view va RPC'larni shu
-- helper bilan filterlash. staff_profiles.position'ga 'receptionist'
-- qo'shish (kassir/qabulxona istisno).
-- =============================================================================

-- 1) staff_profiles.position — 'receptionist' qiymatini qo'shish
ALTER TABLE staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_position_check;
ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_position_check
  CHECK (position IN (
    'doctor','nurse','cleaner','administrator',
    'cashier','receptionist','pharmacist','lab_tech','manager','other'
  ));

-- 2) Payroll-eligible role helper (profiles.role uchun)
CREATE OR REPLACE FUNCTION public.is_payroll_eligible_role(p_role text)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  -- doctor + clinic_admin + clinic_owner = maosh oluvchi rollar.
  -- staff, super_admin va h.k. — payroll'dan tashqari.
  SELECT p_role IN ('doctor','clinic_admin','clinic_owner');
$$;

COMMENT ON FUNCTION public.is_payroll_eligible_role IS
  'Maosh moduli uchun yaroqli rol filtri. Ghost profillar ham shu role''larda yaratiladi.';

-- 3) doctor_balances_view — role filtri kengaytirildi
DROP VIEW IF EXISTS doctor_balances_view;
CREATE VIEW doctor_balances_view AS
WITH accrued AS (
  SELECT clinic_id, doctor_id, COALESCE(SUM(amount_uzs), 0) AS total
    FROM doctor_commissions WHERE status = 'accrued'
   GROUP BY clinic_id, doctor_id
),
open_ledger AS (
  SELECT clinic_id, doctor_id, COALESCE(SUM(amount_uzs), 0) AS total
    FROM doctor_ledger WHERE status = 'open'
   GROUP BY clinic_id, doctor_id
),
paid AS (
  SELECT clinic_id, doctor_id, COALESCE(SUM(net_uzs), 0) AS total
    FROM doctor_payouts WHERE status = 'paid'
   GROUP BY clinic_id, doctor_id
)
SELECT
  p.clinic_id,
  p.id AS doctor_id,
  p.full_name,
  COALESCE(a.total, 0) AS accrued_uzs,
  COALESCE(l.total, 0) AS ledger_uzs,
  COALESCE(paid.total, 0) AS paid_uzs,
  COALESCE(a.total, 0) + COALESCE(l.total, 0) AS balance_uzs
FROM profiles p
LEFT JOIN accrued a ON a.doctor_id = p.id AND a.clinic_id = p.clinic_id
LEFT JOIN open_ledger l ON l.doctor_id = p.id AND l.clinic_id = p.clinic_id
LEFT JOIN paid ON paid.doctor_id = p.id AND paid.clinic_id = p.clinic_id
WHERE is_payroll_eligible_role(p.role::text);

COMMENT ON VIEW doctor_balances_view IS
  'Xodimlar maosh balansi (accrued + ledger + paid). Filter: payroll-eligible role''lar.';

-- 4) payroll_period_summary — doctor_id ambiguity fix (jadval prefiksi)
CREATE OR REPLACE FUNCTION payroll_period_summary(
  p_clinic_id UUID, p_doctor_id UUID, p_from DATE, p_to DATE
)
RETURNS TABLE(
  doctor_id UUID, period_from DATE, period_to DATE,
  commissions_uzs BIGINT, monthly_base_uzs BIGINT, bonuses_uzs BIGINT,
  advances_uzs BIGINT, penalties_uzs BIGINT,
  gross_uzs BIGINT, deductions_uzs BIGINT, net_uzs BIGINT,
  rate_configured BOOLEAN, unaccrued_count INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_ts TIMESTAMPTZ := (p_from || 'T00:00:00 Asia/Tashkent')::TIMESTAMPTZ;
  v_to_ts   TIMESTAMPTZ := (p_to   || 'T23:59:59 Asia/Tashkent')::TIMESTAMPTZ;
  v_months  INT;
  v_monthly_base BIGINT := 0;
  v_commissions BIGINT := 0;
  v_bonuses BIGINT := 0;
  v_advances BIGINT := 0;
  v_penalties BIGINT := 0;
  v_rate_configured BOOLEAN;
  v_unaccrued INT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM doctor_commission_rates r
     WHERE r.clinic_id = p_clinic_id AND r.doctor_id = p_doctor_id AND r.is_archived = false
  ) INTO v_rate_configured;

  SELECT COUNT(*) INTO v_unaccrued
    FROM payroll_unaccrued_view v
   WHERE v.clinic_id = p_clinic_id AND v.doctor_id = p_doctor_id
     AND v.created_at >= v_from_ts AND v.created_at <= v_to_ts;

  SELECT COUNT(*) INTO v_months
    FROM (SELECT DISTINCT DATE_TRUNC('month', d)::date AS m
            FROM generate_series(p_from, p_to, '1 day'::interval) AS d) sub;

  SELECT COALESCE(r.monthly_base_uzs, 0) INTO v_monthly_base
    FROM doctor_commission_rates r
   WHERE r.clinic_id = p_clinic_id AND r.doctor_id = p_doctor_id
     AND r.service_id IS NULL AND r.is_archived = false
     AND r.valid_from <= p_from
   ORDER BY r.valid_from DESC LIMIT 1;

  v_monthly_base := COALESCE(v_monthly_base, 0) * GREATEST(v_months, 1);

  -- Jadval prefiksi bilan (doctor_id ambiguity oldini olish — RETURN TABLE ham
  -- doctor_id ustunini e'lon qiladi)
  SELECT COALESCE(SUM(dc.amount_uzs), 0) INTO v_commissions
    FROM doctor_commissions dc
   WHERE dc.clinic_id = p_clinic_id AND dc.doctor_id = p_doctor_id
     AND dc.status IN ('accrued', 'paid')
     AND dc.created_at >= v_from_ts AND dc.created_at <= v_to_ts;

  SELECT
    COALESCE(SUM(CASE WHEN dl.kind = 'bonus' THEN dl.amount_uzs ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN dl.kind = 'advance' THEN -dl.amount_uzs ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN dl.kind IN ('penalty','debt_write_off') THEN -dl.amount_uzs ELSE 0 END), 0)
  INTO v_bonuses, v_advances, v_penalties
  FROM doctor_ledger dl
  WHERE dl.clinic_id = p_clinic_id AND dl.doctor_id = p_doctor_id
    AND dl.status IN ('open', 'applied')
    AND dl.created_at >= v_from_ts AND dl.created_at <= v_to_ts;

  RETURN QUERY SELECT
    p_doctor_id, p_from, p_to,
    v_commissions, v_monthly_base, v_bonuses, v_advances, v_penalties,
    (v_commissions + v_monthly_base + v_bonuses)::BIGINT,
    (v_advances + v_penalties)::BIGINT,
    (v_commissions + v_monthly_base + v_bonuses - v_advances - v_penalties)::BIGINT,
    v_rate_configured, v_unaccrued;
END;
$$;

-- 5) payroll_clinic_period_summary — role filtri kengaytirildi
CREATE OR REPLACE FUNCTION payroll_clinic_period_summary(
  p_clinic_id uuid, p_from date, p_to date
)
RETURNS TABLE (
  doctor_id uuid,
  doctor_name text,
  commissions_uzs bigint,
  monthly_base_uzs bigint,
  bonuses_uzs bigint,
  advances_uzs bigint,
  penalties_uzs bigint,
  gross_uzs bigint,
  deductions_uzs bigint,
  net_uzs bigint,
  rate_configured boolean,
  unaccrued_count integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT
    p.id AS doctor_id,
    p.full_name AS doctor_name,
    s.commissions_uzs,
    s.monthly_base_uzs,
    s.bonuses_uzs,
    s.advances_uzs,
    s.penalties_uzs,
    s.gross_uzs,
    s.deductions_uzs,
    s.net_uzs,
    s.rate_configured,
    s.unaccrued_count
  FROM profiles p
  CROSS JOIN LATERAL payroll_period_summary(p_clinic_id, p.id, p_from, p_to) s
  WHERE p.clinic_id = p_clinic_id
    AND p.is_active = true
    AND is_payroll_eligible_role(p.role::text)
  ORDER BY s.net_uzs DESC NULLS LAST;
$$;
