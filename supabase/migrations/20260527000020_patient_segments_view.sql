-- Faza 2: Patient LTV va churn segmentatsiya

CREATE OR REPLACE VIEW patient_segments_view AS
WITH patient_summary AS (
  SELECT
    p.id,
    p.clinic_id,
    p.full_name,
    p.phone,
    p.dob,
    p.gender,
    p.created_at AS registered_at,
    COUNT(DISTINCT a.id) AS visit_count,
    COALESCE(SUM(ti.final_amount_uzs) FILTER (WHERE t.is_void = false), 0) AS ltv_uzs,
    MAX(a.scheduled_at) AS last_visit,
    COALESCE(AVG(ti.final_amount_uzs) FILTER (WHERE t.is_void = false), 0)::BIGINT AS avg_check_uzs
  FROM patients p
  LEFT JOIN appointments a ON a.patient_id = p.id
  LEFT JOIN transactions t ON t.appointment_id = a.id
  LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
  GROUP BY p.id
)
SELECT
  *,
  CASE
    WHEN last_visit IS NULL AND registered_at < NOW() - INTERVAL '30 days' THEN 'never_visited'
    WHEN last_visit < NOW() - INTERVAL '90 days' THEN 'churned'
    WHEN last_visit < NOW() - INTERVAL '30 days' THEN 'at_risk'
    ELSE 'active'
  END AS churn_segment,
  CASE
    WHEN ltv_uzs > 5000000 AND visit_count >= 5 THEN 'vip'
    WHEN ltv_uzs > 1500000 AND visit_count >= 3 THEN 'regular'
    WHEN visit_count > 0 THEN 'occasional'
    ELSE 'new'
  END AS ltv_segment,
  EXTRACT(DAYS FROM (NOW() - COALESCE(last_visit, registered_at)))::INT AS days_since_last_activity
FROM patient_summary;
