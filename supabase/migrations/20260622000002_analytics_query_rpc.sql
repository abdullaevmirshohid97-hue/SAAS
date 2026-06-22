-- =============================================================================
-- Self-serve BI: analytics_query RPC (Faza 5B)
-- Report Builder uchun XAVFSIZ, oq-ro'yxatli agregatsiya. Dinamik SQL YO'Q —
-- o'lcham/grain faqat CASE va parametr orqali (injection imkonsiz).
-- Metrikalar bir martada hisoblanadi (revenue/tx_count/avg_check); UI qaysi
-- birini chizishni o'zi tanlaydi.
--
-- Tenant: p_clinic_id API'dan (autentifikatsiyalangan foydalanuvchi clinic_id'si)
-- keladi — mijoz body'sidan EMAS. EXECUTE faqat service_role'ga ochiq.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.analytics_query(
  p_clinic_id uuid,
  p_dimension text,   -- time | payment_method | register | source | cashier
  p_grain text,       -- day | week | month  (faqat dimension='time' uchun)
  p_from date,
  p_to date
)
RETURNS TABLE(bucket text, revenue_uzs bigint, tx_count bigint, avg_check_uzs bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE p_dimension
      WHEN 'time' THEN to_char(date_trunc(p_grain, (t.created_at AT TIME ZONE 'Asia/Tashkent')), 'YYYY-MM-DD')
      WHEN 'payment_method' THEN t.payment_method::text
      WHEN 'register' THEN t.register
      WHEN 'source' THEN t.source::text
      WHEN 'cashier' THEN COALESCE(pr.full_name, '—')
      ELSE 'all'
    END AS bucket,
    COALESCE(SUM(CASE WHEN t.kind = 'refund' THEN -t.amount_uzs ELSE t.amount_uzs END), 0)::bigint AS revenue_uzs,
    COUNT(*) FILTER (WHERE t.kind = 'payment')::bigint AS tx_count,
    (COALESCE(SUM(CASE WHEN t.kind = 'refund' THEN -t.amount_uzs ELSE t.amount_uzs END), 0)
      / NULLIF(COUNT(*) FILTER (WHERE t.kind = 'payment'), 0))::bigint AS avg_check_uzs
  FROM transactions t
  LEFT JOIN profiles pr ON pr.id = t.cashier_id
  WHERE t.clinic_id = p_clinic_id
    AND t.is_void = false
    AND t.kind IN ('payment', 'deposit', 'refund')
    AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN p_from AND p_to
  GROUP BY 1
  ORDER BY 1;
$$;

-- Faqat API (service_role) chaqira oladi — autentifikatsiyalangan mijoz to'g'ridan-to'g'ri
-- PostgREST RPC orqali (soxta clinic_id bilan) chaqira olmaydi.
REVOKE ALL ON FUNCTION public.analytics_query(uuid, text, text, date, date) FROM public;
REVOKE ALL ON FUNCTION public.analytics_query(uuid, text, text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.analytics_query(uuid, text, text, date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_query(uuid, text, text, date, date) TO service_role;
