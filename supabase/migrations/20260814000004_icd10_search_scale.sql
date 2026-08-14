-- =============================================================================
-- search_icd10 — to'liq lug'atga (~14 000 kod) tayyorlash
-- =============================================================================
-- Hozir 152 kod bor va qidiruv ~40 ms. Lug'at kengaygach ikki muammo chiqadi:
--   1) `code ILIKE 'j06%'` prefiks qidiruvi indeksdan foydalanmaydi
--      (ILIKE registrga bog'liq emas, btree esa bog'liq).
--   2) `similarity()` har bir mos qator uchun hisoblanadi.
-- Va eng muhimi — UX: 14 000 kod ichida shifokorga avval TEZ-TEZ
-- uchraydiganlari chiqishi kerak, hozir `is_common` saralashda umuman
-- ishlatilmaydi.
--
-- Kodlar bazada katta harfda (152/152 tekshirildi), shuning uchun prefiks
-- qidiruvini `code LIKE upper(q)` ga o'tkazamiz va btree indeks qo'shamiz.

-- Prefiks qidiruvi uchun (J06, A09...). text_pattern_ops — LIKE 'x%' uchun.
CREATE INDEX IF NOT EXISTS idx_icd10_code_prefix
  ON icd10_codes (code text_pattern_ops);

-- Tez-tez uchraydiganlarni oldinga chiqarish uchun.
CREATE INDEX IF NOT EXISTS idx_icd10_common
  ON icd10_codes (is_common)
  WHERE is_common;

CREATE OR REPLACE FUNCTION public.search_icd10(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE(code text, name_uz text, name_ru text, name_en text, category character)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT lower(btrim(p_query)) AS s, upper(btrim(p_query)) AS s_up
  )
  SELECT c.code, c.name_uz, c.name_ru, c.name_en, c.category
    FROM icd10_codes c, q
   WHERE c.search_text ILIKE '%' || q.s || '%'
      OR c.code LIKE q.s_up || '%'
   ORDER BY
     -- 1) aniq kod mosligi, 2) kod prefiksi, 3) qolgani
     CASE WHEN c.code = q.s_up THEN 0
          WHEN c.code LIKE q.s_up || '%' THEN 1
          ELSE 2 END,
     -- Tez-tez uchraydigan tashxis yuqorida — 14 000 kod ichida hal qiluvchi
     c.is_common DESC,
     similarity(c.search_text, q.s) DESC,
     c.code
   LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.search_icd10(text, integer) IS
  'ICD-10 qidiruv: aniq kod > kod prefiksi > tez-tez uchraydigan > o''xshashlik.';
