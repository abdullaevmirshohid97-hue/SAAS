-- =============================================================================
-- KASSA HISOB-KITOBI — SERVER TOMONIDA (PostgREST 1000 QATOR CHEKLOVI TUZATILDI)
-- =============================================================================
-- ⚠️ KRITIK MOLIYAVIY BAG (MAGNUS, 2026-08-08):
-- `cashOnHand` funksiyasi `transaction_payment_legs` ni `.limit()` SIZ o'qirdi.
-- PostgREST esa javobni STANDART 1000 QATOR bilan cheklaydi va buni hech qanday
-- xato bilan bildirmaydi — shunchaki qolgan qatorlarni bermaydi.
--
-- MAGNUS'da 1613 ta naqd yozuv bor. Natijada:
--     haqiqiy:  101 865 000 − 73 585 000 − 20 000 = 28 260 000
--     API'da:    62 305 000 − 56 635 000 − 20 000 =  5 650 000   ❌
-- Ekranda "Seyfga o'tmagan naqd" 5 650 000 ko'rinardi — ya'ni 22 610 000 so'm
-- KAM. Bu shunchaki ko'rinish emas: `assertCashOut` shu raqamga qarab
-- inkasatsiyani bloklaydi, ya'ni kassir haqiqatda bor pulni seyfga o'tkaza
-- olmasdi.
--
-- YECHIM: yig'indini bazaning O'ZIDA hisoblash. Bitta qator qaytadi —
-- cheklovga tushmaydi, ustiga ustak ancha tez.
--
-- Bu funksiyalar API tomonidan service_role bilan chaqiriladi. SECURITY
-- DEFINER QILINMAGAN (ataylab): shunda RLS oddiy tarzda ishlaydi va
-- "policy ichidagi funksiyaga EXECUTE" muammosi tug'ilmaydi.
-- =============================================================================

-- --- 1) Kassadagi naqd (drawer) — yagona qator -------------------------------
CREATE OR REPLACE FUNCTION public.cashier_cash_on_hand(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  cash_in_uzs      bigint,
  refunds_uzs      bigint,
  encashed_uzs     bigint,
  adjustments_uzs  bigint,
  expenses_uzs     bigint,
  payroll_uzs      bigint,
  cash_on_hand_uzs bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH legs AS (
    SELECT kind, amount_uzs, notes
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic
      AND register  = p_register
      AND is_void   = false
      AND method::text = 'cash'
      AND (tx_source IS NULL OR tx_source::text <> 'safe')
  ),
  agg AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind = 'payment'), 0)::bigint AS cash_in,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE kind = 'refund'), 0)::bigint AS refunds,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE kind = 'adjustment' AND lower(COALESCE(notes, '')) LIKE '%inkasatsiya%'
      ), 0)::bigint AS encashed,
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE kind = 'adjustment' AND lower(COALESCE(notes, '')) NOT LIKE '%inkasatsiya%'
      ), 0)::bigint AS adj
    FROM legs
  ),
  exp AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint AS e
    FROM expenses
    WHERE clinic_id = p_clinic
      AND register  = p_register
      AND is_void   = false
      AND (source IS NULL OR source::text <> 'safe')
      AND COALESCE(payment_method::text, 'cash') = 'cash'
  ),
  pay AS (
    -- Maosh klinika darajasida — faqat qabulxona kassasidan.
    SELECT CASE WHEN p_register = 'reception'
                THEN COALESCE(SUM(net_uzs), 0) ELSE 0 END::bigint AS p
    FROM doctor_payouts
    WHERE clinic_id = p_clinic
      AND status = 'paid'
      AND (source IS NULL OR source::text <> 'safe')
      AND COALESCE(method::text, 'cash') = 'cash'
  )
  SELECT agg.cash_in, agg.refunds, agg.encashed, agg.adj, exp.e, pay.p,
         (agg.cash_in - agg.refunds - agg.encashed + agg.adj - exp.e - pay.p)::bigint
  FROM agg, exp, pay;
$$;

-- --- 2) Oylik taqsimot (audit sahifasi) --------------------------------------
CREATE OR REPLACE FUNCTION public.cashier_cash_periods(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  period          text,
  cash_in_uzs     bigint,
  card_in_uzs     bigint,
  transfer_in_uzs bigint,
  other_in_uzs    bigint,
  encashed_uzs    bigint,
  refunds_uzs     bigint,
  adjustments_uzs bigint,
  expenses_uzs    bigint,
  payroll_uzs     bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH legs AS (
    SELECT to_char(created_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') AS p,
           kind, method::text AS method, amount_uzs, tx_source, notes
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
  ),
  tx AS (
    SELECT p,
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind='payment' AND amount_uzs>0 AND method='cash'),0)::bigint     c_in,
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind='payment' AND amount_uzs>0 AND method='card'),0)::bigint     card_in,
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind='payment' AND amount_uzs>0 AND method='transfer'),0)::bigint tr_in,
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE kind='payment' AND amount_uzs>0 AND method NOT IN ('cash','card','transfer')),0)::bigint         oth_in,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE method='cash' AND (tx_source IS NULL OR tx_source::text<>'safe')
          AND kind='adjustment' AND lower(COALESCE(notes,'')) LIKE '%inkasatsiya%'),0)::bigint                 enc,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE method='cash' AND (tx_source IS NULL OR tx_source::text<>'safe')
          AND (kind='refund' OR (kind='payment' AND amount_uzs<0))),0)::bigint                                 ref,
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE method='cash' AND (tx_source IS NULL OR tx_source::text<>'safe')
          AND kind='adjustment' AND lower(COALESCE(notes,'')) NOT LIKE '%inkasatsiya%'),0)::bigint             adj
    FROM legs GROUP BY p
  ),
  ex AS (
    SELECT to_char(COALESCE(expense_date::timestamptz, created_at) AT TIME ZONE 'Asia/Tashkent','YYYY-MM') p,
           COALESCE(SUM(amount_uzs),0)::bigint e
    FROM expenses
    WHERE clinic_id=p_clinic AND register=p_register AND is_void=false
      AND (source IS NULL OR source::text<>'safe')
      AND COALESCE(payment_method::text,'cash')='cash'
    GROUP BY 1
  ),
  pay AS (
    SELECT to_char(COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Tashkent','YYYY-MM') p,
           COALESCE(SUM(net_uzs),0)::bigint n
    FROM doctor_payouts
    WHERE clinic_id=p_clinic AND status='paid' AND p_register='reception'
      AND (source IS NULL OR source::text<>'safe')
      AND COALESCE(method::text,'cash')='cash'
    GROUP BY 1
  ),
  months AS (
    SELECT p FROM tx UNION SELECT p FROM ex UNION SELECT p FROM pay
  )
  SELECT m.p,
    COALESCE(tx.c_in,0), COALESCE(tx.card_in,0), COALESCE(tx.tr_in,0), COALESCE(tx.oth_in,0),
    COALESCE(tx.enc,0), COALESCE(tx.ref,0), COALESCE(tx.adj,0),
    COALESCE(ex.e,0), COALESCE(pay.n,0)
  FROM months m
  LEFT JOIN tx  ON tx.p  = m.p
  LEFT JOIN ex  ON ex.p  = m.p
  LEFT JOIN pay ON pay.p = m.p
  ORDER BY m.p;
$$;

-- --- 3) To'lov usuli bo'yicha jami (audit sahifasi) --------------------------
CREATE OR REPLACE FUNCTION public.cashier_method_totals(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (method text, cnt bigint, total_uzs bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(method::text, 'unknown'), COUNT(*)::bigint, SUM(amount_uzs)::bigint
  FROM transaction_payment_legs
  WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
    AND kind = 'payment' AND amount_uzs > 0
  GROUP BY 1
  ORDER BY 3 DESC;
$$;

NOTIFY pgrst, 'reload schema';
