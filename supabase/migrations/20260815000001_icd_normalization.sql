-- =============================================================================
-- ICD-10 + ICD-11 normalizatsiya
-- =============================================================================
-- Muammo: icd10_codes yagona tizim edi, doctor_icd_usage.code unga QATTIQ FK
-- bilan bog'langan. ICD-11 (WHO 2022 MMS) tuzilishi ICD-10 dan tubdan farq
-- qiladi — bitta jadvalga majburlab sig'dirish noto'g'ri bo'lardi.
--
-- YECHIM: ikkita alohida jadval (har biri o'z tuzilishida), ustiga umumiy
-- qidiruv qatlami. icd10_codes ga TEGILMAYDI — mavjud 152 kod, search_icd10
-- RPC, ICD-10 picker hammasi ishlashda davom etadi.
--
-- ICD-11 jadvali BO'SH bo'lib qoladi: WHO ICD-11 ma'lumotini o'ylab topib
-- bo'lmaydi (tibbiy ma'lumot — noto'g'ri kod xavfli). Haqiqiy ma'lumot
-- WHO ICD-11 API (icd.who.int/icdapi, bepul ro'yxatdan o'tish) orqali
-- yuklanadi — alohida ish, D4 (ICD-10 to'liq lug'ati) bilan bir xil holat.
--
-- ORQAGA QAYTARISH: scripts/rollback-20260815-icd-normalization.sql

-- ── 1) ICD-11 jadvali ────────────────────────────────────────────────────
-- WHO MMS tuzilishi: stem kod (asosiy tashxis) + ixtiyoriy extension kodlar
-- (postcoordination — masalan joylashuv, og'irlik darajasi). V1 uchun faqat
-- STEM kodlar — extension kodlar keyingi bosqich, ular alohida jadval talab
-- qiladi (bitta tashxis bir nechta extension bilan birga kelishi mumkin).
CREATE TABLE IF NOT EXISTS icd11_codes (
  code          TEXT PRIMARY KEY,       -- MMS kod, masalan '1A00'
  title_uz      TEXT,
  title_ru      TEXT,
  title_en      TEXT NOT NULL,
  chapter       TEXT NOT NULL,          -- MMS bob nomi (ICD-10 'chapter' bilan bir xil rol)
  parent_code   TEXT REFERENCES icd11_codes(code) ON DELETE SET NULL,
  is_stem       BOOLEAN NOT NULL DEFAULT true,   -- stem vs extension (v1: hammasi stem)
  foundation_uri TEXT,                  -- WHO Foundation entity URI — kelajakda API sync uchun
  search_text   TEXT NOT NULL,          -- lower(title_uz||title_ru||title_en||code)
  is_common     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_icd11_search_trgm
  ON icd11_codes USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_icd11_code_prefix
  ON icd11_codes (code text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_icd11_common
  ON icd11_codes (is_common) WHERE is_common;
CREATE INDEX IF NOT EXISTS idx_icd11_chapter
  ON icd11_codes (chapter);

COMMENT ON TABLE icd11_codes IS
  'WHO ICD-11 MMS stem kodlari. V1: postcoordination/extension kodlar yo''q. Boshlang''ich holatda BO''SH — haqiqiy ma''lumot WHO ICD-11 API dan yuklanadi.';

-- ── 2) doctor_icd_usage — ikkala tizimga ochish ─────────────────────────
-- Standart 'icd10' — mavjud qatorlarning barchasi ICD-10 kodlari.
ALTER TABLE doctor_icd_usage
  ADD COLUMN IF NOT EXISTS code_system TEXT NOT NULL DEFAULT 'icd10';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doctor_icd_usage_code_system_chk'
  ) THEN
    ALTER TABLE doctor_icd_usage
      ADD CONSTRAINT doctor_icd_usage_code_system_chk
      CHECK (code_system IN ('icd10', 'icd11'));
  END IF;
END $$;

-- Qattiq FK'ni OLIB TASHLAYMIZ — bitta ustun ikkita jadvaldan biriga FK
-- bo'la olmaydi. O'rniga trigger bilan validatsiya (pastda) — xuddi shu
-- qat'iylik, faqat ikkala tizimni qo'llab-quvvatlaydi.
ALTER TABLE doctor_icd_usage
  DROP CONSTRAINT IF EXISTS doctor_icd_usage_code_fkey;

CREATE OR REPLACE FUNCTION public.check_doctor_icd_usage_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.code_system = 'icd10' THEN
    IF NOT EXISTS (SELECT 1 FROM icd10_codes WHERE code = NEW.code) THEN
      RAISE EXCEPTION 'ICD-10 kodi topilmadi: %', NEW.code;
    END IF;
  ELSIF NEW.code_system = 'icd11' THEN
    IF NOT EXISTS (SELECT 1 FROM icd11_codes WHERE code = NEW.code) THEN
      RAISE EXCEPTION 'ICD-11 kodi topilmadi: %', NEW.code;
    END IF;
  ELSE
    RAISE EXCEPTION 'Noma''lum kod tizimi: %', NEW.code_system;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_doctor_icd_usage_check_code ON doctor_icd_usage;
CREATE TRIGGER trg_doctor_icd_usage_check_code
  BEFORE INSERT OR UPDATE OF code, code_system ON doctor_icd_usage
  FOR EACH ROW EXECUTE FUNCTION public.check_doctor_icd_usage_code();

CREATE INDEX IF NOT EXISTS idx_doctor_icd_usage_system
  ON doctor_icd_usage (user_id, code_system);

COMMENT ON COLUMN doctor_icd_usage.code_system IS
  'icd10 | icd11 — qaysi tizimga tegishli. Trigger orqali validatsiya (FK emas, chunki ikkita manba jadvali bor).';

-- ── 3) Umumiy qidiruv — ikkala tizim bo'yicha ────────────────────────────
-- p_system: NULL yoki 'all' = ikkalasi, 'icd10' | 'icd11' = faqat biri.
CREATE OR REPLACE FUNCTION public.search_diagnosis_codes(
  p_query  TEXT,
  p_system TEXT DEFAULT 'all',
  p_limit  INTEGER DEFAULT 20
)
RETURNS TABLE(
  code_system TEXT,
  code        TEXT,
  title_uz    TEXT,
  title_ru    TEXT,
  title_en    TEXT,
  chapter     TEXT
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT lower(btrim(p_query)) AS s, upper(btrim(p_query)) AS s_up
  ),
  icd10_hits AS (
    SELECT 'icd10'::text AS code_system, c.code, c.name_uz AS title_uz,
           c.name_ru AS title_ru, c.name_en AS title_en, c.chapter,
           CASE WHEN c.code = (SELECT s_up FROM q) THEN 0
                WHEN c.code LIKE (SELECT s_up FROM q) || '%' THEN 1
                ELSE 2 END AS rank,
           c.is_common,
           similarity(c.search_text, (SELECT s FROM q)) AS sim
      FROM icd10_codes c, q
     WHERE (p_system IN ('all', 'icd10'))
       AND (c.search_text ILIKE '%' || q.s || '%' OR c.code LIKE q.s_up || '%')
  ),
  icd11_hits AS (
    SELECT 'icd11'::text AS code_system, c.code, c.title_uz,
           c.title_ru, c.title_en, c.chapter,
           CASE WHEN c.code = (SELECT s_up FROM q) THEN 0
                WHEN c.code LIKE (SELECT s_up FROM q) || '%' THEN 1
                ELSE 2 END AS rank,
           c.is_common,
           similarity(c.search_text, (SELECT s FROM q)) AS sim
      FROM icd11_codes c, q
     WHERE (p_system IN ('all', 'icd11'))
       AND (c.search_text ILIKE '%' || q.s || '%' OR c.code LIKE q.s_up || '%')
  )
  SELECT code_system, code, title_uz, title_ru, title_en, chapter
    FROM (SELECT * FROM icd10_hits UNION ALL SELECT * FROM icd11_hits) all_hits
   ORDER BY rank, is_common DESC, sim DESC, code
   LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.search_diagnosis_codes(TEXT, TEXT, INTEGER) IS
  'ICD-10 va ICD-11 bo''yicha umumiy qidiruv. p_system: all|icd10|icd11.';

REVOKE ALL ON FUNCTION public.search_diagnosis_codes(TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_diagnosis_codes(TEXT, TEXT, INTEGER)
  TO service_role;
