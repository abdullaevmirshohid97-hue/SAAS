-- Sprint 1.1: platform_payments.notes ustuni
-- Manba: admin-extras.service.ts plan o'zgartirish va broadcast'da `.notes` field bilan insert qiladi.
-- Hozirgi schema'da bu ustun yo'q, shuning uchun Supabase schema cache xato beradi.

ALTER TABLE platform_payments
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN platform_payments.notes IS
  'Free-form admin note attached to a manual platform-side payment adjustment (plan change, broadcast charge, etc.).';
