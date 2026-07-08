-- =============================================================================
-- Laboratoriya normasi — bolalar uchun alohida referens diapazon.
-- lab_tests'da erkak/ayol normasi bor edi; bolalar (18 yoshgacha) uchun qo'shildi.
-- Natija PDF/public sahifada bemor yoshiga qarab tegishli norma ko'rsatiladi.
-- =============================================================================

ALTER TABLE public.lab_tests
  ADD COLUMN IF NOT EXISTS reference_range_child text;
