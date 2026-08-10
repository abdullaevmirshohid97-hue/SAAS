-- =============================================================================
-- CHUQUR IZLANISH: hisob-kitobni YO'NALISH bo'yicha ajratish
-- =============================================================================
-- Hisobotda ikkita alohida qator bor: "Naqdsiz pul olindi → bank" va "→ seyf".
-- Ilgari ikkalasi ham `section = 'settlement'` ga borardi — ya'ni bank qatorini
-- bosgan odam seyfga olinganlarni ham ro'yxatda ko'rardi. Qator yonidagi SON
-- bilan ro'yxatdagi qatorlar soni mos kelmasdi, bu esa "raqam noto'g'ri" degan
-- shubha tug'diradi (2026-08-11 dagi hisoblagich baglari bilan bir oila).
--
-- Endi: `settlement_bank` va `settlement_safe` alohida. `settlement` esa
-- ikkalasini birga qaytaradi (orqaga moslik uchun).
--
-- Qolgan bo'limlar va ustunlar 20260810000001 dagidek — faqat hisob-kitob
-- shoxobchasining `sect` qiymati va yakuniy WHERE o'zgardi.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.finance_period_rows(
  p_clinic   uuid,
  p_from     date,
  p_to       date,
  p_register text DEFAULT 'reception',
  p_section  text DEFAULT 'revenue',
  p_class    text DEFAULT 'all',
  p_limit    int  DEFAULT 500,
  p_offset   int  DEFAULT 0
)
RETURNS TABLE (
  occurred_at  timestamptz,
  doc_type     text,
  doc_id       uuid,
  party        text,
  description  text,
  method       text,
  method_class text,
  source       text,
  direction    text,
  amount_uzs   bigint,
  who          text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    -- --- Tushum va vozvrat --------------------------------------------------
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
    -- --- Hisob-kitob — bo'lim YO'NALISH bilan --------------------------------
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
      CONCAT('settlement_', bs.destination)
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
    -- --- Seyfdan chiqim ------------------------------------------------------
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
  WHERE (
      p_section = 'all'
      OR b.sect = p_section
      -- 'settlement' = ikkala yo'nalish birga (orqaga moslik)
      OR (p_section = 'settlement' AND b.sect IN ('settlement_bank', 'settlement_safe'))
    )
    AND (p_class = 'all' OR b.mcls = p_class)
  ORDER BY b.ts DESC
  LIMIT GREATEST(1, LEAST(p_limit, 5000))
  OFFSET GREATEST(0, p_offset);
$$;

COMMENT ON FUNCTION public.finance_period_rows(uuid, date, date, text, text, text, int, int) IS
  'Hisobotdagi har bir summaning ortidagi hujjatlar. Bo''limlar: revenue|refund|debt|expense|payroll|encashment|adjustment|settlement (=ikkalasi)|settlement_bank|settlement_safe|safe_deposit|safe_out|all';

NOTIFY pgrst, 'reload schema';
