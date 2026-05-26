-- Supabase linter WARN (0011): 6 ta function search_path mutable.
-- Yechim: har function'ga search_path = '' o'rnatamiz (search_path injection
-- xavfini bartaraf etish).
--
-- search_icd10 ichida public.similarity() (pg_trgm extension) ishlatiladi,
-- shuning uchun unga search_path = 'public' (extension public schema'da
-- joylashgan).

ALTER FUNCTION public.assign_billing_code() SET search_path = '';
ALTER FUNCTION public.search_icd10(text, integer) SET search_path = 'public';
ALTER FUNCTION public.trigger_set_updated_at() SET search_path = '';
ALTER FUNCTION public.seed_clinic_sla_rules() SET search_path = '';
ALTER FUNCTION public.touch_journal_layout() SET search_path = '';
ALTER FUNCTION public.is_payroll_eligible_role(text) SET search_path = '';
