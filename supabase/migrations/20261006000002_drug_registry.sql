-- =============================================================================
-- DAVLAT REESTRI (uzpharm-control.uz) — ro'yxatdan o'tganlik holati
-- =============================================================================
-- Farmatsevtika mahsulotlari xavfsizligi markazi reestrini super admin Excel
-- sifatida yuklaydi (saytda captcha bilan yuklab olinadi). Reestr qatorlari
-- MXIK katalogi (drug_reference) bilan moslashtiriladi:
--   reg_number, reg_active (amalda / muddati o'tgan), reg_country,
--   reg_manufacturer, rx_required (retsept bilan).
-- Prixodda "reestrda muddati o'tgan" ogohlantirishi va katalogdan qo'shilgan
-- dorining "retsept bilan" belgisi shu ma'lumotdan keladi.
--
--   A) drug_registry             — oxirgi import qatorlari (eski importlar o'chiriladi)
--   B) clary_try_date            — xavfsiz sana o'girish
--   C) drug_registry_import_rows — qatorlarni bo'lib-bo'lib yozish
--   D) drug_registry_reset_matches / drug_registry_match(prefiks) /
--      drug_registry_finish      — moslash (bo'laklab: har chaqiriq qisqa)
--
-- Moslash qoidasi: reestrdagi savdo nomi katalogdagi nom bilan boshlanadi
-- ("СЕНА-МИГ Таблетки … №20" ↔ "СЕНА-МИГ"); bir nechta nomzod bo'lsa —
-- ATX mosligi, qadoqdagi son (№), ishlab chiqaruvchi o'xshashligi, amaldagisi.
-- Ishlab chiqaruvchi ikkala tomonda bo'lsa-yu umuman o'xshamasa — moslanmaydi.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) drug_registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drug_registry (
  id           bigserial PRIMARY KEY,
  import_id    uuid NOT NULL,
  reg_number   text,
  product_type text NOT NULL DEFAULT 'drug',
  trade_name   text NOT NULL,
  generic_name text,
  atc_code     text,
  manufacturer text,
  country      text,
  release_form text,
  dosage       text,
  reg_date     date,
  valid_until  date,
  is_active    boolean,
  rx_required  boolean,
  raw          jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  trade_norm   text GENERATED ALWAYS AS (public.clary_search_norm(trade_name)) STORED,
  trade_first  text GENERATED ALWAYS AS (split_part(public.clary_search_norm(trade_name), ' ', 1)) STORED,
  mfr_norm     text GENERATED ALWAYS AS (public.clary_search_norm(manufacturer)) STORED,
  CONSTRAINT drug_registry_type_chk CHECK (product_type IN ('drug', 'device'))
);
CREATE INDEX IF NOT EXISTS idx_drug_registry_import ON public.drug_registry (import_id);
CREATE INDEX IF NOT EXISTS idx_drug_registry_first ON public.drug_registry (import_id, trade_first);

COMMENT ON TABLE public.drug_registry IS
  'Davlat reestri (uzpharm-control) — super admin yuklagan oxirgi Excel. drug_reference bilan moslanadi.';

ALTER TABLE public.drug_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.drug_registry FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- B) Xavfsiz sana: noto'g'ri qiymat → NULL (import to'xtamaydi)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clary_try_date(p text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN p::date;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- C) Import qatorlari
-- ---------------------------------------------------------------------------
-- p_rows: [{ reg_number?, product_type?, trade_name, generic_name?, atc_code?,
--            manufacturer?, country?, release_form?, dosage?, reg_date? (YYYY-MM-DD),
--            valid_until?, is_active?, rx_required?, raw? }]
CREATE OR REPLACE FUNCTION public.drug_registry_import_rows(p_import uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_import IS NULL THEN
    RAISE EXCEPTION 'import_id kerak';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;
  INSERT INTO drug_registry
    (import_id, reg_number, product_type, trade_name, generic_name, atc_code, manufacturer,
     country, release_form, dosage, reg_date, valid_until, is_active, rx_required, raw)
  SELECT p_import,
         NULLIF(left(btrim(r->>'reg_number'), 100), ''),
         CASE WHEN r->>'product_type' = 'device' THEN 'device' ELSE 'drug' END,
         left(btrim(r->>'trade_name'), 500),
         NULLIF(left(btrim(r->>'generic_name'), 300), ''),
         NULLIF(upper(left(btrim(r->>'atc_code'), 10)), ''),
         NULLIF(left(btrim(r->>'manufacturer'), 300), ''),
         NULLIF(left(btrim(r->>'country'), 100), ''),
         NULLIF(left(btrim(r->>'release_form'), 300), ''),
         NULLIF(left(btrim(r->>'dosage'), 200), ''),
         clary_try_date(r->>'reg_date'),
         clary_try_date(r->>'valid_until'),
         CASE WHEN r->>'is_active' IN ('true', 'false') THEN (r->>'is_active')::boolean END,
         CASE WHEN r->>'rx_required' IN ('true', 'false') THEN (r->>'rx_required')::boolean END,
         CASE WHEN jsonb_typeof(r->'raw') = 'object' THEN r->'raw' END
    FROM jsonb_array_elements(p_rows) AS r
   WHERE NULLIF(btrim(r->>'trade_name'), '') IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- D) Moslash
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drug_registry_reset_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE drug_reference
     SET reg_number = NULL, reg_active = NULL, reg_country = NULL, reg_manufacturer = NULL,
         rx_required = NULL, reg_matched_at = NULL
   WHERE reg_matched_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Bitta bo'lak: MXIK kodi p_prefix bilan boshlanadigan katalog yozuvlari.
-- API sinf kodlari bo'yicha (masalan 030040…030049) ketma-ket chaqiradi.
CREATE OR REPLACE FUNCTION public.drug_registry_match(p_import uuid, p_prefix text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_prefix IS NULL OR p_prefix !~ '^[0-9]{1,17}$' THEN
    RAISE EXCEPTION 'Noto''g''ri prefiks: %', p_prefix;
  END IF;

  WITH cand AS (
    SELECT DISTINCT ON (d.mxik_code)
           d.mxik_code, g.reg_number, g.is_active, g.valid_until, g.country,
           g.manufacturer, g.rx_required
      FROM drug_reference d
      JOIN drug_registry g
        ON g.import_id = p_import
       AND g.trade_first = split_part(d.name_norm, ' ', 1)
       AND (g.trade_norm = d.name_norm OR g.trade_norm LIKE d.name_norm || ' %')
     WHERE d.mxik_code LIKE p_prefix || '%'
       AND d.kind IN ('drug', 'device')
       AND length(d.name_norm) >= 3
       AND (d.mfr_norm = '' OR g.mfr_norm = ''
            OR word_similarity(d.mfr_norm, g.mfr_norm) >= 0.4
            OR similarity(d.mfr_norm, g.mfr_norm) >= 0.3)
     ORDER BY d.mxik_code,
              (g.atc_code IS NOT NULL AND g.atc_code = d.atc_code) DESC,
              (substring(g.trade_norm FROM ' n ([0-9]+)') = d.pack_qty::text) DESC,
              word_similarity(d.mfr_norm, g.mfr_norm) DESC,
              g.is_active DESC NULLS LAST,
              g.valid_until DESC NULLS LAST,
              g.id DESC
  )
  UPDATE drug_reference d
     SET reg_number       = c.reg_number,
         reg_active       = COALESCE(c.is_active, c.valid_until IS NULL OR c.valid_until >= current_date),
         reg_country      = c.country,
         reg_manufacturer = c.manufacturer,
         rx_required      = c.rx_required,
         reg_matched_at   = now()
    FROM cand c
   WHERE d.mxik_code = c.mxik_code;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Yakun: eski importlar o'chiriladi, natija qaytadi.
CREATE OR REPLACE FUNCTION public.drug_registry_finish(p_import uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM drug_registry WHERE import_id = p_import;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Import bo''sh yoki topilmadi: %', p_import;
  END IF;
  DELETE FROM drug_registry WHERE import_id <> p_import;
  RETURN jsonb_build_object(
    'rows',         v_rows,
    'rows_active',  (SELECT count(*) FROM drug_registry WHERE import_id = p_import AND is_active IS TRUE),
    'matched',      (SELECT count(*) FROM drug_reference WHERE reg_matched_at IS NOT NULL),
    'reg_active',   (SELECT count(*) FROM drug_reference WHERE reg_active IS TRUE),
    'reg_inactive', (SELECT count(*) FROM drug_reference WHERE reg_active IS FALSE),
    'rx_required',  (SELECT count(*) FROM drug_reference WHERE rx_required IS TRUE)
  );
END;
$$;

-- Yarim qolgan (tugallanmagan) importni tozalash
CREATE OR REPLACE FUNCTION public.drug_registry_discard(p_import uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM drug_registry WHERE import_id = p_import;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.clary_try_date(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_registry_import_rows(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_registry_reset_matches() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_registry_match(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_registry_finish(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drug_registry_discard(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.clary_try_date(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_registry_import_rows(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_registry_reset_matches() TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_registry_match(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_registry_finish(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.drug_registry_discard(uuid) TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drug_registry TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.drug_registry_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
