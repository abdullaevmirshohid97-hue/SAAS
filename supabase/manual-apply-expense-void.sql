-- =============================================================================
-- Clary v2 — Migration: expenses soft-delete (void)
--
-- voidExpense oldin .delete() bilan rasxotni butunlay o'chirardi — audit izi
-- yo'qolardi. transactions/pharmacy_sales jadvalidagi is_void patterniga mos
-- ravishda expenses jadvaliga soft-delete ustunlari qo'shiladi.
-- =============================================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS is_void   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES profiles(id);

-- Faol (void qilinmagan) rasxotlar bo'yicha so'rovlarni tezlashtirish
CREATE INDEX IF NOT EXISTS idx_expenses_clinic_active
  ON expenses(clinic_id, expense_date DESC)
  WHERE is_void = false;
