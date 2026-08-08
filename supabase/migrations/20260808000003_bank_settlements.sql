-- =============================================================================
-- NAQDSIZ PUL KUZATUVI — karta/o'tkazma ham naqd singari boshqariladi
-- =============================================================================
-- MUAMMO: naqd pul to'liq kuzatilardi (kassa → inkasatsiya → seyf → chiqim),
-- karta va o'tkazma esa faqat "tushum" sifatida qayd etilib, keyingi taqdiri
-- umuman kuzatilmasdi. Ya'ni "terminal orqali 18 825 000 tushgan, bankka
-- qanchasi kelgan?" degan savolga tizim javob bera olmasdi.
--
-- YECHIM: naqd modelining AYNAN nusxasi:
--     naqd:     kassa   → inkasatsiya → seyf   → chiqim
--     naqdsiz:  terminal → hisob-kitob → bank  → chiqim
--
--   "Bankka o'tmagan"  = Σ naqdsiz to'lov − Σ vozvrat − Σ hisob-kitob
--   "Bankdagi pul"     = Σ hisob-kitob − Σ naqdsiz rasxot/maosh
--
-- NEGA ALOHIDA JADVAL (transactions ichida emas): inkasatsiya `notes` matnidan
-- ("%inkasatsiya%") aniqlanadi — bu mo'rt yechim (operator izohni o'zgartirsa
-- yoki tarjima qilinsa buziladi). Bu yerda shu xatoni takrorlamaymiz: hisob-kitob
-- ALOHIDA jadvalda, aniq ustunlar bilan.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bank_settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  register     TEXT NOT NULL DEFAULT 'reception',
  -- Qaysi usul bo'yicha pul bankka tushdi (card/transfer/click/...).
  -- NULL = aralash/umumiy hisob-kitob (barcha naqdsiz usullar birga).
  method       TEXT,
  amount_uzs   BIGINT NOT NULL CHECK (amount_uzs > 0),
  bank_name    TEXT,
  reference    TEXT,           -- bank ko'chirmasidagi hujjat raqami
  notes        TEXT,
  recorded_by  UUID REFERENCES profiles(id),
  is_void      BOOLEAN NOT NULL DEFAULT false,
  voided_at    TIMESTAMPTZ,
  voided_by    UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_settlements_clinic
  ON bank_settlements (clinic_id, register, created_at DESC);

ALTER TABLE bank_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_bank_settlements_tenant ON bank_settlements;
CREATE POLICY p_bank_settlements_tenant ON bank_settlements
  FOR ALL
  USING      ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'))
  WITH CHECK ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'));

-- =============================================================================
-- Naqdsiz balans — bitta qator (PostgREST 1000 qator cheklovidan xoli).
-- Naqd tomondagi cashier_cash_on_hand bilan bir xil uslubda.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cashier_noncash_balance(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  received_uzs   bigint,  -- naqdsiz to'lovlar (kirim)
  refunds_uzs    bigint,  -- naqdsiz vozvratlar
  settled_uzs    bigint,  -- bankka o'tkazilgani (hisob-kitob)
  pending_uzs    bigint,  -- BANKKA O'TMAGAN (kutilmoqda)
  expenses_uzs   bigint,  -- naqdsiz rasxot (bankdan)
  payroll_uzs    bigint,  -- naqdsiz maosh (bankdan)
  bank_uzs       bigint   -- BANKDAGI PUL
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH legs AS (
    SELECT kind, amount_uzs
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic
      AND register  = p_register
      AND is_void   = false
      -- Naqd EMAS va qarz EMAS: qarz — hali kelmagan pul, hisobga kirmaydi.
      AND method::text NOT IN ('cash', 'debt', 'mixed')
      AND (tx_source IS NULL OR tx_source::text <> 'safe')
  ),
  inc AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind = 'payment' AND amount_uzs > 0), 0)::bigint AS received,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE kind = 'refund' OR (kind = 'payment' AND amount_uzs < 0)
      ), 0)::bigint AS refunds
    FROM legs
  ),
  st AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint AS settled
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
  ),
  ex AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint AS e
    FROM expenses
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND COALESCE(payment_method::text, 'cash') NOT IN ('cash')
  ),
  pay AS (
    SELECT CASE WHEN p_register = 'reception'
                THEN COALESCE(SUM(net_uzs), 0) ELSE 0 END::bigint AS p
    FROM doctor_payouts
    WHERE clinic_id = p_clinic AND status = 'paid'
      AND COALESCE(method::text, 'cash') NOT IN ('cash')
  )
  SELECT inc.received, inc.refunds, st.settled,
         (inc.received - inc.refunds - st.settled)::bigint,
         ex.e, pay.p,
         (st.settled - ex.e - pay.p)::bigint
  FROM inc, st, ex, pay;
$$;

-- =============================================================================
-- Naqdsiz kirim — usul bo'yicha (audit sahifasida "nima kutilmoqda" ko'rinishi)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cashier_noncash_by_method(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (method text, cnt bigint, received_uzs bigint, settled_uzs bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH inc AS (
    SELECT method::text AS m, COUNT(*)::bigint c, SUM(amount_uzs)::bigint s
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND kind = 'payment' AND amount_uzs > 0
      AND method::text NOT IN ('cash', 'debt', 'mixed')
    GROUP BY 1
  ),
  st AS (
    SELECT COALESCE(method, 'aralash') AS m, SUM(amount_uzs)::bigint s
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
    GROUP BY 1
  )
  SELECT COALESCE(inc.m, st.m), COALESCE(inc.c, 0), COALESCE(inc.s, 0), COALESCE(st.s, 0)
  FROM inc FULL OUTER JOIN st ON st.m = inc.m
  ORDER BY 3 DESC;
$$;

NOTIFY pgrst, 'reload schema';
