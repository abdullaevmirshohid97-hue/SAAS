-- =============================================================================
-- NAQDSIZ PUL — PLASTIK VA O'TKAZMA ALOHIDA
-- =============================================================================
-- Kassada plastik va o'tkazma bitta "Naqdsiz to'lovdagi pul" kartasida edi.
-- Amalda bu ikki xil pul: plastik terminal orqali (acquiring, odatda ertasi
-- kuni tushadi), o'tkazma esa to'g'ridan-to'g'ri hisobga. Ularni bir joyda
-- ko'rsatish "qaysi biri kelmayapti?" degan savolga javob bermaydi.
--
-- Sinflar `finance_method_class` bilan AYNAN bir xil — kassa va hisobot bitta
-- mantiqdan foydalanadi (aks holda ikki ekran turli raqam ko'rsatadi).
--
-- ⚠️ BIRIKTIRILMAGAN HISOB-KITOB: `bank_settlements.method` NULL bo'lishi
-- mumkin ("aralash" — dialogda usul tanlanmagan). Bunday yozuvni qaysi sinfga
-- yozishni bilib bo'lmaydi, shuning uchun u ALOHIDA `unassigned` qatorida
-- ko'rsatiladi. Uni jimgina sinflarga taqsimlash — o'ylab topilgan raqam
-- bo'lardi. Qatorlar yig'indisi umumiy `pending_uzs` ga TENG bo'ladi.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cashier_noncash_by_class(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  cls           text,    -- card | transfer | other | unassigned
  received_uzs  bigint,  -- terminalga tushgan
  refunds_uzs   bigint,  -- qaytarilgan
  settled_uzs   bigint,  -- olingan (bank yoki seyf)
  pending_uzs   bigint,  -- hali olinmagan
  cnt           bigint   -- to'lovlar soni
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH legs AS (
    SELECT finance_method_class(method::text) AS c, kind, amount_uzs
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND (tx_source IS NULL OR tx_source::text <> 'safe')
      AND finance_method_class(method::text) IN ('card', 'transfer', 'other')
  ),
  inc AS (
    SELECT c,
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind = 'payment' AND amount_uzs > 0), 0)::bigint AS rec,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE kind = 'refund' OR (kind = 'payment' AND amount_uzs < 0)
      ), 0)::bigint AS ref,
      COUNT(*) FILTER (WHERE kind = 'payment' AND amount_uzs > 0)::bigint AS n
    FROM legs GROUP BY c
  ),
  st AS (
    -- Usuli ko'rsatilgan hisob-kitoblar sinfga biriktiriladi.
    SELECT finance_method_class(method) AS c, COALESCE(SUM(amount_uzs), 0)::bigint AS s
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
  ),
  classes AS (SELECT unnest(ARRAY['card', 'transfer', 'other']) AS c)
  SELECT
    classes.c,
    COALESCE(inc.rec, 0),
    COALESCE(inc.ref, 0),
    COALESCE(st.s, 0),
    (COALESCE(inc.rec, 0) - COALESCE(inc.ref, 0) - COALESCE(st.s, 0))::bigint,
    COALESCE(inc.n, 0)
  FROM classes
  LEFT JOIN inc ON inc.c = classes.c
  LEFT JOIN st  ON st.c  = classes.c

  UNION ALL
  -- Usuli ko'rsatilmagan hisob-kitoblar — sinfga taqsimlanmaydi.
  SELECT 'unassigned', 0::bigint, 0::bigint, unassigned.s, (-unassigned.s)::bigint, 0::bigint
  FROM unassigned
  WHERE unassigned.s <> 0;
$$;

COMMENT ON FUNCTION public.cashier_noncash_by_class(uuid, text) IS
  'Naqdsiz pul sinf kesimida (plastik / o''tkazma / boshqa): tushgan, qaytarilgan, olingan, kutilayotgan. Qatorlar yig''indisi cashier_noncash_balance.pending_uzs ga teng.';

REVOKE ALL ON FUNCTION public.cashier_noncash_by_class(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.cashier_noncash_by_class(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.cashier_noncash_by_class(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cashier_noncash_by_class(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
