-- =============================================================================
-- Clary v2 — Migration 000060: Row Level Security on every domain table
-- Standard policies:
--   SELECT:  clinic_id = get_my_clinic_id() OR is_super_admin()
--   INSERT:  clinic_id = get_my_clinic_id() AND role checks (where applicable)
--   UPDATE:  clinic_id = get_my_clinic_id() OR is_super_admin()
--   DELETE:  clinic_id = get_my_clinic_id() OR is_super_admin()
-- =============================================================================

-- Helper: apply standard 4 policies to a list of tables
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    -- Core
    'clinics', 'profiles', 'invitations', 'user_devices',
    'subscriptions', 'invoices', 'platform_payments', 'tenant_vault_secrets',

    -- Catalog
    'service_categories', 'services', 'service_price_history',
    'rooms', 'room_tariffs',
    'diagnostic_categories', 'diagnostic_preparations', 'diagnostic_equipment', 'diagnostic_types',
    'lab_test_categories', 'lab_tests',
    'medication_categories', 'medications', 'suppliers',
    'expense_categories', 'payment_methods_catalog',
    'discount_rules', 'insurance_companies', 'referral_partners',
    'document_templates', 'sms_templates', 'email_templates',
    'working_hours', 'holidays', 'custom_roles',

    -- Clinical
    'patients', 'appointments', 'queues',
    'diagnostic_orders', 'diagnostic_results',
    'lab_orders', 'lab_order_items', 'lab_results',
    'inpatient_stays', 'vital_signs', 'treatment_notes',
    'pharmacy_sales', 'pharmacy_sale_items', 'pharmacy_stock_movements',
    'shifts', 'transactions', 'transaction_items',
    'expenses', 'doctor_payouts',

    -- Audit
    'activity_journal', 'settings_audit_log',

    -- Marketing
    'marketing_segments', 'marketing_campaigns', 'marketing_campaign_sends',
    'marketing_journeys', 'marketing_journey_enrollments',
    'loyalty_rules', 'loyalty_points_ledger', 'nps_responses',

    -- Support + infra
    'support_threads', 'support_messages',
    'webhook_endpoints', 'webhook_deliveries',
    'clinic_features'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Standard clinic-scoped policies
-- -----------------------------------------------------------------------------
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'invitations', 'user_devices', 'subscriptions', 'invoices', 'platform_payments',
    'tenant_vault_secrets',
    'service_categories', 'services', 'service_price_history',
    'rooms', 'room_tariffs',
    'diagnostic_categories', 'diagnostic_preparations', 'diagnostic_equipment', 'diagnostic_types',
    'lab_test_categories', 'lab_tests',
    'medication_categories', 'medications', 'suppliers',
    'expense_categories', 'payment_methods_catalog',
    'discount_rules', 'insurance_companies', 'referral_partners',
    'document_templates', 'sms_templates', 'email_templates',
    'working_hours', 'holidays', 'custom_roles',
    'patients', 'appointments', 'queues',
    'diagnostic_orders', 'diagnostic_results',
    'lab_orders', 'lab_order_items', 'lab_results',
    'inpatient_stays', 'vital_signs', 'treatment_notes',
    'pharmacy_sales', 'pharmacy_sale_items', 'pharmacy_stock_movements',
    'shifts', 'transactions', 'transaction_items',
    'expenses', 'doctor_payouts',
    'activity_journal',
    'marketing_segments', 'marketing_campaigns', 'marketing_campaign_sends',
    'marketing_journeys', 'marketing_journey_enrollments',
    'loyalty_rules', 'loyalty_points_ledger', 'nps_responses',
    'support_threads', 'support_messages',
    'webhook_endpoints', 'webhook_deliveries',
    'clinic_features'
  ])
  LOOP
    EXECUTE format($pol$
      CREATE POLICY %I_tenant_select ON %I FOR SELECT
        USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
      CREATE POLICY %I_tenant_insert ON %I FOR INSERT
        WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
      CREATE POLICY %I_tenant_update ON %I FOR UPDATE
        USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin())
        WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
      CREATE POLICY %I_tenant_delete ON %I FOR DELETE
        USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
    $pol$, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Special policies
-- -----------------------------------------------------------------------------

-- clinics — admin of self, super admin sees all
CREATE POLICY clinics_self_select ON clinics FOR SELECT
  USING (id = public.get_my_clinic_id() OR public.is_super_admin());
CREATE POLICY clinics_self_update ON clinics FOR UPDATE
  USING ((id = public.get_my_clinic_id() AND public.is_clinic_admin()) OR public.is_super_admin());
-- Only super admin may insert/delete clinics (signup goes through a service-role function)
CREATE POLICY clinics_super_admin_insert ON clinics FOR INSERT
  WITH CHECK (public.is_super_admin());
CREATE POLICY clinics_super_admin_delete ON clinics FOR DELETE
  USING (public.is_super_admin());

-- profiles — user sees self + same-clinic members; clinic admin updates clinic members
CREATE POLICY profiles_self_or_clinic_select ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR clinic_id = public.get_my_clinic_id()
    OR public.is_super_admin()
  );
CREATE POLICY profiles_self_update ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING ((clinic_id = public.get_my_clinic_id() AND public.is_clinic_admin()) OR public.is_super_admin())
  WITH CHECK ((clinic_id = public.get_my_clinic_id() AND public.is_clinic_admin()) OR public.is_super_admin());
CREATE POLICY profiles_admin_insert ON profiles FOR INSERT
  WITH CHECK (public.is_clinic_admin() OR public.is_super_admin());

-- settings_audit_log — READ ONLY for clinic admin + super admin
CREATE POLICY sal_select ON settings_audit_log FOR SELECT
  USING ((clinic_id = public.get_my_clinic_id() AND public.is_clinic_admin()) OR public.is_super_admin());
-- INSERT is allowed only via the trigger (SECURITY DEFINER); rules block direct writes
CREATE POLICY sal_insert ON settings_audit_log FOR INSERT WITH CHECK (false);

-- plans — read by everyone, write super admin only
CREATE POLICY plans_public_read ON plans FOR SELECT USING (true);
CREATE POLICY plans_super_admin_write ON plans FOR INSERT WITH CHECK (public.is_super_admin());
CREATE POLICY plans_super_admin_update ON plans FOR UPDATE USING (public.is_super_admin());
CREATE POLICY plans_super_admin_delete ON plans FOR DELETE USING (public.is_super_admin());
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- admin_impersonation_sessions (super admin only)
ALTER TABLE admin_impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ais_super_admin ON admin_impersonation_sessions
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- backup_runs — super admin only
ALTER TABLE backup_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY br_super_admin ON backup_runs
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- newsletter + leads — insert open, select super admin only
ALTER TABLE newsletter_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY newsletter_insert_anon ON newsletter_subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY newsletter_select_super ON newsletter_subscriptions FOR SELECT USING (public.is_super_admin());

ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_insert_anon ON sales_leads FOR INSERT WITH CHECK (true);
CREATE POLICY leads_select_super ON sales_leads FOR SELECT USING (public.is_super_admin());
CREATE POLICY leads_update_super ON sales_leads FOR UPDATE USING (public.is_super_admin());
