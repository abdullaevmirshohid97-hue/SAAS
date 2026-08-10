-- =============================================================================
-- MOLIYAVIY HISOBOT — DAVR BO'YICHA (BANK KO'CHIRMASI STANDARTI)
-- =============================================================================
-- MUAMMO (MAGNUS, 2026-08-10):
-- Klinika har oyning 10-sanasida "oy yopadi" va o'sha davr uchun bitta hisobot
-- oladi. Tizimda esa buni qilishning iloji YO'Q edi:
--
--   1. Barcha balanslar (`cashier_cash_on_hand`, `safeBalance`,
--      `cashier_noncash_balance`) BUTUN TARIX bo'yicha hisoblanadi — "hozir
--      qancha pul bor" degan savolga javob beradi. "11-iyul kuni seyfda qancha
--      pul bor edi?" degan savolga javob YO'Q.
--   2. Analitika (`analytics_query`) faqat TUSHUMni biladi: rasxot, maosh,
--      inkasatsiya, seyf harakati umuman ko'rinmaydi.
--   3. Davr chegarasi kalendar oyga qotib qolgan — 11-iyul → 10-avgust kabi
--      oraliq umuman qo'llab-quvvatlanmaydi.
--
-- YECHIM — BANK KO'CHIRMASI MANTIG'I:
--   Har bir "hisob" uchun:  BOSHLANG'ICH QOLDIQ + AYLANMA = YAKUNIY QOLDIQ
--   Bu ayniyat buzilsa hisobot ISHONCHSIZ — API uni tekshiradi va ogohlantiradi.
--
-- To'rtta hisob (Clary pul modeli — bank hisob rejasining aynan ko'rinishi):
--   1. KASSA   (drawer)      — inkasatsiya qilinmagan naqd        [50 Kassa]
--   2. SEYF    (vault)       — inkasatsiya qilingan naqd          [50 Kassa/seyf]
--   3. YO'LDAGI (in transit) — terminalga tushgan, bankka kelmagan[57 O'tkazmadagi pul]
--   4. BANK    (settlement)  — bank hisobidagi pul                [51 Hisob-raqam]
--
-- MUHIM: yig'indilar BAZADA hisoblanadi. PostgREST javobni standart 1000 qator
-- bilan cheklaydi va buni HECH QANDAY xato bilan bildirmaydi (2026-08-08 dagi
-- 22 610 000 so'mlik xatoning sababi aynan shu edi — `cashier_aggregates_rpc`
-- izohiga qarang). Bu yerda o'sha xato takrorlanmaydi.
--
-- SECURITY DEFINER QILINMAGAN (ataylab, `cashier_*` funksiyalari kabi): API
-- ularni service_role bilan chaqiradi, RLS oddiy tarzda ishlaydi.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) To'lov usuli sinflagichi — bitta joyda (hamma funksiya shuni ishlatadi).
--    Naqdsiz sinflar `cashier_noncash_balance` bilan AYNAN mos bo'lishi SHART:
--    u naqd/qarz/mixed dan boshqa hammasini "naqdsiz" deb hisoblaydi.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_method_class(p_method text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE lower(COALESCE(p_method, 'cash'))
    WHEN 'cash'     THEN 'cash'
    WHEN 'card'     THEN 'card'
    WHEN 'humo'     THEN 'card'
    WHEN 'uzcard'   THEN 'card'
    WHEN 'transfer' THEN 'transfer'
    WHEN 'mbank'    THEN 'transfer'
    WHEN 'debt'     THEN 'debt'
    WHEN 'mixed'    THEN 'mixed'
    ELSE 'other'   -- click / payme / uzum / kaspi / stripe / insurance
  END;
$$;

COMMENT ON FUNCTION public.finance_method_class(text) IS
  'To''lov usulini sinfga ajratadi: cash | card | transfer | other | debt | mixed';

-- =============================================================================
-- 1) QOLDIQ SANAGA — "p_asof kuni oxirida qaysi hisobda qancha pul bor edi"
-- =============================================================================
-- Bu `cashier_cash_on_hand` + `safeBalance` + `cashier_noncash_balance` ning
-- SANA CHEGARALI ko'rinishi. p_asof yetarlicha katta bo'lsa (bugun yoki keyin)
-- natija o'sha funksiyalar bilan bir xil chiqishi SHART — aks holda kassa
-- kartasi va hisobot bir-biriga zid raqam ko'rsatadi.
--
-- Sana asosi (business date), har manba uchun alohida:
--   transactions / legs   → created_at (Asia/Tashkent)
--   expenses              → expense_date (yo'q bo'lsa created_at)
--   doctor_payouts        → paid_at (yo'q bo'lsa created_at)
--   safe_deposits         → created_at
--   bank_settlements      → created_at
-- =============================================================================
CREATE OR REPLACE FUNCTION public.finance_balances_asof(
  p_clinic   uuid,
  p_asof     date,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  cash_uzs    bigint,  -- kassadagi (seyfga o'tmagan) naqd
  safe_uzs    bigint,  -- seyfdagi naqd
  pending_uzs bigint,  -- terminalda: tushgan, lekin olinmagan naqdsiz
  bank_uzs    bigint,  -- bank hisobidagi pul
  total_uzs   bigint   -- jami operatsion pul
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
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date <= p_asof
  ),
  -- --- NAQD (kassa) ---------------------------------------------------------
  cash_legs AS (
    SELECT * FROM legs
    WHERE cls = 'cash' AND (tx_source IS NULL OR tx_source::text <> 'safe')
  ),
  cash_agg AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind = 'payment'), 0)::bigint AS cash_in,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE kind = 'refund'), 0)::bigint AS refunds,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE kind = 'adjustment' AND lower(COALESCE(notes, '')) LIKE '%inkasatsiya%'
      ), 0)::bigint AS encashed,
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE kind = 'adjustment' AND lower(COALESCE(notes, '')) NOT LIKE '%inkasatsiya%'
      ), 0)::bigint AS adj
    FROM cash_legs
  ),
  -- --- NAQDSIZ (terminal) ---------------------------------------------------
  noncash_legs AS (
    SELECT * FROM legs
    WHERE cls IN ('card', 'transfer', 'other')
      AND (tx_source IS NULL OR tx_source::text <> 'safe')
  ),
  noncash_agg AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind = 'payment' AND amount_uzs > 0), 0)::bigint AS received,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE kind = 'refund' OR (kind = 'payment' AND amount_uzs < 0)
      ), 0)::bigint AS refunds
    FROM noncash_legs
  ),
  -- --- Rasxot ---------------------------------------------------------------
  -- DIQQAT: sinflar mavjud `safeBalance` / `cashier_noncash_balance` bilan
  -- AYNAN bir xil bo'lishi shart — aks holda hisobot va kassa kartasi turli
  -- raqam ko'rsatadi. Shu sababli chegara holat (source='safe' + karta bilan
  -- to'langan rasxot) mavjud xulq bo'yicha ikkala hisobdan ham ayriladi.
  -- Amalda bunday yozuv mantiqan noto'g'ri (seyf = naqd), UI uni yaratmaydi.
  exp AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE finance_method_class(payment_method::text) = 'cash'
          AND (source IS NULL OR source::text <> 'safe')
      ), 0)::bigint AS cash_drawer,
      COALESCE(SUM(amount_uzs) FILTER (WHERE source::text = 'safe'), 0)::bigint AS from_safe,
      COALESCE(SUM(amount_uzs) FILTER (
        WHERE finance_method_class(payment_method::text) <> 'cash'
      ), 0)::bigint AS noncash
    FROM expenses
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND COALESCE(expense_date, (created_at AT TIME ZONE 'Asia/Tashkent')::date) <= p_asof
  ),
  -- --- Maosh (klinika darajasida — faqat qabulxona registri) ----------------
  pay AS (
    SELECT
      COALESCE(SUM(net_uzs) FILTER (
        WHERE finance_method_class(method::text) = 'cash'
          AND (source IS NULL OR source::text <> 'safe')
      ), 0)::bigint AS cash_drawer,
      COALESCE(SUM(net_uzs) FILTER (WHERE source::text = 'safe'), 0)::bigint AS from_safe,
      COALESCE(SUM(net_uzs) FILTER (
        WHERE finance_method_class(method::text) <> 'cash'
      ), 0)::bigint AS noncash
    FROM doctor_payouts
    WHERE clinic_id = p_clinic AND status = 'paid' AND p_register = 'reception'
      AND (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Tashkent')::date <= p_asof
  ),
  -- --- Seyf kirimi (qo'lda) -------------------------------------------------
  dep AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint AS d
    FROM safe_deposits
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date <= p_asof
  ),
  -- --- Seyfdan chiqim (tranzaksiya: vozvrat / tuzatish) ---------------------
  safe_tx AS (
    SELECT COALESCE(SUM(abs(amount_uzs)), 0)::bigint AS o
    FROM transactions
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND source::text = 'safe'
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date <= p_asof
  ),
  -- --- Naqdsiz pulni olish (hisob-kitob) ------------------------------------
  st AS (
    SELECT
      COALESCE(SUM(amount_uzs), 0)::bigint AS settled,
      COALESCE(SUM(amount_uzs) FILTER (WHERE destination = 'bank'), 0)::bigint AS to_bank,
      COALESCE(SUM(amount_uzs) FILTER (WHERE destination = 'safe'), 0)::bigint AS to_safe
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date <= p_asof
  )
  SELECT
    (cash_agg.cash_in - cash_agg.refunds - cash_agg.encashed + cash_agg.adj
       - exp.cash_drawer - pay.cash_drawer)::bigint,
    (cash_agg.encashed + dep.d + st.to_safe - safe_tx.o - exp.from_safe - pay.from_safe)::bigint,
    (noncash_agg.received - noncash_agg.refunds - st.settled)::bigint,
    (st.to_bank - exp.noncash - pay.noncash)::bigint,
    (
      (cash_agg.cash_in - cash_agg.refunds - cash_agg.encashed + cash_agg.adj
         - exp.cash_drawer - pay.cash_drawer)
      + (cash_agg.encashed + dep.d + st.to_safe - safe_tx.o - exp.from_safe - pay.from_safe)
      + (noncash_agg.received - noncash_agg.refunds - st.settled)
      + (st.to_bank - exp.noncash - pay.noncash)
    )::bigint
  FROM cash_agg, noncash_agg, exp, pay, dep, safe_tx, st;
$$;

COMMENT ON FUNCTION public.finance_balances_asof(uuid, date, text) IS
  'Berilgan sana OXIRIDA to''rtta hisob qoldig''i (kassa/seyf/yo''ldagi/bank). Davr hisobotining boshlang''ich va yakuniy qoldig''i shu funksiyadan olinadi.';

-- =============================================================================
-- 2) DAVR AYLANMASI — [p_from, p_to] oralig'idagi barcha pul harakati
-- =============================================================================
-- Har bir ustun bitta MA'NOGA ega va hisobotning bir qatoriga to'g'ri keladi.
-- Ichki ko'chirmalar (inkasatsiya, hisob-kitob) DAROMAD EMAS — alohida.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.finance_period_flows(
  p_clinic   uuid,
  p_from     date,
  p_to       date,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  -- Tushum (to'lovlar)
  rev_cash_uzs        bigint,
  rev_card_uzs        bigint,
  rev_transfer_uzs    bigint,
  rev_other_uzs       bigint,
  rev_total_uzs       bigint,
  rev_count           bigint,
  -- Vozvrat
  ref_cash_uzs        bigint,
  ref_card_uzs        bigint,
  ref_transfer_uzs    bigint,
  ref_other_uzs       bigint,
  ref_total_uzs       bigint,
  ref_count           bigint,
  -- Qarzga berilgan (pul kelmagan — daromadga kirmaydi)
  debt_uzs            bigint,
  debt_count          bigint,
  -- Rasxot
  exp_cash_uzs        bigint,   -- kassadan naqd
  exp_safe_uzs        bigint,   -- seyfdan
  exp_noncash_uzs     bigint,   -- bank/karta
  exp_total_uzs       bigint,
  exp_count           bigint,
  -- Maosh (to'langan)
  pay_cash_uzs        bigint,
  pay_safe_uzs        bigint,
  pay_noncash_uzs     bigint,
  pay_total_uzs       bigint,
  pay_count           bigint,
  -- Ichki ko'chirmalar
  encashed_uzs        bigint,   -- kassa → seyf
  encash_count        bigint,
  settled_bank_uzs    bigint,   -- yo'ldagi → bank
  settled_safe_uzs    bigint,   -- yo'ldagi → seyf (naqdga aylandi)
  settle_count        bigint,
  safe_deposit_uzs    bigint,   -- qo'lda seyfga
  safe_out_tx_uzs     bigint,   -- seyfdan vozvrat/tuzatish
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
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'cash'), 0)::bigint     c,
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'card'), 0)::bigint     k,
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'transfer'), 0)::bigint t,
      COALESCE(SUM(amount_uzs) FILTER (WHERE cls = 'other'), 0)::bigint    o,
      COUNT(*)::bigint                                                     n
    FROM money WHERE kind = 'payment' AND amount_uzs > 0
  ),
  ref AS (
    SELECT
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'cash'), 0)::bigint     c,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'card'), 0)::bigint     k,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'transfer'), 0)::bigint t,
      COALESCE(SUM(abs(amount_uzs)) FILTER (WHERE cls = 'other'), 0)::bigint    o,
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
      COALESCE(SUM(amount_uzs) FILTER (WHERE destination = 'safe'), 0)::bigint sf,
      COUNT(*)::bigint n
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  dep AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint s
    FROM safe_deposits
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  ),
  safeout AS (
    SELECT COALESCE(SUM(abs(amount_uzs)), 0)::bigint s
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
    rev.c, rev.k, rev.t, rev.o, (rev.c + rev.k + rev.t + rev.o)::bigint, rev.n,
    ref.c, ref.k, ref.t, ref.o, (ref.c + ref.k + ref.t + ref.o)::bigint, ref.n,
    dbt.s, dbt.n,
    ex.c, ex.s, ex.nc, ex.tot, ex.n,
    pr.c, pr.s, pr.nc, pr.tot, pr.n,
    enc.s, enc.n,
    st.b, st.sf, st.n,
    dep.s, safeout.s,
    adj.s, adj.n,
    comm.s,
    ph.rev, ph_profit.p, ph.dbt, ph.n
  FROM rev, ref, dbt, ex, pr, enc, adj, st, dep, safeout, comm, ph, ph_profit;
$$;

COMMENT ON FUNCTION public.finance_period_flows(uuid, date, date, text) IS
  'Davr aylanmasi: tushum/vozvrat (usul kesimida), rasxot, maosh, inkasatsiya, hisob-kitob, seyf harakati, komissiya, dorixona.';

-- =============================================================================
-- 3) CHUQUR IZLANISH — har raqamning ORTIDAGI HUJJATLAR
-- =============================================================================
-- "1 gina xato millionlab zarar berishi mumkin" — shuning uchun hisobotdagi
-- HAR BIR summa bosilganda uni tashkil qilgan hujjatlar ro'yxati ochiladi.
-- Bo'limlar hisobot qatorlariga bir-bir mos keladi.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.finance_period_rows(
  p_clinic   uuid,
  p_from     date,
  p_to       date,
  p_register text DEFAULT 'reception',
  p_section  text DEFAULT 'revenue',
  p_class    text DEFAULT 'all',   -- cash | card | transfer | other | all
  p_limit    int  DEFAULT 500,
  p_offset   int  DEFAULT 0
)
RETURNS TABLE (
  occurred_at  timestamptz,
  doc_type     text,
  doc_id       uuid,
  party        text,     -- bemor / xodim / kontragent
  description  text,
  method       text,
  method_class text,
  source       text,     -- cash_drawer | safe | —
  direction    text,     -- in | out
  amount_uzs   bigint,
  who          text      -- kim qayd etgan
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- DIQQAT: ichki ustunlar QASDDAN qisqa nomlar bilan (ts/dtype/…). Agar ular
  -- RETURNS TABLE dagi nomlar bilan bir xil bo'lsa, PostgreSQL ularni OUT
  -- parametr deb hisoblab "column reference is ambiguous" xatosi beradi.
  WITH base AS (
    -- --- Tushum va vozvrat (mixed to'lovning har oyog'i alohida qator) ------
    SELECT
      t.created_at AS ts,
      CASE WHEN l.kind = 'refund' THEN 'refund' ELSE 'payment' END AS dtype,
      t.id AS did,
      COALESCE(pt.full_name, '—') AS pty,
      COALESCE(t.notes, '') AS descr,
      l.method::text AS mth,
      finance_method_class(l.method::text) AS mcls,
      COALESCE(t.source::text, 'cash_drawer') AS src,
      CASE WHEN l.kind = 'refund' OR l.amount_uzs < 0 THEN 'out' ELSE 'in' END AS dir,
      abs(l.amount_uzs)::bigint AS amt,
      COALESCE(cs.full_name, '—') AS whom,
      CASE
        WHEN finance_method_class(l.method::text) = 'debt' THEN 'debt'
        WHEN l.kind = 'refund' OR l.amount_uzs < 0 THEN 'refund'
        ELSE 'revenue'
      END AS sect
    FROM transaction_payment_legs l
    JOIN transactions t ON t.id = l.transaction_id
    LEFT JOIN patients pt ON pt.id = t.patient_id
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE l.clinic_id = p_clinic AND l.register = p_register AND l.is_void = false
      AND l.kind IN ('payment', 'refund')
      AND (t.source IS NULL OR t.source::text <> 'safe')
      AND (l.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- --- Inkasatsiya va naqd tuzatishlar ------------------------------------
    SELECT
      t.created_at,
      'adjustment', t.id,
      COALESCE(pt.full_name, '—'),
      COALESCE(t.notes, ''),
      t.payment_method::text,
      finance_method_class(t.payment_method::text),
      COALESCE(t.source::text, 'cash_drawer'),
      CASE WHEN t.amount_uzs < 0 THEN 'out' ELSE 'in' END,
      abs(t.amount_uzs)::bigint,
      COALESCE(cs.full_name, '—'),
      CASE WHEN lower(COALESCE(t.notes, '')) LIKE '%inkasatsiya%'
           THEN 'encashment' ELSE 'adjustment' END
    FROM transactions t
    LEFT JOIN patients pt ON pt.id = t.patient_id
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE t.clinic_id = p_clinic AND t.register = p_register AND t.is_void = false
      AND t.kind = 'adjustment'
      AND (t.source IS NULL OR t.source::text <> 'safe')
      AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- --- Rasxot --------------------------------------------------------------
    SELECT
      e.created_at,
      'expense', e.id,
      COALESCE(sp.name, '—'),
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(': ',
          COALESCE(ec.name_i18n ->> 'uz-Latn', ec.name_i18n ->> 'en'),
          e.description)), ''),
        'Rasxot'),
      COALESCE(e.payment_method::text, 'cash'),
      finance_method_class(e.payment_method::text),
      COALESCE(e.source::text, 'cash_drawer'),
      'out',
      e.amount_uzs::bigint,
      COALESCE(rp.full_name, '—'),
      'expense'
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    LEFT JOIN suppliers sp ON sp.id = e.supplier_id
    LEFT JOIN profiles rp ON rp.id = e.recorded_by
    WHERE e.clinic_id = p_clinic AND e.register = p_register AND e.is_void = false
      AND COALESCE(e.expense_date, (e.created_at AT TIME ZONE 'Asia/Tashkent')::date)
          BETWEEN p_from AND p_to

    UNION ALL
    -- --- Maosh ---------------------------------------------------------------
    SELECT
      COALESCE(dp.paid_at, dp.created_at),
      'payout', dp.id,
      COALESCE(dr.full_name, '—'),
      CONCAT('Maosh ', to_char(dp.period_start, 'DD.MM.YYYY'), '–',
             to_char(dp.period_end, 'DD.MM.YYYY')),
      COALESCE(dp.method::text, 'cash'),
      finance_method_class(dp.method::text),
      COALESCE(dp.source::text, 'cash_drawer'),
      'out',
      dp.net_uzs::bigint,
      COALESCE(py.full_name, '—'),
      'payroll'
    FROM doctor_payouts dp
    LEFT JOIN profiles dr ON dr.id = dp.doctor_id
    LEFT JOIN profiles py ON py.id = dp.paid_by
    WHERE dp.clinic_id = p_clinic AND dp.status = 'paid' AND p_register = 'reception'
      AND (COALESCE(dp.paid_at, dp.created_at) AT TIME ZONE 'Asia/Tashkent')::date
          BETWEEN p_from AND p_to

    UNION ALL
    -- --- Naqdsiz pulni olish (hisob-kitob) ----------------------------------
    SELECT
      bs.created_at,
      'settlement', bs.id,
      COALESCE(bs.bank_name, '—'),
      CONCAT('Naqdsiz pul → ', CASE bs.destination WHEN 'safe' THEN 'seyf' ELSE 'bank' END,
             COALESCE(' · ' || NULLIF(bs.reference, ''), '')),
      COALESCE(bs.method, 'aralash'),
      finance_method_class(bs.method),
      bs.destination,
      'out',
      bs.amount_uzs::bigint,
      COALESCE(rp.full_name, '—'),
      'settlement'
    FROM bank_settlements bs
    LEFT JOIN profiles rp ON rp.id = bs.recorded_by
    WHERE bs.clinic_id = p_clinic AND bs.register = p_register AND bs.is_void = false
      AND (bs.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- --- Seyfga qo'lda kirim -------------------------------------------------
    SELECT
      sd.created_at,
      'safe_deposit', sd.id,
      '—',
      COALESCE(sd.reason, 'Seyfga qo''shildi'),
      'cash', 'cash', 'safe', 'in',
      sd.amount_uzs::bigint,
      COALESCE(rp.full_name, '—'),
      'safe_deposit'
    FROM safe_deposits sd
    LEFT JOIN profiles rp ON rp.id = sd.recorded_by
    WHERE sd.clinic_id = p_clinic AND sd.register = p_register AND sd.is_void = false
      AND (sd.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- --- Seyfdan chiqim (vozvrat / tuzatish) --------------------------------
    SELECT
      t.created_at,
      'safe_out', t.id,
      COALESCE(pt.full_name, '—'),
      COALESCE(t.notes, 'Seyfdan chiqim'),
      t.payment_method::text,
      finance_method_class(t.payment_method::text),
      'safe', 'out',
      abs(t.amount_uzs)::bigint,
      COALESCE(cs.full_name, '—'),
      'safe_out'
    FROM transactions t
    LEFT JOIN patients pt ON pt.id = t.patient_id
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE t.clinic_id = p_clinic AND t.register = p_register AND t.is_void = false
      AND t.source::text = 'safe'
      AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  )
  SELECT b.ts, b.dtype, b.did, b.pty, b.descr, b.mth, b.mcls,
         b.src, b.dir, b.amt, b.whom
  FROM base b
  WHERE (p_section = 'all' OR b.sect = p_section)
    AND (p_class = 'all' OR b.mcls = p_class)
  ORDER BY b.ts DESC
  LIMIT GREATEST(1, LEAST(p_limit, 5000))
  OFFSET GREATEST(0, p_offset);
$$;

COMMENT ON FUNCTION public.finance_period_rows(uuid, date, date, text, text, text, int, int) IS
  'Hisobotdagi har bir summaning ortidagi hujjatlar (chuqur izlanish). Bo''limlar: revenue|refund|debt|expense|payroll|encashment|adjustment|settlement|safe_deposit|safe_out|all';

-- =============================================================================
-- 4) DAVR YOPISH — "oy yopish" yozuvi va snapshot
-- =============================================================================
-- Bank amaliyoti: davr yopilgach, o'sha davrga ORQAGA YOZUV KIRITILMAYDI.
-- Xato topilsa — joriy davrda TUZATUV yozuvi bilan to'g'rilanadi.
-- `snapshot` — yopish paytidagi hisobotning to'liq nusxasi: keyin ma'lumot
-- o'zgarsa ham, o'sha kuni imzolangan hisobot o'zgarmay qoladi.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.period_closings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  register          text NOT NULL DEFAULT 'reception',
  period_from       date NOT NULL,
  period_to         date NOT NULL,
  status            text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'reopened')),

  -- Kassa svertkasi (bank kassiri kun yopgandagi bilan bir xil tartib)
  cash_system_uzs   bigint NOT NULL DEFAULT 0,   -- tizim bo'yicha kassada
  cash_counted_uzs  bigint,                      -- qo'lda sanaldi (NULL = sanalmadi)
  cash_diff_uzs     bigint NOT NULL DEFAULT 0,   -- sanoq − tizim (+ortiqcha / −kam)
  moved_to_safe_uzs bigint NOT NULL DEFAULT 0,   -- yopishda seyfga o'tkazilgan naqd
  -- SET NULL (CASCADE emas): "Xavfli zona" moliyaviy yozuvlarni hard-delete
  -- qilganda YOPISH YOZUVI YO'QOLMASLIGI kerak — u audit hujjati.
  encash_tx_id      uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  settled_uzs       bigint NOT NULL DEFAULT 0,   -- yopishda bankka olingan naqdsiz
  settle_id         uuid REFERENCES public.bank_settlements(id) ON DELETE SET NULL,

  snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes             text,
  closed_at         timestamptz NOT NULL DEFAULT now(),
  closed_by         uuid REFERENCES public.profiles(id),
  reopened_at       timestamptz,
  reopened_by       uuid REFERENCES public.profiles(id),
  reopen_reason     text,
  CHECK (period_to >= period_from)
);

-- Bitta davr bir marta yopiladi (qayta ochilganlar cheklovga tushmaydi).
CREATE UNIQUE INDEX IF NOT EXISTS uq_period_closings_open
  ON public.period_closings (clinic_id, register, period_from, period_to)
  WHERE status = 'closed';

CREATE INDEX IF NOT EXISTS idx_period_closings_clinic
  ON public.period_closings (clinic_id, register, period_to DESC);

ALTER TABLE public.period_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_period_closings_tenant ON public.period_closings;
CREATE POLICY p_period_closings_tenant ON public.period_closings
  FOR ALL
  USING      ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'))
  WITH CHECK ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'));

COMMENT ON TABLE public.period_closings IS
  'Davr (oy) yopish yozuvi: kassa svertkasi, seyfga o''tkazilgan naqd va hisobot snapshot''i';

-- --- Sana yopilgan davr ichidami? --------------------------------------------
-- Orqaga sana bilan yozuv kiritishni bloklash uchun (rasxot expense_date).
CREATE OR REPLACE FUNCTION public.finance_period_locked(
  p_clinic   uuid,
  p_date     date,
  p_register text DEFAULT 'reception'
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM period_closings
    WHERE clinic_id = p_clinic
      AND register  = p_register
      AND status    = 'closed'
      AND p_date BETWEEN period_from AND period_to
  );
$$;

COMMENT ON FUNCTION public.finance_period_locked(uuid, date, text) IS
  'Berilgan sana yopilgan davr ichidami — orqaga sana bilan yozuvni bloklash uchun';

-- =============================================================================
-- Ruxsatlar — faqat API (service_role). Mijoz roli to'g'ridan-to'g'ri PostgREST
-- orqali soxta clinic_id bilan chaqira olmasin (2026-07-03 hardening qoidasi).
-- =============================================================================
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.finance_method_class(text)',
    'public.finance_balances_asof(uuid, date, text)',
    'public.finance_period_flows(uuid, date, date, text)',
    'public.finance_period_rows(uuid, date, date, text, text, text, int, int)',
    'public.finance_period_locked(uuid, date, text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
