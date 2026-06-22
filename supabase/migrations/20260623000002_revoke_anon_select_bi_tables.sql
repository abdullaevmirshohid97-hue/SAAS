-- =============================================================================
-- Faza 5 jadvallari (ai_copilot_log, report_schedules) faqat API service_role
-- orqali ishlatiladi. anon/authenticated SELECT grant'ini olib tashlash —
-- GraphQL sxemada ko'rinmasin (advisor lint 0026/0027). RLS allaqachon deny-all
-- (policy yo'q); bu defense-in-depth.
-- =============================================================================

REVOKE SELECT ON public.ai_copilot_log FROM anon, authenticated;
REVOKE SELECT ON public.report_schedules FROM anon, authenticated;
