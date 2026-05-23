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

-- 4) payroll_clinic_period_summary — role filtri kengaytirildi
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
