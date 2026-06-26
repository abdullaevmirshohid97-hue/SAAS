-- Accounting hisobotlari uchun yagona RPC — trial balance / P&L / cash-flow.
-- Har hisobning berilgan davrdagi debit/credit faolligi (clinic-scoped).
CREATE OR REPLACE FUNCTION public.gl_account_activity(p_clinic uuid, p_from date, p_to date)
RETURNS TABLE(code text, name text, type text, debit bigint, credit bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coa.code, coa.name, coa.type,
    COALESCE(SUM(CASE WHEN j.journal_date BETWEEN p_from AND p_to THEN l.debit_uzs END),0)::bigint AS debit,
    COALESCE(SUM(CASE WHEN j.journal_date BETWEEN p_from AND p_to THEN l.credit_uzs END),0)::bigint AS credit
  FROM chart_of_accounts coa
  LEFT JOIN gl_lines l ON l.account_id = coa.id
  LEFT JOIN gl_journals j ON j.id = l.journal_id
  WHERE coa.clinic_id = p_clinic
  GROUP BY coa.code, coa.name, coa.type
  ORDER BY coa.code;
$$;
REVOKE ALL ON FUNCTION public.gl_account_activity(uuid,date,date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gl_account_activity(uuid,date,date) TO service_role;
