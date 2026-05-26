-- Supabase linter WARN (0024): leads/newsletter/sales_leads anon INSERT
-- policy WITH CHECK (true) — bot/spam xavfli.
-- Yechim: validatsiya qo'shamiz (uzunlik cheklash, kerakli maydonlar).

DROP POLICY IF EXISTS leads_anon_insert ON public.leads;
CREATE POLICY leads_anon_insert ON public.leads
  FOR INSERT
  TO anon
  WITH CHECK (
    char_length(COALESCE(phone, '')) BETWEEN 7 AND 30
    AND char_length(COALESCE(name, '')) BETWEEN 2 AND 100
    AND char_length(COALESCE(message, '')) <= 2000
    AND char_length(COALESCE(email, '')) <= 200
    AND status IN ('new')
  );

DROP POLICY IF EXISTS newsletter_insert_anon ON public.newsletter_subscriptions;
CREATE POLICY newsletter_insert_anon ON public.newsletter_subscriptions
  FOR INSERT
  TO anon
  WITH CHECK (
    char_length(email) BETWEEN 5 AND 200
    AND email ~* '^[^@]+@[^@]+\.[^@]+$'
    AND char_length(COALESCE(locale, '')) <= 10
    AND char_length(COALESCE(source, '')) <= 50
  );

DROP POLICY IF EXISTS leads_insert_anon ON public.sales_leads;
CREATE POLICY leads_insert_anon ON public.sales_leads
  FOR INSERT
  TO anon
  WITH CHECK (
    char_length(full_name) BETWEEN 2 AND 100
    AND char_length(COALESCE(phone, '')) BETWEEN 7 AND 30
    AND char_length(COALESCE(email, '')) <= 200
    AND char_length(COALESCE(message, '')) <= 2000
    AND char_length(COALESCE(clinic_name, '')) <= 200
    AND status IN ('new')
  );
