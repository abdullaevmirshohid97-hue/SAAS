-- Atomic seed RPC for demo workspaces.
-- Creates clinic + profile-less seed data so a demo visitor can poke at
-- realistic-looking dashboards without an auth user being attached.

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
  v_service_id   UUID;
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

  -- 2. Attach owner to the demo clinic (clinic_admin)
  IF p_owner_user_id IS NOT NULL THEN
    PERFORM set_user_clinic(p_owner_user_id, v_clinic_id, 'clinic_admin');
  END IF;

  -- 3. Service categories
  FOREACH cat_name IN ARRAY cat_names LOOP
    INSERT INTO service_categories (clinic_id, name_i18n, sort_order)
    VALUES (v_clinic_id, jsonb_build_object('uz-Latn', cat_name), 0);
  END LOOP;

  -- 4. Services (loop over specs)
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

  -- 5. Patients (20 sample)
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

  -- 6. Queue tickets — 10 waiting / 3 serving today
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
