-- =============================================================================
-- Clary v2 — Migration: Dorixona mijoz-klinikalari (B2B)
-- Dorixona 2-3 klinikaga sotadi. Mijoz-klinikalar dorixonaning o'z ro'yxati
-- (tenant klinikalardan mustaqil): klinika + shifokorlar + qarz daftari.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pharmacy_clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_person text,
  phone text,
  notes text,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS idx_pharm_clinics_clinic ON pharmacy_clinics(clinic_id);

CREATE TABLE IF NOT EXISTS pharmacy_clinic_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pharmacy_clinic_id uuid NOT NULL REFERENCES pharmacy_clinics(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_pharm_clinic_doctors_pc ON pharmacy_clinic_doctors(pharmacy_clinic_id);

-- Mijoz qarzi (receivable): charge / payment / refund / adjustment
CREATE TABLE IF NOT EXISTS pharmacy_clinic_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pharmacy_clinic_id uuid NOT NULL REFERENCES pharmacy_clinics(id) ON DELETE CASCADE,
  sale_id uuid,
  entry_kind text NOT NULL CHECK (entry_kind IN ('charge','payment','refund','adjustment')),
  amount_uzs bigint NOT NULL,
  payment_method text,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharm_clinic_ledger_pc ON pharmacy_clinic_ledger(pharmacy_clinic_id);

ALTER TABLE pharmacy_sales
  ADD COLUMN IF NOT EXISTS pharmacy_clinic_id uuid,
  ADD COLUMN IF NOT EXISTS pharmacy_doctor_id uuid;

ALTER TABLE pharmacy_sale_items
  ADD COLUMN IF NOT EXISTS doctor_share_uzs bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_uzs bigint NOT NULL DEFAULT 0;

-- RLS (tenant) — mavjud naqsh (get_my_clinic_id / is_super_admin)
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['pharmacy_clinics','pharmacy_clinic_doctors','pharmacy_clinic_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('CREATE POLICY %I_tenant_select ON %I FOR SELECT USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_tenant_insert ON %I FOR INSERT WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_tenant_update ON %I FOR UPDATE USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin()) WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_tenant_delete ON %I FOR DELETE USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin());', tbl, tbl);
  END LOOP;
END $$;
