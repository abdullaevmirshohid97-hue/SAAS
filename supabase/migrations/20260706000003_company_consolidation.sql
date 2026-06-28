-- =============================================================================
-- QISM 0 / F0.4 — Konsolidatsiya: kompaniyaning barcha filiallari bo'yicha
-- GL faolligi (per-branch). API service_role orqali (member tekshiruvi API'da).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.company_consolidated_activity(p_company uuid, p_from date, p_to date)
RETURNS TABLE(clinic_id uuid, clinic_name text, code text, name text, type text, debit bigint, credit bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cl.id AS clinic_id, cl.name AS clinic_name, a.code, a.name, a.type, a.debit, a.credit
  FROM clinics cl
  CROSS JOIN LATERAL public.gl_account_activity(cl.id, p_from, p_to) a
  WHERE cl.company_id = p_company AND cl.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.company_consolidated_activity(uuid,date,date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_consolidated_activity(uuid,date,date) TO service_role;
