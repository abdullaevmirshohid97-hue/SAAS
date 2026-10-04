-- =============================================================================
-- DORIXONA 2.0 — Prihod 2.0 (Faza 4 / 5 / 9)
-- =============================================================================
--   A) pharmacy_receipts / items     — manba, idempotency, faktura sanasi, birliklar
--   B) pharmacy_receipt_drafts       — server qoralamasi (boshqa kompyuterda davom)
--   C) supplier_item_aliases         — "firmadagi nom → bizdagi dori" xotirasi
--   D) pharmacy_import_profiles      — Excel ustun moslashuvi (firma bo'yicha)
--   E) pharmacy_receive(...)         — ATOMAR kirim: bitta tranzaksiya, ikki marta
--                                      kirim bo'lmaydi, narx tarixi, shtrix-kod va
--                                      alias o'rganish, firma daftari, kassa harakati
--   F) pharmacy_match_import(...)    — Excel qatorlarini katalog bilan moslash (1 so'rov)
--   G) pharmacy_void_receipt         — endi NARXNI HAM tiklaydi (narx tarixidan)
--   H) gl_post_supplier_ledger       — manfiy yozuvlar (bekor qilish) teskari provodka
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Ustunlar
-- ---------------------------------------------------------------------------
ALTER TABLE public.pharmacy_receipts
  ADD COLUMN IF NOT EXISTS source             text,
  ADD COLUMN IF NOT EXISTS idempotency_key    uuid,
  ADD COLUMN IF NOT EXISTS invoice_date       date,
  ADD COLUMN IF NOT EXISTS file_name          text,
  ADD COLUMN IF NOT EXISTS file_hash          text,
  ADD COLUMN IF NOT EXISTS operator_id        uuid,
  ADD COLUMN IF NOT EXISTS expected_total_uzs bigint,
  ADD COLUMN IF NOT EXISTS pharmacy_shift_id  uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_receipts_idem
  ON public.pharmacy_receipts (clinic_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_receipts_supplier_no
  ON public.pharmacy_receipts (clinic_id, supplier_id, receipt_no) WHERE NOT is_void;
CREATE INDEX IF NOT EXISTS idx_pharmacy_receipts_file_hash
  ON public.pharmacy_receipts (clinic_id, file_hash) WHERE file_hash IS NOT NULL AND NOT is_void;

ALTER TABLE public.pharmacy_receipt_items
  ADD COLUMN IF NOT EXISTS unit_kind        text,
  ADD COLUMN IF NOT EXISTS entered_qty      numeric(14,3),
  ADD COLUMN IF NOT EXISTS entered_cost_uzs bigint,
  ADD COLUMN IF NOT EXISTS pack_qty         integer,
  ADD COLUMN IF NOT EXISTS sale_price_uzs   bigint,
  ADD COLUMN IF NOT EXISTS old_price_uzs    bigint,
  ADD COLUMN IF NOT EXISTS manufacturer     text,
  ADD COLUMN IF NOT EXISTS gtin             text,
  ADD COLUMN IF NOT EXISTS source_name      text;

-- ---------------------------------------------------------------------------
-- B) Qoralamalar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_receipt_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  title       text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines_count integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id),
  operator_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_receipt_drafts_clinic
  ON public.pharmacy_receipt_drafts (clinic_id, updated_at DESC);

ALTER TABLE public.pharmacy_receipt_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_receipt_drafts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) Alias xotirasi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_item_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  supplier_id   uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  alias_norm    text NOT NULL,
  alias_raw     text,
  medication_id uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  times_used    integer NOT NULL DEFAULT 1,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_item_aliases
  ON public.supplier_item_aliases (
    clinic_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), alias_norm);
CREATE INDEX IF NOT EXISTS idx_supplier_item_aliases_lookup
  ON public.supplier_item_aliases (clinic_id, alias_norm);

ALTER TABLE public.supplier_item_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_item_aliases FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- D) Excel ustun moslashuvi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_import_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  mapping     jsonb NOT NULL,
  updated_by  uuid REFERENCES public.profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_import_profiles
  ON public.pharmacy_import_profiles (
    clinic_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.pharmacy_import_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_import_profiles FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- E) Atomar kirim
-- ---------------------------------------------------------------------------
-- p_payload:
--  { idempotency_key?, supplier_id?, receipt_no?, invoice_date?, received_at?,
--    paid_uzs?, payment_method?, notes?, source?('manual'|'excel'|'scan'|'po'|'opening'),
--    file_name?, file_hash?, operator_id?, pharmacy_shift_id?, expected_total_uzs?,
--    items: [{ medication_id, unit_kind?('unit'|'pack'), entered_qty | quantity,
--              entered_cost_uzs | unit_cost_uzs, sale_price_uzs?(1 dona), pack_price_uzs?,
--              profit_percent?, keep_higher_price?, doctor_share_percent?,
--              doctor_share_bonus_uzs?, manufacturer?, manufacture_date?, batch_no?,
--              expiry_date?, gtin?, mxik_code?, source_name? }] }
-- Qaytaradi: { receipt_id, duplicate, total_cost_uzs, items }
CREATE OR REPLACE FUNCTION public.pharmacy_receive(p_clinic uuid, p_user uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key      uuid := NULLIF(p_payload->>'idempotency_key', '')::uuid;
  v_supplier uuid := NULLIF(p_payload->>'supplier_id', '')::uuid;
  v_source   text := COALESCE(NULLIF(p_payload->>'source', ''), 'manual');
  v_received timestamptz := COALESCE(NULLIF(p_payload->>'received_at', '')::timestamptz, now());
  v_paid     bigint := GREATEST(0, COALESCE(NULLIF(p_payload->>'paid_uzs', '')::bigint, 0));
  v_method   text := NULLIF(p_payload->>'payment_method', '');
  v_operator uuid := NULLIF(p_payload->>'operator_id', '')::uuid;
  v_shift    uuid := NULLIF(p_payload->>'pharmacy_shift_id', '')::uuid;
  v_existing uuid;
  v_receipt  uuid;
  v_item     jsonb;
  v_med      RECORD;
  v_kind     text;
  v_factor   integer;
  v_entered  numeric;
  v_cost_in  numeric;
  v_qty      integer;
  v_unit_cost bigint;
  v_line_total bigint;
  v_total    bigint := 0;
  v_profit   numeric;
  v_sale     bigint;
  v_pack     bigint;
  v_keep     boolean;
  v_kept     boolean;
  v_new_price bigint;
  v_expiry   date;
  v_batch    uuid;
  v_count    integer := 0;
  v_status   text;
  v_occurred date;
  v_gtin     text;
  v_alias    text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'Prixodda dori yo''q';
  END IF;
  IF jsonb_array_length(p_payload->'items') > 2000 THEN
    RAISE EXCEPTION 'Bitta prixodda 2000 tadan ko''p qator bo''lmaydi';
  END IF;

  -- Ikki marta bosish / tarmoq takrori → o'sha prixod qaytadi
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM pharmacy_receipts
     WHERE clinic_id = p_clinic AND idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('receipt_id', v_existing, 'duplicate', true);
    END IF;
  END IF;

  IF v_supplier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suppliers WHERE id = v_supplier AND clinic_id = p_clinic
  ) THEN
    RAISE EXCEPTION 'Firma topilmadi';
  END IF;

  -- 1-o'tish: tekshiruv va jami summa (fakturadagi kabi: soni × kiritilgan narx)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    SELECT id, pack_qty, is_archived INTO v_med FROM medications
     WHERE id = NULLIF(v_item->>'medication_id', '')::uuid AND clinic_id = p_clinic;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dori topilmadi: %', COALESCE(v_item->>'medication_id', '—');
    END IF;
    IF v_med.is_archived THEN
      RAISE EXCEPTION 'Dori arxivlangan — avval arxivdan chiqaring (%)',
        COALESCE(v_item->>'source_name', v_item->>'medication_id');
    END IF;
    v_kind := COALESCE(NULLIF(v_item->>'unit_kind', ''), 'unit');
    v_factor := CASE WHEN v_kind = 'pack' THEN GREATEST(COALESCE(v_med.pack_qty, 1), 1) ELSE 1 END;
    v_entered := COALESCE(NULLIF(v_item->>'entered_qty', '')::numeric, NULLIF(v_item->>'quantity', '')::numeric);
    IF v_entered IS NULL OR v_entered <= 0 THEN
      RAISE EXCEPTION 'Soni noto''g''ri (%)', COALESCE(v_item->>'source_name', v_item->>'medication_id');
    END IF;
    IF (v_entered * v_factor) <> floor(v_entered * v_factor) THEN
      RAISE EXCEPTION 'Soni butun dona bo''lishi kerak (%)', COALESCE(v_item->>'source_name', v_item->>'medication_id');
    END IF;
    v_cost_in := COALESCE(NULLIF(v_item->>'entered_cost_uzs', '')::numeric,
                          NULLIF(v_item->>'unit_cost_uzs', '')::numeric, 0);
    IF v_cost_in < 0 THEN
      RAISE EXCEPTION 'Tannarx manfiy bo''lishi mumkin emas';
    END IF;
    v_expiry := NULLIF(v_item->>'expiry_date', '')::date;
    IF v_expiry IS NOT NULL AND v_expiry < CURRENT_DATE AND v_source <> 'opening' THEN
      RAISE EXCEPTION 'Muddati o''tgan dori qabul qilinmaydi (%: %)',
        COALESCE(v_item->>'source_name', v_item->>'medication_id'), v_expiry;
    END IF;
    v_total := v_total + ROUND(v_entered * v_cost_in);
  END LOOP;

  v_paid := LEAST(v_paid, v_total);
  v_status := CASE WHEN v_paid >= v_total THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'pending' END;

  INSERT INTO pharmacy_receipts
    (clinic_id, supplier_id, receipt_no, received_at, total_cost_uzs, paid_uzs, payment_status,
     notes, created_by, source, idempotency_key, invoice_date, file_name, file_hash,
     operator_id, expected_total_uzs, pharmacy_shift_id)
  VALUES
    (p_clinic, v_supplier, NULLIF(p_payload->>'receipt_no', ''), v_received, v_total, v_paid, v_status,
     NULLIF(p_payload->>'notes', ''), p_user, v_source, v_key,
     NULLIF(p_payload->>'invoice_date', '')::date, NULLIF(p_payload->>'file_name', ''),
     NULLIF(p_payload->>'file_hash', ''), v_operator,
     NULLIF(p_payload->>'expected_total_uzs', '')::bigint, v_shift)
  RETURNING id INTO v_receipt;

  -- Narx tarixi triggeri manbani shu yerdan oladi
  PERFORM set_config('clary.price_source', 'receipt', true);
  PERFORM set_config('clary.receipt_id', v_receipt::text, true);

  -- 2-o'tish: partiya, qator, harakat, qoldiq, narx
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    SELECT * INTO v_med FROM medications
     WHERE id = (v_item->>'medication_id')::uuid AND clinic_id = p_clinic
     FOR UPDATE;
    v_kind := COALESCE(NULLIF(v_item->>'unit_kind', ''), 'unit');
    v_factor := CASE WHEN v_kind = 'pack' THEN GREATEST(COALESCE(v_med.pack_qty, 1), 1) ELSE 1 END;
    v_entered := COALESCE(NULLIF(v_item->>'entered_qty', '')::numeric, NULLIF(v_item->>'quantity', '')::numeric);
    v_cost_in := COALESCE(NULLIF(v_item->>'entered_cost_uzs', '')::numeric,
                          NULLIF(v_item->>'unit_cost_uzs', '')::numeric, 0);
    v_qty := (v_entered * v_factor)::integer;
    v_unit_cost := ROUND(v_cost_in / v_factor);
    v_line_total := ROUND(v_entered * v_cost_in);
    v_profit := COALESCE(NULLIF(v_item->>'profit_percent', '')::numeric, 0);

    -- Sotuv narxi (1 dona): aniq berilgan → qadoq narxidan → tannarx × (1 + foyda%)
    v_sale := NULLIF(v_item->>'sale_price_uzs', '')::bigint;
    v_pack := NULLIF(v_item->>'pack_price_uzs', '')::bigint;
    IF v_sale IS NULL AND v_pack IS NOT NULL THEN
      v_sale := ROUND(v_pack::numeric / GREATEST(COALESCE(v_med.pack_qty, 1), 1));
    END IF;
    IF v_sale IS NULL THEN
      v_sale := ROUND(v_unit_cost * (1 + v_profit / 100));
    END IF;
    v_keep := COALESCE(NULLIF(v_item->>'keep_higher_price', '')::boolean, false);
    v_kept := v_keep AND COALESCE(v_med.price_uzs, 0) > v_sale;
    v_new_price := CASE WHEN v_kept THEN v_med.price_uzs ELSE v_sale END;

    INSERT INTO medication_batches
      (clinic_id, medication_id, supplier_id, batch_no, expiry_date, manufacture_date, manufacturer,
       unit_cost_uzs, unit_price_uzs, profit_percent, doctor_share_percent, doctor_share_bonus_uzs,
       received_at, qty_received, qty_remaining, receipt_id, created_by)
    VALUES
      (p_clinic, v_med.id, v_supplier, NULLIF(v_item->>'batch_no', ''),
       NULLIF(v_item->>'expiry_date', '')::date, NULLIF(v_item->>'manufacture_date', '')::date,
       NULLIF(v_item->>'manufacturer', ''), v_unit_cost, v_new_price, v_profit,
       COALESCE(NULLIF(v_item->>'doctor_share_percent', '')::numeric, 0),
       COALESCE(NULLIF(v_item->>'doctor_share_bonus_uzs', '')::bigint, 0),
       v_received, v_qty, v_qty, v_receipt, p_user)
    RETURNING id INTO v_batch;

    INSERT INTO pharmacy_receipt_items
      (clinic_id, receipt_id, medication_id, batch_id, quantity, unit_cost_uzs, total_cost_uzs,
       batch_no, expiry_date, unit_kind, entered_qty, entered_cost_uzs, pack_qty, sale_price_uzs,
       old_price_uzs, manufacturer, gtin, source_name)
    VALUES
      (p_clinic, v_receipt, v_med.id, v_batch, v_qty, v_unit_cost, v_line_total,
       NULLIF(v_item->>'batch_no', ''), NULLIF(v_item->>'expiry_date', '')::date, v_kind,
       v_entered, ROUND(v_cost_in), v_med.pack_qty, v_new_price, v_med.price_uzs,
       NULLIF(v_item->>'manufacturer', ''), NULLIF(v_item->>'gtin', ''),
       NULLIF(v_item->>'source_name', ''));

    INSERT INTO pharmacy_stock_movements
      (clinic_id, medication_id, kind, quantity, unit_cost_uzs, supplier_id, receipt_id,
       batch_no, expiry_date, performed_by)
    VALUES
      (p_clinic, v_med.id, 'in', v_qty, v_unit_cost, v_supplier, v_receipt,
       NULLIF(v_item->>'batch_no', ''), NULLIF(v_item->>'expiry_date', '')::date, p_user);

    UPDATE medications
       SET stock = stock + v_qty,
           price_uzs = v_new_price,
           pack_price_uzs = CASE
             WHEN v_kept THEN pack_price_uzs
             WHEN COALESCE(pack_qty, 1) > 1 THEN v_pack
             ELSE NULL END,
           cost_uzs = v_unit_cost,
           manufacturer = COALESCE(NULLIF(v_item->>'manufacturer', ''), manufacturer),
           mxik_code = COALESCE(mxik_code, NULLIF(v_item->>'mxik_code', '')),
           updated_by = p_user
     WHERE id = v_med.id;

    -- Shtrix-kod o'rganish (DataMatrix GTIN yoki Excel ustuni)
    v_gtin := clary_barcode_norm(v_item->>'gtin');
    IF v_gtin <> '' THEN
      INSERT INTO medication_barcodes (clinic_id, medication_id, code, raw_code, kind, created_by)
      VALUES (p_clinic, v_med.id, v_gtin, v_item->>'gtin', 'manufacturer', p_user)
      ON CONFLICT (clinic_id, code) DO NOTHING;
    END IF;

    -- "Firmadagi nom → bizdagi dori" xotirasi
    v_alias := clary_search_norm(v_item->>'source_name');
    IF v_alias <> '' THEN
      INSERT INTO supplier_item_aliases (clinic_id, supplier_id, alias_norm, alias_raw, medication_id)
      VALUES (p_clinic, v_supplier, v_alias, v_item->>'source_name', v_med.id)
      ON CONFLICT (clinic_id, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), alias_norm)
      DO UPDATE SET medication_id = EXCLUDED.medication_id,
                    alias_raw = EXCLUDED.alias_raw,
                    times_used = supplier_item_aliases.times_used + 1,
                    last_used_at = now();
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- Firma oldi-berdi daftari (boshlang'ich qoldiqda yozilmaydi — u xarid emas)
  IF v_supplier IS NOT NULL AND v_source <> 'opening' THEN
    v_occurred := (v_received AT TIME ZONE 'Asia/Tashkent')::date;
    INSERT INTO pharmacy_supplier_ledger
      (clinic_id, supplier_id, entry_kind, amount_uzs, invoice_no, receipt_id, occurred_at, notes, created_by)
    VALUES
      (p_clinic, v_supplier, 'purchase', v_total, NULLIF(p_payload->>'receipt_no', ''), v_receipt,
       v_occurred, 'Prixot (kirim)', p_user);
    IF v_paid > 0 THEN
      INSERT INTO pharmacy_supplier_ledger
        (clinic_id, supplier_id, entry_kind, amount_uzs, payment_method, invoice_no, receipt_id,
         occurred_at, notes, created_by)
      VALUES
        (p_clinic, v_supplier, 'payment', -v_paid, v_method, NULLIF(p_payload->>'receipt_no', ''),
         v_receipt, v_occurred, 'Prixotda to''langan', p_user);
    END IF;
  END IF;

  -- Kassadan naqd to'langan bo'lsa — dorixona kassasi harakati
  IF v_paid > 0 AND v_shift IS NOT NULL AND COALESCE(v_method, 'cash') = 'cash' THEN
    INSERT INTO pharmacy_cash_movements
      (clinic_id, shift_id, kind, method, amount_uzs, notes, operator_id, created_by, ref_table, ref_id)
    VALUES
      (p_clinic, v_shift, 'supplier_payment', 'cash', -v_paid, 'Prixot uchun firmaga to''lov',
       v_operator, p_user, 'pharmacy_receipts', v_receipt);
  END IF;

  RETURN jsonb_build_object(
    'receipt_id', v_receipt, 'duplicate', false, 'total_cost_uzs', v_total, 'items', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_receive(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_receive(uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- F) Excel qatorlarini moslash — bitta so'rovda
-- ---------------------------------------------------------------------------
-- p_rows: [{ idx, name, strength?, barcode?, mxik? }]
-- Qaytaradi: [{ idx, medication_id|null, method|null, score|null, last, candidates[] }]
-- Tartib: shtrix-kod → alias (firma xotirasi) → MXIK (yagona bo'lsa) → aniq nom → o'xshash.
CREATE OR REPLACE FUNCTION public.pharmacy_match_import(p_clinic uuid, p_supplier uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       jsonb;
  out     jsonb := '[]'::jsonb;
  v_norm  text;
  v_code  text;
  v_med   uuid;
  v_method text;
  v_score numeric;
  v_cands jsonb;
  v_last  jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN out;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_med := NULL; v_method := NULL; v_score := NULL; v_cands := '[]'::jsonb; v_last := NULL;
    v_code := clary_barcode_norm(r->>'barcode');
    v_norm := clary_search_norm(concat_ws(' ', r->>'name', r->>'strength'));

    IF v_code <> '' THEN
      SELECT b.medication_id INTO v_med
        FROM medication_barcodes b
        JOIN medications m ON m.id = b.medication_id AND NOT m.is_archived
       WHERE b.clinic_id = p_clinic AND b.code = v_code
       LIMIT 1;
      IF v_med IS NOT NULL THEN v_method := 'barcode'; v_score := 1; END IF;
    END IF;

    IF v_med IS NULL AND v_norm <> '' THEN
      SELECT a.medication_id INTO v_med
        FROM supplier_item_aliases a
        JOIN medications m ON m.id = a.medication_id AND NOT m.is_archived
       WHERE a.clinic_id = p_clinic AND a.alias_norm = v_norm
         AND (p_supplier IS NULL OR a.supplier_id IS NULL OR a.supplier_id = p_supplier)
       ORDER BY (a.supplier_id IS NOT DISTINCT FROM p_supplier) DESC, a.times_used DESC
       LIMIT 1;
      IF v_med IS NOT NULL THEN v_method := 'alias'; v_score := 1; END IF;
    END IF;

    IF v_med IS NULL AND NULLIF(btrim(r->>'mxik'), '') IS NOT NULL THEN
      SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END INTO v_med
        FROM medications
       WHERE clinic_id = p_clinic AND NOT is_archived AND mxik_code = btrim(r->>'mxik');
      IF v_med IS NOT NULL THEN v_method := 'mxik'; v_score := 0.95; END IF;
    END IF;

    IF v_med IS NULL AND v_norm <> '' THEN
      SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END INTO v_med
        FROM medications
       WHERE clinic_id = p_clinic AND NOT is_archived
         AND clary_search_norm(name || ' ' || coalesce(strength, '')) = v_norm;
      IF v_med IS NOT NULL THEN v_method := 'name'; v_score := 0.98; END IF;
    END IF;

    IF v_norm <> '' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'strength', c.strength, 'manufacturer', c.manufacturer,
               'pack_qty', c.pack_qty, 'price_uzs', c.price_uzs, 'score', round(c.sim::numeric, 3))
             ORDER BY c.sim DESC), '[]'::jsonb)
        INTO v_cands
        FROM (
          SELECT m.id, m.name, m.strength, m.manufacturer, m.pack_qty, m.price_uzs,
                 similarity(m.search_text, v_norm) AS sim
            FROM medications m
           WHERE m.clinic_id = p_clinic AND NOT m.is_archived AND m.search_text % v_norm
           ORDER BY similarity(m.search_text, v_norm) DESC
           LIMIT 5
        ) c;
    END IF;

    IF v_med IS NOT NULL THEN
      SELECT jsonb_build_object('qty', ri.quantity, 'unit_cost_uzs', ri.unit_cost_uzs,
                                'entered_qty', ri.entered_qty, 'unit_kind', ri.unit_kind,
                                'at', ri.created_at)
        INTO v_last
        FROM pharmacy_receipt_items ri
       WHERE ri.clinic_id = p_clinic AND ri.medication_id = v_med
       ORDER BY ri.created_at DESC
       LIMIT 1;
    END IF;

    out := out || jsonb_build_array(jsonb_build_object(
      'idx', r->'idx', 'medication_id', v_med, 'method', v_method, 'score', v_score,
      'last', v_last, 'candidates', v_cands));
  END LOOP;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_match_import(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_match_import(uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- G) Prixodni bekor qilish — endi narx ham tiklanadi
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_void_receipt(
  p_clinic_id UUID,
  p_user_id   UUID,
  p_receipt_id UUID,
  p_reason    TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt RECORD;
  v_batch   RECORD;
  v_hist    RECORD;
  v_sold    INTEGER;
BEGIN
  SELECT * INTO v_receipt
    FROM pharmacy_receipts
   WHERE id = p_receipt_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prixod topilmadi';
  END IF;
  IF v_receipt.is_void THEN
    RAISE EXCEPTION 'Prixod allaqachon bekor qilingan';
  END IF;

  SELECT COALESCE(SUM(qty_received - qty_remaining), 0) INTO v_sold
    FROM medication_batches
   WHERE receipt_id = p_receipt_id AND clinic_id = p_clinic_id;

  IF v_sold > 0 THEN
    RAISE EXCEPTION
      'Bekor qilib bo''lmaydi: bu prixoddan % dona sotilgan. Qaytarish (return) orqali rasmiylashtiring.',
      v_sold;
  END IF;

  FOR v_batch IN
    SELECT id, medication_id, qty_received
      FROM medication_batches
     WHERE receipt_id = p_receipt_id AND clinic_id = p_clinic_id
  LOOP
    UPDATE medications
       SET stock = GREATEST(0, stock - v_batch.qty_received)
     WHERE id = v_batch.medication_id AND clinic_id = p_clinic_id;

    UPDATE medication_batches
       SET qty_remaining = 0
     WHERE id = v_batch.id;

    INSERT INTO pharmacy_stock_movements
      (clinic_id, medication_id, kind, quantity, receipt_id, performed_by, notes)
    VALUES
      (p_clinic_id, v_batch.medication_id, 'out', v_batch.qty_received,
       p_receipt_id, p_user_id, 'Prixod bekor qilindi');
  END LOOP;

  -- Narxni tiklash: shu prixod o'rnatgan narx hali turgan bo'lsa (keyin qo'lda
  -- yoki boshqa prixod bilan o'zgartirilmagan bo'lsa) — oldingisiga qaytaramiz.
  PERFORM set_config('clary.price_source', 'receipt_void', true);
  PERFORM set_config('clary.receipt_id', p_receipt_id::text, true);
  FOR v_hist IN
    SELECT DISTINCT ON (h.medication_id) h.medication_id, h.old_price_uzs, h.new_price_uzs,
           h.old_pack_price_uzs, h.new_pack_price_uzs
      FROM medication_price_history h
     WHERE h.receipt_id = p_receipt_id AND h.source = 'receipt' AND h.clinic_id = p_clinic_id
     ORDER BY h.medication_id, h.created_at ASC
  LOOP
    UPDATE medications m
       SET price_uzs = COALESCE(v_hist.old_price_uzs, m.price_uzs),
           pack_price_uzs = v_hist.old_pack_price_uzs,
           updated_by = p_user_id
     WHERE m.id = v_hist.medication_id AND m.clinic_id = p_clinic_id
       AND m.price_uzs IS NOT DISTINCT FROM v_hist.new_price_uzs;
  END LOOP;

  IF v_receipt.supplier_id IS NOT NULL THEN
    INSERT INTO pharmacy_supplier_ledger
      (clinic_id, supplier_id, entry_kind, amount_uzs, receipt_id, occurred_at, notes, created_by)
    SELECT
      p_clinic_id, v_receipt.supplier_id, 'purchase', -l.amount_uzs,
      p_receipt_id, CURRENT_DATE, 'Prixod bekor qilindi', p_user_id
      FROM pharmacy_supplier_ledger l
     WHERE l.receipt_id = p_receipt_id
       AND l.clinic_id = p_clinic_id
       AND l.entry_kind = 'purchase'
       AND l.amount_uzs > 0;
  END IF;

  UPDATE pharmacy_receipts
     SET is_void = true,
         voided_at = now(),
         voided_by = p_user_id,
         voided_reason = p_reason
   WHERE id = p_receipt_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.pharmacy_void_receipt(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_void_receipt(UUID, UUID, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.pharmacy_void_receipt(UUID, UUID, UUID, TEXT) IS
  'Prixodni bekor qiladi. Undan biror dona sotilgan bo''lsa rad etadi. Shu prixod o''rnatgan narxni tiklaydi.';

-- ---------------------------------------------------------------------------
-- H) GL: manfiy supplier yozuvlari teskari provodka bilan
-- ---------------------------------------------------------------------------
-- Avval ABS(summa) har doim "Dr Inventory / Cr AP" berardi — prixod bekor
-- qilinganda (manfiy purchase) xarid IKKINCHI marta yozilib qolardi.
CREATE OR REPLACE FUNCTION public.gl_post_supplier_ledger(s public.pharmacy_supplier_ledger)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amt bigint;
  v_cash text;
BEGIN
  v_amt := ABS(s.amount_uzs);
  IF v_amt = 0 THEN RETURN; END IF;
  IF s.entry_kind = 'purchase' THEN
    IF s.amount_uzs > 0 THEN
      PERFORM post_journal(s.clinic_id, 'purchase', s.occurred_at, 'pharmacy_supplier_ledger', s.id, 'Xarid (kirim)',
        jsonb_build_array(
          jsonb_build_object('code', '1400', 'debit', v_amt, 'credit', 0),
          jsonb_build_object('code', '2100', 'debit', 0, 'credit', v_amt)));
    ELSE
      PERFORM post_journal(s.clinic_id, 'purchase', s.occurred_at, 'pharmacy_supplier_ledger', s.id, 'Xarid bekor qilindi',
        jsonb_build_array(
          jsonb_build_object('code', '2100', 'debit', v_amt, 'credit', 0),
          jsonb_build_object('code', '1400', 'debit', 0, 'credit', v_amt)));
    END IF;
  ELSIF s.entry_kind = 'payment' THEN
    v_cash := gl_cash_code(COALESCE(s.payment_method, 'cash'), 'cash_drawer');
    IF s.amount_uzs < 0 THEN
      PERFORM post_journal(s.clinic_id, 'supplier_payment', s.occurred_at, 'pharmacy_supplier_ledger', s.id, 'Supplierga to''lov',
        jsonb_build_array(
          jsonb_build_object('code', '2100', 'debit', v_amt, 'credit', 0),
          jsonb_build_object('code', v_cash, 'debit', 0, 'credit', v_amt)));
    ELSE
      PERFORM post_journal(s.clinic_id, 'supplier_payment', s.occurred_at, 'pharmacy_supplier_ledger', s.id, 'Supplierdan qaytgan pul',
        jsonb_build_array(
          jsonb_build_object('code', v_cash, 'debit', v_amt, 'credit', 0),
          jsonb_build_object('code', '2100', 'debit', 0, 'credit', v_amt)));
    END IF;
  END IF;
END;
$$;
