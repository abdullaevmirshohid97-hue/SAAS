-- Faza 3: Operatsion analitika — Shifokor anomaliya

CREATE OR REPLACE VIEW doctor_anomaly_view AS
WITH doctor_stats AS (
  SELECT
    d.clinic_id,
    d.doctor_id,
    d.doctor_name,
    SUM(d.visits) AS total_visits,
    SUM(d.unique_patients) AS total_patients,
    SUM(d.revenue_uzs)::BIGINT AS total_revenue,
    AVG(d.revenue_uzs::NUMERIC / NULLIF(d.visits, 0))::BIGINT AS avg_check_uzs,
    COUNT(DISTINCT d.day) AS working_days
  FROM doctor_productivity_view d
  WHERE d.day >= NOW() - INTERVAL '30 days'
  GROUP BY d.clinic_id, d.doctor_id, d.doctor_name
),
clinic_quartiles AS (
  SELECT
    clinic_id,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY avg_check_uzs) AS q1_check,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY avg_check_uzs) AS q3_check,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY total_visits) AS q1_visits,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_visits) AS q3_visits,
    COUNT(*) AS doctor_count
  FROM doctor_stats
  GROUP BY clinic_id
)
SELECT
  ds.*,
  cq.q1_check,
  cq.q3_check,
  cq.q1_visits,
  cq.q3_visits,
  CASE
    WHEN cq.doctor_count < 3 THEN 'insufficient_data'
    WHEN ds.avg_check_uzs < cq.q1_check - 1.5 * (cq.q3_check - cq.q1_check)
      THEN 'below_expected'
    WHEN ds.avg_check_uzs > cq.q3_check + 1.5 * (cq.q3_check - cq.q1_check)
      THEN 'above_expected'
    ELSE 'normal'
  END AS performance_flag
FROM doctor_stats ds
JOIN clinic_quartiles cq ON cq.clinic_id = ds.clinic_id;
