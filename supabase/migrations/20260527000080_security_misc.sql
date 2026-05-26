-- Supabase linter WARN (0025 + 0016 + 0026): qo'shimcha xavfsizlik fix'lari.

-- 1) staff-documents bucket — public LIST policy'ni olib tashlash.
-- Public bucket faylga URL bilan kirish ishlaydi, lekin LIST yashirilsin.
DROP POLICY IF EXISTS staff_documents_public_read ON storage.objects;

-- 2) clinic_rating_summary materialized view'ni Data API'dan yashirish.
-- Materialized view'lar RLS qo'llab-quvvatlamaydi, anon/authenticated
-- to'g'ridan-to'g'ri ko'rmasligi kerak.
REVOKE SELECT ON public.clinic_rating_summary FROM anon;
REVOKE SELECT ON public.clinic_rating_summary FROM authenticated;

-- Public landing uchun wrapper view yaratamiz (RLS qo'llanadi).
CREATE OR REPLACE VIEW public.clinic_rating_public_view AS
SELECT * FROM public.clinic_rating_summary;

ALTER VIEW public.clinic_rating_public_view SET (security_invoker = true);
GRANT SELECT ON public.clinic_rating_public_view TO anon;
GRANT SELECT ON public.clinic_rating_public_view TO authenticated;
