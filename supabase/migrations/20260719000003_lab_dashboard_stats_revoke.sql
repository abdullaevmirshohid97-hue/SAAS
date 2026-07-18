-- =============================================================================
-- D2 — lab_dashboard_stats SECURITY DEFINER: anon/authenticated EXECUTE revoke
-- =============================================================================
-- Funksiya lab faza3'da 2026-07-03 hardening'dan KEYIN yaratilgan — default
-- PUBLIC EXECUTE bilan qolgan (advisors: anon_security_definer_function_executable).
-- API service_role bilan chaqiradi — boshqa hech kimga kerak emas.
-- Eslatma: get_my_clinic_id/get_my_role/get_my_company_id/can_access_branch
-- authenticated'da QOLISHI SHART (RLS policy'lar chaqiradi). pgaudit_* —
-- event-trigger ichki funksiyalari (RPC orqali chaqirilmaydi), tegilmaydi.
-- PROD'GA QO'LLANGAN (2026-07-19).

REVOKE ALL ON FUNCTION public.lab_dashboard_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lab_dashboard_stats(uuid) TO service_role;
