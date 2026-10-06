-- =============================================================================
-- DAVLAT DORI KATALOGI (MXIK) — barcha dorixonalar uchun umumiy ma'lumotnoma
-- =============================================================================
-- Manba: Soliq qo'mitasining MXIK katalogi (tasnif.soliq.uz) — dorilar, BAD,
-- tibbiy buyumlar: savdo nomi, ishlab chiqaruvchi, shakli, dozasi, qadoqdagi
-- dona soni, MNN, ATX, QQS imtiyozi, shtrix-kodlar. API haftada bir sinxronlaydi.
--
--   A) drug_reference            — katalog (klinikaga bog'lanmagan, platforma darajasi)
--   B) drug_reference_barcodes   — shtrix-kod → MXIK (MXIK'dan + dorixonalar o'rgatgani)
--   C) drug_reference_sync_log   — sinxronlash / reestr importi tarixi
--   D) drug_reference_upsert, drug_reference_deactivate_stale — sinxronlash
--   E) drug_reference_search     — 1–2 harfdan (prefiks), 3+ harf (so'zlar + trigram)
--   F) pharmacy_adopt_reference  — katalogdagi dorini klinika bazasiga qo'shish
--   G) dorixonalar o'rgatgan shtrix-kodlar (trigger) + bir martalik yig'ish
--   H) drug_reference_stats      — super admin sahifasi uchun
--
-- HAMMASI QO'SHIMCHA: mavjud jadval va funksiyalar o'zgarmaydi. Katalog bo'sh
-- tursa ham dorixona avvalgidek ishlaydi (qidiruv shunchaki natija bermaydi).
-- Bog'liq: 20261004000001 (clary_search_norm, clary_barcode_norm, medication_barcodes).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- A) drug_reference
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drug_reference (
  mxik_code           text PRIMARY KEY,
  kind                text NOT NULL DEFAULT 'drug',
  name                text NOT NULL,
  manufacturer        text,
  attribute           text,
  form                text,
  strength            text,
  pack_qty            integer NOT NULL DEFAULT 1,
  blister_qty         integer,
  unit_name           text,
  generic_name        text,
  atc_code            text,
  class_code          text NOT NULL,
  subposition_name    text,
  vat_exempt          boolean NOT NULL DEFAULT false,
  -- Qadoq kodlari (fiskal chek) — birinchi qo'shilganda MXIK'dan olinadi
  packages            jsonb,
  packages_fetched_at timestamptz,
  -- Davlat reestri (uzpharm-control) bilan moslash — 20261006000002
  reg_number          text,
  reg_active          boolean,
  reg_country         text,
  reg_manufacturer    text,
  rx_required         boolean,
  reg_matched_at      timestamptz,
  -- 'mxik' — ommaviy sinxron; 'live' — shtrix-kod bo'yicha jonli so'rov
  source              text NOT NULL DEFAULT 'mxik',
  is_active           boolean NOT NULL DEFAULT true,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  search_text         text GENERATED ALWAYS AS (
    public.clary_search_norm(
      name || ' ' || coalesce(strength, '') || ' ' || coalesce(form, '') || ' ' ||
      coalesce(manufacturer, '') || ' ' || coalesce(generic_name, '') || ' ' ||
      coalesce(subposition_name, '')
    )
  ) STORED,
  name_norm           text GENERATED ALWAYS AS (public.clary_search_norm(name)) STORED,
  mfr_norm            text GENERATED ALWAYS AS (public.clary_search_norm(manufacturer)) STORED,
  CONSTRAINT drug_reference_mxik_chk CHECK (mxik_code ~ '^[0-9]{17}$'),
  CONSTRAINT drug_reference_kind_chk CHECK (kind IN ('drug', 'bad', 'device', 'other')),
  CONSTRAINT drug_reference_source_chk CHECK (source IN ('mxik', 'live')),
  CONSTRAINT drug_reference_pack_chk CHECK (
    pack_qty BETWEEN 1 AND 10000
    AND (blister_qty IS NULL OR (blister_qty >= 1 AND blister_qty <= pack_qty))
  )
);

COMMENT ON TABLE public.drug_reference IS
  'Davlat dori katalogi (MXIK, tasnif.soliq.uz). Platforma darajasi — klinikaga bog''lanmagan. API sinxronlaydi.';

CREATE INDEX IF NOT EXISTS idx_drug_reference_search_trgm
  ON public.drug_reference USING gin (search_text gin_trgm_ops) WHERE is_active;
-- 1–2 harfli qidiruv: search_text LIKE 'pa%'
CREATE INDEX IF NOT EXISTS idx_drug_reference_search_prefix
  ON public.drug_reference (search_text text_pattern_ops) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_drug_reference_class
  ON public.drug_reference (class_code, synced_at);
-- Reestr bilan moslash (birinchi so'z bo'yicha)
CREATE INDEX IF NOT EXISTS idx_drug_reference_name_first
  ON public.drug_reference ((split_part(name_norm, ' ', 1)));

ALTER TABLE public.drug_reference ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.drug_reference FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- B) drug_reference_barcodes — bitta kod odatda bitta MXIK; ehtiyot uchun ko'p
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drug_reference_barcodes (
  code          text NOT NULL,
  mxik_code     text NOT NULL REFERENCES public.drug_reference(mxik_code) ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'mxik',
  -- 'clinic' manbada: nechta dorixona shu kodni shu MXIK'li doriga biriktirgan
  confirmations integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, mxik_code),
  CONSTRAINT drug_reference_barcodes_source_chk CHECK (source IN ('mxik', 'clinic')),
  CONSTRAINT drug_reference_barcodes_code_chk CHECK (code ~ '^[0-9]{14}$')
);
CREATE INDEX IF NOT EXISTS idx_drug_reference_barcodes_mxik
  ON public.drug_reference_barcodes (mxik_code);

ALTER TABLE public.drug_reference_barcodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.drug_reference_barcodes FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) Sinxronlash tarixi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drug_reference_sync_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text NOT NULL,
  status           text NOT NULL DEFAULT 'running',
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  rows_fetched     integer NOT NULL DEFAULT 0,
  rows_upserted    integer NOT NULL DEFAULT 0,
  rows_deactivated integer NOT NULL DEFAULT 0,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  error            text,
  triggered_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT drug_reference_sync_log_source_chk CHECK (source IN ('mxik', 'registry')),
  CONSTRAINT drug_reference_sync_log_status_chk CHECK (status IN ('running', 'ok', 'partial', 'error'))
);
CREATE INDEX IF NOT EXISTS idx_drug_reference_sync_log_started
  ON public.drug_reference_sync_log (source, started_at DESC);

ALTER TABLE public.drug_reference_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.drug_reference_sync_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- D) Sinxronlash: yozuvlarni qo'shish/yangilash + shtrix-kodlar
-- ---------------------------------------------------------------------------
-- p_rows: DrugReferenceRow[] (packages/utils/src/drug-reference.ts → mapMxikRow)
--   { mxik_code, kind, name, manufacturer?, attribute?, form?, strength?, pack_qty,
--     blister_qty?, unit_name?, generic_name?, atc_code?, class_code, subposition_name?,
--     vat_exempt, gtins: string[] }
-- Reestr natijasi (reg_*) va qadoq kodlari (packages) tegilmaydi.
CREATE OR REPLACE FUNCTION public.drug_reference_upsert(p_rows jsonb, p_source text DEFAULT 'mxik')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_source NOT IN ('mxik', 'live') THEN
    RAISE EXCEPTION 'Noto''g''ri manba: %', p_source;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH src AS (
    SELECT DISTINCT ON (r->>'mxik_code') r,
           LEAST(GREATEST(COALESCE(NULLIF(r->>'pack_qty', '')::int, 1), 1), 10000) AS pack
      FROM jsonb_array_elements(p_rows) AS r
     WHERE (r->>'mxik_code') ~ '^[0-9]{17}$'
       AND NULLIF(btrim(r->>'name'), '') IS NOT NULL
     ORDER BY r->>'mxik_code'
  ), up AS (
    INSERT INTO drug_reference AS d
      (mxik_code, kind, name, manufacturer, attribute, form, strength, pack_qty, blister_qty,
       unit_name, generic_name, atc_code, class_code, subposition_name, vat_exempt,
       source, is_active, synced_at, updated_at)
    SELECT r->>'mxik_code',
           CASE WHEN r->>'kind' IN ('drug', 'bad', 'device', 'other') THEN r->>'kind' ELSE 'other' END,
           left(btrim(r->>'name'), 300),
           NULLIF(left(btrim(r->>'manufacturer'), 200), ''),
           NULLIF(left(btrim(r->>'attribute'), 500), ''),
           NULLIF(left(btrim(r->>'form'), 100), ''),
           NULLIF(left(btrim(r->>'strength'), 100), ''),
           pack,
           CASE WHEN NULLIF(r->>'blister_qty', '')::int BETWEEN 1 AND pack
                THEN (r->>'blister_qty')::int END,
           NULLIF(left(btrim(r->>'unit_name'), 40), ''),
           NULLIF(left(btrim(r->>'generic_name'), 200), ''),
           NULLIF(upper(left(btrim(r->>'atc_code'), 10)), ''),
           COALESCE(NULLIF(r->>'class_code', ''), left(r->>'mxik_code', 5)),
           NULLIF(left(btrim(r->>'subposition_name'), 300), ''),
           COALESCE((r->>'vat_exempt')::boolean, false),
           p_source, true, now(), now()
      FROM src
    ON CONFLICT (mxik_code) DO UPDATE SET
      kind             = EXCLUDED.kind,
      name             = EXCLUDED.name,
      manufacturer     = EXCLUDED.manufacturer,
      attribute        = EXCLUDED.attribute,
      form             = EXCLUDED.form,
      strength         = EXCLUDED.strength,
      pack_qty         = EXCLUDED.pack_qty,
      blister_qty      = EXCLUDED.blister_qty,
      unit_name        = EXCLUDED.unit_name,
      generic_name     = EXCLUDED.generic_name,
      atc_code         = EXCLUDED.atc_code,
      class_code       = EXCLUDED.class_code,
      subposition_name = EXCLUDED.subposition_name,
      vat_exempt       = EXCLUDED.vat_exempt,
      -- jonli so'rov ommaviy sinxron yozuvini "live" ga tushirmaydi
      source           = CASE WHEN d.source = 'mxik' THEN 'mxik' ELSE EXCLUDED.source END,
      is_active        = true,
      synced_at        = now(),
      updated_at       = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM up;

  INSERT INTO drug_reference_barcodes AS b (code, mxik_code, source)
  SELECT DISTINCT clary_barcode_norm(g.code), r->>'mxik_code', 'mxik'
    FROM jsonb_array_elements(p_rows) AS r
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(r->'gtins') = 'array' THEN r->'gtins' ELSE '[]'::jsonb END
    ) AS g(code)
   WHERE (r->>'mxik_code') ~ '^[0-9]{17}$'
     AND clary_barcode_norm(g.code) ~ '^[0-9]{14}$'
     AND EXISTS (SELECT 1 FROM drug_reference d WHERE d.mxik_code = r->>'mxik_code')
  ON CONFLICT (code, mxik_code) DO UPDATE SET source = 'mxik', updated_at = now();

  RETURN v_n;
END;
$$;

-- To'liq sinxrondan keyin: shu sinflarda MXIK'dan yo'qolgan yozuvlar nofaol.
-- Faqat to'liq yuklangan sinflar beriladi (API tekshiradi) — yarim yuklanish
-- katalogni "o'chirib" yubormaydi.
CREATE OR REPLACE FUNCTION public.drug_reference_deactivate_stale(
  p_before timestamptz,
  p_classes text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_before IS NULL OR p_classes IS NULL OR cardinality(p_classes) = 0 THEN
    RETURN 0;
  END IF;
  UPDATE drug_reference
     SET is_active = false, updated_at = now()
   WHERE source = 'mxik'
     AND is_active
     AND synced_at < p_before
     AND class_code = ANY (p_classes);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- E) Qidiruv
-- ---------------------------------------------------------------------------
--   * faqat raqam (8–17) — shtrix-kod yoki MXIK boshi
--   * 1–2 harf — nom boshi (prefiks indeks)
--   * 3+ harf — barcha so'zlar ichida bo'lsin, yoki so'z o'xshashligi (imlo xatosi)
CREATE OR REPLACE FUNCTION public.drug_reference_search(
  p_q text,
  p_limit integer DEFAULT 30,
  p_kind text DEFAULT NULL
)
RETURNS TABLE (
  mxik_code        text,
  kind             text,
  name             text,
  manufacturer     text,
  attribute        text,
  form             text,
  strength         text,
  pack_qty         integer,
  blister_qty      integer,
  unit_name        text,
  generic_name     text,
  atc_code         text,
  subposition_name text,
  vat_exempt       boolean,
  reg_active       boolean,
  rx_required      boolean,
  barcode          text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm   text := clary_search_norm(p_q);
  v_digits text := regexp_replace(coalesce(p_q, ''), '\s+', '', 'g');
  v_code   text := clary_barcode_norm(p_q);
  v_lim    int  := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_kind   text := NULLIF(p_kind, '');
  v_tokens text[];
  v_pats   text[];
  v_long   text;
  v_found  int := 0;
  v_more   int := 0;
BEGIN
  IF v_norm = '' THEN
    RETURN;
  END IF;

  IF v_digits ~ '^[0-9]{8,17}$' THEN
    RETURN QUERY
      SELECT d.mxik_code, d.kind, d.name, d.manufacturer, d.attribute, d.form, d.strength,
             d.pack_qty, d.blister_qty, d.unit_name, d.generic_name, d.atc_code,
             d.subposition_name, d.vat_exempt, d.reg_active, d.rx_required,
             (SELECT b.code FROM drug_reference_barcodes b WHERE b.mxik_code = d.mxik_code
               ORDER BY (b.source = 'mxik') DESC, b.confirmations DESC LIMIT 1)
        FROM drug_reference d
       WHERE d.is_active
         AND (v_kind IS NULL OR d.kind = v_kind)
         AND (d.mxik_code LIKE v_digits || '%'
              OR EXISTS (SELECT 1 FROM drug_reference_barcodes b
                          WHERE b.code = v_code AND b.mxik_code = d.mxik_code))
       ORDER BY d.name
       LIMIT v_lim;
    RETURN;
  END IF;

  IF length(v_norm) < 3 THEN
    RETURN QUERY
      SELECT d.mxik_code, d.kind, d.name, d.manufacturer, d.attribute, d.form, d.strength,
             d.pack_qty, d.blister_qty, d.unit_name, d.generic_name, d.atc_code,
             d.subposition_name, d.vat_exempt, d.reg_active, d.rx_required,
             (SELECT b.code FROM drug_reference_barcodes b WHERE b.mxik_code = d.mxik_code
               ORDER BY (b.source = 'mxik') DESC, b.confirmations DESC LIMIT 1)
        FROM drug_reference d
       WHERE d.is_active
         AND (v_kind IS NULL OR d.kind = v_kind)
         AND d.search_text LIKE v_norm || '%'
       ORDER BY d.search_text, d.mxik_code
       LIMIT v_lim;
    RETURN;
  END IF;

  v_tokens := regexp_split_to_array(v_norm, ' ');
  SELECT array_agg('%' || t || '%'), (array_agg(t ORDER BY length(t) DESC))[1]
    INTO v_pats, v_long
    FROM unnest(v_tokens) AS t
   WHERE t <> '';

  -- 1) Nom boshi (prefiks indeks) — eng tez va eng kutilgan natija
  RETURN QUERY
    SELECT d.mxik_code, d.kind, d.name, d.manufacturer, d.attribute, d.form, d.strength,
           d.pack_qty, d.blister_qty, d.unit_name, d.generic_name, d.atc_code,
           d.subposition_name, d.vat_exempt, d.reg_active, d.rx_required,
           (SELECT b.code FROM drug_reference_barcodes b WHERE b.mxik_code = d.mxik_code
             ORDER BY (b.source = 'mxik') DESC, b.confirmations DESC LIMIT 1)
      FROM drug_reference d
     WHERE d.is_active
       AND (v_kind IS NULL OR d.kind = v_kind)
       AND d.search_text LIKE v_norm || '%'
     ORDER BY d.search_text, d.mxik_code
     LIMIT v_lim;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found >= v_lim THEN
    RETURN;
  END IF;

  -- 2) Barcha so'zlar matn ichida (trigram indeks): so'z boshi va nomdagisi oldinda
  RETURN QUERY
    SELECT d.mxik_code, d.kind, d.name, d.manufacturer, d.attribute, d.form, d.strength,
           d.pack_qty, d.blister_qty, d.unit_name, d.generic_name, d.atc_code,
           d.subposition_name, d.vat_exempt, d.reg_active, d.rx_required,
           (SELECT b.code FROM drug_reference_barcodes b WHERE b.mxik_code = d.mxik_code
             ORDER BY (b.source = 'mxik') DESC, b.confirmations DESC LIMIT 1)
      FROM drug_reference d
     WHERE d.is_active
       AND (v_kind IS NULL OR d.kind = v_kind)
       AND d.search_text LIKE '%' || v_long || '%'
       AND d.search_text LIKE ALL (v_pats)
       AND d.search_text NOT LIKE v_norm || '%'
     ORDER BY
       (d.name_norm LIKE '%' || v_long || '%') DESC,
       (d.search_text LIKE '% ' || v_tokens[1] || '%') DESC,
       length(d.search_text),
       d.name,
       d.mxik_code
     LIMIT v_lim - v_found;
  GET DIAGNOSTICS v_more = ROW_COUNT;
  IF v_found + v_more > 0 THEN
    RETURN;
  END IF;

  -- 2b) Lotincha "u" ko'pincha "ю" o'rnida yoziladi ("teraflu" → "терафлю" = "terafliu")
  IF position('u' IN v_norm) > 0 THEN
    RETURN QUERY
      SELECT d.mxik_code, d.kind, d.name, d.manufacturer, d.attribute, d.form, d.strength,
             d.pack_qty, d.blister_qty, d.unit_name, d.generic_name, d.atc_code,
             d.subposition_name, d.vat_exempt, d.reg_active, d.rx_required,
             (SELECT b.code FROM drug_reference_barcodes b WHERE b.mxik_code = d.mxik_code
               ORDER BY (b.source = 'mxik') DESC, b.confirmations DESC LIMIT 1)
        FROM drug_reference d
       WHERE d.is_active
         AND (v_kind IS NULL OR d.kind = v_kind)
         AND d.search_text LIKE replace(v_norm, 'u', 'iu') || '%'
       ORDER BY d.search_text, d.mxik_code
       LIMIT v_lim;
    GET DIAGNOSTICS v_more = ROW_COUNT;
    IF v_more > 0 THEN
      RETURN;
    END IF;
  END IF;

  -- 3) Hech narsa topilmadi — imlo xatosi / transliteratsiya farqi (so'z o'xshashligi)
  RETURN QUERY
    SELECT d.mxik_code, d.kind, d.name, d.manufacturer, d.attribute, d.form, d.strength,
           d.pack_qty, d.blister_qty, d.unit_name, d.generic_name, d.atc_code,
           d.subposition_name, d.vat_exempt, d.reg_active, d.rx_required,
           (SELECT b.code FROM drug_reference_barcodes b WHERE b.mxik_code = d.mxik_code
             ORDER BY (b.source = 'mxik') DESC, b.confirmations DESC LIMIT 1)
      FROM drug_reference d
     WHERE d.is_active
       AND (v_kind IS NULL OR d.kind = v_kind)
       AND v_norm <% d.search_text
     ORDER BY word_similarity(v_norm, d.name_norm) DESC,
              similarity(v_tokens[1], split_part(d.name_norm, ' ', 1)) DESC,
              word_similarity(v_norm, d.search_text) DESC,
              d.name,
              d.mxik_code
     LIMIT v_lim;
END;
$$;

-- ---------------------------------------------------------------------------
-- F) Katalogdagi dorini klinika bazasiga qo'shish ("asrab olish")
-- ---------------------------------------------------------------------------
-- Takror yaratilmaydi: klinikada shu MXIK'li dori bo'lsa — o'shani qaytaradi;
-- shtrix-kod klinikada boshqa dorida band bo'lsa — o'sha dori qaytadi.
-- Narx 0 — prixodda kiritiladi. Natija: { medication_id, created, reason? }
CREATE OR REPLACE FUNCTION public.pharmacy_adopt_reference(
  p_clinic uuid,
  p_user uuid,
  p_mxik text,
  p_barcode text DEFAULT NULL,
  p_sell_by_unit boolean DEFAULT NULL,
  p_package_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       drug_reference%ROWTYPE;
  v_med   uuid;
  v_taken uuid;
  v_code  text := NULLIF(clary_barcode_norm(p_barcode), '');
BEGIN
  SELECT * INTO r FROM drug_reference WHERE mxik_code = p_mxik;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Davlat katalogida topilmadi: %', p_mxik;
  END IF;

  -- Bir vaqtda ikki marta bosilsa ham bitta dori yaratiladi
  PERFORM pg_advisory_xact_lock(hashtext('clary.adopt:' || p_clinic::text || ':' || p_mxik));

  IF v_code IS NOT NULL THEN
    SELECT mb.medication_id INTO v_taken
      FROM medication_barcodes mb
     WHERE mb.clinic_id = p_clinic AND mb.code = v_code;
  END IF;

  SELECT m.id INTO v_med
    FROM medications m
   WHERE m.clinic_id = p_clinic AND NOT m.is_archived AND m.mxik_code = p_mxik
   ORDER BY m.created_at
   LIMIT 1;

  IF v_med IS NULL AND v_taken IS NOT NULL THEN
    RETURN jsonb_build_object('medication_id', v_taken, 'created', false, 'reason', 'barcode');
  END IF;

  IF v_med IS NULL THEN
    INSERT INTO medications
      (clinic_id, name, manufacturer, strength, form, generic_name, mxik_code, package_code,
       vat_percent, pack_qty, blister_qty, unit_name, sell_by_unit, requires_prescription,
       barcode, price_uzs, stock, created_by)
    VALUES
      (p_clinic, r.name, r.manufacturer, r.strength, r.form, r.generic_name, r.mxik_code,
       NULLIF(btrim(p_package_code), ''),
       CASE WHEN r.vat_exempt THEN 0 END,
       r.pack_qty, r.blister_qty, r.unit_name,
       COALESCE(p_sell_by_unit, false) AND r.pack_qty > 1,
       COALESCE(r.rx_required, false),
       -- tg_medications_barcode_sync kodni medication_barcodes ga yozadi
       CASE WHEN v_code IS NOT NULL AND v_taken IS NULL
            THEN regexp_replace(v_code, '^0([0-9]{13})$', '\1') END,
       0, 0, p_user)
    RETURNING id INTO v_med;
    RETURN jsonb_build_object('medication_id', v_med, 'created', true);
  END IF;

  -- Mavjud dori: yangi shtrix-kod biriktiriladi (band bo'lmasa)
  IF v_code IS NOT NULL AND v_taken IS NULL THEN
    INSERT INTO medication_barcodes (clinic_id, medication_id, code, raw_code, kind, created_by)
    VALUES (p_clinic, v_med, v_code, p_barcode, 'manufacturer', p_user)
    ON CONFLICT (clinic_id, code) DO NOTHING;
    UPDATE medications
       SET barcode = regexp_replace(v_code, '^0([0-9]{13})$', '\1'), updated_by = p_user
     WHERE id = v_med AND (barcode IS NULL OR btrim(barcode) = '');
  END IF;
  RETURN jsonb_build_object('medication_id', v_med, 'created', false, 'reason', 'mxik');
END;
$$;

-- ---------------------------------------------------------------------------
-- G) Dorixonalar o'rgatgan shtrix-kodlar
-- ---------------------------------------------------------------------------
-- Dorixona MXIK'li doriga ishlab chiqaruvchi shtrix-kodini biriktirsa — kod
-- katalogga "clinic" manba bilan yoziladi (keyingi dorixonada skaner o'zi taniydi).
-- Ichki kodlar (GS1 "2" prefiksi → GTIN-14 "02…") va boshqa turlar o'rganilmaydi.
-- HECH QACHON asosiy amalni buzmaydi (xato — faqat WARNING).
CREATE OR REPLACE FUNCTION public.tg_drug_reference_learn_barcode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mxik text;
BEGIN
  IF NEW.kind <> 'manufacturer' OR NEW.code !~ '^[0-9]{14}$' OR NEW.code LIKE '02%' THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT m.mxik_code INTO v_mxik FROM medications m WHERE m.id = NEW.medication_id;
    IF v_mxik IS NOT NULL AND EXISTS (SELECT 1 FROM drug_reference d WHERE d.mxik_code = v_mxik) THEN
      INSERT INTO drug_reference_barcodes AS b (code, mxik_code, source, confirmations)
      VALUES (NEW.code, v_mxik, 'clinic', 1)
      ON CONFLICT (code, mxik_code) DO UPDATE
        SET confirmations = b.confirmations + 1, updated_at = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'drug_reference_barcodes (kod): %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_drug_reference_learn_barcode ON public.medication_barcodes;
CREATE TRIGGER tg_drug_reference_learn_barcode
  AFTER INSERT ON public.medication_barcodes
  FOR EACH ROW EXECUTE FUNCTION public.tg_drug_reference_learn_barcode();

-- Doriga MXIK keyinroq kiritilsa — uning ishlab chiqaruvchi kodlari ham o'rganiladi
CREATE OR REPLACE FUNCTION public.tg_drug_reference_learn_mxik()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.mxik_code IS NULL OR NEW.mxik_code IS NOT DISTINCT FROM OLD.mxik_code THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF EXISTS (SELECT 1 FROM drug_reference d WHERE d.mxik_code = NEW.mxik_code) THEN
      INSERT INTO drug_reference_barcodes AS b (code, mxik_code, source, confirmations)
      SELECT DISTINCT mb.code, NEW.mxik_code, 'clinic', 1
        FROM medication_barcodes mb
       WHERE mb.medication_id = NEW.id
         AND mb.kind = 'manufacturer'
         AND mb.code ~ '^[0-9]{14}$'
         AND mb.code NOT LIKE '02%'
      ON CONFLICT (code, mxik_code) DO UPDATE
        SET confirmations = b.confirmations + 1, updated_at = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'drug_reference_barcodes (mxik): %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_drug_reference_learn_mxik ON public.medications;
CREATE TRIGGER tg_drug_reference_learn_mxik
  AFTER UPDATE OF mxik_code ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.tg_drug_reference_learn_mxik();

-- Mavjud dorixona ma'lumotidan yig'ish (sinxrondan keyin chaqiriladi). Takror
-- chaqirilsa ham to'g'ri: tasdiqlar soni = shu kodni biriktirgan klinikalar soni.
CREATE OR REPLACE FUNCTION public.drug_reference_learn_backfill()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO drug_reference_barcodes AS b (code, mxik_code, source, confirmations)
  SELECT mb.code, m.mxik_code, 'clinic', count(DISTINCT mb.clinic_id)::int
    FROM medication_barcodes mb
    JOIN medications m ON m.id = mb.medication_id
    JOIN drug_reference d ON d.mxik_code = m.mxik_code
   WHERE mb.kind = 'manufacturer'
     AND mb.code ~ '^[0-9]{14}$'
     AND mb.code NOT LIKE '02%'
     AND NOT m.is_archived
   GROUP BY mb.code, m.mxik_code
  ON CONFLICT (code, mxik_code) DO UPDATE
    SET confirmations = GREATEST(b.confirmations, EXCLUDED.confirmations),
        updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- H) Super admin statistikasi
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drug_reference_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',        (SELECT count(*) FROM drug_reference WHERE is_active),
    'inactive',     (SELECT count(*) FROM drug_reference WHERE NOT is_active),
    'by_kind',      COALESCE((SELECT jsonb_object_agg(kind, n) FROM (
                       SELECT kind, count(*) AS n FROM drug_reference WHERE is_active GROUP BY kind) k), '{}'::jsonb),
    'with_barcode', (SELECT count(DISTINCT b.mxik_code) FROM drug_reference_barcodes b
                       JOIN drug_reference d ON d.mxik_code = b.mxik_code AND d.is_active),
    'barcodes',     (SELECT count(*) FROM drug_reference_barcodes),
    'barcodes_from_clinics', (SELECT count(*) FROM drug_reference_barcodes WHERE source = 'clinic'),
    'reg_matched',  (SELECT count(*) FROM drug_reference WHERE is_active AND reg_matched_at IS NOT NULL),
    'reg_active',   (SELECT count(*) FROM drug_reference WHERE is_active AND reg_active IS TRUE),
    'reg_inactive', (SELECT count(*) FROM drug_reference WHERE is_active AND reg_active IS FALSE),
    'adopted_clinics', (SELECT count(DISTINCT m.clinic_id) FROM medications m
                          JOIN drug_reference d ON d.mxik_code = m.mxik_code
                         WHERE NOT m.is_archived)
  );
$$;

-- ---------------------------------------------------------------------------
-- Ruxsatlar: faqat API (service_role)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.drug_reference_upsert(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_reference_deactivate_stale(timestamptz, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_reference_search(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pharmacy_adopt_reference(uuid, uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_reference_learn_backfill() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_reference_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_drug_reference_learn_barcode() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_drug_reference_learn_mxik() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.drug_reference_upsert(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_reference_deactivate_stale(timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_reference_search(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_adopt_reference(uuid, uuid, text, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_reference_learn_backfill() TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_reference_stats() TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drug_reference TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drug_reference_barcodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drug_reference_sync_log TO service_role;

NOTIFY pgrst, 'reload schema';
