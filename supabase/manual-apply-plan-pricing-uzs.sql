-- =============================================================================
-- Clary v2 — Migration: tarif narxlari so'mda (UZS)
--
-- Oldin narxlar USD-da (price_usd_cents) edi. Endi so'mda ko'rsatiladi.
-- Eski *_usd_cents ustunlar qoladi (buzilmasin), lekin ishlatilmaydi.
-- staff_profiles'ga email — "ilovaga ruxsat ber" oqimi uchun.
-- =============================================================================

-- 1) plans — so'm narx ustunlari (sentsiz, to'g'ridan-to'g'ri so'm)
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS price_uzs        BIGINT,
  ADD COLUMN IF NOT EXISTS price_yearly_uzs BIGINT;

-- Oylik narx + yillik (oylik × 12 × 0.8 — 20% chegirma)
UPDATE plans SET price_uzs = 0,       price_yearly_uzs = 0        WHERE code = 'demo';
UPDATE plans SET price_uzs = 300000,  price_yearly_uzs = 2880000  WHERE code = '25pro';
UPDATE plans SET price_uzs = 600000,  price_yearly_uzs = 5760000  WHERE code = '50pro';
UPDATE plans SET price_uzs = 1500000, price_yearly_uzs = 14400000 WHERE code = '120pro';

COMMENT ON COLUMN plans.price_uzs IS 'Oylik narx so''mda (sentsiz).';
COMMENT ON COLUMN plans.price_yearly_uzs IS 'Yillik narx so''mda — oylik × 12 × 0.8.';

-- 2) staff_profiles — email (login akkaunt yaratishda kerak)
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN staff_profiles.email IS
  'Xodim emaili — "Ilovaga ruxsat ber" orqali login akkaunt yaratilganda ishlatiladi.';
