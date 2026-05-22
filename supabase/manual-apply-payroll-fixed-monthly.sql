-- =============================================================================
-- Clary v2 — Migration: payroll fixed monthly + aniq period summary RPC
--
-- BUG'LAR:
-- A) Stavka topilmaganda accrueTransaction() jim null qaytaradi — admin bilmaydi
-- B) Fixed monthly oylik (har oy aniq summa) yo'q — faqat % komissiya
-- C) Period bo'yicha aniq gross/deductions/net hisoblash uchun maxsus RPC yo'q
--
-- YECHIM:
-- 1) doctor_commission_rates.monthly_base_uzs — har oy aniq oylik (komissiyadan tashqari)
-- 2) staff_profiles.salary_fixed_uzs allaqachon bor (anketada) — uni rate bilan sync
-- 3) Yangi VIEW payroll_unaccrued_view — stavkasi yo'q tranzaksiyalar (admin tekshiradi)
-- 4) Yangi RPC payroll_period_summary(clinic_id, doctor_id, from, to) — to'liq
--    aggregatsiya: monthly_base + commissions − advances + bonuses = net
-- 5) doctor_commissions UNIQUE allaqachon mavjud (clinic, transaction, doctor)
-- =============================================================================

-- 1) Monthly base — har oy beriladigan aniq oylik (komissiyadan tashqari)
ALTER TABLE doctor_commission_rates
  ADD COLUMN IF NOT EXISTS monthly_base_uzs BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN doctor_commission_rates.monthly_base_uzs IS
  'Har oy uchun aniq oylik so''mda (komissiyadan tashqari qo''shiladi). Default 0.';

-- 2) View — stavkasiz tranzaksiyalar (admin paneli "sozlanmagan" deb ko'rsatadi)
CREATE OR REPLACE VIEW payroll_unaccrued_view AS
SELECT
  t.clinic_id,
  t.id            AS transaction_id,
  a.doctor_id,
  p.full_name     AS doctor_name,
  ti.service_id,
  ti.service_name_snapshot AS service_name,
  ti.final_amount_uzs AS amount_uzs,
  t.created_at
FROM transactions t
JOIN appointments a ON a.id = t.appointment_id
LEFT JOIN profiles p ON p.id = a.doctor_id
LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
LEFT JOIN doctor_commissions dc
  ON dc.transaction_id = t.id AND dc.doctor_id = a.doctor_id
WHERE t.is_void = false
  AND t.kind = 'payment'
  AND a.doctor_id IS NOT NULL
  AND dc.id IS NULL;  -- bu yerga tushgan tranzaksiyalar — stavkasiz yoki accrual ishlamagan

COMMENT ON VIEW payroll_unaccrued_view IS
  'Komissiya hisoblanmagan tranzaksiyalar — odatda doctor_commission_rates da '
  'stavka yo''qligidan. Admin bularni ko''rib stavka sozlashi kerak.';

-- 3) RPC: aniq period summary (gross + monthly_base + adjustments − advances = net)
CREATE OR REPLACE FUNCTION payroll_period_summary(
  p_clinic_id  UUID,
  p_doctor_id  UUID,
  p_from       DATE,
  p_to         DATE
)
RETURNS TABLE(
  doctor_id           UUID,
  period_from         DATE,
  period_to           DATE,
  commissions_uzs     BIGINT,
  monthly_base_uzs    BIGINT,
  bonuses_uzs         BIGINT,
  advances_uzs        BIGINT,
  penalties_uzs       BIGINT,
  gross_uzs           BIGINT,
  deductions_uzs      BIGINT,
  net_uzs             BIGINT,
  rate_configured     BOOLEAN,
  unaccrued_count     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Stavka sozlanganmi (har qanday rate qator bormi)
  SELECT EXISTS(
    SELECT 1 FROM doctor_commission_rates r
     WHERE r.clinic_id = p_clinic_id
       AND r.doctor_id = p_doctor_id
       AND r.is_archived = false
  ) INTO v_rate_configured;

  -- Stavkasiz tranzaksiyalar soni (admin diqqatga olishi uchun)
  SELECT COUNT(*) INTO v_unaccrued
    FROM payroll_unaccrued_view v
   WHERE v.clinic_id = p_clinic_id
     AND v.doctor_id = p_doctor_id
     AND v.created_at >= v_from_ts
     AND v.created_at <= v_to_ts;

  -- Monthly base — period qaysi oylarni qamrasa, har biri uchun bir martadan
  -- (oddiy: oy boshi DATE_TRUNC bo'yicha distinct sanalardagi oylar soni)
  SELECT COUNT(*) INTO v_months
    FROM (
      SELECT DISTINCT DATE_TRUNC('month', d)::date AS m
        FROM generate_series(p_from, p_to, '1 day'::interval) AS d
    ) sub;

  -- Hozirgi (oxirgi) faol monthly_base ni olamiz — period boshlanishida amalda bo'lgan
  SELECT COALESCE(r.monthly_base_uzs, 0) INTO v_monthly_base
    FROM doctor_commission_rates r
   WHERE r.clinic_id = p_clinic_id
     AND r.doctor_id = p_doctor_id
     AND r.service_id IS NULL
     AND r.is_archived = false
     AND r.valid_from <= p_from
   ORDER BY r.valid_from DESC
   LIMIT 1;

  v_monthly_base := COALESCE(v_monthly_base, 0) * GREATEST(v_months, 1);

  -- Komissiyalar — period oralig'ida (created_at Asia/Tashkent)
  SELECT COALESCE(SUM(amount_uzs), 0) INTO v_commissions
    FROM doctor_commissions
   WHERE clinic_id = p_clinic_id
     AND doctor_id = p_doctor_id
     AND status IN ('accrued', 'paid')
     AND created_at >= v_from_ts
     AND created_at <= v_to_ts;

  -- Ledger: bonus / advance / penalty alohida (status='open' va 'applied' birga)
  SELECT
    COALESCE(SUM(CASE WHEN kind = 'bonus'                                  THEN amount_uzs ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN kind = 'advance'                                THEN -amount_uzs ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN kind IN ('penalty','debt_write_off')            THEN -amount_uzs ELSE 0 END), 0)
  INTO v_bonuses, v_advances, v_penalties
  FROM doctor_ledger
  WHERE clinic_id = p_clinic_id
    AND doctor_id = p_doctor_id
    AND status IN ('open', 'applied')
    AND created_at >= v_from_ts
    AND created_at <= v_to_ts;

  -- Eslatma: doctor_ledger.amount_uzs — payroll.module.ts da advance/penalty
  -- uchun NEGATIVE, bonus uchun POSITIVE. Bu yerda biz mutlaq qiymatlarni
  -- alohida ko'rsatamiz (clarity), keyin net hisoblaymiz.
  -- advance/penalty allaqachon negativ — biz -amount_uzs bilan absolute olamiz.

  RETURN QUERY SELECT
    p_doctor_id                          AS doctor_id,
    p_from                               AS period_from,
    p_to                                 AS period_to,
    v_commissions                        AS commissions_uzs,
    v_monthly_base                       AS monthly_base_uzs,
    v_bonuses                            AS bonuses_uzs,
    v_advances                           AS advances_uzs,
    v_penalties                          AS penalties_uzs,
    (v_commissions + v_monthly_base + v_bonuses)::BIGINT AS gross_uzs,
    (v_advances + v_penalties)::BIGINT  AS deductions_uzs,
    (v_commissions + v_monthly_base + v_bonuses - v_advances - v_penalties)::BIGINT AS net_uzs,
    v_rate_configured                    AS rate_configured,
    v_unaccrued                          AS unaccrued_count;
END;
$$;

COMMENT ON FUNCTION payroll_period_summary IS
  'Shifokor uchun period (oy) bo''yicha aniq oylik hisobi: '
  'commissions + monthly_base + bonuses − advances − penalties = net. '
  'rate_configured=false bo''lsa admin stavka sozlashi kerak. '
  'unaccrued_count>0 — sozlanmagan tranzaksiyalar bor.';

REVOKE ALL ON FUNCTION payroll_period_summary(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payroll_period_summary(UUID, UUID, DATE, DATE) TO service_role;

-- 4) Klinika bo'yicha barcha shifokorlarning summary — bitta so'rovda
CREATE OR REPLACE FUNCTION payroll_clinic_period_summary(
  p_clinic_id  UUID,
  p_from       DATE,
  p_to         DATE
)
RETURNS TABLE(
  doctor_id           UUID,
  doctor_name         TEXT,
  commissions_uzs     BIGINT,
  monthly_base_uzs    BIGINT,
  bonuses_uzs         BIGINT,
  advances_uzs        BIGINT,
  penalties_uzs       BIGINT,
  gross_uzs           BIGINT,
  deductions_uzs      BIGINT,
  net_uzs             BIGINT,
  rate_configured     BOOLEAN,
  unaccrued_count     INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND p.role = 'doctor'
    AND p.is_active = true
  ORDER BY s.net_uzs DESC NULLS LAST;
$$;

COMMENT ON FUNCTION payroll_clinic_period_summary IS
  'Klinika bo''yicha barcha shifokorlarning period summary — bitta so''rovda.';

REVOKE ALL ON FUNCTION payroll_clinic_period_summary(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payroll_clinic_period_summary(UUID, DATE, DATE) TO service_role;
