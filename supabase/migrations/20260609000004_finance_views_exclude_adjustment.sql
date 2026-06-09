-- =============================================================================
-- Clary v2 — Migration 20260609000004: Moliya view'lari — inkasatsiya tuzatish
-- MUAMMO: daily_revenue_view / daily_revenue_history_view kind='adjustment'
-- (inkasatsiya — seyfga olish) ni daromadga qo'shardi (ELSE amount_uzs). Manfiy
-- summa bo'lgani uchun Analitika/Jurnal tushumini KAMAYTIRARDI (MAGNUS 8.3M→1.4M,
-- MUSLIMA 1.83M→0). Kassa kpis() allaqachon adjustment'ni skip qiladi.
-- YECHIM: revenue view'larida `kind <> 'adjustment'`; expense view'da is_void.
-- security_invoker saqlanadi (security advisor regressiyasidan qochish).
-- =============================================================================

CREATE OR REPLACE VIEW daily_revenue_view
WITH (security_invoker = true) AS
SELECT clinic_id,
    date((created_at AT TIME ZONE 'Asia/Tashkent')) AS day,
    sum(CASE WHEN kind = 'refund' THEN -amount_uzs ELSE amount_uzs END)::bigint AS revenue_uzs,
    count(*)::integer AS transactions
FROM transactions t
WHERE is_void = false AND kind <> 'adjustment'
GROUP BY clinic_id, date((created_at AT TIME ZONE 'Asia/Tashkent'));

CREATE OR REPLACE VIEW daily_revenue_history_view
WITH (security_invoker = true) AS
SELECT clinic_id,
    date((created_at AT TIME ZONE 'Asia/Tashkent')) AS day,
    EXTRACT(dow FROM (created_at AT TIME ZONE 'Asia/Tashkent'))::integer AS dow,
    sum(CASE WHEN kind = 'refund' THEN -amount_uzs ELSE amount_uzs END) AS revenue_uzs,
    count(*) FILTER (WHERE kind = 'payment') AS tx_count
FROM transactions
WHERE is_void = false AND kind <> 'adjustment' AND created_at >= (now() - '90 days'::interval)
GROUP BY clinic_id, date((created_at AT TIME ZONE 'Asia/Tashkent')),
         EXTRACT(dow FROM (created_at AT TIME ZONE 'Asia/Tashkent'))::integer;

CREATE OR REPLACE VIEW daily_expense_view
WITH (security_invoker = true) AS
SELECT clinic_id, expense_date AS day, sum(amount_uzs)::bigint AS expenses_uzs
FROM expenses e
WHERE is_void = false
GROUP BY clinic_id, expense_date;
