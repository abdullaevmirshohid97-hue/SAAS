-- =============================================================================
-- ANALITIKA TUZATISHLARI (2026-10-17 audit)
-- =============================================================================
-- Prod ma'lumotida topilgan xatolar:
--  1) Vozvrat tushumni KAMAYTIRISH o'rniga OSHIRARDI: refund amount_uzs allaqachon
--     manfiy saqlanadi, view'lar esa yana minusga ko'paytirardi (-(-x) = +x).
--  2) To'liq qarzga berilgan xizmat (payment_method='debt') tushum deb sanalardi,
--     qarz to'langanda yana sanalardi — IKKI MARTA. Endi tushum = kassaga tushgan
--     pul (transaction_payment_legs, 'debt' oyog'isiz) — oylik hisobot bilan bir xil.
--  3) Shifokor analitikasi BO'SH edi: view faqat status completed/in_progress
--     qabullarni olardi, prod'da esa barcha 3587 qabul 'checked_in'. Endi manba —
--     to'lov cheki (transactions.doctor_id, yo'q bo'lsa qabul shifokori).
--  4) Bemor segmentlari: o'rtacha chek = xizmat QATORI o'rtachasi edi (chek emas),
--     qabulsiz cheklar va o'chirilgan (birlashtirilgan) bemorlar hisobga noto'g'ri.
--  5) Statsionar xonalari: bemori bo'lmagan xona clinic_id NULL bo'lib qolib,
--     ro'yxatda umuman ko'rinmasdi.
--  6) API PostgREST 1000 qator chegarasiga urilardi (oylik/yillik heatmap, top
--     xizmatlar, segmentlar) — og'ir agregatlar SQL funksiyalarga ko'chirildi.
-- Hammasi Toshkent kunlari bo'yicha. Ustunlar nomi/turi o'zgarmagan (Telegram
-- hisobot va AI ham shu view'lardan o'qiydi). Idempotent.
-- =============================================================================

-- ── 1–2) Kunlik tushum ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.daily_revenue_view WITH (security_invoker = true) AS
SELECT l.clinic_id,
       date(l.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
       COALESCE(SUM(l.amount_uzs) FILTER (WHERE l.method::text <> 'debt'), 0)::bigint AS revenue_uzs,
       (COUNT(DISTINCT l.transaction_id)
          FILTER (WHERE l.kind = 'payment' AND l.amount_uzs > 0 AND l.method::text <> 'debt'))::integer
         AS transactions
  FROM transaction_payment_legs l
 WHERE NOT l.is_void AND l.kind IN ('payment', 'refund')
 GROUP BY l.clinic_id, date(l.created_at AT TIME ZONE 'Asia/Tashkent');

CREATE OR REPLACE VIEW public.daily_revenue_history_view WITH (security_invoker = true) AS
SELECT l.clinic_id,
       date(l.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
       (EXTRACT(dow FROM (l.created_at AT TIME ZONE 'Asia/Tashkent')))::integer AS dow,
       COALESCE(SUM(l.amount_uzs) FILTER (WHERE l.method::text <> 'debt'), 0)::numeric AS revenue_uzs,
       COUNT(DISTINCT l.transaction_id)
         FILTER (WHERE l.kind = 'payment' AND l.amount_uzs > 0 AND l.method::text <> 'debt') AS tx_count
  FROM transaction_payment_legs l
 WHERE NOT l.is_void AND l.kind IN ('payment', 'refund')
   AND l.created_at >= now() - interval '90 days'
 GROUP BY l.clinic_id, date(l.created_at AT TIME ZONE 'Asia/Tashkent'),
          (EXTRACT(dow FROM (l.created_at AT TIME ZONE 'Asia/Tashkent')))::integer;

-- ── 3) Shifokor unumdorligi (chek asosida) ───────────────────────────────────
-- visits = bemor-kunlar, revenue_uzs = ko'rsatilgan xizmatlar qiymati (chek
-- qatorlari; qarzga berilgani ham — bu shifokor ishi). Qarz to'lash cheklarida
-- xizmat qatori yo'q — ular sanalmaydi.
CREATE OR REPLACE VIEW public.doctor_productivity_view WITH (security_invoker = on) AS
WITH tx AS (
  SELECT t.id,
         t.clinic_id,
         t.patient_id,
         COALESCE(t.doctor_id, a.doctor_id) AS doctor_id,
         date(t.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
         (SELECT COALESCE(SUM(i.final_amount_uzs), 0) FROM transaction_items i
           WHERE i.transaction_id = t.id) AS items_uzs
    FROM transactions t
    LEFT JOIN appointments a ON a.id = t.appointment_id
   WHERE NOT t.is_void AND t.kind = 'payment' AND t.amount_uzs >= 0
)
SELECT tx.clinic_id,
       tx.doctor_id,
       p.full_name AS doctor_name,
       tx.day,
       count(DISTINCT COALESCE(tx.patient_id, tx.id)) AS visits,
       count(DISTINCT tx.patient_id) AS unique_patients,
       COALESCE(sum(tx.items_uzs), 0)::bigint AS revenue_uzs
  FROM tx
  LEFT JOIN profiles p ON p.id = tx.doctor_id
 WHERE tx.doctor_id IS NOT NULL AND tx.items_uzs > 0
 GROUP BY tx.clinic_id, tx.doctor_id, p.full_name, tx.day;

-- ── 4) Bemor segmentlari ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.patient_segments_view WITH (security_invoker = true) AS
WITH visits AS (
  SELECT t.patient_id,
         count(DISTINCT date(t.created_at AT TIME ZONE 'Asia/Tashkent')) AS visit_count,
         max(t.created_at) AS last_visit
    FROM transactions t
   WHERE NOT t.is_void AND t.kind = 'payment' AND t.amount_uzs > 0 AND t.patient_id IS NOT NULL
   GROUP BY t.patient_id
), paid AS (
  SELECT t.patient_id, SUM(l.amount_uzs) AS ltv
    FROM transaction_payment_legs l
    JOIN transactions t ON t.id = l.transaction_id
   WHERE NOT l.is_void AND l.kind IN ('payment', 'refund') AND l.method::text <> 'debt'
     AND t.patient_id IS NOT NULL
   GROUP BY t.patient_id
), base AS (
  SELECT p.id, p.clinic_id, p.full_name, p.phone, p.dob, p.gender,
         p.created_at AS registered_at,
         COALESCE(v.visit_count, 0)::bigint AS visit_count,
         COALESCE(pd.ltv, 0)::numeric AS ltv_uzs,
         v.last_visit
    FROM patients p
    LEFT JOIN visits v ON v.patient_id = p.id
    LEFT JOIN paid pd ON pd.patient_id = p.id
   WHERE p.deleted_at IS NULL
)
SELECT id, clinic_id, full_name, phone, dob, gender, registered_at, visit_count, ltv_uzs, last_visit,
       COALESCE((ltv_uzs / NULLIF(visit_count, 0)), 0)::bigint AS avg_check_uzs,
       CASE
         WHEN last_visit IS NULL AND registered_at < now() - interval '30 days' THEN 'never_visited'
         WHEN last_visit < now() - interval '90 days' THEN 'churned'
         WHEN last_visit < now() - interval '30 days' THEN 'at_risk'
         ELSE 'active'
       END AS churn_segment,
       CASE
         WHEN ltv_uzs > 5000000 AND visit_count >= 5 THEN 'vip'
         WHEN ltv_uzs > 1500000 AND visit_count >= 3 THEN 'regular'
         WHEN visit_count > 0 THEN 'occasional'
         ELSE 'new'
       END AS ltv_segment,
       (EXTRACT(days FROM (now() - COALESCE(last_visit, registered_at))))::integer
         AS days_since_last_activity
  FROM base;

-- ── 5) Statsionar xonalari (bo'sh xonalar ham) ───────────────────────────────
CREATE OR REPLACE VIEW public.inpatient_occupancy_view WITH (security_invoker = on) AS
SELECT r.clinic_id,
       r.id AS room_id,
       r.number AS room_number,
       r.type AS room_type,
       count(st.id) FILTER (WHERE st.discharged_at IS NULL) AS current_stays,
       COALESCE(sum(st.total_cost_uzs) FILTER (WHERE st.discharged_at IS NOT NULL), 0)::bigint
         AS revenue_uzs
  FROM rooms r
  LEFT JOIN inpatient_stays st ON st.room_id = r.id
 WHERE r.is_archived = false
 GROUP BY r.clinic_id, r.id, r.number, r.type;

-- Kassa farqi anomaliyasi: smenani kim yopgani (operator bo'lmasa — foydalanuvchi)
-- uchun user_id oxiriga qo'shiladi (view'da FK yo'q — API nomlarni alohida oladi)
CREATE OR REPLACE VIEW public.shift_cash_anomaly_view WITH (security_invoker = true) AS
WITH closed_shifts AS (
  SELECT s.*, abs(COALESCE(s.actual_cash_uzs, 0) - COALESCE(s.expected_cash_uzs, 0)) AS abs_diff
    FROM shifts s
   WHERE s.closed_at IS NOT NULL
), clinic_stats AS (
  SELECT clinic_id,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY abs_diff::double precision) AS q1,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY abs_diff::double precision) AS median,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY abs_diff::double precision) AS q3,
         count(*) AS sample_size
    FROM closed_shifts
   GROUP BY clinic_id
)
SELECT cs.id, cs.clinic_id, cs.opened_at, cs.closed_at, cs.opening_cash_uzs, cs.expected_cash_uzs,
       cs.actual_cash_uzs,
       (COALESCE(cs.actual_cash_uzs, 0) - COALESCE(cs.expected_cash_uzs, 0)) AS diff_uzs,
       cs.abs_diff, cs.operator_id, stats.q1, stats.q3, (stats.q3 - stats.q1) AS iqr,
       CASE
         WHEN stats.sample_size < 3 THEN 'insufficient_data'
         WHEN cs.abs_diff::double precision > stats.q3 + 1.5 * (stats.q3 - stats.q1)
              AND cs.abs_diff > 100000 THEN 'high_anomaly'
         WHEN cs.abs_diff::double precision > stats.q3 AND cs.abs_diff > 50000 THEN 'medium_anomaly'
         ELSE 'normal'
       END AS anomaly_level,
       cs.user_id
  FROM closed_shifts cs
  JOIN clinic_stats stats ON stats.clinic_id = cs.clinic_id;

-- ── 6) Hisobot quruvchi (BI) — xuddi shu tushum ta'rifi ─────────────────────
CREATE OR REPLACE FUNCTION public.analytics_query(
  p_clinic_id uuid, p_dimension text, p_grain text, p_from date, p_to date
)
RETURNS TABLE(bucket text, revenue_uzs bigint, tx_count bigint, avg_check_uzs bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH legs AS (
    SELECT l.*, t.cashier_id
      FROM transaction_payment_legs l
      JOIN transactions t ON t.id = l.transaction_id
     WHERE l.clinic_id = p_clinic_id
       AND NOT l.is_void
       AND l.kind IN ('payment', 'refund')
       AND l.method::text <> 'debt'
       AND l.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Tashkent')
       AND l.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent')
  )
  SELECT
    CASE p_dimension
      WHEN 'time' THEN to_char(date_trunc(
             CASE WHEN p_grain IN ('day', 'week', 'month') THEN p_grain ELSE 'day' END,
             (l.created_at AT TIME ZONE 'Asia/Tashkent')), 'YYYY-MM-DD')
      WHEN 'payment_method' THEN l.method::text
      WHEN 'register' THEN l.register
      WHEN 'source' THEN l.tx_source::text
      WHEN 'cashier' THEN COALESCE(pr.full_name, '—')
      ELSE 'all'
    END AS bucket,
    COALESCE(SUM(l.amount_uzs), 0)::bigint AS revenue_uzs,
    COUNT(DISTINCT l.transaction_id) FILTER (WHERE l.kind = 'payment' AND l.amount_uzs > 0)::bigint
      AS tx_count,
    (COALESCE(SUM(l.amount_uzs), 0)
      / NULLIF(COUNT(DISTINCT l.transaction_id) FILTER (WHERE l.kind = 'payment' AND l.amount_uzs > 0), 0))::bigint
      AS avg_check_uzs
  FROM legs l
  LEFT JOIN profiles pr ON pr.id = l.cashier_id
  GROUP BY 1
  ORDER BY 1;
$$;

-- ── Yangi agregat funksiyalar (1000 qator chegarasisiz, Toshkent kunlari) ────

-- Davr bo'yicha qo'shimcha ko'rsatkichlar
CREATE OR REPLACE FUNCTION public.analytics_period_extras(p_clinic uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Tashkent') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent') AS t1
  )
  SELECT jsonb_build_object(
    'new_patients', (SELECT count(*) FROM patients p, b
                      WHERE p.clinic_id = p_clinic AND p.deleted_at IS NULL
                        AND p.created_at >= b.t0 AND p.created_at < b.t1),
    'appointments', (SELECT count(*) FROM appointments a, b
                      WHERE a.clinic_id = p_clinic AND a.scheduled_at >= b.t0 AND a.scheduled_at < b.t1),
    'appointment_status', COALESCE((
       SELECT jsonb_object_agg(s, n) FROM (
         SELECT a.status::text AS s, count(*) AS n FROM appointments a, b
          WHERE a.clinic_id = p_clinic AND a.scheduled_at >= b.t0 AND a.scheduled_at < b.t1
          GROUP BY a.status) x), '{}'::jsonb),
    'payroll_uzs', (SELECT COALESCE(sum(d.net_uzs), 0) FROM doctor_payouts d, b
                     WHERE d.clinic_id = p_clinic AND d.status = 'paid'
                       AND d.paid_at >= b.t0 AND d.paid_at < b.t1),
    'debt_given_uzs', (SELECT COALESCE(sum(l.amount_uzs), 0) FROM transaction_payment_legs l, b
                        WHERE l.clinic_id = p_clinic AND NOT l.is_void AND l.kind = 'payment'
                          AND l.method::text = 'debt' AND l.amount_uzs > 0
                          AND l.created_at >= b.t0 AND l.created_at < b.t1),
    'refunds_uzs', (SELECT COALESCE(sum(-l.amount_uzs), 0) FROM transaction_payment_legs l, b
                     WHERE l.clinic_id = p_clinic AND NOT l.is_void AND l.amount_uzs < 0
                       AND l.kind IN ('payment', 'refund') AND l.method::text <> 'debt'
                       AND l.created_at >= b.t0 AND l.created_at < b.t1),
    'inpatient_charges_uzs', (SELECT COALESCE(sum(abs(pl.amount_uzs)), 0) FROM patient_ledger pl, b
                               WHERE pl.clinic_id = p_clinic AND pl.entry_kind = 'charge'
                                 AND pl.stay_id IS NOT NULL
                                 AND pl.created_at >= b.t0 AND pl.created_at < b.t1),
    'inpatient_charges_count', (SELECT count(*) FROM patient_ledger pl, b
                                 WHERE pl.clinic_id = p_clinic AND pl.entry_kind = 'charge'
                                   AND pl.stay_id IS NOT NULL
                                   AND pl.created_at >= b.t0 AND pl.created_at < b.t1)
  );
$$;

-- Shifokorlar: davr bo'yicha (bemorlar soni davr bo'yicha NOYOB) + komissiya.
-- Faol shifokorlar faoliyatsiz ham (0 bilan), faoliyati bor har kim ham.
CREATE OR REPLACE FUNCTION public.analytics_doctors(p_clinic uuid, p_from date, p_to date)
RETURNS TABLE (doctor_id uuid, doctor_name text, visits bigint, patients bigint,
               revenue_uzs bigint, commission_uzs bigint, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Tashkent') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent') AS t1
  ), tx AS (
    SELECT t.id, t.patient_id,
           COALESCE(t.doctor_id, a.doctor_id) AS doctor_id,
           date(t.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
           (SELECT COALESCE(SUM(i.final_amount_uzs), 0) FROM transaction_items i
             WHERE i.transaction_id = t.id) AS items_uzs
      FROM transactions t
      LEFT JOIN appointments a ON a.id = t.appointment_id, b
     WHERE t.clinic_id = p_clinic AND NOT t.is_void AND t.kind = 'payment' AND t.amount_uzs >= 0
       AND t.created_at >= b.t0 AND t.created_at < b.t1
  ), act AS (
    SELECT doctor_id,
           count(DISTINCT (COALESCE(patient_id, id), day)) AS visits,
           count(DISTINCT patient_id) AS patients,
           COALESCE(sum(items_uzs), 0) AS revenue
      FROM tx WHERE doctor_id IS NOT NULL AND items_uzs > 0
     GROUP BY doctor_id
  ), comm AS (
    SELECT dc.doctor_id, COALESCE(sum(dc.amount_uzs), 0) AS amount
      FROM doctor_commissions dc, b
     WHERE dc.clinic_id = p_clinic AND dc.status IN ('accrued', 'paid')
       AND dc.created_at >= b.t0 AND dc.created_at < b.t1
     GROUP BY dc.doctor_id
  ), ids AS (
    SELECT doctor_id FROM act
    UNION SELECT doctor_id FROM comm
    UNION SELECT id FROM profiles
           WHERE clinic_id = p_clinic AND role = 'doctor' AND is_active AND deleted_at IS NULL
  )
  SELECT ids.doctor_id, COALESCE(p.full_name, 'Nomaʼlum'),
         COALESCE(act.visits, 0)::bigint, COALESCE(act.patients, 0)::bigint,
         COALESCE(act.revenue, 0)::bigint, COALESCE(comm.amount, 0)::bigint,
         COALESCE(p.is_active, false)
    FROM ids
    LEFT JOIN profiles p ON p.id = ids.doctor_id
    LEFT JOIN act ON act.doctor_id = ids.doctor_id
    LEFT JOIN comm ON comm.doctor_id = ids.doctor_id
   ORDER BY COALESCE(act.revenue, 0) DESC, COALESCE(p.full_name, '');
$$;

-- Xizmatlar: soni (miqdor bilan), summa, tannarx + kunlik dinamika va shifokorlar
CREATE OR REPLACE FUNCTION public.analytics_services(
  p_clinic uuid, p_from date, p_to date, p_limit int DEFAULT 20
)
RETURNS TABLE (service_key text, service_name text, qty bigint, revenue_uzs bigint,
               cost_uzs bigint, daily jsonb, doctors jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Tashkent') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent') AS t1
  ), it AS (
    SELECT COALESCE(i.service_id::text, i.lab_test_id::text, i.diagnostic_type_id::text,
                    i.medication_id::text, COALESCE(i.service_name_snapshot, '—')) AS k,
           COALESCE(i.service_name_snapshot, '—') AS name,
           GREATEST(COALESCE(i.quantity, 1), 1) AS q,
           COALESCE(i.final_amount_uzs, 0) AS amt,
           COALESCE(i.cost_snapshot_uzs, 0) AS cost,
           date(t.created_at AT TIME ZONE 'Asia/Tashkent') AS day,
           COALESCE(t.doctor_id, a.doctor_id) AS doctor_id
      FROM transaction_items i
      JOIN transactions t ON t.id = i.transaction_id
      LEFT JOIN appointments a ON a.id = t.appointment_id, b
     WHERE t.clinic_id = p_clinic AND NOT t.is_void AND t.kind = 'payment'
       AND t.created_at >= b.t0 AND t.created_at < b.t1
  ), agg AS (
    SELECT k, max(name) AS name, sum(q) AS qty, sum(amt) AS rev, sum(cost) AS cost
      FROM it GROUP BY k
     ORDER BY sum(amt) DESC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200))
  )
  SELECT agg.k, agg.name, agg.qty::bigint, agg.rev::bigint, agg.cost::bigint,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'count', d.q, 'revenue', d.r)
                                    ORDER BY d.day)
                     FROM (SELECT day, sum(q) AS q, sum(amt) AS r FROM it
                            WHERE it.k = agg.k GROUP BY day) d), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('name', COALESCE(p.full_name, '—'), 'times', x.n)
                                    ORDER BY x.n DESC)
                     FROM (SELECT doctor_id, sum(q) AS n FROM it
                            WHERE it.k = agg.k AND doctor_id IS NOT NULL GROUP BY doctor_id) x
                     LEFT JOIN profiles p ON p.id = x.doctor_id), '[]'::jsonb)
    FROM agg
   ORDER BY agg.rev DESC;
$$;

-- Soat × hafta kuni (Toshkent) — to'lov cheklari soni
CREATE OR REPLACE FUNCTION public.analytics_heatmap(p_clinic uuid, p_from date, p_to date)
RETURNS TABLE (dow int, hour int, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXTRACT(dow FROM (t.created_at AT TIME ZONE 'Asia/Tashkent'))::int,
         EXTRACT(hour FROM (t.created_at AT TIME ZONE 'Asia/Tashkent'))::int,
         count(*)
    FROM transactions t
   WHERE t.clinic_id = p_clinic AND NOT t.is_void AND t.kind = 'payment' AND t.amount_uzs > 0
     AND t.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Tashkent')
     AND t.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent')
   GROUP BY 1, 2;
$$;

-- Bemor segmentlari — butun klinika bo'yicha jamlanma + top ro'yxatlar
CREATE OR REPLACE FUNCTION public.analytics_patient_segments(p_clinic uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM patient_segments_view WHERE clinic_id = p_clinic)
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'total', (SELECT count(*) FROM s),
      'by_ltv', jsonb_build_object(
        'vip', (SELECT count(*) FROM s WHERE ltv_segment = 'vip'),
        'regular', (SELECT count(*) FROM s WHERE ltv_segment = 'regular'),
        'occasional', (SELECT count(*) FROM s WHERE ltv_segment = 'occasional'),
        'new', (SELECT count(*) FROM s WHERE ltv_segment = 'new')),
      'by_churn', jsonb_build_object(
        'active', (SELECT count(*) FROM s WHERE churn_segment = 'active'),
        'at_risk', (SELECT count(*) FROM s WHERE churn_segment = 'at_risk'),
        'churned', (SELECT count(*) FROM s WHERE churn_segment = 'churned'),
        'never_visited', (SELECT count(*) FROM s WHERE churn_segment = 'never_visited')),
      'total_ltv_uzs', (SELECT COALESCE(sum(ltv_uzs), 0) FROM s)),
    'at_risk_top', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ltv_uzs DESC) FROM (
        SELECT id, full_name, phone, ltv_uzs, visit_count, last_visit, days_since_last_activity
          FROM s WHERE churn_segment IN ('at_risk', 'churned')
         ORDER BY ltv_uzs DESC LIMIT 10) x), '[]'::jsonb),
    'vip_top', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ltv_uzs DESC) FROM (
        SELECT id, full_name, phone, ltv_uzs, visit_count, avg_check_uzs
          FROM s WHERE ltv_segment = 'vip'
         ORDER BY ltv_uzs DESC LIMIT 10) x), '[]'::jsonb)
  );
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'analytics_period_extras(uuid, date, date)',
    'analytics_doctors(uuid, date, date)',
    'analytics_services(uuid, date, date, int)',
    'analytics_heatmap(uuid, date, date)',
    'analytics_patient_segments(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
