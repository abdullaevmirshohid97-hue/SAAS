-- =============================================================================
-- XAVFSIZLIK: public SECURITY DEFINER funksiyalaridan client rollarning (PUBLIC/
-- anon/authenticated) EXECUTE huquqini olib tashlash.
--
-- SABAB: Supabase advisor 72 ta SECURITY DEFINER funksiya anon (login qilmagan,
-- ochiq kalit bilan har kim) tomonidan chaqirilishi mumkinligini aniqladi —
-- masalan set_user_clinic (imtiyoz oshirish), hard_delete_transaction,
-- data_admin_purge, pharmacy_sell. Bu RPC'lar RLS'ni chetlab o'tadi.
--
-- XAVFSIZLIK ISBOTI (buzilmasligi):
--  * Frontend (web-clinic) bu funksiyalarni HECH QACHON to'g'ridan chaqirmaydi
--    (`.rpc(` = 0 ta). Hammasi NestJS API (service_role) orqali.
--  * service_role va postgres ALOHIDA (explicit) grant'ga ega — quyida yana
--    aniq GRANT bilan kafolatlanadi. REVOKE ular'ga tegmaydi → API ishlashda davom etadi.
--  * RLS policy'larda faqat get_my_clinic_id / get_my_role ishlatiladi —
--    ular authenticated uchun SAQLANADI (realtime RLS buzilmasin).
--
-- QAYTARISH (rollback): quyidagi DO blokdagi REVOKE'larni GRANT ... TO anon,
-- authenticated, PUBLIC ga almashtiring (yoki bu migratsiyani teskari qo'llang).
-- =============================================================================

DO $$
DECLARE
  r record;
  sig text;
  keep_authenticated text[] := ARRAY[
    'get_my_clinic_id', 'get_my_role', 'get_my_company_id', 'can_access_branch'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    sig := format('public.%I(%s)', r.proname, r.args);

    -- Kafolat: API (service_role) har doim EXECUTE saqlaydi.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);

    -- Client rollardan olib tashlash.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', sig);

    IF r.proname = ANY(keep_authenticated) THEN
      -- RLS yordamchilari — authenticated uchun kerak (realtime RLS).
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', sig);
    END IF;
  END LOOP;
END $$;
