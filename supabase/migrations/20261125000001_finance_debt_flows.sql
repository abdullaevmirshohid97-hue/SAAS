-- =============================================================================
-- BEMOR QARZI — hisobotlardagi "Qarzga berilgan" qatori (A0, 2026-11-25)
-- =============================================================================
-- Muammo: analitika va oylik moliyaviy hisobot qarzni `transaction_payment_legs`
-- dagi method='debt' oyog'idan sanardi. Qabulxona esa qarzni u yerga YOZMAYDI —
-- faqat `patient_ledger` ga (entry_kind='charge', manfiy) yozadi. Natija: butun
-- platformada "Qarzga berilgan" doim 0 (MAGNUS 11.10–10.11: haqiqatda 475 000).
--
-- Yechim — manba `patient_ledger` (Qarzdorlar daftari ham shundan o'qiydi):
--   given     — davrda berilgan qabulxona qarzi: har bekor qilinmagan to'lov cheki
--               bo'yicha SOF qarz (charge + shu chekka bog'langan tuzatishlar),
--               chek sanasi bo'yicha. Chek o'chirilsa (is_void) — sanalmaydi.
--   collected — davrda undirilgan qarz ("Qarz to'lash" depoziti, statsionarsiz).
--   outstanding_* — sanadagi jami bemor qarzi (manfiy balansli bemorlar
--               yig'indisi). Ayniyat: start + given − collected ± tuzatish = end.
-- Faqat yangi funksiyalar — mavjud jadval/funksiyalarga TEGILMAYDI. Idempotent.
-- Statsionar (stay_id bor) charge'lari bu yerda "qarzga berildi" emas — ular
-- yotgan bemorning hisob-kitobi; ular faqat outstanding_total ga kiradi.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finance_debt_flows(p_clinic uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Tashkent') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent') AS t1
  ), given AS (
    SELECT t.id, -SUM(l.amount_uzs) AS net
      FROM patient_ledger l
      JOIN transactions t ON t.id = l.transaction_id, b
     WHERE l.clinic_id = p_clinic
       AND l.stay_id IS NULL
       AND l.entry_kind IN ('charge', 'adjustment')
       AND t.kind = 'payment' AND NOT t.is_void
       AND t.created_at >= b.t0 AND t.created_at < b.t1
     GROUP BY t.id
  ), coll AS (
    SELECT COALESCE(SUM(l.amount_uzs), 0) AS s, COUNT(*) AS n
      FROM patient_ledger l
      JOIN transactions t ON t.id = l.transaction_id, b
     WHERE l.clinic_id = p_clinic
       AND l.stay_id IS NULL
       AND l.entry_kind = 'deposit'
       AND NOT t.is_void
       AND l.created_at >= b.t0 AND l.created_at < b.t1
  ), bal AS (
    SELECT l.patient_id,
           SUM(l.amount_uzs) FILTER (WHERE l.created_at < b.t0) AS at_start,
           SUM(l.amount_uzs) FILTER (WHERE l.created_at < b.t1) AS at_end,
           SUM(l.amount_uzs) FILTER (WHERE l.created_at < b.t1 AND l.stay_id IS NULL) AS at_end_reception
      FROM patient_ledger l, b
     WHERE l.clinic_id = p_clinic
     GROUP BY l.patient_id
  )
  SELECT jsonb_build_object(
    'given_uzs',       (SELECT COALESCE(SUM(GREATEST(net, 0)), 0) FROM given),
    'given_count',     (SELECT COUNT(*) FILTER (WHERE net > 0) FROM given),
    'collected_uzs',   (SELECT s FROM coll),
    'collected_count', (SELECT n FROM coll),
    'outstanding_start_uzs', (SELECT COALESCE(SUM(GREATEST(-at_start, 0)), 0) FROM bal),
    'outstanding_end_uzs',   (SELECT COALESCE(SUM(GREATEST(-at_end, 0)), 0) FROM bal),
    'outstanding_reception_end_uzs',
                             (SELECT COALESCE(SUM(GREATEST(-at_end_reception, 0)), 0) FROM bal),
    'debtors_end',           (SELECT COUNT(*) FILTER (WHERE at_end < 0) FROM bal)
  );
$$;

-- Chuqur izlanish: "Qarzga berilgan" raqami ortidagi cheklar. Ustunlar
-- `finance_period_rows` bilan bir xil (veb jadvali o'zgarmaydi).
CREATE OR REPLACE FUNCTION public.finance_debt_rows(
  p_clinic uuid, p_from date, p_to date, p_limit int DEFAULT 500, p_offset int DEFAULT 0
)
RETURNS TABLE (
  occurred_at timestamptz, doc_type text, doc_id uuid, party text, description text,
  method text, method_class text, source text, direction text, amount_uzs bigint, who text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Tashkent') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent') AS t1
  ), given AS (
    SELECT t.id, t.created_at, t.patient_id, t.cashier_id, -SUM(l.amount_uzs) AS net
      FROM patient_ledger l
      JOIN transactions t ON t.id = l.transaction_id, b
     WHERE l.clinic_id = p_clinic
       AND l.stay_id IS NULL
       AND l.entry_kind IN ('charge', 'adjustment')
       AND t.kind = 'payment' AND NOT t.is_void
       AND t.created_at >= b.t0 AND t.created_at < b.t1
     GROUP BY t.id, t.created_at, t.patient_id, t.cashier_id
  )
  SELECT g.created_at, 'transaction'::text, g.id, COALESCE(p.full_name, '—'),
         'Qarzga berilgan xizmat'::text, 'debt'::text, 'debt'::text, ''::text,
         'in'::text, g.net::bigint, COALESCE(pr.full_name, '—')
    FROM given g
    LEFT JOIN patients p ON p.id = g.patient_id
    LEFT JOIN profiles pr ON pr.id = g.cashier_id
   WHERE g.net > 0
   ORDER BY g.created_at DESC
   LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$$;

-- Xavfsizlik: faqat API (service_role) chaqiradi — brauzer to'g'ridan-to'g'ri emas.
REVOKE ALL ON FUNCTION public.finance_debt_flows(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_debt_rows(uuid, date, date, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_debt_flows(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_debt_rows(uuid, date, date, int, int) TO service_role;

NOTIFY pgrst, 'reload schema';
