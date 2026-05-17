-- =============================================================================
-- BUG fix — diagnostic_equipment.name NOT NULL buzilishi
-- =============================================================================
-- Muammo: 20260423000010_catalog.sql `name TEXT NOT NULL` yaratgan.
-- 20260424001000_expansion_core.sql `name_i18n` qo'shgan, lekin eski `name`
-- ustunini olib tashlamagan. Backend faqat name_i18n yuboradi → name NULL
-- qoladi → "null value in column name violates not-null constraint".
--
-- Yechim: mavjud yozuvlarda name'ni name_i18n'dan to'ldirib, NOT NULL
-- cheklovini olib tashlash. Backend ham endi name'ni yozadi (zaxira sifatida).

-- 1) Mavjud bo'sh name'larni name_i18n'dan to'ldirish
UPDATE diagnostic_equipment
   SET name = COALESCE(
     NULLIF(name, ''),
     name_i18n->>'uz-Latn',
     name_i18n->>'uz',
     name_i18n->>'ru',
     name_i18n->>'en',
     'Diagnostika apparati'
   )
 WHERE name IS NULL OR name = '';

-- 2) NOT NULL cheklovini olib tashlash — name_i18n asosiy manba bo'ldi,
--    name esa endi ixtiyoriy zaxira (legacy).
ALTER TABLE diagnostic_equipment
  ALTER COLUMN name DROP NOT NULL;

COMMENT ON COLUMN diagnostic_equipment.name IS
  'Legacy zaxira nom. Asosiy nom — name_i18n (JSONB, ko''p tilli). '
  'Backend ikkalasini ham yozadi; yangi kod name_i18n''dan o''qiydi.';
