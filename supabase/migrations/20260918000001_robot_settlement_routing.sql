-- =============================================================================
-- OY YOPISHDA NAQDSIZ PULNI USUL BO'YICHA YO'NALTIRISH
-- =============================================================================
-- MUAMMO: oy yopishda naqdsiz pul (plastik / o'tkazma / Click / Payme) faqat
-- BITTA yo'nalishga o'tardi — hammasi bankka (`closePeriod` da destination
-- qattiq 'bank'). Amalda klinika egasi har usulni boshqa joyga oladi:
-- plastik → asosiy hisob, Click → Click hisobi, Payme → naqd yechib seyfga.
--
-- NEGA SINF EMAS, USUL KESIMIDA: `finance_method_class` Click/Payme/Uzum/Kaspi
-- ni bitta 'other' sinfiga qo'shib yuboradi, ya'ni sinf darajasida Click bilan
-- Payme ni ajratib bo'lmaydi — foydalanuvchi so'ragan narsa esa aynan shu.
-- `bank_settlements.method` ANIQ usulni allaqachon saqlaydi va
-- `cashier_noncash_by_class` uni qayta sinfga o'giradi, ya'ni ma'lumot modeli
-- buni ko'taradi — faqat qoldiqni usul kesimida ko'rsatuvchi funksiya yo'q edi.
--
-- ⚠️ NEGA `destination` GA UCHINCHI QIYMAT ('other') QO'SHILMADI:
-- oltita funksiya `destination` bo'yicha filtrlaydi va ular IKKI xil yozilgan:
--   ELSE 'bank'                      → finance_account_ledger, finance_period_rows
--   FILTER (WHERE destination='bank') → finance_balances_asof, finance_period_flows
-- Ikkinchi shakl uchun yangi qiymat HALOKATLI: pul `settled` ga kiradi (ya'ni
-- "bankka o'tmagan" dan ayriladi), lekin na to_bank, na to_safe ga tushadi —
-- BALANSDAN BUTUNLAY YO'QOLADI. Shuning uchun "boshqa kategoriya" alohida
-- yo'nalish emas, balki bank tomonidagi pulning YORLIG'I:
--     destination = 'bank' + category = '<yorliq>'
-- Jismoniy haqiqat ham shu: seyfga naqd yechib olinmagan naqdsiz pul —
-- qanday atalmasin — bank tomonidagi pul.
-- =============================================================================

-- --- 1) Hisob-kitob yozuviga manzil yorliqlari --------------------------------
ALTER TABLE bank_settlements
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS category        text;

COMMENT ON COLUMN bank_settlements.bank_account_id IS
  'Qaysi bank hisobiga tushdi (bank_accounts). NULL = ko''rsatilmagan.';
COMMENT ON COLUMN bank_settlements.category IS
  'Erkin yorliq — "boshqa kategoriya" tanlanganda. destination o''zgarmaydi (bank).';

CREATE INDEX IF NOT EXISTS idx_bank_settlements_account
  ON bank_settlements (bank_account_id) WHERE bank_account_id IS NOT NULL;

-- --- 2) Bitta yopishda bir nechta hisob-kitob ---------------------------------
-- Ilgari yopish bitta `settle_id` yozardi (hammasi bankka). Endi har usul
-- alohida yozuv — `reopen` hammasini bekor qila olishi uchun ro'yxat kerak.
-- `settle_id` QOLADI (birinchi id) — eski qatorlar va eski kod buzilmasin.
ALTER TABLE period_closings
  ADD COLUMN IF NOT EXISTS settle_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN period_closings.settle_ids IS
  'Shu yopishda yozilgan bank_settlements id lari. settle_id = birinchisi (orqaga moslik).';

-- --- 3) Naqdsiz qoldiq ANIQ USUL kesimida -------------------------------------
-- `cashier_noncash_by_class` ning aynan nusxasi, faqat sinf o'rniga method::text
-- bo'yicha guruhlanadi.
--
-- INVARIANT: qatorlar yig'indisi `cashier_noncash_balance.pending_uzs` ga TENG.
-- Buning uchun BARCHA hisob-kitoblar hisobga olinishi shart (o'sha funksiya
-- `st` da method bo'yicha umuman filtrlamaydi):
--   * legdagi usulga mos hisob-kitob     → FULL OUTER JOIN ning ikkala tomoni
--   * legda uchramaydigan usul           → JOIN ning o'ng tomoni
--   * method IS NULL (eski aralash yozuv) → 'aralash' qatori
DROP FUNCTION IF EXISTS public.cashier_noncash_pending_by_method(uuid, text);

CREATE FUNCTION public.cashier_noncash_pending_by_method(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  method       text,
  cls          text,
  received_uzs bigint,
  refunds_uzs  bigint,
  settled_uzs  bigint,
  pending_uzs  bigint,
  cnt          bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH legs AS (
    SELECT method::text AS m, kind, amount_uzs
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (tx_source IS NULL OR tx_source::text <> 'safe')
      -- `cashier_noncash_balance` bilan bir xil chegara (cash/debt/mixed tashqarida).
      AND finance_method_class(method::text) IN ('card', 'transfer', 'other')
  ),
  inc AS (
    SELECT m,
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind = 'payment' AND amount_uzs > 0), 0)::bigint AS rec,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE kind = 'refund' OR (kind = 'payment' AND amount_uzs < 0)
      ), 0)::bigint AS ref,
      COUNT(*) FILTER (WHERE kind = 'payment' AND amount_uzs > 0)::bigint AS n
    FROM legs GROUP BY m
  ),
  st AS (
    SELECT method AS m, COALESCE(SUM(amount_uzs), 0)::bigint AS s
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND method IS NOT NULL
    GROUP BY 1
  ),
  unassigned AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint AS s
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND method IS NULL
  )
  SELECT
    COALESCE(inc.m, st.m)                        AS method,
    finance_method_class(COALESCE(inc.m, st.m))  AS cls,
    COALESCE(inc.rec, 0),
    COALESCE(inc.ref, 0),
    COALESCE(st.s, 0),
    (COALESCE(inc.rec, 0) - COALESCE(inc.ref, 0) - COALESCE(st.s, 0))::bigint,
    COALESCE(inc.n, 0)
  FROM inc
  FULL OUTER JOIN st ON st.m = inc.m

  UNION ALL
  -- Usuli ko'rsatilmagan eski hisob-kitoblar — usulga taqsimlanmaydi.
  SELECT 'aralash', 'other', 0::bigint, 0::bigint,
         unassigned.s, (-unassigned.s)::bigint, 0::bigint
  FROM unassigned
  WHERE unassigned.s <> 0;
$$;

COMMENT ON FUNCTION public.cashier_noncash_pending_by_method(uuid, text) IS
  'Naqdsiz pul ANIQ usul kesimida (card/humo/uzcard/transfer/click/payme/...): tushgan, qaytarilgan, olingan, kutilayotgan. Qatorlar yig''indisi cashier_noncash_balance.pending_uzs ga teng.';

REVOKE ALL  ON FUNCTION public.cashier_noncash_pending_by_method(uuid, text) FROM public;
REVOKE ALL  ON FUNCTION public.cashier_noncash_pending_by_method(uuid, text) FROM anon;
REVOKE ALL  ON FUNCTION public.cashier_noncash_pending_by_method(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cashier_noncash_pending_by_method(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
