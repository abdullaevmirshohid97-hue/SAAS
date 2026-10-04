-- =============================================================================
-- DORIXONA 2.0 — poydevor (Faza 0 / 1 / 9)
-- =============================================================================
--   A) clary_search_norm(text)   — qidiruv kaliti (kirill ⇄ lotin, imlo variantlari).
--      ⚠️ packages/utils/src/search-norm.ts dagi searchNorm() bilan QADAMMA-QADAM bir xil.
--   B) clary_barcode_norm(text)  — shtrix-kod kaliti (GTIN-14). barcode.ts dagi
--      normalizeBarcode() bilan bir xil.
--   C) medications: birliklar (qadoq/blister/dona), MXIK, QQS, generic nom, search_text.
--   D) medication_barcodes        — bitta dorida bir nechta shtrix-kod (klinika ichida unikal).
--   E) medication_price_history   — narx tarixi (prixod bekor qilinsa narx qaytadi).
--   F) medication_stock_summary   — yangi ustunlar (sotiladigan qoldiq, birliklar, search_text).
--   G) pharmacy_search_medications — server qidiruvi (trigram + reyting).
--   H) pharmacy_set_pack_size      — "qadoqda nechta dona" + qoldiqni donaga o'tkazish.
--
-- HAMMASI QO'SHIMCHA (additive): eski kod o'zgarishsiz ishlayveradi — yangi
-- ustunlar default bilan, eski funksiyalar tegilmagan.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- A) Qidiruv normallashtirish
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clary_search_norm(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  s text := lower(coalesce(p, ''));
BEGIN
  s := replace(s, 'ё', 'yo');
  s := replace(s, 'ж', 'j');
  s := replace(s, 'ц', 'ts');
  s := replace(s, 'ч', 'ch');
  s := replace(s, 'ш', 'sh');
  s := replace(s, 'щ', 'sh');
  s := replace(s, 'ю', 'yu');
  s := replace(s, 'я', 'ya');
  s := replace(s, 'х', 'x');
  s := translate(s, 'абвгдезийклмнопрстуфыэўқғҳ', 'abvgdeziyklmnoprstufieoqgh');
  -- qattiq/yumshoq belgi va apostroflar o'chiriladi (to'ldiruvchisiz translate)
  s := translate(s, 'ъь''`ʻʼ‘’´', '');
  s := replace(s, '№', ' n ');
  s := replace(s, 'ch', '#');
  s := replace(s, 'ph', 'f');
  s := replace(s, 'ts', 's');
  s := replace(s, 'c', 's');
  s := replace(s, '#', 'ch');
  s := replace(s, 'x', 'ks');
  s := replace(s, 'w', 'v');
  s := replace(s, 'y', 'i');
  s := regexp_replace(s, '([0-9])([a-z])', '\1 \2', 'g');
  s := regexp_replace(s, '([a-z])([0-9])', '\1 \2', 'g');
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  s := regexp_replace(s, '([a-z])\1+', '\1', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  RETURN s;
END;
$$;

COMMENT ON FUNCTION public.clary_search_norm(text) IS
  'Qidiruv kaliti. packages/utils/src/search-norm.ts searchNorm() bilan bir xil bo''lishi SHART.';

-- ---------------------------------------------------------------------------
-- B) Shtrix-kod normallashtirish (GTIN-14)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clary_barcode_norm(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  s text := regexp_replace(coalesce(p, ''), '\s+', '', 'g');
  body text;
  total int := 0;
  i int;
  d int;
BEGIN
  IF s = '' THEN
    RETURN '';
  END IF;
  IF s ~ '^[0-9]+$' AND length(s) IN (8, 12, 13, 14) THEN
    body := left(s, length(s) - 1);
    FOR i IN 0 .. length(body) - 1 LOOP
      d := substr(body, length(body) - i, 1)::int;
      total := total + d * CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END;
    END LOOP;
    IF (10 - (total % 10)) % 10 = right(s, 1)::int THEN
      RETURN lpad(s, 14, '0');
    END IF;
  END IF;
  RETURN upper(s);
END;
$$;

-- ---------------------------------------------------------------------------
-- C) medications — birliklar, fiskal maydonlar, qidiruv
-- ---------------------------------------------------------------------------
ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS pack_qty          integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS blister_qty       integer,
  ADD COLUMN IF NOT EXISTS unit_name         text,
  ADD COLUMN IF NOT EXISTS pack_price_uzs    bigint,
  ADD COLUMN IF NOT EXISTS blister_price_uzs bigint,
  ADD COLUMN IF NOT EXISTS sell_by_unit      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mxik_code         text,
  ADD COLUMN IF NOT EXISTS package_code      text,
  ADD COLUMN IF NOT EXISTS vat_percent       numeric(5,2),
  ADD COLUMN IF NOT EXISTS generic_name      text;

ALTER TABLE public.medications DROP CONSTRAINT IF EXISTS medications_units_chk;
ALTER TABLE public.medications ADD CONSTRAINT medications_units_chk CHECK (
  pack_qty >= 1 AND pack_qty <= 10000
  AND (blister_qty IS NULL OR (blister_qty >= 1 AND blister_qty <= pack_qty))
);

COMMENT ON COLUMN public.medications.pack_qty IS
  'Bitta qadoqdagi asosiy birliklar (dona) soni. 1 = qadoq o''zi birlik (eski dorilar).';
COMMENT ON COLUMN public.medications.price_uzs IS
  '1 ta asosiy birlik (dona) narxi. Qadoq narxi = pack_price_uzs yoki price_uzs × pack_qty.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'medications' AND column_name = 'search_text'
  ) THEN
    ALTER TABLE public.medications
      ADD COLUMN search_text text GENERATED ALWAYS AS (
        public.clary_search_norm(
          coalesce(name, '') || ' ' || coalesce(strength, '') || ' ' || coalesce(form, '') || ' ' ||
          coalesce(manufacturer, '') || ' ' || coalesce(generic_name, '')
        )
      ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_medications_search_trgm
  ON public.medications USING gin (search_text gin_trgm_ops)
  WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_medications_mxik
  ON public.medications (clinic_id, mxik_code)
  WHERE mxik_code IS NOT NULL AND is_archived = false;

-- ---------------------------------------------------------------------------
-- D) medication_barcodes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medication_barcodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  medication_id uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  code          text NOT NULL,
  raw_code      text,
  kind          text NOT NULL DEFAULT 'manufacturer'
                CHECK (kind IN ('manufacturer', 'internal', 'supplier')),
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_medication_barcodes_code
  ON public.medication_barcodes (clinic_id, code);
CREATE INDEX IF NOT EXISTS idx_medication_barcodes_med
  ON public.medication_barcodes (medication_id);

ALTER TABLE public.medication_barcodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medication_barcodes FROM anon, authenticated;

-- Eski yozuvlar: medications.barcode → medication_barcodes
INSERT INTO public.medication_barcodes (clinic_id, medication_id, code, raw_code, kind)
SELECT m.clinic_id, m.id, public.clary_barcode_norm(m.barcode), m.barcode, 'manufacturer'
  FROM public.medications m
 WHERE m.barcode IS NOT NULL AND btrim(m.barcode) <> '' AND NOT m.is_archived
ON CONFLICT (clinic_id, code) DO NOTHING;

-- medications.barcode o'zgarsa jadvalga ham yoziladi (eski kod yo'llari — katalog,
-- dori formasi — uchun). HECH QACHON xato bermaydi: band kod bo'lsa jim o'tadi.
CREATE OR REPLACE FUNCTION public.tg_medications_barcode_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.barcode IS NOT NULL AND btrim(NEW.barcode) <> ''
     AND (TG_OP = 'INSERT' OR NEW.barcode IS DISTINCT FROM OLD.barcode) THEN
    BEGIN
      INSERT INTO medication_barcodes (clinic_id, medication_id, code, raw_code, kind, created_by)
      VALUES (NEW.clinic_id, NEW.id, clary_barcode_norm(NEW.barcode), NEW.barcode, 'manufacturer',
              COALESCE(NEW.updated_by, NEW.created_by))
      ON CONFLICT (clinic_id, code) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'medication_barcodes sync: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_medications_barcode_sync ON public.medications;
CREATE TRIGGER tg_medications_barcode_sync
  AFTER INSERT OR UPDATE OF barcode ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.tg_medications_barcode_sync();

-- ---------------------------------------------------------------------------
-- E) Narx tarixi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medication_price_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  medication_id      uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  old_price_uzs      bigint,
  new_price_uzs      bigint,
  old_pack_price_uzs bigint,
  new_pack_price_uzs bigint,
  source             text NOT NULL DEFAULT 'manual',
  receipt_id         uuid,
  changed_by         uuid REFERENCES public.profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_med_price_history_med
  ON public.medication_price_history (medication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_med_price_history_receipt
  ON public.medication_price_history (receipt_id) WHERE receipt_id IS NOT NULL;

ALTER TABLE public.medication_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medication_price_history FROM anon, authenticated;

-- Narx qayerdan o'zgargan bo'lsa ham (API, katalog, RPC) tarix yoziladi.
-- Manba RPC ichida `set_config('clary.price_source', ...)` bilan beriladi.
CREATE OR REPLACE FUNCTION public.tg_medications_price_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source  text := NULLIF(current_setting('clary.price_source', true), '');
  v_receipt text := NULLIF(current_setting('clary.receipt_id', true), '');
BEGIN
  IF NEW.price_uzs IS DISTINCT FROM OLD.price_uzs
     OR NEW.pack_price_uzs IS DISTINCT FROM OLD.pack_price_uzs THEN
    BEGIN
      INSERT INTO medication_price_history
        (clinic_id, medication_id, old_price_uzs, new_price_uzs, old_pack_price_uzs,
         new_pack_price_uzs, source, receipt_id, changed_by)
      VALUES
        (NEW.clinic_id, NEW.id, OLD.price_uzs, NEW.price_uzs, OLD.pack_price_uzs,
         NEW.pack_price_uzs, COALESCE(v_source, 'manual'),
         CASE WHEN v_receipt ~ '^[0-9a-f-]{36}$' THEN v_receipt::uuid END,
         NEW.updated_by);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'medication_price_history: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_medications_price_history ON public.medications;
CREATE TRIGGER tg_medications_price_history
  AFTER UPDATE OF price_uzs, pack_price_uzs ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.tg_medications_price_history();

-- ---------------------------------------------------------------------------
-- F) medication_stock_summary — yangi ustunlar OXIRIGA qo'shiladi
--    (CREATE OR REPLACE VIEW mavjud ustunlar tartibini saqlashni talab qiladi)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.medication_stock_summary AS
 SELECT m.clinic_id,
    m.id AS medication_id,
    m.name,
    m.form,
    m.price_uzs,
    m.reorder_level,
    COALESCE(sum(mb.qty_remaining), 0::bigint) AS qty_in_stock,
    COALESCE(sum(mb.qty_remaining * mb.unit_cost_uzs), 0::numeric)::bigint AS stock_value_uzs,
    min(mb.expiry_date) AS earliest_expiry,
    count(*) FILTER (WHERE mb.qty_remaining > 0 AND mb.expiry_date <= (CURRENT_DATE + '90 days'::interval)) AS batches_expiring_soon,
    m.barcode,
    m.manufacturer,
    COALESCE(sum(mb.qty_remaining) FILTER (
      WHERE mb.expiry_date IS NULL OR mb.expiry_date >= CURRENT_DATE), 0::bigint) AS qty_sellable,
    min(mb.expiry_date) FILTER (WHERE mb.expiry_date >= CURRENT_DATE) AS earliest_sellable_expiry,
    m.strength,
    m.pack_qty,
    m.blister_qty,
    m.unit_name,
    m.pack_price_uzs,
    m.blister_price_uzs,
    m.sell_by_unit,
    m.requires_prescription,
    m.search_text,
    m.mxik_code,
    m.vat_percent,
    m.cost_uzs,
    m.generic_name
   FROM medications m
     LEFT JOIN medication_batches mb ON mb.medication_id = m.id AND mb.qty_remaining > 0
  WHERE m.is_archived = false
  GROUP BY m.id;

-- ---------------------------------------------------------------------------
-- G) Server qidiruvi — reyting: shtrix-kod → nom boshi → so'z boshi → o'xshashlik
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_search_medications(
  p_clinic uuid,
  p_q text,
  p_limit integer DEFAULT 40
)
RETURNS SETOF public.medication_stock_summary
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := clary_search_norm(p_q);
  v_code text := clary_barcode_norm(p_q);
  v_lim  int  := LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
BEGIN
  IF v_norm = '' AND v_code = '' THEN
    RETURN QUERY
      SELECT * FROM medication_stock_summary s
       WHERE s.clinic_id = p_clinic
       ORDER BY s.name
       LIMIT v_lim;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT s.*
      FROM medication_stock_summary s
     WHERE s.clinic_id = p_clinic
       AND (
         s.search_text LIKE '%' || v_norm || '%'
         OR (v_norm <> '' AND s.search_text % v_norm)
         OR EXISTS (SELECT 1 FROM medication_barcodes b
                     WHERE b.clinic_id = p_clinic AND b.medication_id = s.medication_id
                       AND b.code = v_code)
         OR (s.barcode IS NOT NULL AND clary_barcode_norm(s.barcode) = v_code)
       )
     ORDER BY
       (EXISTS (SELECT 1 FROM medication_barcodes b
                 WHERE b.clinic_id = p_clinic AND b.medication_id = s.medication_id
                   AND b.code = v_code)) DESC,
       (s.search_text LIKE v_norm || '%') DESC,
       (s.search_text LIKE '% ' || v_norm || '%') DESC,
       similarity(s.search_text, v_norm) DESC,
       s.name
     LIMIT v_lim;
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_search_medications(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_search_medications(uuid, text, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- H) "Qadoqda nechta dona" — qoldiqni donaga o'tkazish
-- ---------------------------------------------------------------------------
-- p_convert_stock = true: hozirgi qoldiq QADOQDA yuritilgan (pack_qty = 1) va
-- endi donaga o'tadi. Shu dorining BUTUN tarixi (partiyalar, sotuvlar,
-- prixodlar, harakatlar, retseptlar, buyurtmalar) yangi birlikka bir
-- tranzaksiyada qayta hisoblanadi — qaytarish/bekor qilish keyin ham to'g'ri
-- ishlaydi. Summalar (subtotal, foyda, jami tannarx) O'ZGARMAYDI.
-- p_convert_stock = false: faqat son o'zgaradi (qoldiq allaqachon donada).
CREATE OR REPLACE FUNCTION public.pharmacy_set_pack_size(
  p_clinic uuid,
  p_user uuid,
  p_medication uuid,
  p_pack_qty integer,
  p_convert_stock boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_med RECORD;
  f int;
BEGIN
  IF p_pack_qty IS NULL OR p_pack_qty < 1 OR p_pack_qty > 10000 THEN
    RAISE EXCEPTION 'Qadoqdagi dona soni 1..10000 oralig''ida bo''lishi kerak';
  END IF;

  SELECT * INTO v_med FROM medications
   WHERE id = p_medication AND clinic_id = p_clinic
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dori topilmadi';
  END IF;

  IF NOT COALESCE(p_convert_stock, false) THEN
    UPDATE medications
       SET pack_qty = p_pack_qty,
           blister_qty = CASE WHEN blister_qty IS NOT NULL AND blister_qty > p_pack_qty THEN NULL ELSE blister_qty END,
           updated_by = p_user
     WHERE id = p_medication;
    RETURN jsonb_build_object('converted', false, 'pack_qty', p_pack_qty);
  END IF;

  IF COALESCE(v_med.pack_qty, 1) <> 1 THEN
    RAISE EXCEPTION 'Qoldiq allaqachon donada yuritilmoqda (qadoqda % dona). Faqat sonni o''zgartiring.',
      v_med.pack_qty;
  END IF;

  f := p_pack_qty;
  IF f = 1 THEN
    RETURN jsonb_build_object('converted', false, 'pack_qty', 1);
  END IF;

  PERFORM set_config('clary.price_source', 'pack_convert', true);

  UPDATE medication_batches
     SET qty_received = qty_received * f,
         qty_remaining = qty_remaining * f,
         unit_cost_uzs = ROUND(unit_cost_uzs::numeric / f),
         unit_price_uzs = CASE WHEN unit_price_uzs IS NULL THEN NULL ELSE ROUND(unit_price_uzs::numeric / f) END,
         doctor_share_bonus_uzs = ROUND(COALESCE(doctor_share_bonus_uzs, 0)::numeric / f)
   WHERE medication_id = p_medication AND clinic_id = p_clinic;

  UPDATE pharmacy_sale_items
     SET quantity = quantity * f,
         returned_qty = returned_qty * f,
         price_snapshot = ROUND(price_snapshot::numeric / f),
         unit_cost_snapshot = CASE WHEN unit_cost_snapshot IS NULL THEN NULL
                                   ELSE ROUND(unit_cost_snapshot::numeric / f) END
   WHERE medication_id = p_medication AND clinic_id = p_clinic;

  UPDATE pharmacy_receipt_items
     SET quantity = quantity * f,
         unit_cost_uzs = ROUND(unit_cost_uzs::numeric / f)
   WHERE medication_id = p_medication AND clinic_id = p_clinic;

  UPDATE pharmacy_stock_movements
     SET quantity = quantity * f,
         unit_cost_uzs = CASE WHEN unit_cost_uzs IS NULL THEN NULL ELSE ROUND(unit_cost_uzs::numeric / f) END
   WHERE medication_id = p_medication AND clinic_id = p_clinic;

  UPDATE prescription_items
     SET quantity = quantity * f,
         dispensed_qty = dispensed_qty * f,
         unit_price_snapshot = CASE WHEN unit_price_snapshot IS NULL THEN NULL
                                    ELSE ROUND(unit_price_snapshot::numeric / f) END
   WHERE medication_id = p_medication AND clinic_id = p_clinic;

  UPDATE purchase_order_items poi
     SET qty_ordered = poi.qty_ordered * f,
         qty_received = poi.qty_received * f,
         unit_cost_uzs = ROUND(poi.unit_cost_uzs::numeric / f)
    FROM purchase_orders po
   WHERE po.id = poi.po_id AND po.clinic_id = p_clinic AND poi.medication_id = p_medication;

  UPDATE medications
     SET pack_qty = f,
         stock = stock * f,
         pack_price_uzs = COALESCE(pack_price_uzs, price_uzs),
         price_uzs = ROUND(price_uzs::numeric / f),
         cost_uzs = CASE WHEN cost_uzs IS NULL THEN NULL ELSE ROUND(cost_uzs::numeric / f) END,
         reorder_level = CASE WHEN reorder_level IS NULL THEN NULL ELSE reorder_level * f END,
         updated_by = p_user
   WHERE id = p_medication;

  RETURN jsonb_build_object('converted', true, 'pack_qty', f);
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_set_pack_size(uuid, uuid, uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_set_pack_size(uuid, uuid, uuid, integer, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.tg_medications_barcode_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_medications_price_history() FROM PUBLIC, anon, authenticated;
