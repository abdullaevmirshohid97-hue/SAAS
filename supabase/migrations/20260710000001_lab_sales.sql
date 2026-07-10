-- =============================================================================
-- Laboratoriya — mustaqil sotuv (POS) maydonlari. Lab order = lab sotuv.
-- To'lov lab ichida saqlanadi; umumiy `transactions`/jurnal/kassaga TEGMAYDI
-- (izolyatsiya — lab o'z jurnali + o'z kassasi bilan boshqariladi).
-- =============================================================================

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_uzs      bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_uzs      bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_uzs  bigint NOT NULL DEFAULT 0,
  -- Xalqaro standart tashxis kodi (ixtiyoriy) — ICD-10.
  ADD COLUMN IF NOT EXISTS icd10_code    text;

-- Lab kassa/qarzdorlar hisobotlari uchun.
CREATE INDEX IF NOT EXISTS idx_lab_orders_clinic_debt
  ON public.lab_orders (clinic_id, debt_uzs);
