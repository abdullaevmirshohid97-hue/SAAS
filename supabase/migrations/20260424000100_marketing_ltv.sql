-- =============================================================================
-- Clary v2 — Migration 000100: Marketing LTV view + SMS campaign enqueue helpers
-- =============================================================================

-- patient_ltv_view: aggregate spending, visits, last visit per patient
CREATE OR REPLACE VIEW patient_ltv_view AS
WITH tx AS (
  SELECT
    t.clinic_id,
    t.patient_id,
    SUM(
      CASE WHEN t.kind = 'refund' THEN -t.amount_uzs ELSE t.amount_uzs END
    ) FILTER (WHERE t.is_void = false) AS total_spent_uzs,
    COUNT(DISTINCT t.id) FILTER (WHERE t.is_void = false) AS tx_count,
    MAX(t.created_at) AS last_payment_at
  FROM transactions t
  WHERE t.patient_id IS NOT NULL
  GROUP BY t.clinic_id, t.patient_id
),
ap AS (
  SELECT
    a.clinic_id,
    a.patient_id,
    COUNT(*) AS visits_total,
    COUNT(*) FILTER (WHERE a.status = 'completed') AS visits_completed,
    MAX(a.scheduled_at) AS last_visit_at
  FROM appointments a
  GROUP BY a.clinic_id, a.patient_id
)
SELECT
  p.id                                AS patient_id,
  p.clinic_id,
  p.full_name,
  p.phone,
  p.gender,
  p.dob,
  p.referral_source,
  p.created_at                        AS registered_at,
  COALESCE(tx.total_spent_uzs, 0)     AS total_spent_uzs,
  COALESCE(tx.tx_count, 0)            AS tx_count,
  COALESCE(ap.visits_total, 0)        AS visits_total,
  COALESCE(ap.visits_completed, 0)    AS visits_completed,
  GREATEST(tx.last_payment_at, ap.last_visit_at) AS last_activity_at,
  CASE
    WHEN GREATEST(tx.last_payment_at, ap.last_visit_at) IS NULL THEN NULL
    ELSE EXTRACT(DAY FROM now() - GREATEST(tx.last_payment_at, ap.last_visit_at))::INT
  END                                 AS days_since_activity,
  CASE
    WHEN GREATEST(tx.last_payment_at, ap.last_visit_at) IS NULL THEN 'new'
    WHEN GREATEST(tx.last_payment_at, ap.last_visit_at) > now() - INTERVAL '30 days' THEN 'active'
    WHEN GREATEST(tx.last_payment_at, ap.last_visit_at) > now() - INTERVAL '90 days' THEN 'warming'
    WHEN GREATEST(tx.last_payment_at, ap.last_visit_at) > now() - INTERVAL '180 days' THEN 'cooling'
    ELSE 'passive'
  END                                 AS lifecycle_stage
FROM patients p
LEFT JOIN tx ON tx.patient_id = p.id AND tx.clinic_id = p.clinic_id
LEFT JOIN ap ON ap.patient_id = p.id AND ap.clinic_id = p.clinic_id
WHERE p.deleted_at IS NULL;

COMMENT ON VIEW patient_ltv_view IS
  'Per-patient lifetime value: spend, visits, lifecycle bucket';

-- Helpful composite indexes for segmentation queries
CREATE INDEX IF NOT EXISTS idx_appointments_patient_services
  ON appointments(clinic_id, patient_id, service_id, status);

CREATE INDEX IF NOT EXISTS idx_inpatient_stays_patient
  ON inpatient_stays(clinic_id, patient_id);
