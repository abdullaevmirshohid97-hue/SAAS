-- ============================================================================
-- Clary v1.0 — Supabase manual apply
-- ============================================================================
-- Supabase Dashboard → SQL Editor → ushbu butun faylni paste qiling → Run.
-- Idempotent: bir necha marta ishga tushirilsa ham xato chiqarmaydi.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0) HELPER: trigger_set_updated_at() — alias to existing tg_set_updated_at
--    Sizning DB'da nom `tg_set_updated_at` — mos alias yaratamiz.
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 1) DEMO WORKSPACES — clinics jadvaliga ustunlar + audit jadval + cleanup
--    (manba: 20260504000001_demo_workspaces.sql)
-- ============================================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS clinics_demo_expires_at_idx
  ON clinics (demo_expires_at)
  WHERE is_demo = TRUE;

CREATE TABLE IF NOT EXISTS demo_spawn_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash     TEXT NOT NULL,
  fingerprint TEXT,
  user_agent  TEXT,
  clinic_id   UUID REFERENCES clinics(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demo_spawn_log_ip_created_idx
  ON demo_spawn_log (ip_hash, created_at DESC);

ALTER TABLE demo_spawn_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_spawn_log_no_select ON demo_spawn_log;
DROP POLICY IF EXISTS demo_spawn_log_no_write  ON demo_spawn_log;
CREATE POLICY demo_spawn_log_no_select ON demo_spawn_log FOR SELECT USING (FALSE);
CREATE POLICY demo_spawn_log_no_write  ON demo_spawn_log FOR INSERT WITH CHECK (FALSE);

CREATE OR REPLACE FUNCTION cleanup_expired_demos()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH expired AS (
    DELETE FROM clinics
    WHERE is_demo = TRUE
      AND demo_expires_at IS NOT NULL
      AND demo_expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM expired;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_demos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_expired_demos() TO service_role;

COMMENT ON FUNCTION cleanup_expired_demos IS
  'Drops clinics where is_demo=TRUE and demo_expires_at < NOW(). Run hourly via cron.';

-- ============================================================================
-- 2) DEMO SEED RPC — atomic clinic + 8 services + 20 patients + 13 queue
--    (manba: 20260504000002_demo_seed_rpc.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION spawn_demo_workspace(
  p_owner_user_id UUID,
  p_ttl_hours INT DEFAULT 24
)
RETURNS TABLE (clinic_id UUID, slug TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug         TEXT;
  v_clinic_id    UUID;
  v_expires_at   TIMESTAMPTZ;
  v_patient_id   UUID;
  v_category_id  UUID;
  i              INT;
  patient_names  TEXT[] := ARRAY[
    'Aziza Karimova', 'Bekzod Yusupov', 'Dilnoza Saidova', 'Elyor Rahimov',
    'Feruza Tursunova', 'Gulnoza Abdullayeva', 'Husan Mirzayev', 'Ikrom Khasanov',
    'Jasur Tukhtayev', 'Kamola Ibragimova', 'Lola Yusupova', 'Murod Karimov',
    'Nafisa Akbarova', 'Otabek Sodiqov', 'Parvina Nazarova', 'Qodir Olimov',
    'Rustam Nabiyev', 'Saodat Khalilova', 'Timur Aliyev', 'Umida Rashidova'
  ];
  service_specs JSONB := '[
    {"name":"Umumiy konsultatsiya","price":150000,"dur":20,"cat":"Konsultatsiya"},
    {"name":"Kardiolog ko''rik","price":250000,"dur":30,"cat":"Konsultatsiya"},
    {"name":"USG abdominal","price":200000,"dur":25,"cat":"Diagnostika"},
    {"name":"EKG","price":120000,"dur":15,"cat":"Diagnostika"},
    {"name":"Qon analizi (umumiy)","price":80000,"dur":10,"cat":"Laboratoriya"},
    {"name":"Stomatolog ko''rik","price":180000,"dur":40,"cat":"Stomatologiya"},
    {"name":"Glyukoza testi","price":40000,"dur":5,"cat":"Laboratoriya"},
    {"name":"Kichik jarrohlik","price":500000,"dur":60,"cat":"Jarrohlik"}
  ]'::jsonb;
  cat_names TEXT[] := ARRAY['Konsultatsiya','Diagnostika','Laboratoriya','Stomatologiya','Jarrohlik'];
  spec       JSONB;
  cat_name   TEXT;
BEGIN
  v_expires_at := NOW() + (p_ttl_hours || ' hours')::INTERVAL;
  v_slug       := 'demo-' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10);

  -- 1. Clinic
  INSERT INTO clinics (
    slug, name, country, region, city, timezone, default_locale,
    organization_type, primary_color, current_plan, subscription_status,
    trial_ends_at, is_demo, demo_expires_at
  )
  VALUES (
    v_slug, 'Demo Klinika', 'UZ', 'Toshkent shahri', 'Toshkent', 'Asia/Tashkent',
    'uz-Latn', 'clinic', '#2563EB', 'demo', 'trialing',
    v_expires_at, TRUE, v_expires_at
  )
  RETURNING id INTO v_clinic_id;

  -- 2. Attach owner
  IF p_owner_user_id IS NOT NULL THEN
    PERFORM set_user_clinic(p_owner_user_id, v_clinic_id, 'clinic_admin');
  END IF;

  -- 3. Service categories
  FOREACH cat_name IN ARRAY cat_names LOOP
    INSERT INTO service_categories (clinic_id, name_i18n, sort_order)
    VALUES (v_clinic_id, jsonb_build_object('uz-Latn', cat_name), 0);
  END LOOP;

  -- 4. Services
  FOR spec IN SELECT * FROM jsonb_array_elements(service_specs) LOOP
    SELECT id INTO v_category_id
    FROM service_categories
    WHERE clinic_id = v_clinic_id
      AND name_i18n->>'uz-Latn' = spec->>'cat'
    LIMIT 1;

    INSERT INTO services (
      clinic_id, category_id, name_i18n, price_uzs, duration_min,
      doctor_required, sort_order, created_by
    )
    VALUES (
      v_clinic_id,
      v_category_id,
      jsonb_build_object('uz-Latn', spec->>'name'),
      (spec->>'price')::BIGINT,
      (spec->>'dur')::INT,
      TRUE,
      0,
      COALESCE(p_owner_user_id, '00000000-0000-0000-0000-000000000000'::UUID)
    );
  END LOOP;

  -- 5. Patients
  FOR i IN 1..array_length(patient_names, 1) LOOP
    INSERT INTO patients (
      clinic_id, mrn, full_name, gender, dob, city, region
    )
    VALUES (
      v_clinic_id,
      'D-' || LPAD(i::TEXT, 4, '0'),
      patient_names[i],
      CASE WHEN i % 2 = 0 THEN 'female' ELSE 'male' END,
      (CURRENT_DATE - ((20 + (i * 137) % 50) || ' years')::INTERVAL)::DATE,
      'Toshkent',
      'Toshkent shahri'
    );
  END LOOP;

  -- 6. Queue tickets
  FOR i IN 1..13 LOOP
    SELECT id INTO v_patient_id FROM patients WHERE clinic_id = v_clinic_id ORDER BY random() LIMIT 1;
    INSERT INTO queues (
      clinic_id, patient_id, ticket_no, status, priority, joined_at
    )
    VALUES (
      v_clinic_id,
      v_patient_id,
      'A-' || LPAD(i::TEXT, 3, '0'),
      CASE WHEN i <= 10 THEN 'waiting'::queue_status ELSE 'serving'::queue_status END,
      CASE WHEN i = 1 THEN 1 ELSE 0 END,
      NOW() - ((i * 4) || ' minutes')::INTERVAL
    );
  END LOOP;

  RETURN QUERY SELECT v_clinic_id, v_slug, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION spawn_demo_workspace(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spawn_demo_workspace(UUID, INT) TO service_role;

COMMENT ON FUNCTION spawn_demo_workspace IS
  'Creates a demo clinic with seeded services, patients, and queue. Owner user is attached as clinic_admin if provided.';

-- ============================================================================
-- 3) LEADS — inbound lead capture (exit-intent, floating CTA, book-demo)
--    (manba: 20260504000003_leads.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  clinic_name  TEXT,
  message      TEXT,
  source       TEXT NOT NULL DEFAULT 'unknown',
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','contacted','qualified','demo_booked','won','lost','spam')),
  notes        TEXT,
  ip_hash      TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx     ON leads (status) WHERE status NOT IN ('won','lost','spam');
CREATE INDEX IF NOT EXISTS leads_source_idx     ON leads (source);

DROP TRIGGER IF EXISTS tg_leads_updated ON leads;
CREATE TRIGGER tg_leads_updated BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_no_select   ON leads;
DROP POLICY IF EXISTS leads_anon_insert ON leads;
DROP POLICY IF EXISTS leads_no_update   ON leads;
CREATE POLICY leads_no_select   ON leads FOR SELECT USING (FALSE);
CREATE POLICY leads_anon_insert ON leads FOR INSERT WITH CHECK (TRUE);
CREATE POLICY leads_no_update   ON leads FOR UPDATE USING (FALSE);

COMMENT ON TABLE leads IS 'Inbound leads from landing forms, exit-intent, /book-demo. Service role / API only for read & admin.';

-- ============================================================================
-- VERIFY (commit oldidan tekshirish — xato bo'lsa COMMIT bekor qilinadi)
-- ============================================================================

DO $$
BEGIN
  -- Demo columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clinics' AND column_name = 'is_demo'
  ) THEN
    RAISE EXCEPTION 'clinics.is_demo column not added';
  END IF;

  -- Tables
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'demo_spawn_log') THEN
    RAISE EXCEPTION 'demo_spawn_log table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'leads') THEN
    RAISE EXCEPTION 'leads table missing';
  END IF;

  -- Functions
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_expired_demos') THEN
    RAISE EXCEPTION 'cleanup_expired_demos function missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'spawn_demo_workspace') THEN
    RAISE EXCEPTION 'spawn_demo_workspace function missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_set_updated_at') THEN
    RAISE EXCEPTION 'tg_set_updated_at function missing';
  END IF;

  RAISE NOTICE '✅ Clary v1.0 migrations applied successfully';
END
$$;

COMMIT;
