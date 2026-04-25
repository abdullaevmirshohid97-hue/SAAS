-- =============================================================================
-- Clary v2 — Migration 000030: Dual audit
-- (1) activity_journal — real-time operational feed, visible to all staff
-- (2) settings_audit_log — tamper-evident (SHA-256 hash chain), admin only
-- =============================================================================

-- -----------------------------------------------------------------------------
-- activity_journal
-- -----------------------------------------------------------------------------
CREATE TABLE activity_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES profiles(id),
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  summary_i18n JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_aj_clinic_date ON activity_journal(clinic_id, created_at DESC);
CREATE INDEX idx_aj_clinic_actor ON activity_journal(clinic_id, actor_id, created_at DESC);
CREATE INDEX idx_aj_clinic_action ON activity_journal(clinic_id, action, created_at DESC);
CREATE INDEX idx_aj_resource ON activity_journal(resource_type, resource_id);

-- Generic append helper (NestJS calls via Postgres function)
CREATE OR REPLACE FUNCTION public.log_activity(
  p_clinic_id UUID,
  p_actor_id UUID,
  p_actor_role TEXT,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id UUID,
  p_summary JSONB,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.activity_journal (
    clinic_id, actor_id, actor_role, action,
    resource_type, resource_id, summary_i18n, metadata
  ) VALUES (
    p_clinic_id, p_actor_id, p_actor_role, p_action,
    p_resource_type, p_resource_id, p_summary, p_metadata
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- settings_audit_log (tamper-evident hash chain)
-- -----------------------------------------------------------------------------
CREATE TABLE settings_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGSERIAL UNIQUE NOT NULL,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  actor_role TEXT NOT NULL,
  actor_ip INET,
  actor_ua TEXT,
  table_name TEXT NOT NULL,
  record_id UUID,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'RESTORE', 'REVERT')),
  changed_fields TEXT[],
  before_value JSONB,
  after_value JSONB,
  diff JSONB,
  reason TEXT,
  prev_hash TEXT,
  current_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sal_clinic_seq ON settings_audit_log(clinic_id, sequence DESC);
CREATE INDEX idx_sal_table ON settings_audit_log(clinic_id, table_name, created_at DESC);
CREATE INDEX idx_sal_actor ON settings_audit_log(clinic_id, actor_id, created_at DESC);
CREATE INDEX idx_sal_record ON settings_audit_log(table_name, record_id);

-- APPEND-ONLY
CREATE RULE no_update_settings_audit AS ON UPDATE TO settings_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_settings_audit AS ON DELETE TO settings_audit_log DO INSTEAD NOTHING;

-- -----------------------------------------------------------------------------
-- Hash-chain trigger (reusable by every catalog table)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_settings_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_hash TEXT;
  v_canonical TEXT;
  v_hash TEXT;
  v_clinic UUID;
  v_record_id UUID;
  v_actor_id UUID;
  v_actor_role TEXT;
  v_actor_ip INET;
  v_actor_ua TEXT;
  v_before JSONB;
  v_after JSONB;
  v_changed TEXT[];
BEGIN
  v_clinic := COALESCE((NEW).clinic_id::UUID, (OLD).clinic_id::UUID);
  v_record_id := COALESCE((NEW).id::UUID, (OLD).id::UUID);

  v_actor_id := NULLIF(current_setting('app.actor_id', true), '')::UUID;
  v_actor_role := current_setting('app.actor_role', true);
  v_actor_ip := NULLIF(current_setting('app.actor_ip', true), '')::INET;
  v_actor_ua := current_setting('app.actor_ua', true);

  -- Fallback: use the record's own updated_by/created_by if no app context
  IF v_actor_id IS NULL THEN
    v_actor_id := COALESCE((NEW).updated_by::UUID, (NEW).created_by::UUID, (OLD).created_by::UUID);
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'system';
  END IF;

  -- Values
  IF TG_OP = 'INSERT' THEN
    v_before := NULL;
    v_after := to_jsonb(NEW);
    v_changed := ARRAY(SELECT jsonb_object_keys(v_after));
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_changed := ARRAY(
      SELECT key FROM jsonb_each(v_after)
      WHERE v_after->key IS DISTINCT FROM v_before->key
    );
  ELSE -- DELETE
    v_before := to_jsonb(OLD);
    v_after := NULL;
    v_changed := ARRAY(SELECT jsonb_object_keys(v_before));
  END IF;

  -- Previous hash
  SELECT current_hash INTO v_prev_hash
  FROM public.settings_audit_log
  WHERE clinic_id = v_clinic
  ORDER BY sequence DESC
  LIMIT 1;

  v_canonical := TG_TABLE_NAME || '|' || TG_OP || '|' ||
                 COALESCE(v_before::text, '') || '|' ||
                 COALESCE(v_after::text, '') || '|' ||
                 COALESCE(v_prev_hash, '');
  v_hash := encode(digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.settings_audit_log (
    clinic_id, actor_id, actor_role, actor_ip, actor_ua,
    table_name, record_id, operation, changed_fields,
    before_value, after_value, diff,
    prev_hash, current_hash
  ) VALUES (
    v_clinic, v_actor_id, v_actor_role, v_actor_ip, v_actor_ua,
    TG_TABLE_NAME, v_record_id, TG_OP, v_changed,
    v_before, v_after, public.jsonb_diff(v_before, v_after),
    v_prev_hash, v_hash
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach the audit trigger to every catalog table
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'service_categories', 'services', 'rooms', 'room_tariffs',
    'diagnostic_categories', 'diagnostic_preparations', 'diagnostic_equipment', 'diagnostic_types',
    'lab_test_categories', 'lab_tests',
    'medication_categories', 'medications', 'suppliers',
    'expense_categories', 'payment_methods_catalog',
    'discount_rules', 'insurance_companies', 'referral_partners',
    'document_templates', 'sms_templates', 'email_templates',
    'working_hours', 'holidays', 'custom_roles',
    'tenant_vault_secrets'
  ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER tg_%I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.log_settings_audit();',
      tbl, tbl
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Hash-chain integrity verifier (runs every hour via pg_cron)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_audit_chain(p_clinic_id UUID DEFAULT NULL)
RETURNS TABLE (clinic_id UUID, ok BOOLEAN, broken_at BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  v_prev_hash TEXT;
  v_canonical TEXT;
  v_expected TEXT;
BEGIN
  FOR clinic_id IN
    SELECT DISTINCT clinic_id FROM public.settings_audit_log
    WHERE p_clinic_id IS NULL OR clinic_id = p_clinic_id
  LOOP
    v_prev_hash := NULL;
    ok := true;
    broken_at := NULL;
    FOR rec IN
      SELECT * FROM public.settings_audit_log
      WHERE settings_audit_log.clinic_id = clinic_id
      ORDER BY sequence ASC
    LOOP
      v_canonical := rec.table_name || '|' || rec.operation || '|' ||
                     COALESCE(rec.before_value::text, '') || '|' ||
                     COALESCE(rec.after_value::text, '') || '|' ||
                     COALESCE(v_prev_hash, '');
      v_expected := encode(digest(v_canonical, 'sha256'), 'hex');
      IF v_expected <> rec.current_hash THEN
        ok := false;
        broken_at := rec.sequence;
        EXIT;
      END IF;
      v_prev_hash := rec.current_hash;
    END LOOP;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Schedule hourly verification (uncomment in production once pg_cron is licensed)
-- SELECT cron.schedule('verify-audit-chain', '0 * * * *', $$SELECT public.verify_audit_chain();$$);
