-- =============================================================================
-- Clary v2 — Migration 80: Cashier extensions
--   * Add shift_id to expenses (so expenses can be reconciled per-shift)
--   * Add shift_id to pharmacy_sales (if missing)
--   * Index for KPIs
-- =============================================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id);

ALTER TABLE pharmacy_sales
  DROP CONSTRAINT IF EXISTS pharmacy_sales_shift_id_fkey;
ALTER TABLE pharmacy_sales
  ADD CONSTRAINT pharmacy_sales_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_clinic_created
  ON transactions(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_clinic_date
  ON expenses(clinic_id, expense_date DESC);
