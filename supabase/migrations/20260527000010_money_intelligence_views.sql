-- Faza 1: Money Intelligence views
-- 1A: smena kassa farqi anomaliya (IQR)
-- 1B: kassir vozvrat nisbati (haftalik) - fraud detection
-- 1C: 90 kunlik tushum tarixi - forecast uchun

CREATE OR REPLACE VIEW shift_cash_anomaly_view AS
WITH closed_shifts AS (
  SELECT
    s.*,
    ABS(COALESCE(s.actual_cash_uzs, 0) - COALESCE(s.expected_cash_uzs, 0)) AS abs_diff
  FROM shifts s
  WHERE s.closed_at IS NOT NULL
),
clinic_stats AS (
  SELECT
    clinic_id,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY abs_diff) AS q1,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY abs_diff) AS median,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY abs_diff) AS q3,
    COUNT(*) AS sample_size
  FROM closed_shifts
  GROUP BY clinic_id
)
SELECT
  cs.id,
  cs.clinic_id,
  cs.opened_at,
  cs.closed_at,
  cs.opening_cash_uzs,
  cs.expected_cash_uzs,
  cs.actual_cash_uzs,
  (COALESCE(cs.actual_cash_uzs, 0) - COALESCE(cs.expected_cash_uzs, 0)) AS diff_uzs,
  cs.abs_diff,
  cs.operator_id,
  stats.q1,
  stats.q3,
  (stats.q3 - stats.q1) AS iqr,
  CASE
    WHEN stats.sample_size < 3 THEN 'insufficient_data'
    WHEN cs.abs_diff > stats.q3 + 1.5 * (stats.q3 - stats.q1) AND cs.abs_diff > 100000
      THEN 'high_anomaly'
    WHEN cs.abs_diff > stats.q3 AND cs.abs_diff > 50000
      THEN 'medium_anomaly'
    ELSE 'normal'
  END AS anomaly_level
FROM closed_shifts cs
JOIN clinic_stats stats ON stats.clinic_id = cs.clinic_id;

CREATE OR REPLACE VIEW cashier_refund_ratio_view AS
SELECT
  clinic_id,
  cashier_id,
  DATE_TRUNC('week', created_at AT TIME ZONE 'Asia/Tashkent')::DATE AS week_start,
  COUNT(*) FILTER (WHERE kind = 'refund') AS refunds_count,
  COUNT(*) FILTER (WHERE kind = 'payment') AS payments_count,
  COUNT(*) AS total_count,
  SUM(ABS(amount_uzs)) FILTER (WHERE kind = 'refund') AS refunds_amount_uzs,
  ROUND(100.0 * COUNT(*) FILTER (WHERE kind = 'refund') / NULLIF(COUNT(*), 0), 2) AS refund_ratio_pct,
  CASE
    WHEN COUNT(*) < 5 THEN 'insufficient_data'
    WHEN 100.0 * COUNT(*) FILTER (WHERE kind = 'refund') / NULLIF(COUNT(*), 0) > 20 THEN 'high_risk'
    WHEN 100.0 * COUNT(*) FILTER (WHERE kind = 'refund') / NULLIF(COUNT(*), 0) > 10 THEN 'medium_risk'
    ELSE 'normal'
  END AS risk_level
FROM transactions
WHERE is_void = false AND cashier_id IS NOT NULL
GROUP BY clinic_id, cashier_id, week_start;

CREATE OR REPLACE VIEW daily_revenue_history_view AS
SELECT
  clinic_id,
  DATE(created_at AT TIME ZONE 'Asia/Tashkent') AS day,
  EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tashkent')::INT AS dow,
  SUM(CASE WHEN kind = 'refund' THEN -amount_uzs ELSE amount_uzs END) AS revenue_uzs,
  COUNT(*) FILTER (WHERE kind = 'payment') AS tx_count
FROM transactions
WHERE is_void = false
  AND created_at >= NOW() - INTERVAL '90 days'
GROUP BY clinic_id, day, dow;
