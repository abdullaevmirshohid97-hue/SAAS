-- =============================================================================
-- Clary v2 — Migration 90: Analytics views
--
-- We use regular VIEWs (not materialized) for simplicity. They can be promoted
-- to matviews later with a periodic REFRESH inside BullMQ.
--
--   * daily_revenue_view        — per-day revenue + expense
--   * doctor_productivity_view  — visits, revenue, avg check
--   * service_heatmap_view      — (hour_of_day × service) counts
--   * pharmacy_daily_view       — pharmacy revenue / qty
--   * inpatient_occupancy_view  — stays per room type
-- =============================================================================

CREATE OR REPLACE VIEW daily_revenue_view AS
SELECT
  t.clinic_id,
  DATE(t.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
  SUM(CASE WHEN t.kind = 'refund' THEN -t.amount_uzs ELSE t.amount_uzs END)::BIGINT AS revenue_uzs,
  COUNT(*)::INT                                                                    AS transactions
FROM transactions t
WHERE t.is_void = false
GROUP BY t.clinic_id, DATE(t.created_at AT TIME ZONE 'Asia/Tashkent');

CREATE OR REPLACE VIEW daily_expense_view AS
SELECT
  e.clinic_id,
  e.expense_date AS day,
  SUM(e.amount_uzs)::BIGINT AS expenses_uzs
FROM expenses e
GROUP BY e.clinic_id, e.expense_date;

CREATE OR REPLACE VIEW doctor_productivity_view AS
SELECT
  a.clinic_id,
  a.doctor_id,
  p.full_name AS doctor_name,
  DATE(a.scheduled_at AT TIME ZONE 'Asia/Tashkent') AS day,
  COUNT(DISTINCT a.id)                                AS visits,
  COUNT(DISTINCT a.patient_id)                        AS unique_patients,
  COALESCE(SUM(ti.final_amount_uzs), 0)::BIGINT       AS revenue_uzs
FROM appointments a
LEFT JOIN profiles p ON p.id = a.doctor_id
LEFT JOIN transactions t ON t.appointment_id = a.id AND t.is_void = false
LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
WHERE a.status IN ('completed', 'in_progress')
GROUP BY a.clinic_id, a.doctor_id, p.full_name, DATE(a.scheduled_at AT TIME ZONE 'Asia/Tashkent');

CREATE OR REPLACE VIEW service_hour_heatmap_view AS
SELECT
  t.clinic_id,
  EXTRACT(DOW FROM t.created_at AT TIME ZONE 'Asia/Tashkent')::INT  AS day_of_week,
  EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'Asia/Tashkent')::INT AS hour_of_day,
  ti.service_id,
  ti.service_name_snapshot AS service_name,
  COUNT(*)::INT AS count,
  COALESCE(SUM(ti.final_amount_uzs), 0)::BIGINT AS revenue_uzs
FROM transactions t
JOIN transaction_items ti ON ti.transaction_id = t.id
WHERE t.is_void = false
GROUP BY
  t.clinic_id,
  EXTRACT(DOW FROM t.created_at AT TIME ZONE 'Asia/Tashkent'),
  EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'Asia/Tashkent'),
  ti.service_id,
  ti.service_name_snapshot;

CREATE OR REPLACE VIEW pharmacy_daily_view AS
SELECT
  s.clinic_id,
  DATE(s.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
  COUNT(*)                                         AS sales,
  SUM(s.total_uzs)::BIGINT                         AS revenue_uzs,
  SUM(COALESCE(s.debt_uzs, 0))::BIGINT             AS debt_uzs,
  SUM(COALESCE(s.discount_uzs, 0))::BIGINT         AS discount_uzs
FROM pharmacy_sales s
WHERE s.is_void = false
GROUP BY s.clinic_id, DATE(s.created_at AT TIME ZONE 'Asia/Tashkent');

CREATE OR REPLACE VIEW inpatient_occupancy_view AS
SELECT
  st.clinic_id,
  r.id AS room_id,
  r.number AS room_number,
  r.type AS room_type,
  COUNT(st.id) FILTER (WHERE st.discharged_at IS NULL) AS current_stays,
  COALESCE(SUM(st.total_cost_uzs) FILTER (WHERE st.discharged_at IS NOT NULL), 0)::BIGINT AS revenue_uzs
FROM rooms r
LEFT JOIN inpatient_stays st ON st.room_id = r.id
WHERE r.is_archived = false
GROUP BY st.clinic_id, r.id, r.number, r.type;
