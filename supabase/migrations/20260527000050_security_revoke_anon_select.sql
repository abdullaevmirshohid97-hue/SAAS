-- Supabase linter WARN (0026): anon role GraphQL orqali ko'p PHI jadvallarni
-- ko'rmoqda. Multi-tenant SaaS uchun bu xavfli — bemor ma'lumotlari, moliya,
-- statsionar — hammasi anon kalit bilan o'qish mumkin (RLS himoya qiladi,
-- lekin defence-in-depth yetishmaydi).
--
-- Strategy: hamma public jadvallardan SELECT'ni anon'dan revoke. Faqat
-- landing/marketing public jadvallarini qaytaramiz.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND privilege_type = 'SELECT' AND table_schema = 'public'
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', r.table_name);
  END LOOP;
END $$;

-- Landing/marketing public ma'lumotlari uchun SELECT'ni qaytaramiz.
GRANT SELECT ON public.clinics TO anon;
GRANT SELECT ON public.clinic_features TO anon;
GRANT SELECT ON public.clinic_web_profiles TO anon;
GRANT SELECT ON public.clinic_reviews TO anon;
GRANT SELECT ON public.clinic_review_helpful TO anon;
GRANT SELECT ON public.services TO anon;
GRANT SELECT ON public.service_categories TO anon;
GRANT SELECT ON public.plans TO anon;
GRANT SELECT ON public.site_entries TO anon;
GRANT SELECT ON public.site_media TO anon;
GRANT SELECT ON public.site_revisions TO anon;
GRANT SELECT ON public.legal_documents TO anon;
GRANT SELECT ON public.app_versions TO anon;
GRANT SELECT ON public.holidays TO anon;
GRANT SELECT ON public.payment_methods_catalog TO anon;
GRANT SELECT ON public.payment_providers TO anon;
GRANT SELECT ON public.icd10_codes TO anon;
GRANT SELECT ON public.loinc_tests TO anon;
GRANT SELECT ON public.permissions_catalog TO anon;
GRANT SELECT ON public.online_queue_slots TO anon;
GRANT SELECT ON public.home_nurse_tariffs TO anon;
GRANT SELECT ON public.insurance_companies TO anon;
