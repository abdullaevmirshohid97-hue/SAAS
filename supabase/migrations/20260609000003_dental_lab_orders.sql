-- =============================================================================
-- Clary v2 — Migration 20260609000003: Dental lab orders (laboratoriya buyurtmalari)
-- Protez/koronka/ko'prik/implant/vinir/kappa uchun tashqi laboratoriya ish oqimi:
-- buyurtma berildi → jarayonda → tayyor → topshirildi (+ bekor).
-- Davolash rejasi/bandiga ixtiyoriy bog'lanadi; tish raqamlari jsonb massiv.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dental_lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES dental_treatment_plans(id) ON DELETE SET NULL,
  item_id UUID REFERENCES dental_treatment_items(id) ON DELETE SET NULL,
  doctor_id UUID REFERENCES profiles(id),
  lab_name TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'other' CHECK (order_type IN (
    'crown','bridge','denture','implant_crown','inlay_onlay','veneer','aligner','other'
  )),
  tooth_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  shade TEXT,
  material TEXT,
  price_uzs BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN (
    'ordered','in_progress','ready','delivered','canceled'
  )),
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dental_lab_orders_patient
  ON dental_lab_orders(clinic_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dental_lab_orders_status
  ON dental_lab_orders(clinic_id, status);

DROP TRIGGER IF EXISTS tg_dental_lab_orders_updated ON dental_lab_orders;
CREATE TRIGGER tg_dental_lab_orders_updated BEFORE UPDATE ON dental_lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE dental_lab_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dental_lab_orders_tenant ON dental_lab_orders;
CREATE POLICY p_dental_lab_orders_tenant ON dental_lab_orders
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE dental_lab_orders IS 'Stomatologiya laboratoriya buyurtmalari (protez/koronka/implant ish oqimi)';
