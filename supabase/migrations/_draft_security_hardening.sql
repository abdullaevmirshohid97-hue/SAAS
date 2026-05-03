-- ============================================================================
-- SECURITY HARDENING — DRAFT (review before applying)
-- ============================================================================
-- Detected by Supabase advisor 2026-05-03. ~13 P0 findings.
-- DO NOT RUN until reviewed: revoking anon SELECT may break public APIs that
-- legitimately use the anon role (e.g. landing portal). Verify each table.
--
-- To apply: rename to a real timestamped migration (e.g. 20260503120000_security_hardening.sql)
-- ============================================================================

-- 1. Revoke anon SELECT on highly sensitive tables (PHI/PII/secrets)
-- These should NEVER be exposed to anon via GraphQL/REST.
REVOKE ALL ON public.tenant_vault_secrets FROM anon, authenticated;
GRANT SELECT ON public.tenant_vault_secrets TO service_role;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.patient_otp_sessions FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.patients FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.prescriptions FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.prescription_items FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.invoices FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.patient_ledger FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.patient_balance FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.admin_impersonation_sessions FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.super_admin_audit FROM anon;

-- 2. Add deny-all default policy to RLS-enabled-no-policy tables (currently blocking everything anyway, but explicit is safer)
DROP POLICY IF EXISTS p_canned_no_anon ON public.support_canned_responses;
CREATE POLICY p_canned_no_anon ON public.support_canned_responses
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS p_typing_no_anon ON public.support_typing_indicators;
CREATE POLICY p_typing_no_anon ON public.support_typing_indicators
  FOR SELECT USING (auth.role() = 'authenticated');

-- 3. Tighten WITH CHECK = true policies (rate-limit + ownership)
-- Example for clinic_profile_views: only allow inserts of own session, max 1/min/clinic
-- ⚠ Custom logic needed — coordinate with backend.
-- ALTER POLICY ... ON public.clinic_profile_views ...

-- 4. SECURITY DEFINER views — convert to security_invoker where possible.
-- Each requires manual review. List:
--   doctor_productivity_view, pharmacy_daily_view, inpatient_occupancy_view,
--   medication_stock_summary, service_hour_heatmap_view, daily_expense_view,
--   doctor_balances_view, daily_revenue_view, patient_ltv_view, patient_balance
-- Pattern: ALTER VIEW name SET (security_invoker = on);

-- 5. Function search_path immutable (14 functions affected) — set explicit search_path
-- Pattern: ALTER FUNCTION name() SET search_path = public, pg_catalog;

-- 6. Storage buckets: disable public listing on site-media, staff-files
-- (Supabase Console → Storage → Bucket → Public listing OFF)

-- 7. Enable auth.leaked_password_protection
-- (Supabase Console → Authentication → Policies → "Leaked password protection" ON)
