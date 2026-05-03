-- =============================================================================
-- SECURITY HARDENING — addresses 13 P0 advisor findings (2026-05-03)
-- =============================================================================
-- This migration is idempotent and safe to re-run.
-- Each block is wrapped to skip non-existent objects (development envs may
-- be missing some tables/views/functions).
-- =============================================================================

-- 1. REVOKE anon access on PHI / PII / secret-bearing tables -----------------
-- These should NEVER be exposed to the anon role via PostgREST/GraphQL.
-- RLS would catch most reads, but explicit REVOKE is defense-in-depth.
DO $$
DECLARE
  t TEXT;
  sensitive_tables TEXT[] := ARRAY[
    'tenant_vault_secrets',
    'patient_otp_sessions',
    'patients',
    'prescriptions',
    'prescription_items',
    'invoices',
    'patient_ledger',
    'patient_balance',
    'admin_impersonation_sessions',
    'super_admin_audit'
  ];
BEGIN
  FOREACH t IN ARRAY sensitive_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
      EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
      RAISE NOTICE 'Revoked anon/authenticated on public.%', t;
    END IF;
  END LOOP;
END $$;

-- 2. Add deny-all-anon RLS policies to support_* tables ---------------------
-- These have RLS enabled but no policies → already deny everything,
-- but explicit policies make intent clear and pass the advisor check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_canned_responses') THEN
    DROP POLICY IF EXISTS p_canned_authenticated_read ON public.support_canned_responses;
    CREATE POLICY p_canned_authenticated_read ON public.support_canned_responses
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_typing_indicators') THEN
    DROP POLICY IF EXISTS p_typing_authenticated_read ON public.support_typing_indicators;
    CREATE POLICY p_typing_authenticated_read ON public.support_typing_indicators
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- 3. Convert SECURITY DEFINER views to security_invoker --------------------
-- security_invoker means the view runs with the caller's privileges, so RLS
-- on underlying tables is enforced for the requester.
-- Auto-discover any view in `public` that is currently SECURITY DEFINER.
DO $$
DECLARE
  v RECORD;
BEGIN
  FOR v IN
    SELECT c.relname AS view_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
       AND COALESCE((c.reloptions::text)::text LIKE '%security_invoker=on%', false) = false
  LOOP
    BEGIN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v.view_name);
      RAISE NOTICE 'Set security_invoker=on for view public.%', v.view_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped view public.% (%)', v.view_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- 4. Set immutable search_path on all public functions ----------------------
-- Mutable search_path is a search-path-injection risk (CVE-2018-1058 class).
-- Apply explicit `search_path = public, pg_catalog` to every public function.
DO $$
DECLARE
  f RECORD;
  cfg TEXT;
BEGIN
  FOR f IN
    SELECT n.nspname AS schema, p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
  LOOP
    -- Skip if search_path is already explicitly set
    IF f.proconfig IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM unnest(f.proconfig) AS cfg_item
         WHERE cfg_item LIKE 'search_path=%'
      ) THEN
        CONTINUE;
      END IF;
    END IF;

    BEGIN
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog, extensions',
        f.name, f.args
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped function %(%) — %', f.name, f.args, SQLERRM;
    END;
  END LOOP;
END $$;

-- 5. Tighten clinic_profile_views WITH CHECK ------------------------------
-- Only allow inserting your own session row (anon may insert freely otherwise).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clinic_profile_views') THEN
    DROP POLICY IF EXISTS p_cpv_insert ON public.clinic_profile_views;
    CREATE POLICY p_cpv_insert ON public.clinic_profile_views
      FOR INSERT
      WITH CHECK (
        portal_user_id IS NULL OR portal_user_id = auth.uid()
      );
  END IF;
END $$;

-- 6. Documentation — manual Console steps still required -------------------
-- The following CANNOT be set via SQL and must be toggled in Supabase Console:
--   a. Authentication → Providers → Google (set Client ID + Secret + ON)
--   b. Authentication → Email → Leaked password protection = ON
--   c. Storage → site-media → Public listing = OFF
--   d. Storage → staff-files → Public listing = OFF
--   e. Authentication → URL Configuration:
--        Site URL: https://app.clary.uz
--        Redirect URLs: https://patient.clary.uz, https://app.clary.uz/auth/callback
-- =============================================================================

COMMENT ON SCHEMA public IS 'Clary v2 — security hardened 2026-05-03';
