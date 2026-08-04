-- =============================================================================
-- ROLLBACK — MAGNUS smena backfill (2026-08-05)
-- =============================================================================
-- Nima qaytariladi: inkasatsiya tufayli MANFIY chiqqan 9 ta smenaning
-- cash_total_uzs / expected_cash_uzs qiymatlari backfill'dan OLDINGI holatga.
--
-- Eslatma:
--   • discrepancy_uzs — GENERATED ustun (actual − expected), o'zi qayta hisoblanadi.
--   • Bu faqat HISOBOT maydonlari. Pul harakati (transactions/expenses/payouts)
--     backfill'da ham, bu rollback'da ham TEGILMAYDI.
--   • Barcha 9 qatorda opening_cash_uzs = 0 edi, shuning uchun
--     expected_cash_uzs = cash_total_uzs.
--
-- Ishlatish: Supabase SQL Editor (prod: aoubdvlkcatbeifuysau) yoki MCP.
-- =============================================================================

BEGIN;

UPDATE shifts s
SET cash_total_uzs    = v.old_cash,
    expected_cash_uzs = v.old_cash
FROM (VALUES
  ('53114bc3-71b5-4b35-9257-7625009f1707'::uuid,  -6640000::bigint),  -- 2026-06-09
  ('38b3c69c-d395-4e07-b155-c7c4c6c40094'::uuid,  -5995000::bigint),  -- 2026-06-15
  ('a287e6dd-4dbb-46c7-87d4-8738d079653c'::uuid,  -6705000::bigint),  -- 2026-06-20
  ('172075f3-1847-48ee-8037-432c59459c5a'::uuid, -10055000::bigint),  -- 2026-06-27
  ('43b1e703-afc7-4053-b1cf-ebe51b4d2b69'::uuid, -17070000::bigint),  -- 2026-07-07
  ('2482598c-0b74-47fc-8ce1-37aa975b2c6d'::uuid,  -9755000::bigint),  -- 2026-07-13
  ('2da701c9-0547-4772-ad66-0c6a9a7ad1e3'::uuid,  -5650000::bigint),  -- 2026-07-20
  ('e8c78eff-967d-42b4-874c-eace2094d9b6'::uuid,  -5310000::bigint),  -- 2026-07-27
  ('d8391c7c-2b91-4f8e-b87b-2e29ba9eb095'::uuid,  -5650000::bigint)   -- 2026-08-04
) AS v(shift_id, old_cash)
WHERE s.id = v.shift_id
  AND s.clinic_id = '7e4ab36d-a750-43f6-8870-dd90a0d2da50';  -- MAGNUS

-- 9 qator o'zgarishi SHART. Boshqa son bo'lsa — ROLLBACK qiling.
SELECT id, opened_at::date AS kun, cash_total_uzs, expected_cash_uzs,
       actual_cash_uzs, discrepancy_uzs
FROM shifts
WHERE clinic_id = '7e4ab36d-a750-43f6-8870-dd90a0d2da50'
  AND id IN ('53114bc3-71b5-4b35-9257-7625009f1707','38b3c69c-d395-4e07-b155-c7c4c6c40094',
             'a287e6dd-4dbb-46c7-87d4-8738d079653c','172075f3-1847-48ee-8037-432c59459c5a',
             '43b1e703-afc7-4053-b1cf-ebe51b4d2b69','2482598c-0b74-47fc-8ce1-37aa975b2c6d',
             '2da701c9-0547-4772-ad66-0c6a9a7ad1e3','e8c78eff-967d-42b4-874c-eace2094d9b6',
             'd8391c7c-2b91-4f8e-b87b-2e29ba9eb095')
ORDER BY opened_at;

COMMIT;
