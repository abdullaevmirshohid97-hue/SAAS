-- =============================================================================
-- Clary v2 — Migration 000130: Fix audit search_path (pgcrypto lives in
-- "extensions" schema on Supabase, so digest() is not visible from functions
-- that only SET search_path = public). We add 'extensions' to the path for
-- the two audit functions and use fully-qualified calls defensively.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_settings_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

  IF v_actor_id IS NULL THEN
    v_actor_id := COALESCE((NEW).updated_by::UUID, (NEW).created_by::UUID, (OLD).created_by::UUID);
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'system';
  END IF;

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
  ELSE
    v_before := to_jsonb(OLD);
    v_after := NULL;
    v_changed := ARRAY(SELECT jsonb_object_keys(v_before));
  END IF;

  SELECT current_hash INTO v_prev_hash
  FROM public.settings_audit_log
  WHERE clinic_id = v_clinic
  ORDER BY sequence DESC
  LIMIT 1;

  v_canonical := TG_TABLE_NAME || '|' || TG_OP || '|' ||
                 COALESCE(v_before::text, '') || '|' ||
                 COALESCE(v_after::text, '') || '|' ||
                 COALESCE(v_prev_hash, '');
  v_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');

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

CREATE OR REPLACE FUNCTION public.verify_audit_chain(p_clinic_id UUID DEFAULT NULL)
RETURNS TABLE (clinic_id UUID, ok BOOLEAN, broken_at BIGINT)
LANGUAGE plpgsql
SET search_path = public, extensions
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
      v_expected := encode(extensions.digest(v_canonical, 'sha256'), 'hex');
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
