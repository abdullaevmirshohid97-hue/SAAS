-- =============================================================================
-- Clary v2 — Migration 60: Pharmacy — FIFO batches + dispense support
--   * medication_batches (batch_no, expiry, unit_cost, qty_received, qty_remaining)
--   * pharmacy_receipts (prihot — goods-in docs with supplier + total cost)
--   * pharmacy_receipt_items
--   * enhanced pharmacy_sales: prescription_id, debt_uzs, patient_ledger link
--   * view: medication_stock_view — aggregates total/low/expiring
-- =============================================================================

-- Medication batches (FIFO) — each goods-in creates one batch
CREATE TABLE IF NOT EXISTS medication_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id),
  supplier_id UUID REFERENCES suppliers(id),
  batch_no TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expiry_date DATE,
  unit_cost_uzs BIGINT NOT NULL DEFAULT 0,
  unit_price_uzs BIGINT,                        -- optional override for this batch
  qty_received INT NOT NULL,
  qty_remaining INT NOT NULL,
  receipt_id UUID,
  notes TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  CHECK (qty_remaining >= 0),
  CHECK (qty_remaining <= qty_received)
);
CREATE INDEX IF NOT EXISTS idx_med_batches_clinic_med
  ON medication_batches(clinic_id, medication_id, received_at)
  WHERE qty_remaining > 0;
CREATE INDEX IF NOT EXISTS idx_med_batches_expiry
  ON medication_batches(clinic_id, expiry_date)
  WHERE qty_remaining > 0 AND expiry_date IS NOT NULL;

DROP TRIGGER IF EXISTS tg_med_batches_updated ON medication_batches;
CREATE TRIGGER tg_med_batches_updated
  BEFORE UPDATE ON medication_batches
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE medication_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_med_batches_tenant ON medication_batches;
CREATE POLICY p_med_batches_tenant ON medication_batches
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- Pharmacy receipts (prihot)
CREATE TABLE IF NOT EXISTS pharmacy_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  receipt_no TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_cost_uzs BIGINT NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS tg_pharm_receipts_updated ON pharmacy_receipts;
CREATE TRIGGER tg_pharm_receipts_updated
  BEFORE UPDATE ON pharmacy_receipts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE pharmacy_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pharm_receipts_tenant ON pharmacy_receipts;
CREATE POLICY p_pharm_receipts_tenant ON pharmacy_receipts
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- back-ref medication_batches.receipt_id
ALTER TABLE medication_batches
  DROP CONSTRAINT IF EXISTS fk_med_batches_receipt;
ALTER TABLE medication_batches
  ADD CONSTRAINT fk_med_batches_receipt
  FOREIGN KEY (receipt_id) REFERENCES pharmacy_receipts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS pharmacy_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  receipt_id UUID NOT NULL REFERENCES pharmacy_receipts(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id),
  batch_id UUID REFERENCES medication_batches(id),
  quantity INT NOT NULL,
  unit_cost_uzs BIGINT NOT NULL,
  total_cost_uzs BIGINT NOT NULL,
  batch_no TEXT,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pharmacy_receipt_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pharm_receipt_items_tenant ON pharmacy_receipt_items;
CREATE POLICY p_pharm_receipt_items_tenant ON pharmacy_receipt_items
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- Enhance pharmacy_sales with prescription + debt support
ALTER TABLE pharmacy_sales
  ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES prescriptions(id),
  ADD COLUMN IF NOT EXISTS debt_uzs BIGINT NOT NULL DEFAULT 0;

-- Extended sale items: batch tracking
ALTER TABLE pharmacy_sale_items
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES medication_batches(id),
  ADD COLUMN IF NOT EXISTS unit_cost_snapshot BIGINT;

-- -----------------------------------------------------------------------------
-- FIFO: allocate quantity across batches & update stock
-- Returns JSON array [{ batch_id, quantity, unit_cost }]
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pharmacy_allocate_fifo(
  p_clinic UUID,
  p_medication UUID,
  p_quantity INT
) RETURNS JSONB AS $$
DECLARE
  v_remaining INT := p_quantity;
  v_batch RECORD;
  v_take INT;
  v_result JSONB := '[]'::jsonb;
  v_total_avail INT;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;

  SELECT COALESCE(SUM(qty_remaining), 0) INTO v_total_avail
  FROM medication_batches
  WHERE clinic_id = p_clinic AND medication_id = p_medication AND qty_remaining > 0;

  IF v_total_avail < p_quantity THEN
    RAISE EXCEPTION 'insufficient stock: have %, need %', v_total_avail, p_quantity;
  END IF;

  FOR v_batch IN
    SELECT id, qty_remaining, unit_cost_uzs
      FROM medication_batches
     WHERE clinic_id = p_clinic
       AND medication_id = p_medication
       AND qty_remaining > 0
     ORDER BY COALESCE(expiry_date, '9999-12-31'::date) ASC, received_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.qty_remaining, v_remaining);
    UPDATE medication_batches SET qty_remaining = qty_remaining - v_take WHERE id = v_batch.id;
    v_result := v_result || jsonb_build_object(
      'batch_id', v_batch.id,
      'quantity', v_take,
      'unit_cost', v_batch.unit_cost_uzs
    );
    v_remaining := v_remaining - v_take;
  END LOOP;

  -- Update medications.stock aggregate
  UPDATE medications
     SET stock = stock - p_quantity
   WHERE id = p_medication AND clinic_id = p_clinic;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Medication stock summary view (clinic dashboard)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW medication_stock_summary AS
SELECT
  m.clinic_id,
  m.id AS medication_id,
  m.name,
  m.form,
  m.price_uzs,
  m.reorder_level,
  COALESCE(SUM(mb.qty_remaining), 0)::BIGINT                                               AS qty_in_stock,
  COALESCE(SUM(mb.qty_remaining * mb.unit_cost_uzs), 0)::BIGINT                            AS stock_value_uzs,
  MIN(mb.expiry_date)                                                                      AS earliest_expiry,
  COUNT(*) FILTER (WHERE mb.qty_remaining > 0 AND mb.expiry_date <= CURRENT_DATE + INTERVAL '90 days') AS batches_expiring_soon
FROM medications m
LEFT JOIN medication_batches mb ON mb.medication_id = m.id AND mb.qty_remaining > 0
WHERE m.is_archived = false
GROUP BY m.clinic_id, m.id, m.name, m.form, m.price_uzs, m.reorder_level;
