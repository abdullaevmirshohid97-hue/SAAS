-- =============================================================================
-- MAOSH — XODIM KESIMIDA (hisobotda "kim qancha oldi")
-- =============================================================================
-- Hisobotda maosh bitta umumiy qator edi: "Maosh to'lovlari — 12 ta — 45 mln".
-- Klinika egasiga esa aynan "falon shifokor shu davrda qancha oldi?" kerak.
-- Bu javob chuqur izlanishda bor edi (har to'lov alohida qator), lekin uni
-- odam qo'lda yig'ib chiqishi kerak edi — 12 ta to'lovni 5 ta shifokor bo'yicha
-- guruhlash xatoga ochiq ish.
--
-- SVERTKA: bu yerdagi `net_uzs` yig'indisi `finance_period_flows.pay_total_uzs`
-- ga TENG bo'lishi shart. Sinf bo'yicha ustunlar (cash/noncash/safe) ham
-- o'sha funksiyadagi pay_cash/pay_noncash/pay_safe bilan mos — ya'ni bu jadval
-- hisobotning boshqa qismlarini tekshirish uchun ham ishlaydi.
--
-- Eslatma: jadval nomi `doctor_payouts` bo'lsa-da, unda klinikaning BARCHA
-- xodimlari bo'lishi mumkin (maosh moduli shunday ishlaydi), shuning uchun
-- ustun nomi `person_*` — "shifokor" deb cheklamaymiz.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finance_payroll_by_person(
  p_clinic   uuid,
  p_from     date,
  p_to       date,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  person_id     uuid,
  person_name   text,
  person_role   text,
  payouts_count bigint,
  net_uzs       bigint,   -- qo'lga tekkan (jami)
  cash_uzs      bigint,   -- shundan naqd (kassadan)
  safe_uzs      bigint,   -- shundan seyfdan
  noncash_uzs   bigint,   -- shundan karta/bank
  first_paid_at timestamptz,
  last_paid_at  timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    dp.doctor_id,
    COALESCE(pf.full_name, '—'),
    COALESCE(pf.role, '—'),
    COUNT(*)::bigint,
    COALESCE(SUM(dp.net_uzs), 0)::bigint,
    -- Sinflar `finance_period_flows` dagi pay_* bilan AYNAN bir xil mantiqda.
    COALESCE(SUM(dp.net_uzs) FILTER (
      WHERE finance_method_class(dp.method::text) = 'cash'
        AND (dp.source IS NULL OR dp.source::text <> 'safe')
    ), 0)::bigint,
    COALESCE(SUM(dp.net_uzs) FILTER (WHERE dp.source::text = 'safe'), 0)::bigint,
    COALESCE(SUM(dp.net_uzs) FILTER (
      WHERE finance_method_class(dp.method::text) <> 'cash'
    ), 0)::bigint,
    MIN(COALESCE(dp.paid_at, dp.created_at)),
    MAX(COALESCE(dp.paid_at, dp.created_at))
  FROM doctor_payouts dp
  LEFT JOIN profiles pf ON pf.id = dp.doctor_id
  WHERE dp.clinic_id = p_clinic
    AND dp.status = 'paid'
    AND p_register = 'reception'   -- maosh klinika darajasida (qabulxona kassasi)
    AND (COALESCE(dp.paid_at, dp.created_at) AT TIME ZONE 'Asia/Tashkent')::date
        BETWEEN p_from AND p_to
  GROUP BY dp.doctor_id, pf.full_name, pf.role
  ORDER BY 5 DESC;   -- eng ko'p olgan birinchi
$$;

COMMENT ON FUNCTION public.finance_payroll_by_person(uuid, date, date, text) IS
  'Davr ichida har bir xodim qancha maosh olgani: soni, jami, naqd/seyf/naqdsiz kesimi, birinchi va oxirgi to''lov sanasi';

REVOKE ALL ON FUNCTION public.finance_payroll_by_person(uuid, date, date, text) FROM public;
REVOKE ALL ON FUNCTION public.finance_payroll_by_person(uuid, date, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.finance_payroll_by_person(uuid, date, date, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finance_payroll_by_person(uuid, date, date, text) TO service_role;

NOTIFY pgrst, 'reload schema';
