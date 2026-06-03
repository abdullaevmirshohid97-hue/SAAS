-- =============================================================================
-- Clary v2 — Migration: Dorixona prixot (kirim) kengaytmasi
--
-- medication_batches (partiya) ga prixot maydonlari:
--   profit_percent          — foyda foizi (sotuv narxi = tannarx * (1 + %/100))
--   doctor_share_percent    — doktor ulushi foizda (dori sotilganda)
--   doctor_share_bonus_uzs  — doktor ulushi bonus summada (alternativa)
--   manufacture_date        — ishlab chiqarilgan sana
--   manufacturer            — ishlab chiqaruvchi firma nomi
-- (received_at = yetkazuvchi olib kelgan sana; unit_price_uzs backend hisoblaydi.)
--
-- pharmacy_receipts.paid_uzs — yetkazib beruvchiga to'langan summa
--   (qarz = total_cost_uzs - paid_uzs).
-- =============================================================================

ALTER TABLE medication_batches
  ADD COLUMN IF NOT EXISTS profit_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doctor_share_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doctor_share_bonus_uzs bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manufacture_date date,
  ADD COLUMN IF NOT EXISTS manufacturer text;

ALTER TABLE pharmacy_receipts
  ADD COLUMN IF NOT EXISTS paid_uzs bigint NOT NULL DEFAULT 0;
