-- =============================================================================
-- FILIAL TARMOG'I — Faza 3–5: tarmoq markazi, HQ'dan boshqaruv, filiallararo amallar
-- =============================================================================
--   Faza 3  network_live_snapshot / network_period_compare — bir ekranda 10 filial
--   Faza 4  network_push_catalog — xizmat, laboratoriya, diagnostika katalogini
--           HQ'dan filiallarga tarqatish (master_id bog'lanish, narx qulfi)
--   Faza 5  network_transfer_*   — dorixona zaxirasini filiallar orasida o'tkazish
--           network_cash_*       — filial seyfidan HQ seyfiga pul o'tkazish
--           service_referrals.source_clinic_id — boshqa filialga yo'llanma
--           network_duplicate_patients / network_merge_patients — dublikatlar
-- Pul va zaxira MAVJUD yo'llar orqali yuradi (seyfdan chiqim = transactions
-- source='safe', seyfga kirim = safe_deposits, dori kirimi = pharmacy_receive),
-- shuning uchun kassa/seyf/oylik hisobotlar o'zgarishsiz to'g'ri hisoblaydi.
-- Hammasi faqat service_role (API) orqali. Idempotent.
-- =============================================================================

-- ── Umumiy yordamchilar ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.network_name_key(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(regexp_replace(COALESCE(p ->> 'uz-Latn', p ->> 'uz', p ->> 'ru', p ->> 'en', ''),
                                    '\s+', ' ', 'g')));
$$;

-- Ikki filial bitta tarmoqdami — kompaniya id'si (aks holda xato)
CREATE OR REPLACE FUNCTION public.network_assert_same_company(p_a uuid, p_b uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a uuid; v_b uuid;
BEGIN
  IF p_a = p_b THEN
    RAISE EXCEPTION 'Jo''natuvchi va qabul qiluvchi filial bir xil';
  END IF;
  SELECT company_id INTO v_a FROM clinics WHERE id = p_a AND deleted_at IS NULL;
  SELECT company_id INTO v_b FROM clinics WHERE id = p_b AND deleted_at IS NULL;
  IF v_a IS NULL OR v_b IS NULL OR v_a <> v_b THEN
    RAISE EXCEPTION 'Filiallar bitta tarmoqda emas';
  END IF;
  RETURN v_a;
END $$;

-- =============================================================================
-- FAZA 3 — Tarmoq markazi
-- =============================================================================
CREATE OR REPLACE FUNCTION public.network_live_snapshot(p_clinics uuid[], p_day date)
RETURNS TABLE (
  clinic_id        uuid,
  name             text,
  is_hq            boolean,
  branch_code      text,
  branch_color     text,
  received_uzs     bigint,
  debt_uzs         bigint,
  pharmacy_uzs     bigint,
  queue_total      int,
  queue_waiting    int,
  queue_served     int,
  open_shifts      int,
  inpatients       int,
  new_patients     int,
  low_stock        int,
  expiring_30d     int,
  cash_uzs         bigint,
  safe_uzs         bigint,
  debtors_uzs      bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bounds AS (
    SELECT (p_day::timestamp AT TIME ZONE 'Asia/Tashkent') AS t0,
           ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Tashkent') AS t1
  )
  SELECT c.id, c.name, c.is_hq, c.branch_code, c.branch_color,
         COALESCE(rev.received, 0)::bigint,
         COALESCE(rev.debt, 0)::bigint,
         COALESCE(ph.paid, 0)::bigint,
         COALESCE(q.total, 0)::int,
         COALESCE(q.waiting, 0)::int,
         COALESCE(q.served, 0)::int,
         COALESCE(sh.n, 0)::int,
         COALESCE(ip.n, 0)::int,
         COALESCE(np.n, 0)::int,
         COALESCE(st.low, 0)::int,
         COALESCE(ex.n, 0)::int,
         COALESCE(fb.cash_uzs, 0)::bigint,
         COALESCE(fb.safe_uzs, 0)::bigint,
         COALESCE(dbt.total, 0)::bigint
    FROM clinics c
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
      SELECT SUM(l.amount_uzs) FILTER (WHERE l.method::text <> 'debt') AS received,
             SUM(l.amount_uzs) FILTER (WHERE l.method::text = 'debt' AND l.amount_uzs > 0) AS debt
        FROM transaction_payment_legs l
       WHERE l.clinic_id = c.id AND NOT l.is_void AND l.kind = 'payment'
         AND l.created_at >= b.t0 AND l.created_at < b.t1
    ) rev ON true
    LEFT JOIN LATERAL (
      SELECT SUM(s.paid_uzs) AS paid FROM pharmacy_sales s
       WHERE s.clinic_id = c.id AND NOT s.is_void AND s.created_at >= b.t0 AND s.created_at < b.t1
    ) ph ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,
             count(*) FILTER (WHERE qq.status::text IN ('waiting', 'called')) AS waiting,
             count(*) FILTER (WHERE qq.status::text = 'served') AS served
        FROM queues qq WHERE qq.clinic_id = c.id AND qq.queue_date = p_day
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM shifts s WHERE s.clinic_id = c.id AND s.closed_at IS NULL
    ) sh ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM inpatient_stays s
       WHERE s.clinic_id = c.id AND s.discharged_at IS NULL
         AND s.status NOT IN ('discharged', 'canceled', 'cancelled')
    ) ip ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM patients pt
       WHERE pt.clinic_id = c.id AND pt.deleted_at IS NULL
         AND pt.created_at >= b.t0 AND pt.created_at < b.t1
    ) np ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS low FROM medications m
       WHERE m.clinic_id = c.id AND NOT m.is_archived
         AND m.stock <= COALESCE(m.reorder_level, 0)
         AND EXISTS (SELECT 1 FROM medication_batches mb WHERE mb.medication_id = m.id)
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM medication_batches mb
       WHERE mb.clinic_id = c.id AND mb.qty_remaining > 0
         AND mb.expiry_date IS NOT NULL AND mb.expiry_date <= p_day + 30
    ) ex ON true
    LEFT JOIN LATERAL (
      SELECT f.cash_uzs, f.safe_uzs FROM finance_balances_asof(c.id, p_day, 'reception') f LIMIT 1
    ) fb ON true
    LEFT JOIN LATERAL (
      SELECT SUM(-bal) AS total FROM (
        SELECT SUM(pl.amount_uzs) AS bal FROM patient_ledger pl
         WHERE pl.clinic_id = c.id GROUP BY pl.patient_id
      ) x WHERE x.bal < 0
    ) dbt ON true
   WHERE c.id = ANY (p_clinics) AND c.deleted_at IS NULL
   ORDER BY c.is_hq DESC, c.name;
$$;

CREATE OR REPLACE FUNCTION public.network_period_compare(p_clinics uuid[], p_from date, p_to date)
RETURNS TABLE (
  clinic_id        uuid,
  name             text,
  is_hq            boolean,
  received_uzs     bigint,
  refunds_uzs      bigint,
  debt_uzs         bigint,
  pharmacy_uzs     bigint,
  expenses_uzs     bigint,
  payroll_uzs      bigint,
  visits           int,
  unique_patients  int,
  new_patients     int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bounds AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Tashkent') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tashkent') AS t1
  )
  SELECT c.id, c.name, c.is_hq,
         COALESCE(rev.received, 0)::bigint,
         COALESCE(rev.refunds, 0)::bigint,
         COALESCE(rev.debt, 0)::bigint,
         COALESCE(ph.paid, 0)::bigint,
         COALESCE(exp.total, 0)::bigint,
         COALESCE(pay.total, 0)::bigint,
         COALESCE(v.visits, 0)::int,
         COALESCE(v.uniq, 0)::int,
         COALESCE(np.n, 0)::int
    FROM clinics c
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
      SELECT SUM(l.amount_uzs) FILTER (WHERE l.method::text <> 'debt' AND l.amount_uzs > 0) AS received,
             SUM(-l.amount_uzs) FILTER (WHERE l.method::text <> 'debt' AND l.amount_uzs < 0) AS refunds,
             SUM(l.amount_uzs) FILTER (WHERE l.method::text = 'debt' AND l.amount_uzs > 0) AS debt
        FROM transaction_payment_legs l
       WHERE l.clinic_id = c.id AND NOT l.is_void AND l.kind = 'payment'
         AND l.created_at >= b.t0 AND l.created_at < b.t1
    ) rev ON true
    LEFT JOIN LATERAL (
      SELECT SUM(s.paid_uzs) AS paid FROM pharmacy_sales s
       WHERE s.clinic_id = c.id AND NOT s.is_void AND s.created_at >= b.t0 AND s.created_at < b.t1
    ) ph ON true
    LEFT JOIN LATERAL (
      SELECT SUM(e.amount_uzs) AS total FROM expenses e
       WHERE e.clinic_id = c.id AND NOT e.is_void AND e.expense_date BETWEEN p_from AND p_to
    ) exp ON true
    LEFT JOIN LATERAL (
      SELECT SUM(d.net_uzs) AS total FROM doctor_payouts d
       WHERE d.clinic_id = c.id AND d.status = 'paid'
         AND d.paid_at >= b.t0 AND d.paid_at < b.t1
    ) pay ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT (t.patient_id, (t.created_at AT TIME ZONE 'Asia/Tashkent')::date)) AS visits,
             count(DISTINCT t.patient_id) AS uniq
        FROM transactions t
       WHERE t.clinic_id = c.id AND NOT t.is_void AND t.kind = 'payment' AND t.amount_uzs > 0
         AND t.patient_id IS NOT NULL AND t.created_at >= b.t0 AND t.created_at < b.t1
    ) v ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM patients pt
       WHERE pt.clinic_id = c.id AND pt.deleted_at IS NULL
         AND pt.created_at >= b.t0 AND pt.created_at < b.t1
    ) np ON true
   WHERE c.id = ANY (p_clinics) AND c.deleted_at IS NULL
   ORDER BY c.is_hq DESC, c.name;
$$;

-- =============================================================================
-- FAZA 4 — HQ'dan markaziy katalog
-- =============================================================================
ALTER TABLE public.service_categories   ADD COLUMN IF NOT EXISTS master_id uuid;
ALTER TABLE public.services             ADD COLUMN IF NOT EXISTS master_id uuid;
ALTER TABLE public.services             ADD COLUMN IF NOT EXISTS price_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.lab_test_categories  ADD COLUMN IF NOT EXISTS master_id uuid;
ALTER TABLE public.lab_tests            ADD COLUMN IF NOT EXISTS master_id uuid;
ALTER TABLE public.lab_tests            ADD COLUMN IF NOT EXISTS price_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.diagnostic_categories ADD COLUMN IF NOT EXISTS master_id uuid;
ALTER TABLE public.diagnostic_types     ADD COLUMN IF NOT EXISTS master_id uuid;
ALTER TABLE public.diagnostic_types     ADD COLUMN IF NOT EXISTS price_locked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_service_categories_master ON public.service_categories (clinic_id, master_id) WHERE master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_master ON public.services (clinic_id, master_id) WHERE master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_test_categories_master ON public.lab_test_categories (clinic_id, master_id) WHERE master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_tests_master ON public.lab_tests (clinic_id, master_id) WHERE master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_diagnostic_categories_master ON public.diagnostic_categories (clinic_id, master_id) WHERE master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_diagnostic_types_master ON public.diagnostic_types (clinic_id, master_id) WHERE master_id IS NOT NULL;

-- Manba filial (odatda HQ) katalogini tanlangan filiallarga tarqatadi.
-- Moslash: avval master_id, keyin bir xil nom (bog'lanmagan qator) — topilsa
-- bog'lanadi va yangilanadi, topilmasa qo'shiladi. Narx: price_locked yoki
-- p_update_prices bo'lsa HQ narxi, aks holda filial o'z narxida qoladi.
-- Manbada arxivlangan (bog'langan) yozuv filialda ham arxivlanadi. Filialning
-- O'Z qo'shgan (HQ'da yo'q) yozuvlariga tegilmaydi.
CREATE OR REPLACE FUNCTION public.network_push_catalog(
  p_source        uuid,
  p_targets       uuid[],
  p_actor         uuid,
  p_kinds         text[],
  p_update_prices boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid;
  t         uuid;
  s         record;
  v_tgt     uuid;
  v_cat     uuid;
  cat_map   jsonb;
  ins int; upd int; arch int;
  v_target_stats jsonb;
  v_result  jsonb := '{}'::jsonb;
BEGIN
  SELECT company_id INTO v_company FROM clinics WHERE id = p_source AND deleted_at IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Manba filial topilmadi'; END IF;
  IF p_targets IS NULL OR cardinality(p_targets) = 0 THEN
    RAISE EXCEPTION 'Qabul qiluvchi filial tanlanmagan';
  END IF;
  IF p_kinds IS NULL OR cardinality(p_kinds) = 0 THEN
    p_kinds := ARRAY['services', 'lab', 'diagnostics'];
  END IF;

  FOREACH t IN ARRAY p_targets LOOP
    CONTINUE WHEN t = p_source;
    IF NOT EXISTS (SELECT 1 FROM clinics WHERE id = t AND company_id = v_company AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Filial shu tarmoqda emas: %', t;
    END IF;
    v_target_stats := '{}'::jsonb;

    -- ---------------- Xizmatlar ----------------
    IF 'services' = ANY (p_kinds) THEN
      ins := 0; upd := 0; arch := 0; cat_map := '{}'::jsonb;
      FOR s IN SELECT * FROM service_categories WHERE clinic_id = p_source ORDER BY sort_order, id LOOP
        SELECT id INTO v_tgt FROM service_categories WHERE clinic_id = t AND master_id = s.id LIMIT 1;
        IF v_tgt IS NULL THEN
          SELECT id INTO v_tgt FROM service_categories
           WHERE clinic_id = t AND master_id IS NULL
             AND network_name_key(name_i18n) = network_name_key(s.name_i18n) LIMIT 1;
        END IF;
        IF v_tgt IS NULL THEN
          CONTINUE WHEN s.is_archived;
          INSERT INTO service_categories (clinic_id, name_i18n, icon, color, sort_order, created_by, master_id)
          VALUES (t, s.name_i18n, s.icon, s.color, s.sort_order, p_actor, s.id)
          RETURNING id INTO v_tgt;
        ELSE
          UPDATE service_categories
             SET master_id = s.id, name_i18n = s.name_i18n, icon = s.icon, color = s.color,
                 sort_order = s.sort_order, is_archived = s.is_archived, updated_by = p_actor
           WHERE id = v_tgt;
        END IF;
        cat_map := cat_map || jsonb_build_object(s.id::text, v_tgt);
      END LOOP;

      FOR s IN SELECT * FROM services WHERE clinic_id = p_source ORDER BY sort_order, id LOOP
        SELECT id INTO v_tgt FROM services WHERE clinic_id = t AND master_id = s.id LIMIT 1;
        IF v_tgt IS NULL AND NOT s.is_archived THEN
          SELECT id INTO v_tgt FROM services
           WHERE clinic_id = t AND master_id IS NULL AND NOT is_archived
             AND network_name_key(name_i18n) = network_name_key(s.name_i18n) LIMIT 1;
        END IF;
        v_cat := NULLIF(cat_map ->> COALESCE(s.category_id::text, ''), '')::uuid;
        IF v_tgt IS NULL THEN
          CONTINUE WHEN s.is_archived;
          INSERT INTO services (clinic_id, category_id, name_i18n, description_i18n, price_uzs,
                                duration_min, doctor_required, room_type, is_insurance_covered, sku,
                                sort_order, qqs_percent, cost_uzs, price_locked, master_id, created_by)
          VALUES (t, v_cat, s.name_i18n, s.description_i18n, s.price_uzs,
                  s.duration_min, s.doctor_required, s.room_type, s.is_insurance_covered, s.sku,
                  s.sort_order, s.qqs_percent, s.cost_uzs, s.price_locked, s.id, p_actor);
          ins := ins + 1;
        ELSE
          UPDATE services
             SET master_id = s.id,
                 category_id = COALESCE(v_cat, category_id),
                 name_i18n = s.name_i18n,
                 description_i18n = s.description_i18n,
                 duration_min = s.duration_min,
                 doctor_required = s.doctor_required,
                 room_type = s.room_type,
                 is_insurance_covered = s.is_insurance_covered,
                 sku = s.sku,
                 sort_order = s.sort_order,
                 qqs_percent = s.qqs_percent,
                 cost_uzs = s.cost_uzs,
                 price_locked = s.price_locked,
                 price_uzs = CASE WHEN s.price_locked OR p_update_prices THEN s.price_uzs ELSE price_uzs END,
                 archived_at = CASE WHEN s.is_archived AND NOT is_archived THEN now()
                                    WHEN NOT s.is_archived THEN NULL ELSE archived_at END,
                 is_archived = s.is_archived,
                 updated_by = p_actor
           WHERE id = v_tgt;
          IF s.is_archived THEN arch := arch + 1; ELSE upd := upd + 1; END IF;
        END IF;
      END LOOP;
      v_target_stats := v_target_stats || jsonb_build_object('services',
        jsonb_build_object('inserted', ins, 'updated', upd, 'archived', arch));
    END IF;

    -- ---------------- Laboratoriya ----------------
    IF 'lab' = ANY (p_kinds) THEN
      ins := 0; upd := 0; arch := 0; cat_map := '{}'::jsonb;
      FOR s IN SELECT * FROM lab_test_categories WHERE clinic_id = p_source ORDER BY sort_order, id LOOP
        SELECT id INTO v_tgt FROM lab_test_categories WHERE clinic_id = t AND master_id = s.id LIMIT 1;
        IF v_tgt IS NULL THEN
          SELECT id INTO v_tgt FROM lab_test_categories
           WHERE clinic_id = t AND master_id IS NULL
             AND network_name_key(name_i18n) = network_name_key(s.name_i18n) LIMIT 1;
        END IF;
        IF v_tgt IS NULL THEN
          CONTINUE WHEN s.is_archived;
          INSERT INTO lab_test_categories (clinic_id, name_i18n, sort_order, created_by, master_id)
          VALUES (t, s.name_i18n, s.sort_order, p_actor, s.id)
          RETURNING id INTO v_tgt;
        ELSE
          UPDATE lab_test_categories
             SET master_id = s.id, name_i18n = s.name_i18n, sort_order = s.sort_order,
                 is_archived = s.is_archived, updated_by = p_actor
           WHERE id = v_tgt;
        END IF;
        cat_map := cat_map || jsonb_build_object(s.id::text, v_tgt);
      END LOOP;

      FOR s IN SELECT * FROM lab_tests WHERE clinic_id = p_source ORDER BY sort_order, id LOOP
        SELECT id INTO v_tgt FROM lab_tests WHERE clinic_id = t AND master_id = s.id LIMIT 1;
        IF v_tgt IS NULL AND NOT s.is_archived THEN
          SELECT id INTO v_tgt FROM lab_tests
           WHERE clinic_id = t AND master_id IS NULL AND NOT is_archived
             AND network_name_key(name_i18n) = network_name_key(s.name_i18n) LIMIT 1;
        END IF;
        v_cat := NULLIF(cat_map ->> COALESCE(s.category_id::text, ''), '')::uuid;
        IF v_tgt IS NULL THEN
          CONTINUE WHEN s.is_archived;
          INSERT INTO lab_tests (clinic_id, category_id, code, name_i18n, price_uzs, unit,
                                 reference_range_male, reference_range_female, reference_range_child,
                                 duration_hours, sample_type, sort_order, loinc_code, price_locked,
                                 master_id, created_by)
          VALUES (t, v_cat, s.code, s.name_i18n, s.price_uzs, s.unit,
                  s.reference_range_male, s.reference_range_female, s.reference_range_child,
                  s.duration_hours, s.sample_type, s.sort_order, s.loinc_code, s.price_locked,
                  s.id, p_actor);
          ins := ins + 1;
        ELSE
          UPDATE lab_tests
             SET master_id = s.id,
                 category_id = COALESCE(v_cat, category_id),
                 code = s.code,
                 name_i18n = s.name_i18n,
                 unit = s.unit,
                 reference_range_male = s.reference_range_male,
                 reference_range_female = s.reference_range_female,
                 reference_range_child = s.reference_range_child,
                 duration_hours = s.duration_hours,
                 sample_type = s.sample_type,
                 sort_order = s.sort_order,
                 loinc_code = s.loinc_code,
                 price_locked = s.price_locked,
                 price_uzs = CASE WHEN s.price_locked OR p_update_prices THEN s.price_uzs ELSE price_uzs END,
                 is_archived = s.is_archived,
                 updated_by = p_actor
           WHERE id = v_tgt;
          IF s.is_archived THEN arch := arch + 1; ELSE upd := upd + 1; END IF;
        END IF;
      END LOOP;
      v_target_stats := v_target_stats || jsonb_build_object('lab',
        jsonb_build_object('inserted', ins, 'updated', upd, 'archived', arch));
    END IF;

    -- ---------------- Diagnostika ----------------
    IF 'diagnostics' = ANY (p_kinds) THEN
      ins := 0; upd := 0; arch := 0; cat_map := '{}'::jsonb;
      FOR s IN SELECT * FROM diagnostic_categories WHERE clinic_id = p_source ORDER BY sort_order, id LOOP
        SELECT id INTO v_tgt FROM diagnostic_categories WHERE clinic_id = t AND master_id = s.id LIMIT 1;
        IF v_tgt IS NULL THEN
          SELECT id INTO v_tgt FROM diagnostic_categories
           WHERE clinic_id = t AND master_id IS NULL
             AND network_name_key(name_i18n) = network_name_key(s.name_i18n) LIMIT 1;
        END IF;
        IF v_tgt IS NULL THEN
          CONTINUE WHEN s.is_archived;
          INSERT INTO diagnostic_categories (clinic_id, name_i18n, icon, sort_order, created_by, master_id)
          VALUES (t, s.name_i18n, s.icon, s.sort_order, p_actor, s.id)
          RETURNING id INTO v_tgt;
        ELSE
          UPDATE diagnostic_categories
             SET master_id = s.id, name_i18n = s.name_i18n, icon = s.icon, sort_order = s.sort_order,
                 is_archived = s.is_archived, updated_by = p_actor
           WHERE id = v_tgt;
        END IF;
        cat_map := cat_map || jsonb_build_object(s.id::text, v_tgt);
      END LOOP;

      FOR s IN SELECT * FROM diagnostic_types WHERE clinic_id = p_source ORDER BY sort_order, id LOOP
        SELECT id INTO v_tgt FROM diagnostic_types WHERE clinic_id = t AND master_id = s.id LIMIT 1;
        IF v_tgt IS NULL AND NOT s.is_archived THEN
          SELECT id INTO v_tgt FROM diagnostic_types
           WHERE clinic_id = t AND master_id IS NULL AND NOT is_archived
             AND network_name_key(name_i18n) = network_name_key(s.name_i18n) LIMIT 1;
        END IF;
        v_cat := NULLIF(cat_map ->> COALESCE(s.category_id::text, ''), '')::uuid;
        IF v_tgt IS NULL THEN
          -- diagnostic_types.category_id majburiy — toifasi o'tmagan tur o'tkazib yuboriladi
          CONTINUE WHEN s.is_archived OR v_cat IS NULL;
          INSERT INTO diagnostic_types (clinic_id, category_id, code, name_i18n, description_i18n,
                                        price_uzs, duration_min, doctor_role_required, result_kind,
                                        sort_order, price_locked, master_id, created_by)
          VALUES (t, v_cat, s.code, s.name_i18n, s.description_i18n,
                  s.price_uzs, s.duration_min, s.doctor_role_required, s.result_kind,
                  s.sort_order, s.price_locked, s.id, p_actor);
          ins := ins + 1;
        ELSE
          UPDATE diagnostic_types
             SET master_id = s.id,
                 category_id = COALESCE(v_cat, category_id),
                 code = s.code,
                 name_i18n = s.name_i18n,
                 description_i18n = s.description_i18n,
                 duration_min = s.duration_min,
                 doctor_role_required = s.doctor_role_required,
                 result_kind = s.result_kind,
                 sort_order = s.sort_order,
                 price_locked = s.price_locked,
                 price_uzs = CASE WHEN s.price_locked OR p_update_prices THEN s.price_uzs ELSE price_uzs END,
                 is_archived = s.is_archived,
                 updated_by = p_actor
           WHERE id = v_tgt;
          IF s.is_archived THEN arch := arch + 1; ELSE upd := upd + 1; END IF;
        END IF;
      END LOOP;
      v_target_stats := v_target_stats || jsonb_build_object('diagnostics',
        jsonb_build_object('inserted', ins, 'updated', upd, 'archived', arch));
    END IF;

    v_result := v_result || jsonb_build_object(t::text, v_target_stats);
    INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
    VALUES (v_company, t, p_actor, 'catalog_push',
            jsonb_build_object('source', p_source, 'kinds', to_jsonb(p_kinds),
                               'update_prices', p_update_prices, 'stats', v_target_stats));
  END LOOP;

  RETURN v_result;
END $$;

-- =============================================================================
-- FAZA 5a — Dorixona zaxirasini filiallar orasida o'tkazish
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.network_stock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  from_clinic_id  uuid NOT NULL REFERENCES public.clinics(id),
  to_clinic_id    uuid NOT NULL REFERENCES public.clinics(id),
  status          text NOT NULL DEFAULT 'in_transit'
                  CHECK (status IN ('in_transit', 'received', 'canceled')),
  notes           text,
  total_cost_uzs  bigint NOT NULL DEFAULT 0,
  items_count     integer NOT NULL DEFAULT 0,
  sent_by         uuid,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  received_by     uuid,
  received_at     timestamptz,
  receipt_id      uuid,
  canceled_by     uuid,
  canceled_at     timestamptz,
  cancel_reason   text,
  CHECK (from_clinic_id <> to_clinic_id)
);
CREATE INDEX IF NOT EXISTS idx_nst_company ON public.network_stock_transfers (company_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_nst_from ON public.network_stock_transfers (from_clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_nst_to ON public.network_stock_transfers (to_clinic_id, status);

CREATE TABLE IF NOT EXISTS public.network_stock_transfer_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id           uuid NOT NULL REFERENCES public.network_stock_transfers(id) ON DELETE CASCADE,
  source_medication_id  uuid NOT NULL,
  source_batch_id       uuid,
  target_medication_id  uuid,
  name                  text NOT NULL,
  strength              text,
  form                  text,
  manufacturer          text,
  mxik_code             text,
  barcode               text,
  pack_qty              integer,
  batch_no              text,
  expiry_date           date,
  manufacture_date      date,
  quantity              integer NOT NULL CHECK (quantity > 0),
  unit_cost_uzs         bigint NOT NULL DEFAULT 0,
  unit_price_uzs        bigint
);
CREATE INDEX IF NOT EXISTS idx_nsti_transfer ON public.network_stock_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_nsti_source_med ON public.network_stock_transfer_items (source_medication_id);

ALTER TABLE public.network_stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_stock_transfer_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.network_stock_transfers FROM anon, authenticated;
REVOKE ALL ON public.network_stock_transfer_items FROM anon, authenticated;

-- Jo'natish: FEFO bo'yicha partiyalardan ayiriladi (muddati o'tgani olinmaydi),
-- har partiya alohida qator bo'lib "yo'lda" turadi.
CREATE OR REPLACE FUNCTION public.network_transfer_send(
  p_from uuid, p_to uuid, p_user uuid, p_items jsonb, p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid;
  v_id      uuid;
  it        jsonb;
  v_med     medications%ROWTYPE;
  v_qty     int;
  v_need    int;
  v_take    int;
  v_avail   int;
  b         record;
  v_total   bigint := 0;
  v_lines   int := 0;
BEGIN
  v_company := network_assert_same_company(p_from, p_to);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Transferda dori yo''q';
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'Bitta transferda 500 tadan ko''p qator bo''lmaydi';
  END IF;

  INSERT INTO network_stock_transfers (company_id, from_clinic_id, to_clinic_id, notes, sent_by)
  VALUES (v_company, p_from, p_to, NULLIF(btrim(COALESCE(p_notes, '')), ''), p_user)
  RETURNING id INTO v_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_med FROM medications
     WHERE id = NULLIF(it ->> 'medication_id', '')::uuid AND clinic_id = p_from
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dori topilmadi: %', COALESCE(it ->> 'medication_id', '—');
    END IF;
    v_qty := NULLIF(it ->> 'quantity', '')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Soni noto''g''ri (%)', v_med.name;
    END IF;
    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_avail FROM medication_batches
     WHERE medication_id = v_med.id AND clinic_id = p_from AND qty_remaining > 0
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE);
    IF v_avail < v_qty THEN
      RAISE EXCEPTION 'Yetarli qoldiq yo''q: % (bor: %, so''ralgan: %)', v_med.name, v_avail, v_qty;
    END IF;

    v_need := v_qty;
    FOR b IN
      SELECT * FROM medication_batches
       WHERE medication_id = v_med.id AND clinic_id = p_from AND qty_remaining > 0
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
       ORDER BY expiry_date NULLS LAST, received_at, id
       FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, b.qty_remaining);
      UPDATE medication_batches SET qty_remaining = qty_remaining - v_take WHERE id = b.id;
      INSERT INTO network_stock_transfer_items
        (transfer_id, source_medication_id, source_batch_id, name, strength, form, manufacturer,
         mxik_code, barcode, pack_qty, batch_no, expiry_date, manufacture_date, quantity,
         unit_cost_uzs, unit_price_uzs)
      VALUES
        (v_id, v_med.id, b.id, v_med.name, v_med.strength, v_med.form,
         COALESCE(b.manufacturer, v_med.manufacturer), v_med.mxik_code, v_med.barcode, v_med.pack_qty,
         b.batch_no, b.expiry_date, b.manufacture_date, v_take, b.unit_cost_uzs,
         COALESCE(b.unit_price_uzs, v_med.price_uzs));
      INSERT INTO pharmacy_stock_movements
        (clinic_id, medication_id, kind, quantity, unit_cost_uzs, batch_no, expiry_date, notes, performed_by)
      VALUES
        (p_from, v_med.id, 'transfer_out', -v_take, b.unit_cost_uzs, b.batch_no, b.expiry_date,
         'Filialga transfer', p_user);
      v_total := v_total + v_take::bigint * b.unit_cost_uzs;
      v_lines := v_lines + 1;
      v_need := v_need - v_take;
    END LOOP;

    UPDATE medications SET stock = GREATEST(0, stock - v_qty), updated_by = p_user WHERE id = v_med.id;
  END LOOP;

  UPDATE network_stock_transfers SET total_cost_uzs = v_total, items_count = v_lines WHERE id = v_id;
  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_company, p_from, p_user, 'stock_transfer_sent',
          jsonb_build_object('transfer_id', v_id, 'to', p_to, 'lines', v_lines, 'total_cost_uzs', v_total));

  RETURN jsonb_build_object('transfer_id', v_id, 'lines', v_lines, 'total_cost_uzs', v_total);
END $$;

-- Qabul qilish: har qatorga qabul qiluvchi filialda dori kartochkasi topiladi
-- (oldingi transfer → shtrix-kod → nom+doza+qadoq) yoki yaratiladi, keyin
-- ODDIY PRIXOD (pharmacy_receive, source='transfer') bilan kiritiladi —
-- partiya, harakat, qoldiq, narx tarixi bir xil yo'ldan yuradi.
CREATE OR REPLACE FUNCTION public.network_transfer_receive(p_transfer uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tr     network_stock_transfers%ROWTYPE;
  it       record;
  v_src    medications%ROWTYPE;
  v_med    uuid;
  v_price  bigint;
  v_items  jsonb := '[]'::jsonb;
  v_from   text;
  v_res    jsonb;
BEGIN
  SELECT * INTO v_tr FROM network_stock_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer topilmadi'; END IF;
  IF v_tr.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Transfer allaqachon yakunlangan (%)', v_tr.status;
  END IF;
  SELECT name INTO v_from FROM clinics WHERE id = v_tr.from_clinic_id;

  FOR it IN SELECT * FROM network_stock_transfer_items WHERE transfer_id = p_transfer ORDER BY name, id LOOP
    v_med := NULL;
    -- 1) Avvalgi transferlarda shu dori qaysi kartochkaga tushgan
    SELECT i.target_medication_id INTO v_med
      FROM network_stock_transfer_items i
      JOIN network_stock_transfers t ON t.id = i.transfer_id
      JOIN medications m ON m.id = i.target_medication_id
     WHERE t.to_clinic_id = v_tr.to_clinic_id
       AND i.source_medication_id = it.source_medication_id
       AND m.clinic_id = v_tr.to_clinic_id AND NOT m.is_archived
     ORDER BY t.received_at DESC NULLS LAST
     LIMIT 1;
    -- 2) Shtrix-kod
    IF v_med IS NULL AND COALESCE(it.barcode, '') <> '' THEN
      SELECT m.id INTO v_med FROM medications m
       WHERE m.clinic_id = v_tr.to_clinic_id AND NOT m.is_archived
         AND (m.barcode = it.barcode
              OR EXISTS (SELECT 1 FROM medication_barcodes mb
                          WHERE mb.medication_id = m.id AND mb.code = clary_barcode_norm(it.barcode)))
       ORDER BY m.created_at LIMIT 1;
    END IF;
    -- 3) Nom + doza + qadoq
    IF v_med IS NULL THEN
      SELECT m.id INTO v_med FROM medications m
       WHERE m.clinic_id = v_tr.to_clinic_id AND NOT m.is_archived
         AND clary_search_norm(m.name) = clary_search_norm(it.name)
         AND clary_search_norm(COALESCE(m.strength, '')) = clary_search_norm(COALESCE(it.strength, ''))
         AND COALESCE(m.pack_qty, 1) = COALESCE(it.pack_qty, 1)
       ORDER BY m.created_at LIMIT 1;
    END IF;
    -- 4) Yangi kartochka — manba dori nusxasi (filialga xos toifa/shtrix-kodsiz)
    IF v_med IS NULL THEN
      SELECT * INTO v_src FROM medications WHERE id = it.source_medication_id;
      INSERT INTO medications
        (clinic_id, name, manufacturer, strength, form, price_uzs, cost_uzs, stock, reorder_level,
         requires_prescription, created_by, image_url, pack_qty, blister_qty, unit_name,
         pack_price_uzs, blister_price_uzs, sell_by_unit, mxik_code, package_code, vat_percent,
         generic_name)
      VALUES
        (v_tr.to_clinic_id, it.name, COALESCE(it.manufacturer, v_src.manufacturer), it.strength, it.form,
         COALESCE(it.unit_price_uzs, v_src.price_uzs, 0), it.unit_cost_uzs, 0,
         COALESCE(v_src.reorder_level, 10), COALESCE(v_src.requires_prescription, false), p_user,
         v_src.image_url, COALESCE(it.pack_qty, 1), v_src.blister_qty, v_src.unit_name,
         v_src.pack_price_uzs, v_src.blister_price_uzs, COALESCE(v_src.sell_by_unit, false),
         COALESCE(it.mxik_code, v_src.mxik_code), v_src.package_code, v_src.vat_percent,
         v_src.generic_name)
      RETURNING id INTO v_med;
    END IF;

    UPDATE network_stock_transfer_items SET target_medication_id = v_med WHERE id = it.id;
    SELECT price_uzs INTO v_price FROM medications WHERE id = v_med;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'medication_id', v_med,
      'quantity', it.quantity,
      'unit_kind', 'unit',
      'entered_cost_uzs', it.unit_cost_uzs,
      -- Qabul qiluvchi filial o'z sotuv narxida qoladi (yangi kartochkada — manba narxi)
      'sale_price_uzs', CASE WHEN COALESCE(v_price, 0) > 0 THEN v_price ELSE COALESCE(it.unit_price_uzs, 0) END,
      'batch_no', it.batch_no,
      'expiry_date', it.expiry_date,
      'manufacture_date', it.manufacture_date,
      'manufacturer', it.manufacturer,
      'gtin', it.barcode,
      'mxik_code', it.mxik_code));
  END LOOP;

  v_res := pharmacy_receive(v_tr.to_clinic_id, p_user, jsonb_build_object(
    'items', v_items,
    'source', 'transfer',
    'idempotency_key', p_transfer,
    'receipt_no', 'TR-' || upper(left(p_transfer::text, 8)),
    'notes', 'Filialdan transfer: ' || COALESCE(v_from, '—')));

  UPDATE network_stock_transfers
     SET status = 'received', received_by = p_user, received_at = now(),
         receipt_id = NULLIF(v_res ->> 'receipt_id', '')::uuid
   WHERE id = p_transfer;

  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_tr.company_id, v_tr.to_clinic_id, p_user, 'stock_transfer_received',
          jsonb_build_object('transfer_id', p_transfer, 'receipt_id', v_res ->> 'receipt_id'));

  RETURN jsonb_build_object('ok', true, 'receipt_id', v_res ->> 'receipt_id');
END $$;

-- Bekor qilish (faqat yo'lda bo'lsa): dori o'sha partiyalarga qaytadi
CREATE OR REPLACE FUNCTION public.network_transfer_cancel(p_transfer uuid, p_user uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tr network_stock_transfers%ROWTYPE; it record;
BEGIN
  SELECT * INTO v_tr FROM network_stock_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer topilmadi'; END IF;
  IF v_tr.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Faqat yo''ldagi transferni bekor qilish mumkin (holati: %)', v_tr.status;
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Sabab majburiy'; END IF;

  FOR it IN SELECT * FROM network_stock_transfer_items WHERE transfer_id = p_transfer LOOP
    UPDATE medication_batches SET qty_remaining = qty_remaining + it.quantity
     WHERE id = it.source_batch_id AND clinic_id = v_tr.from_clinic_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Manba partiya topilmadi (%), bekor qilib bo''lmaydi', it.name;
    END IF;
    UPDATE medications SET stock = stock + it.quantity, updated_by = p_user
     WHERE id = it.source_medication_id;
    INSERT INTO pharmacy_stock_movements
      (clinic_id, medication_id, kind, quantity, unit_cost_uzs, batch_no, expiry_date, notes, performed_by)
    VALUES
      (v_tr.from_clinic_id, it.source_medication_id, 'transfer_cancel', it.quantity, it.unit_cost_uzs,
       it.batch_no, it.expiry_date, 'Transfer bekor qilindi', p_user);
  END LOOP;

  UPDATE network_stock_transfers
     SET status = 'canceled', canceled_by = p_user, canceled_at = now(), cancel_reason = btrim(p_reason)
   WHERE id = p_transfer;
  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_tr.company_id, v_tr.from_clinic_id, p_user, 'stock_transfer_canceled',
          jsonb_build_object('transfer_id', p_transfer, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('ok', true);
END $$;

-- =============================================================================
-- FAZA 5b — Filial seyfidan HQ seyfiga pul o'tkazish
-- =============================================================================
-- Jo'natish: manba filialda seyfdan chiqim (transactions: adjustment, -N, naqd,
-- source='safe'). Izohda "inkasatsiya" so'zi BO'LMAYDI — aks holda hisobotlar
-- uni kassadan seyfga kirim deb sanardi. Qabul: HQ'da safe_deposits kirimi.
-- Bekor qilish: chiqim tranzaksiyasi void → pul manba seyfiga qaytadi.
CREATE TABLE IF NOT EXISTS public.network_cash_transfers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES public.companies(id),
  from_clinic_id         uuid NOT NULL REFERENCES public.clinics(id),
  to_clinic_id           uuid NOT NULL REFERENCES public.clinics(id),
  amount_uzs             bigint NOT NULL CHECK (amount_uzs > 0),
  register               text NOT NULL DEFAULT 'reception' CHECK (register IN ('reception', 'inpatient')),
  status                 text NOT NULL DEFAULT 'in_transit'
                         CHECK (status IN ('in_transit', 'received', 'canceled')),
  notes                  text,
  source_transaction_id  uuid REFERENCES public.transactions(id),
  target_deposit_id      uuid REFERENCES public.safe_deposits(id),
  sent_by                uuid,
  sent_at                timestamptz NOT NULL DEFAULT now(),
  received_by            uuid,
  received_at            timestamptz,
  canceled_by            uuid,
  canceled_at            timestamptz,
  cancel_reason          text,
  CHECK (from_clinic_id <> to_clinic_id)
);
CREATE INDEX IF NOT EXISTS idx_nct_company ON public.network_cash_transfers (company_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_nct_from ON public.network_cash_transfers (from_clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_nct_to ON public.network_cash_transfers (to_clinic_id, status);
ALTER TABLE public.network_cash_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.network_cash_transfers FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.network_cash_send(
  p_from uuid, p_to uuid, p_user uuid, p_amount bigint,
  p_register text DEFAULT 'reception', p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid;
  v_to_name text;
  v_shift   uuid;
  v_tx      uuid;
  v_id      uuid;
  v_notes   text;
BEGIN
  v_company := network_assert_same_company(p_from, p_to);
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Summa noto''g''ri'; END IF;
  IF COALESCE(p_register, 'reception') NOT IN ('reception', 'inpatient') THEN
    RAISE EXCEPTION 'Kassa turi noto''g''ri';
  END IF;
  SELECT name INTO v_to_name FROM clinics WHERE id = p_to;
  -- "inkasatsiya" so'zi hisobotlarda kassa→seyf kirimi belgisi — izohdan olinadi
  v_notes := NULLIF(btrim(regexp_replace(COALESCE(p_notes, ''), 'inkasatsiya', 'inkas.', 'gi')), '');

  SELECT id INTO v_shift FROM shifts
   WHERE clinic_id = p_from AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1;

  INSERT INTO transactions (clinic_id, cashier_id, shift_id, register, kind, amount_uzs,
                            payment_method, source, notes)
  VALUES (p_from, p_user, v_shift, COALESCE(p_register, 'reception'), 'adjustment', -p_amount,
          'cash', 'safe',
          'Tarmoq: ' || COALESCE(v_to_name, 'HQ') || ' ga pul o''tkazmasi' || COALESCE(' — ' || v_notes, ''))
  RETURNING id INTO v_tx;

  INSERT INTO network_cash_transfers (company_id, from_clinic_id, to_clinic_id, amount_uzs, register,
                                      notes, source_transaction_id, sent_by)
  VALUES (v_company, p_from, p_to, p_amount, COALESCE(p_register, 'reception'), v_notes, v_tx, p_user)
  RETURNING id INTO v_id;

  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_company, p_from, p_user, 'cash_transfer_sent',
          jsonb_build_object('transfer_id', v_id, 'to', p_to, 'amount_uzs', p_amount));
  RETURN jsonb_build_object('transfer_id', v_id, 'transaction_id', v_tx);
END $$;

CREATE OR REPLACE FUNCTION public.network_cash_receive(p_transfer uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tr network_cash_transfers%ROWTYPE; v_from text; v_dep uuid;
BEGIN
  SELECT * INTO v_tr FROM network_cash_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'O''tkazma topilmadi'; END IF;
  IF v_tr.status <> 'in_transit' THEN
    RAISE EXCEPTION 'O''tkazma allaqachon yakunlangan (%)', v_tr.status;
  END IF;
  SELECT name INTO v_from FROM clinics WHERE id = v_tr.from_clinic_id;
  INSERT INTO safe_deposits (clinic_id, amount_uzs, reason, register, recorded_by)
  VALUES (v_tr.to_clinic_id, v_tr.amount_uzs, 'Filialdan pul: ' || COALESCE(v_from, '—'),
          v_tr.register, p_user)
  RETURNING id INTO v_dep;
  UPDATE network_cash_transfers
     SET status = 'received', received_by = p_user, received_at = now(), target_deposit_id = v_dep
   WHERE id = p_transfer;
  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_tr.company_id, v_tr.to_clinic_id, p_user, 'cash_transfer_received',
          jsonb_build_object('transfer_id', p_transfer, 'amount_uzs', v_tr.amount_uzs));
  RETURN jsonb_build_object('ok', true, 'deposit_id', v_dep);
END $$;

CREATE OR REPLACE FUNCTION public.network_cash_cancel(p_transfer uuid, p_user uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tr network_cash_transfers%ROWTYPE;
BEGIN
  SELECT * INTO v_tr FROM network_cash_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'O''tkazma topilmadi'; END IF;
  IF v_tr.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Faqat yo''ldagi o''tkazmani bekor qilish mumkin (holati: %)', v_tr.status;
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Sabab majburiy'; END IF;
  UPDATE transactions SET is_void = true, voided_at = now(), voided_by = p_user
   WHERE id = v_tr.source_transaction_id;
  UPDATE network_cash_transfers
     SET status = 'canceled', canceled_by = p_user, canceled_at = now(), cancel_reason = btrim(p_reason)
   WHERE id = p_transfer;
  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_tr.company_id, v_tr.from_clinic_id, p_user, 'cash_transfer_canceled',
          jsonb_build_object('transfer_id', p_transfer, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('ok', true);
END $$;

-- =============================================================================
-- FAZA 5c — Boshqa filialga yo'llanma
-- =============================================================================
-- Yo'llanma QABUL QILUVCHI filialda yaratiladi (clinic_id = o'sha filial) —
-- uning qabulxona "yo'llanmalar" ro'yxatiga odatdagidek tushadi.
ALTER TABLE public.service_referrals
  ADD COLUMN IF NOT EXISTS source_clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_service_referrals_source_clinic
  ON public.service_referrals (source_clinic_id) WHERE source_clinic_id IS NOT NULL;

-- =============================================================================
-- FAZA 5d — Bemor dublikatlari va birlashtirish
-- =============================================================================
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.patients(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.network_duplicate_patients(p_clinics uuid[], p_limit int DEFAULT 100)
RETURNS TABLE (dup_key text, items jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (
    SELECT pt.id, pt.clinic_id, pt.full_name, pt.phone, pt.dob, pt.created_at, pt.pinfl,
           network_patient_dup_key(pt.phone, pt.full_name) AS k
      FROM patients pt
     WHERE pt.clinic_id = ANY (p_clinics) AND pt.deleted_at IS NULL
  ),
  g AS (
    SELECT k AS gk FROM p WHERE k IS NOT NULL GROUP BY k HAVING count(*) > 1
    UNION
    SELECT 'pinfl:' || pinfl FROM p WHERE pinfl IS NOT NULL GROUP BY pinfl HAVING count(*) > 1
  )
  SELECT g.gk,
         jsonb_agg(jsonb_build_object(
           'id', p.id, 'clinic_id', p.clinic_id, 'clinic_name', c.name,
           'full_name', p.full_name, 'phone', p.phone, 'dob', p.dob, 'created_at', p.created_at,
           'visits', (SELECT count(*) FROM transactions t
                       WHERE t.patient_id = p.id AND NOT t.is_void AND t.kind = 'payment'))
           ORDER BY p.created_at)
    FROM g
    JOIN p ON p.k = g.gk OR ('pinfl:' || p.pinfl) = g.gk
    JOIN clinics c ON c.id = p.clinic_id
   GROUP BY g.gk
   ORDER BY g.gk
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$$;

-- p_drop bemorning BARCHA yozuvlari p_keep'ga o'tadi (patients'ga FK bo'lgan
-- har jadval avtomatik topiladi), bo'sh maydonlar to'ldiriladi, p_drop
-- arxivlanadi (merged_into_id). Biror jadvalda ikkalasida ham noyob yozuv
-- bo'lsa — HAMMASI bekor (bitta tranzaksiya) va aniq xabar qaytadi.
CREATE OR REPLACE FUNCTION public.network_merge_patients(p_keep uuid, p_drop uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k       patients%ROWTYPE;
  d       patients%ROWTYPE;
  r       record;
  v_n     int;
  v_moved jsonb := '{}'::jsonb;
  v_pinfl text;
BEGIN
  IF p_keep = p_drop THEN RAISE EXCEPTION 'Bir xil bemor'; END IF;
  SELECT * INTO k FROM patients WHERE id = p_keep AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asosiy bemor topilmadi'; END IF;
  SELECT * INTO d FROM patients WHERE id = p_drop AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Birlashtiriladigan bemor topilmadi'; END IF;
  IF k.clinic_id <> d.clinic_id AND (k.company_id IS NULL OR k.company_id IS DISTINCT FROM d.company_id) THEN
    RAISE EXCEPTION 'Bemorlar bitta tarmoqda emas';
  END IF;

  -- patient_ledger APPEND-ONLY (UPDATE qoidasi) — faqat shu tranzaksiya ichida
  ALTER TABLE patient_ledger DISABLE RULE no_update_patient_ledger;

  FOR r IN
    SELECT k2.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint k2
      JOIN pg_attribute a ON a.attrelid = k2.conrelid AND a.attnum = k2.conkey[1]
     WHERE k2.contype = 'f'
       AND k2.confrelid = 'public.patients'::regclass
       AND array_length(k2.conkey, 1) = 1
       AND k2.conrelid <> 'public.patients'::regclass
  LOOP
    BEGIN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', r.tbl, r.col, r.col) USING p_keep, p_drop;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Birlashtirib bo''lmadi: "%" bo''limida ikkala bemorda ham yozuv bor', r.tbl;
    END;
    IF v_n > 0 THEN
      v_moved := v_moved || jsonb_build_object(r.tbl::text, v_n);
    END IF;
  END LOOP;

  ALTER TABLE patient_ledger ENABLE RULE no_update_patient_ledger;

  -- PINFL noyob (klinika ichida): avval dublikatdan olinadi
  v_pinfl := CASE WHEN k.pinfl IS NULL THEN d.pinfl ELSE NULL END;
  UPDATE patients
     SET deleted_at = now(), merged_into_id = p_keep, pinfl = NULL,
         notes = btrim(COALESCE(notes, '') || E'\n[Birlashtirildi → ' || p_keep::text || ']')
   WHERE id = p_drop;

  UPDATE patients SET
    phone           = COALESCE(NULLIF(phone, ''), d.phone),
    secondary_phone = COALESCE(NULLIF(secondary_phone, ''),
                               CASE WHEN d.phone IS DISTINCT FROM phone THEN d.phone END,
                               d.secondary_phone),
    dob             = COALESCE(dob, d.dob),
    gender          = COALESCE(gender, d.gender),
    email           = COALESCE(NULLIF(email, ''), d.email),
    id_number       = COALESCE(NULLIF(id_number, ''), d.id_number),
    id_type         = COALESCE(id_type, d.id_type),
    address         = COALESCE(NULLIF(address, ''), d.address),
    city            = COALESCE(NULLIF(city, ''), d.city),
    region          = COALESCE(NULLIF(region, ''), d.region),
    blood_type      = COALESCE(blood_type, d.blood_type),
    pinfl           = COALESCE(pinfl, v_pinfl),
    first_name      = COALESCE(NULLIF(first_name, ''), d.first_name),
    last_name       = COALESCE(NULLIF(last_name, ''), d.last_name),
    patronymic      = COALESCE(NULLIF(patronymic, ''), d.patronymic),
    medical_notes   = CASE WHEN COALESCE(d.medical_notes, '') = '' THEN medical_notes
                           WHEN COALESCE(medical_notes, '') = '' THEN d.medical_notes
                           ELSE medical_notes || E'\n' || d.medical_notes END,
    allergies       = CASE WHEN COALESCE(jsonb_array_length(NULLIF(allergies, 'null'::jsonb)), 0) = 0
                           THEN d.allergies ELSE allergies END,
    chronic_conditions = CASE WHEN COALESCE(jsonb_array_length(NULLIF(chronic_conditions, 'null'::jsonb)), 0) = 0
                           THEN d.chronic_conditions ELSE chronic_conditions END,
    loyalty_points  = loyalty_points + COALESCE(d.loyalty_points, 0)
   WHERE id = p_keep;

  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (k.company_id, k.clinic_id, p_actor, 'patient_merge',
          jsonb_build_object('keep', p_keep, 'drop', p_drop, 'drop_clinic', d.clinic_id,
                             'moved', v_moved));
  RETURN jsonb_build_object('ok', true, 'moved', v_moved);
END $$;

-- ── Ruxsatlar: faqat API ──────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'network_assert_same_company(uuid, uuid)',
    'network_live_snapshot(uuid[], date)',
    'network_period_compare(uuid[], date, date)',
    'network_push_catalog(uuid, uuid[], uuid, text[], boolean)',
    'network_transfer_send(uuid, uuid, uuid, jsonb, text)',
    'network_transfer_receive(uuid, uuid)',
    'network_transfer_cancel(uuid, uuid, text)',
    'network_cash_send(uuid, uuid, uuid, bigint, text, text)',
    'network_cash_receive(uuid, uuid)',
    'network_cash_cancel(uuid, uuid, text)',
    'network_duplicate_patients(uuid[], int)',
    'network_merge_patients(uuid, uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
