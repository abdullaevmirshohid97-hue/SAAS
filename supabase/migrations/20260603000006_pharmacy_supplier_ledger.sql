-- =============================================================================
-- Clary v2 — Migration: Dorixona yetkazib beruvchi (firma) oldi-berdi ledgeri
--
-- Firmalar `suppliers` jadvalida (mavjud). Oldi-berdi (credit/debit) uchun yagona
-- daftar — pharmacy_supplier_ledger. amount_uzs ISHORALI:
--   purchase/debt = +  (biz firmaga qarzdor bo'lamiz)
--   payment       = −  (pul berdik, qarz kamayadi)
--   adjustment    = ±
-- Balans (biz firmaga qarzdormiz) = Σ amount_uzs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pharmacy_supplier_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  entry_kind text NOT NULL CHECK (entry_kind IN ('purchase','payment','debt','adjustment')),
  amount_uzs bigint NOT NULL,
  payment_method text,
  invoice_no text,
  receipt_id uuid,
  occurred_at date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharm_supplier_ledger_sup ON pharmacy_supplier_ledger(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pharm_supplier_ledger_clinic ON pharmacy_supplier_ledger(clinic_id);

-- RLS (tenant) — mavjud naqsh
ALTER TABLE pharmacy_supplier_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY pharmacy_supplier_ledger_tenant_select ON pharmacy_supplier_ledger FOR SELECT
  USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
CREATE POLICY pharmacy_supplier_ledger_tenant_insert ON pharmacy_supplier_ledger FOR INSERT
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
CREATE POLICY pharmacy_supplier_ledger_tenant_update ON pharmacy_supplier_ledger FOR UPDATE
  USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin())
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());
CREATE POLICY pharmacy_supplier_ledger_tenant_delete ON pharmacy_supplier_ledger FOR DELETE
  USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());

-- Backfill: mavjud prixotlar → 'purchase' (+total) va to'langan bo'lsa 'payment' (−paid)
INSERT INTO pharmacy_supplier_ledger (clinic_id, supplier_id, entry_kind, amount_uzs, invoice_no, receipt_id, occurred_at, notes, created_by)
SELECT r.clinic_id, r.supplier_id, 'purchase', r.total_cost_uzs, r.receipt_no, r.id,
       (r.received_at AT TIME ZONE 'Asia/Tashkent')::date, 'Backfill: prixot', r.created_by
FROM pharmacy_receipts r
WHERE r.supplier_id IS NOT NULL;

INSERT INTO pharmacy_supplier_ledger (clinic_id, supplier_id, entry_kind, amount_uzs, invoice_no, receipt_id, occurred_at, notes, created_by)
SELECT r.clinic_id, r.supplier_id, 'payment', -r.paid_uzs, r.receipt_no, r.id,
       (r.received_at AT TIME ZONE 'Asia/Tashkent')::date, 'Backfill: prixotda to''langan', r.created_by
FROM pharmacy_receipts r
WHERE r.supplier_id IS NOT NULL AND COALESCE(r.paid_uzs, 0) > 0;
