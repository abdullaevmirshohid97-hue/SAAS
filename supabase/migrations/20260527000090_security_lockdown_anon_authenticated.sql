-- Supabase linter WARN (0026 + 0027): anon va authenticated rollar
-- GraphQL/Data API orqali 150+ public jadvallarni o'qishi mumkin edi.
-- Multi-tenant SaaS uchun bu defence-in-depth buzilishi.
--
-- Tekshiruv natijasi:
-- - web-landing: Supabase'ga to'g'ridan-to'g'ri ulanmaydi
-- - web-clinic: faqat 3 ta jadval (clinic_reviews, clinic_profile_views,
--               clinic_rating_summary) bevosita Supabase orqali ishlatadi
-- - web-patient/web-admin: Supabase.from() ishlatilmaydi
-- - Frontend Supabase Auth/Storage/Realtime (auth/storage schema'lar)
--   bilan ishlaydi, public.* bilan emas
-- - Backend NestJS service_role bilan ulanadi (revoke ta'sir qilmaydi)
--
-- Strategy: hamma public jadvallardan SELECT'ni anon + authenticated dan
-- revoke, faqat frontend bevosita ishlatadigan 3 ta jadval qoladi.

-- 1) Anon SELECT: hammasidan revoke
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

-- 2) Authenticated SELECT: hammasidan revoke
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated' AND privilege_type = 'SELECT' AND table_schema = 'public'
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', r.table_name);
  END LOOP;
END $$;

-- 3) Frontend bevosita ishlatadigan jadvallarni qaytaramiz (faqat
--    authenticated, anon yo'q):
GRANT SELECT ON public.clinic_reviews TO authenticated;
GRANT UPDATE ON public.clinic_reviews TO authenticated;
GRANT SELECT ON public.clinic_profile_views TO authenticated;
GRANT SELECT ON public.clinic_rating_summary TO authenticated;

-- INSERT/UPDATE/DELETE huquqlari anon/authenticated uchun saqlanadi
-- (leads, newsletter_subscriptions, sales_leads, online_queue_bookings —
-- RLS himoya qiladi va validatsiya policy'lar bor).
