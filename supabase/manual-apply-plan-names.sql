-- ============================================================================
-- Plan nomlarini yangilash: Base / Pro / Enterprise
-- Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================
-- plans.code (enum) tegilmaydi — faqat ko'rinadigan plans.name o'zgaradi.

BEGIN;

UPDATE plans SET name = 'Base'       WHERE code = '25pro';
UPDATE plans SET name = 'Pro'        WHERE code = '50pro';
UPDATE plans SET name = 'Enterprise' WHERE code = '120pro';
UPDATE plans SET name = 'Demo'       WHERE code = 'demo';

COMMIT;

-- Tekshirish:
--   SELECT code, name, price_usd_cents/100 AS usd FROM plans ORDER BY sort_order;
--   demo   | Demo       | 0
--   25pro  | Base       | 25
--   50pro  | Pro        | 50
--   120pro | Enterprise | 120
