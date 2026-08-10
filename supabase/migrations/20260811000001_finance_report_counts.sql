-- =============================================================================
-- HISOBOT: USUL KESIMIDA YOZUVLAR SONI (kritik tuzatish)
-- =============================================================================
-- BAG (2026-08-11, MAGNUS):
-- `finance_period_flows` faqat UMUMIY `rev_count` ni qaytarardi — naqd/plastik/
-- o'tkazma qatorlari uchun son YO'Q edi. Natijada hisobotdagi "Soni" ustuni
-- bo'sh qolardi va PDF'da u `0` bo'lib chiqardi (bo'sh qiymat raqamga
-- aylantirilgani uchun). Ya'ni hisobot "naqd savdo 12 000 000 so'm, 0 ta amal"
-- deb yozardi.
--
-- Bu shunchaki kosmetik emas: SON — summani tekshirishning yagona tez usuli.
-- Sonisiz raqam to'g'ri yoki noto'g'ri ekanini bilishning iloji yo'q, chuqur
-- izlanishdagi qatorlar bilan solishtirib ham bo'lmaydi.
--
-- Qo'shildi:
--   rev_cash_count / rev_card_count / rev_transfer_count / rev_other_count
--   ref_cash_count / ref_card_count / ref_transfer_count / ref_other_count
--   safe_deposit_count / safe_out_count
--
-- Bundan tashqari `rev` endi `amount_uzs >= 0` bo'yicha sanaydi (avval `> 0`).
-- Sabab: `finance_period_rows` ning 'revenue' bo'limi nol summali oyoqni ham
-- qaytaradi. Ikkalasi bir xil bo'lmasa, chuqur izlanishdagi qatorlar soni
-- hisobotdagi son bilan mos kelmasdi. Yig'indi o'zgarmaydi (nol qo'shiladi).
--
-- CREATE OR REPLACE qaytish turini o'zgartira olmaydi → DROP + CREATE.
-- =============================================================================

DROP FUNCTION IF EXISTS public.finance_period_flows(uuid, date, date, text);

CREATE FUNCTION public.finance_period_flows(
  p_clinic   uuid,
  p_from     date,
  p_to       date,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  -- Tushum (to'lovlar) — har usul uchun summa VA soni
  rev_cash_uzs        bigint,
  rev_cash_count      bigint,
  rev_card_uzs        bigint,
  rev_card_count      bigint,
  rev_transfer_uzs    bigint,
  rev_transfer_count  bigint,
  rev_other_uzs       bigint,
  rev_other_count     bigint,
  rev_total_uzs       bigint,
  rev_count           bigint,
  -- Vozvrat
  ref_cash_uzs        bigint,
  ref_cash_count      bigint,
  ref_card_uzs        bigint,
  ref_card_count      bigint,
  ref_transfer_uzs    bigint,
  ref_transfer_count  bigint,
  ref_other_uzs       bigint,
  ref_other_count     bigint,
  ref_total_uzs       bigint,
  ref_count           bigint,
  -- Qarzga berilgan (pul kelmagan — daromadga kirmaydi)
  debt_uzs            bigint,
  debt_count          bigint,
  -- Rasxot
  exp_cash_uzs        bigint,
  exp_safe_uzs        bigint,
  exp_noncash_uzs     bigint,
  exp_total_uzs       bigint,
  exp_count           bigint,
  -- Maosh (to'langan)
  pay_cash_uzs        bigint,
  pay_safe_uzs        bigint,
  pay_noncash_uzs     bigint,
  pay_total_uzs       bigint,
  pay_count           bigint,
  -- Ichki ko'chirmalar
  encashed_uzs        bigint,
  encash_count        bigint,
  settled_bank_uzs    bigint,
  settled_bank_count  bigint,
  settled_safe_uzs    bigint,
  settled_safe_count  bigint,
  settle_count        bigint,
  safe_deposit_uzs    bigint,
  safe_deposit_count  bigint,
  safe_out_tx_uzs     bigint,
  safe_out_count      bigint,
  -- Naqd tuzatishlar (inkasatsiyadan tashqari, ishorali)
  adj_cash_uzs        bigint,
  adj_count           bigint,
  -- Hisoblangan (accrual) mehnat xarajati
  commission_uzs      bigint,
  -- Dorixona (ma'lumot uchun)
  pharm_revenue_uzs   bigint,
  pharm_profit_uzs    bigint,
  pharm_debt_uzs      bigint,
  pharm_count         bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH legs AS (
    SELECT kind, amount_uzs, notes, tx_source,
           finance_method_class(method::text) AS cls
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic
      AND register  = p_register
      AND is_void   = false
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  money AS (  -- haqiqiy pul harakati (qarz emas)
    SELECT * FROM legs
    WHERE cls IN ('cash', 'card', 'transfer', 'other')
      AND (tx_source IS NULL OR tx_source::text <> 'safe')
  ),
  rev AS (
    -- `>= 0`: finance_period_rows ning 'revenue' bo'limi bilan AYNAN bir xil
    -- to'plam bo'lsin (chuqur izlanishdagi qatorlar soni mos kelishi uchun).
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'cash'), 0)::bigint     c,
      COUNT(*) FILTER (WHERE cls = 'cash')::bigint                         cn,
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'card'), 0)::bigint     k,
      COUNT(*) FILTER (WHERE cls = 'card')::bigint                         kn,
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'transfer'), 0)::bigint t,
      COUNT(*) FILTER (WHERE cls = 'transfer')::bigint                     tn,
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'other'), 0)::bigint    o,
      COUNT(*) FILTER (WHERE cls = 'other')::bigint                        onn,
      COUNT(*)::bigint                                                     n
    FROM money WHERE kind = 'payment' AND amount_uzs >= 0
  ),
  ref AS (
    SELECT
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'cash'), 0)::bigint     c,
      COUNT(*) FILTER (WHERE cls = 'cash')::bigint                              cn,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'card'), 0)::bigint     k,
      COUNT(*) FILTER (WHERE cls = 'card')::bigint                              kn,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'transfer'), 0)::bigint t,
      COUNT(*) FILTER (WHERE cls = 'transfer')::bigint                          tn,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'other'), 0)::bigint    o,
      COUNT(*) FILTER (WHERE cls = 'other')::bigint                             onn,
      COUNT(*)::bigint                                                          n
    FROM money WHERE kind = 'refund' OR (kind = 'payment' AND amount_uzs < 0)
  ),
  dbt AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint s, COUNT(*)::bigint n
    FROM legs WHERE cls = 'debt' AND kind = 'payment'
  ),
  enc AS (
    SELECT COALESCE(SUM(abs(amount_uzs)), 0)::bigint s, COUNT(*)::bigint n
    FROM money
    WHERE cls = 'cash' AND kind = 'adjustment'
      AND lower(COALESCE(notes, '')) LIKE '%inkasatsiya%'
  ),
  adj AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint s, COUNT(*)::bigint n
    FROM money
    WHERE cls = 'cash' AND kind = 'adjustment'
      AND lower(COALESCE(notes, '')) NOT LIKE '%inkasatsiya%'
  ),
  ex AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE finance_method_class(payment_method::text) = 'cash'
          AND (source IS NULL OR source::text <> 'safe')
      ), 0)::bigint c,
      COALESCE(SUM(amount_uzs) FILTER (WHERE source::text = 'safe'), 0)::bigint s,
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE finance_method_class(payment_method::text) <> 'cash'
      ), 0)::bigint nc,
      COALESCE(SUM(amount_uzs), 0)::bigint tot,
      COUNT(*)::bigint n
    FROM expenses
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND COALESCE(expense_date, (created_at AT TIME ZONE 'Asia/Tashkent')::date)
          BETWEEN p_from AND p_to
  ),
  pr AS (
    SELECT
      COALESCE(SUM(net_uzs) FILTER (
        WHERE finance_method_class(method::text) = 'cash'
          AND (source IS NULL OR source::text <> 'safe')
      ), 0)::bigint c,
      COALESCE(SUM(net_uzs) FILTER (WHERE source::text = 'safe'), 0)::bigint s,
      COALESCE(SUM(net_uzs) FILTER (
        WHERE finance_method_class(method::text) <> 'cash'
      ), 0)::bigint nc,
      COALESCE(SUM(net_uzs), 0)::bigint tot,
      COUNT(*)::bigint n
    FROM doctor_payouts
    WHERE clinic_id = p_clinic AND status = 'paid' AND p_register = 'reception'
      AND (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Tashkent')::date
          BETWEEN p_from AND p_to
  ),
  st AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE destination = 'bank'), 0)::bigint b,
      COUNT(*) FILTER (WHERE destination = 'bank')::bigint                     bn,
      COALESCE(SUM(amount_uzs) FILTER (WHERE destination = 'safe'), 0)::bigint sf,
      COUNT(*) FILTER (WHERE destination = 'safe')::bigint                     sfn,
      COUNT(*)::bigint n
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  dep AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint s, COUNT(*)::bigint n
    FROM safe_deposits
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  safeout AS (
    SELECT COALESCE(SUM(abs(amount_uzs)), 0)::bigint s, COUNT(*)::bigint n
    FROM transactions
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND source::text = 'safe'
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  comm AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint s
    FROM doctor_commissions
    WHERE clinic_id = p_clinic AND status <> 'reversed' AND p_register = 'reception'
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  ph AS (
    SELECT
      COALESCE(SUM(s.total_uzs), 0)::bigint rev,
      COALESCE(SUM(s.debt_uzs), 0)::bigint  dbt,
      COUNT(*)::bigint                      n
    FROM pharmacy_sales s
    WHERE s.clinic_id = p_clinic AND s.is_void = false AND p_register = 'reception'
      AND (s.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  ph_profit AS (
    SELECT COALESCE(SUM(i.profit_uzs), 0)::bigint p
    FROM pharmacy_sale_items i
    JOIN pharmacy_sales s ON s.id = i.sale_id
    WHERE s.clinic_id = p_clinic AND s.is_void = false AND p_register = 'reception'
      AND (s.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  )
  SELECT
    rev.c, rev.cn, rev.k, rev.kn, rev.t, rev.tn, rev.o, rev.onn,
    (rev.c + rev.k + rev.t + rev.o)::bigint, rev.n,
    ref.c, ref.cn, ref.k, ref.kn, ref.t, ref.tn, ref.o, ref.onn,
    (ref.c + ref.k + ref.t + ref.o)::bigint, ref.n,
    dbt.s, dbt.n,
    ex.c, ex.s, ex.nc, ex.tot, ex.n,
    pr.c, pr.s, pr.nc, pr.tot, pr.n,
    enc.s, enc.n,
    st.b, st.bn, st.sf, st.sfn, st.n,
    dep.s, dep.n,
    safeout.s, safeout.n,
    adj.s, adj.n,
    comm.s,
    ph.rev, ph_profit.p, ph.dbt, ph.n
  FROM rev, ref, dbt, ex, pr, enc, adj, st, dep, safeout, comm, ph, ph_profit;
$$;

COMMENT ON FUNCTION public.finance_period_flows(uuid, date, date, text) IS
  'Davr aylanmasi: tushum/vozvrat (usul kesimida SUMMA VA SONI), rasxot, maosh, inkasatsiya, hisob-kitob, seyf, komissiya, dorixona.';

REVOKE ALL ON FUNCTION public.finance_period_flows(uuid, date, date, text) FROM public;
REVOKE ALL ON FUNCTION public.finance_period_flows(uuid, date, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.finance_period_flows(uuid, date, date, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finance_period_flows(uuid, date, date, text) TO service_role;

NOTIFY pgrst, 'reload schema';
