-- =============================================================================
-- FILIAL TARMOG'I — funksional tekshiruv (deploy-branch-network.sh chaqiradi)
-- =============================================================================
-- Tranzaksiya oxirida ATAYLAB bekor qilinadi (ROLLBACK) — bazada test yozuvi
-- QOLMAYDI. Natija bitta qatorda: "TEST_RESULT OK | ..." yoki "TEST_RESULT FAIL[...]".
-- patient_ledger'ni qulflamaslik uchun bemor birlashtirish bu yerda sinalmaydi
-- (u lokal Postgres'da to'liq ssenariy bilan sinalgan).
-- =============================================================================
BEGIN;

DO $$
DECLARE
  v_missing  text;
  v_actor    uuid;
  v_hq       uuid;
  v_br       uuid;
  v_company  uuid;
  v_old      uuid;
  v_svc      uuid;
  v_res      jsonb;
  v_n        int;
  v_tag      text := 'zz-nettest-' || substr(md5(random()::text), 1, 8);
BEGIN
  -- 0) Obyektlar
  SELECT string_agg(w.t || '.' || w.c, ', ') INTO v_missing
    FROM (VALUES
      ('companies', 'max_branches'), ('companies', 'billing_mode'), ('companies', 'branch_fee_uzs'),
      ('companies', 'shared_patients'), ('clinics', 'branch_color'),
      ('company_audit_log', 'action'), ('services', 'master_id'), ('services', 'price_locked'),
      ('lab_tests', 'master_id'), ('diagnostic_types', 'master_id'),
      ('network_stock_transfers', 'status'), ('network_stock_transfer_items', 'quantity'),
      ('network_cash_transfers', 'amount_uzs'), ('service_referrals', 'source_clinic_id'),
      ('patients', 'merged_into_id')
    ) AS w(t, c)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = w.t AND column_name = w.c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[ustun yo''q] | %', v_missing;
  END IF;

  -- 1) Faza 0 invariantlari
  SELECT count(*) INTO v_n FROM clinics WHERE company_id IS NULL;
  IF v_n > 0 THEN RAISE EXCEPTION 'TEST_RESULT FAIL[F0] | % klinikada company_id yo''q', v_n; END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT company_id FROM clinics WHERE deleted_at IS NULL
     GROUP BY company_id HAVING count(*) FILTER (WHERE is_hq) <> 1) x;
  IF v_n > 0 THEN RAISE EXCEPTION 'TEST_RESULT FAIL[F0] | % kompaniyada HQ soni 1 emas', v_n; END IF;

  SELECT id INTO v_actor FROM profiles WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'TEST_RESULT FAIL[actor] | profil yo''q'; END IF;

  -- 2) Yangi klinika avtomatik kompaniya oladi
  INSERT INTO clinics (slug, name) VALUES (v_tag || '-hq', 'NETTEST HQ') RETURNING id INTO v_hq;
  SELECT company_id INTO v_company FROM clinics WHERE id = v_hq;
  IF v_company IS NULL OR NOT (SELECT is_hq FROM clinics WHERE id = v_hq) THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[F0 trigger] | kompaniya ochilmadi';
  END IF;
  INSERT INTO clinics (slug, name) VALUES (v_tag || '-br', 'NETTEST BR') RETURNING id INTO v_br;
  SELECT company_id INTO v_old FROM clinics WHERE id = v_br;

  -- 3) Limit va ulash
  BEGIN
    PERFORM admin_network_link_branch(v_company, v_br, v_actor);
    RAISE EXCEPTION 'TEST_RESULT FAIL[limit] | limit 1 da ulanib ketdi';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE companies SET max_branches = 3 WHERE id = v_company;
  v_res := admin_network_preview(v_company, v_br);
  IF jsonb_array_length(v_res -> 'blockers') <> 0 THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[preview] | %', v_res;
  END IF;
  PERFORM admin_network_link_branch(v_company, v_br, v_actor);
  IF (SELECT company_id FROM clinics WHERE id = v_br) <> v_company THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[link] | ulanmadi';
  END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE id = v_old) THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[link] | eski kompaniya qoldi';
  END IF;

  -- 4) Katalog tarqatish
  INSERT INTO services (clinic_id, name_i18n, price_uzs, created_by)
  VALUES (v_hq, '{"uz-Latn":"NETTEST xizmat"}', 50000, v_actor) RETURNING id INTO v_svc;
  v_res := network_push_catalog(v_hq, ARRAY[v_br], v_actor, ARRAY['services'], false);
  IF (v_res #>> ARRAY[v_br::text, 'services', 'inserted'])::int <> 1 THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[catalog] | %', v_res;
  END IF;

  -- 5) Pul: filial seyfi → HQ seyfi
  INSERT INTO safe_deposits (clinic_id, amount_uzs, reason, recorded_by)
  VALUES (v_br, 1000, 'NETTEST', v_actor);
  v_res := network_cash_send(v_br, v_hq, v_actor, 600, 'reception', 'test');
  PERFORM network_cash_receive((v_res ->> 'transfer_id')::uuid, v_actor);
  IF NOT EXISTS (SELECT 1 FROM safe_deposits WHERE clinic_id = v_hq AND amount_uzs = 600) THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[cash] | HQ seyfiga tushmadi';
  END IF;
  IF EXISTS (SELECT 1 FROM transactions WHERE id = (v_res ->> 'transaction_id')::uuid
                AND lower(COALESCE(notes, '')) LIKE '%inkasatsiya%') THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[cash] | izohda inkasatsiya so''zi';
  END IF;

  -- 6) Tarmoq markazi
  SELECT count(*) INTO v_n FROM network_live_snapshot(ARRAY[v_hq, v_br], CURRENT_DATE);
  IF v_n <> 2 THEN RAISE EXCEPTION 'TEST_RESULT FAIL[live] | % qator', v_n; END IF;
  SELECT count(*) INTO v_n FROM network_period_compare(ARRAY[v_hq, v_br], CURRENT_DATE - 30, CURRENT_DATE);
  IF v_n <> 2 THEN RAISE EXCEPTION 'TEST_RESULT FAIL[compare] | % qator', v_n; END IF;
  PERFORM * FROM network_duplicate_patients(ARRAY[v_hq, v_br], 10);

  -- 7) HQ almashtirish va ajratish
  PERFORM admin_network_set_hq(v_company, v_br, v_actor);
  IF NOT (SELECT is_hq FROM clinics WHERE id = v_br) THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[hq] | almashmadi';
  END IF;
  PERFORM admin_network_unlink_branch(v_hq, v_actor);
  IF (SELECT company_id FROM clinics WHERE id = v_hq) = v_company THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[unlink] | ajralmadi';
  END IF;

  RAISE NOTICE 'TEST_RESULT OK | trigger, limit, preview, ulash, katalog, pul, markaz, HQ, ajratish';
END $$;

ROLLBACK;
