-- =============================================================================
-- HISOB DAFTARI — qoldiq kartasi bosilganda BARCHA amaliyot maydalab
-- =============================================================================
-- Hisobotdagi to'rtta qoldiq kartasi (Kassa / Seyf / Yo'ldagi / Bank) shu
-- paytgacha faqat raqam edi. Endi ular bosiladi va o'sha hisobning davr
-- ichidagi HAR BIR harakati chiqadi.
--
-- MUHIM FARQ `finance_period_rows` dan: bu yerda ICHKI KO'CHIRMA IKKI MARTA
-- chiqadi — chiqqan hisobda "out", kirgan hisobda "in". Bu ikkilamchi yozuv
-- (double entry) mantig'i:
--     inkasatsiya  →  kassa: out,   seyf: in
--     hisob-kitob  →  yo'ldagi: out, bank yoki seyf: in
-- Shu sababli har hisob uchun qatorlar yig'indisi svertka jadvalidagi
-- KIRIM/CHIQIM ustunlariga AYNAN teng bo'ladi — ya'ni ro'yxatni jamiga
-- solishtirib tekshirsa bo'ladi.
--
-- Rasxot/maosh sinflanishi `finance_balances_asof` bilan bir xil:
--   source='safe'      → seyfdan chiqim
--   naqd + drawer      → kassadan chiqim
--   naqdsiz (usul)     → bankdan chiqim
-- (chegara holat: seyfdan karta bilan to'langan rasxot ikkala hisobda ham
-- ko'rinadi — qoldiq hisobida ham shunday, izchillik saqlanadi.)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finance_account_ledger(
  p_clinic   uuid,
  p_from     date,
  p_to       date,
  p_register text DEFAULT 'reception',
  p_account  text DEFAULT 'all',   -- cash | safe | pending | bank | all
  p_limit    int  DEFAULT 1000,
  p_offset   int  DEFAULT 0
)
RETURNS TABLE (
  occurred_at  timestamptz,
  account      text,
  doc_type     text,
  doc_id       uuid,
  party        text,
  description  text,
  method       text,
  method_class text,
  direction    text,
  amount_uzs   bigint,
  who          text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    -- ---- 1) To'lov / vozvrat: naqd → kassa, naqdsiz → yo'ldagi -------------
    SELECT
      t.created_at AS ts,
      CASE WHEN finance_method_class(l.method::text) = 'cash' THEN 'cash' ELSE 'pending' END AS acct,
      CASE WHEN l.kind = 'refund' THEN 'refund' ELSE 'payment' END AS dtype,
      t.id AS did,
      COALESCE(pt.full_name, '—') AS pty,
      COALESCE(NULLIF(t.notes, ''), CASE WHEN l.kind = 'refund' THEN 'Vozvrat' ELSE 'To''lov' END) AS descr,
      l.method::text AS mth,
      finance_method_class(l.method::text) AS mcls,
      CASE WHEN l.kind = 'refund' OR l.amount_uzs < 0 THEN 'out' ELSE 'in' END AS dir,
      abs(l.amount_uzs)::bigint AS amt,
      COALESCE(cs.full_name, '—') AS whom
    FROM transaction_payment_legs l
    JOIN transactions t ON t.id = l.transaction_id
    LEFT JOIN patients pt ON pt.id = t.patient_id
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE l.clinic_id = p_clinic AND l.register = p_register AND l.is_void = false
      AND l.kind IN ('payment', 'refund')
      AND (t.source IS NULL OR t.source::text <> 'safe')
      AND finance_method_class(l.method::text) IN ('cash', 'card', 'transfer', 'other')
      AND (l.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 2) Naqd tuzatish (inkasatsiyadan tashqari) → kassa ----------------
    SELECT
      t.created_at, 'cash', 'adjustment', t.id,
      COALESCE(pt.full_name, '—'),
      COALESCE(NULLIF(t.notes, ''), 'Kassa tuzatish'),
      'cash', 'cash',
      CASE WHEN t.amount_uzs < 0 THEN 'out' ELSE 'in' END,
      abs(t.amount_uzs)::bigint,
      COALESCE(cs.full_name, '—')
    FROM transactions t
    LEFT JOIN patients pt ON pt.id = t.patient_id
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE t.clinic_id = p_clinic AND t.register = p_register AND t.is_void = false
      AND t.kind = 'adjustment' AND finance_method_class(t.payment_method::text) = 'cash'
      AND (t.source IS NULL OR t.source::text <> 'safe')
      AND lower(COALESCE(t.notes, '')) NOT LIKE '%inkasatsiya%'
      AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 3a) Inkasatsiya — KASSADAN chiqim ---------------------------------
    SELECT
      t.created_at, 'cash', 'encashment', t.id, '—',
      COALESCE(NULLIF(t.notes, ''), 'Inkasatsiya'),
      'cash', 'cash', 'out', abs(t.amount_uzs)::bigint,
      COALESCE(cs.full_name, '—')
    FROM transactions t
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE t.clinic_id = p_clinic AND t.register = p_register AND t.is_void = false
      AND t.kind = 'adjustment' AND finance_method_class(t.payment_method::text) = 'cash'
      AND (t.source IS NULL OR t.source::text <> 'safe')
      AND lower(COALESCE(t.notes, '')) LIKE '%inkasatsiya%'
      AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 3b) Inkasatsiya — SEYFGA kirim (o'sha yozuvning narigi tomoni) ----
    SELECT
      t.created_at, 'safe', 'encashment', t.id, '—',
      COALESCE(NULLIF(t.notes, ''), 'Inkasatsiya'),
      'cash', 'cash', 'in', abs(t.amount_uzs)::bigint,
      COALESCE(cs.full_name, '—')
    FROM transactions t
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE t.clinic_id = p_clinic AND t.register = p_register AND t.is_void = false
      AND t.kind = 'adjustment' AND finance_method_class(t.payment_method::text) = 'cash'
      AND (t.source IS NULL OR t.source::text <> 'safe')
      AND lower(COALESCE(t.notes, '')) LIKE '%inkasatsiya%'
      AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 4a) Hisob-kitob — YO'LDAGI puldan chiqim --------------------------
    SELECT
      bs.created_at, 'pending', 'settlement', bs.id,
      COALESCE(bs.bank_name, '—'),
      CONCAT('Naqdsiz pul olindi → ',
             CASE bs.destination WHEN 'safe' THEN 'seyf' ELSE 'bank' END,
             COALESCE(' · ' || NULLIF(bs.reference, ''), '')),
      COALESCE(bs.method, 'aralash'), finance_method_class(bs.method),
      'out', bs.amount_uzs::bigint,
      COALESCE(rp.full_name, '—')
    FROM bank_settlements bs
    LEFT JOIN profiles rp ON rp.id = bs.recorded_by
    WHERE bs.clinic_id = p_clinic AND bs.register = p_register AND bs.is_void = false
      AND (bs.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 4b) Hisob-kitob — BANK yoki SEYFGA kirim --------------------------
    SELECT
      bs.created_at,
      CASE bs.destination WHEN 'safe' THEN 'safe' ELSE 'bank' END,
      'settlement', bs.id,
      COALESCE(bs.bank_name, '—'),
      CONCAT('Naqdsiz puldan tushdi',
             COALESCE(' · ' || NULLIF(bs.reference, ''), '')),
      COALESCE(bs.method, 'aralash'), finance_method_class(bs.method),
      'in', bs.amount_uzs::bigint,
      COALESCE(rp.full_name, '—')
    FROM bank_settlements bs
    LEFT JOIN profiles rp ON rp.id = bs.recorded_by
    WHERE bs.clinic_id = p_clinic AND bs.register = p_register AND bs.is_void = false
      AND (bs.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 5) Seyfga qo'lda kirim --------------------------------------------
    SELECT
      sd.created_at, 'safe', 'safe_deposit', sd.id, '—',
      COALESCE(NULLIF(sd.reason, ''), 'Seyfga qo''shildi'),
      'cash', 'cash', 'in', sd.amount_uzs::bigint,
      COALESCE(rp.full_name, '—')
    FROM safe_deposits sd
    LEFT JOIN profiles rp ON rp.id = sd.recorded_by
    WHERE sd.clinic_id = p_clinic AND sd.register = p_register AND sd.is_void = false
      AND (sd.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 6) Seyfdan chiqim (vozvrat / tuzatish) ----------------------------
    SELECT
      t.created_at, 'safe', 'safe_out', t.id,
      COALESCE(pt.full_name, '—'),
      COALESCE(NULLIF(t.notes, ''), 'Seyfdan chiqim'),
      t.payment_method::text, finance_method_class(t.payment_method::text),
      'out', abs(t.amount_uzs)::bigint,
      COALESCE(cs.full_name, '—')
    FROM transactions t
    LEFT JOIN patients pt ON pt.id = t.patient_id
    LEFT JOIN profiles cs ON cs.id = t.cashier_id
    WHERE t.clinic_id = p_clinic AND t.register = p_register AND t.is_void = false
      AND t.source::text = 'safe'
      AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 7) Rasxot — seyfdan -----------------------------------------------
    SELECT
      e.created_at, 'safe', 'expense', e.id, COALESCE(sp.name, '—'),
      COALESCE(NULLIF(TRIM(CONCAT_WS(': ',
        COALESCE(ec.name_i18n ->> 'uz-Latn', ec.name_i18n ->> 'en'), e.description)), ''), 'Rasxot'),
      COALESCE(e.payment_method::text, 'cash'), finance_method_class(e.payment_method::text),
      'out', e.amount_uzs::bigint, COALESCE(rp.full_name, '—')
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    LEFT JOIN suppliers sp ON sp.id = e.supplier_id
    LEFT JOIN profiles rp ON rp.id = e.recorded_by
    WHERE e.clinic_id = p_clinic AND e.register = p_register AND e.is_void = false
      AND e.source::text = 'safe'
      AND COALESCE(e.expense_date, (e.created_at AT TIME ZONE 'Asia/Tashkent')::date)
          BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 8) Rasxot — kassadan naqd -----------------------------------------
    SELECT
      e.created_at, 'cash', 'expense', e.id, COALESCE(sp.name, '—'),
      COALESCE(NULLIF(TRIM(CONCAT_WS(': ',
        COALESCE(ec.name_i18n ->> 'uz-Latn', ec.name_i18n ->> 'en'), e.description)), ''), 'Rasxot'),
      COALESCE(e.payment_method::text, 'cash'), 'cash',
      'out', e.amount_uzs::bigint, COALESCE(rp.full_name, '—')
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    LEFT JOIN suppliers sp ON sp.id = e.supplier_id
    LEFT JOIN profiles rp ON rp.id = e.recorded_by
    WHERE e.clinic_id = p_clinic AND e.register = p_register AND e.is_void = false
      AND finance_method_class(e.payment_method::text) = 'cash'
      AND (e.source IS NULL OR e.source::text <> 'safe')
      AND COALESCE(e.expense_date, (e.created_at AT TIME ZONE 'Asia/Tashkent')::date)
          BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 9) Rasxot — naqdsiz (bankdan) -------------------------------------
    SELECT
      e.created_at, 'bank', 'expense', e.id, COALESCE(sp.name, '—'),
      COALESCE(NULLIF(TRIM(CONCAT_WS(': ',
        COALESCE(ec.name_i18n ->> 'uz-Latn', ec.name_i18n ->> 'en'), e.description)), ''), 'Rasxot'),
      COALESCE(e.payment_method::text, 'cash'), finance_method_class(e.payment_method::text),
      'out', e.amount_uzs::bigint, COALESCE(rp.full_name, '—')
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    LEFT JOIN suppliers sp ON sp.id = e.supplier_id
    LEFT JOIN profiles rp ON rp.id = e.recorded_by
    WHERE e.clinic_id = p_clinic AND e.register = p_register AND e.is_void = false
      AND finance_method_class(e.payment_method::text) <> 'cash'
      AND COALESCE(e.expense_date, (e.created_at AT TIME ZONE 'Asia/Tashkent')::date)
          BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 10) Maosh — seyfdan / kassadan / bankdan --------------------------
    SELECT
      COALESCE(dp.paid_at, dp.created_at),
      CASE
        WHEN dp.source::text = 'safe' THEN 'safe'
        WHEN finance_method_class(dp.method::text) = 'cash' THEN 'cash'
        ELSE 'bank'
      END,
      'payout', dp.id, COALESCE(dr.full_name, '—'),
      CONCAT('Maosh ', to_char(dp.period_start, 'DD.MM.YYYY'), '–',
             to_char(dp.period_end, 'DD.MM.YYYY')),
      COALESCE(dp.method::text, 'cash'), finance_method_class(dp.method::text),
      'out', dp.net_uzs::bigint, COALESCE(py.full_name, '—')
    FROM doctor_payouts dp
    LEFT JOIN profiles dr ON dr.id = dp.doctor_id
    LEFT JOIN profiles py ON py.id = dp.paid_by
    WHERE dp.clinic_id = p_clinic AND dp.status = 'paid' AND p_register = 'reception'
      AND (COALESCE(dp.paid_at, dp.created_at) AT TIME ZONE 'Asia/Tashkent')::date
          BETWEEN p_from AND p_to

    UNION ALL
    -- ---- 11) Maosh — naqdsiz, LEKIN seyfdan yozilgan ------------------------
    -- Qoldiq hisobida bunday yozuv ikkala hisobdan ham ayriladi (mavjud
    -- xulq). Daftar ham shuni takrorlaydi, aks holda ro'yxat jamiga yetmaydi.
    SELECT
      COALESCE(dp.paid_at, dp.created_at), 'bank', 'payout', dp.id,
      COALESCE(dr.full_name, '—'),
      CONCAT('Maosh (naqdsiz) ', to_char(dp.period_start, 'DD.MM.YYYY')),
      COALESCE(dp.method::text, 'cash'), finance_method_class(dp.method::text),
      'out', dp.net_uzs::bigint, COALESCE(py.full_name, '—')
    FROM doctor_payouts dp
    LEFT JOIN profiles dr ON dr.id = dp.doctor_id
    LEFT JOIN profiles py ON py.id = dp.paid_by
    WHERE dp.clinic_id = p_clinic AND dp.status = 'paid' AND p_register = 'reception'
      AND dp.source::text = 'safe'
      AND finance_method_class(dp.method::text) <> 'cash'
      AND (COALESCE(dp.paid_at, dp.created_at) AT TIME ZONE 'Asia/Tashkent')::date
          BETWEEN p_from AND p_to
  )
  SELECT b.ts, b.acct, b.dtype, b.did, b.pty, b.descr, b.mth, b.mcls, b.dir, b.amt, b.whom
  FROM base b
  WHERE (p_account = 'all' OR b.acct = p_account)
  ORDER BY b.ts DESC
  LIMIT GREATEST(1, LEAST(p_limit, 5000))
  OFFSET GREATEST(0, p_offset);
$$;

COMMENT ON FUNCTION public.finance_account_ledger(uuid, date, date, text, text, int, int) IS
  'Hisob daftari: kassa/seyf/yo''ldagi/bank hisobining davr ichidagi har bir harakati. Ichki ko''chirma ikki marta (chiqqan hisobda out, kirgan hisobda in) — yig''indi svertka jadvaliga teng.';

REVOKE ALL ON FUNCTION public.finance_account_ledger(uuid, date, date, text, text, int, int) FROM public;
REVOKE ALL ON FUNCTION public.finance_account_ledger(uuid, date, date, text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.finance_account_ledger(uuid, date, date, text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finance_account_ledger(uuid, date, date, text, text, int, int) TO service_role;

NOTIFY pgrst, 'reload schema';
