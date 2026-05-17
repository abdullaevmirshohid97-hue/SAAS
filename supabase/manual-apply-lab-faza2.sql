-- =============================================================================
-- Laboratoriya moduli — FAZA 2: Namuna (tube) kuzatuvi + smart result entry
-- =============================================================================
-- Mavjud state machine (pending..delivered) buzilmaydi. Status enum'i FAZA 3'da
-- validatsiya bilan birga kengaytiriladi. Bu migratsiya faqat namuna kuzatuvi
-- va natija kiritishni boyitadi.

-- -----------------------------------------------------------------------------
-- 1) lab_samples — har buyurtma uchun probirka (tube) kuzatuvi
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  tube_id         TEXT NOT NULL,            -- inson o'qiy oladigan: LAB-26-000042
  barcode         TEXT NOT NULL,            -- Code128 uchun string (tube_id bilan bir xil)
  sample_type     TEXT NOT NULL DEFAULT 'blood'
                    CHECK (sample_type IN ('blood','urine','stool','swab','tissue','other')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','collected','received','rejected')),
  collected_at    TIMESTAMPTZ,
  collected_by    UUID REFERENCES profiles(id),
  received_at     TIMESTAMPTZ,
  rejected_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, tube_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_samples_order ON lab_samples(order_id);
CREATE INDEX IF NOT EXISTS idx_lab_samples_clinic ON lab_samples(clinic_id);
-- Scan tezligi uchun — barcode bo'yicha qidiruv
CREATE INDEX IF NOT EXISTS idx_lab_samples_barcode ON lab_samples(clinic_id, barcode);

ALTER TABLE lab_samples ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_samples_tenant ON lab_samples;
CREATE POLICY p_lab_samples_tenant ON lab_samples
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DROP TRIGGER IF EXISTS tg_lab_samples_updated ON lab_samples;
CREATE TRIGGER tg_lab_samples_updated
  BEFORE UPDATE ON lab_samples
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE lab_samples IS
  'Laboratoriya namunalari (probirka) — har buyurtmaga tube_id/barcode. '
  'Laborant barkodni skanerlab buyurtma va bemorni topadi (one-click workflow).';

-- -----------------------------------------------------------------------------
-- 2) lab_tube_seq — har klinika uchun ketma-ket tube raqami
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_tube_seq (
  clinic_id  UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  last_value BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE lab_tube_seq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_tube_seq_tenant ON lab_tube_seq;
CREATE POLICY p_lab_tube_seq_tenant ON lab_tube_seq
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- Keyingi tube raqamini atomik tarzda beradi (poyga holatisiz)
CREATE OR REPLACE FUNCTION next_lab_tube_no(p_clinic UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next BIGINT;
BEGIN
  INSERT INTO lab_tube_seq (clinic_id, last_value)
  VALUES (p_clinic, 1)
  ON CONFLICT (clinic_id)
  DO UPDATE SET last_value = lab_tube_seq.last_value + 1
  RETURNING last_value INTO v_next;
  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION next_lab_tube_no(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_lab_tube_no(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- 3) lab_results — smart entry uchun qo'shimcha ustunlar
-- -----------------------------------------------------------------------------
-- numeric_value: raqamli natija (trend grafik, abnormal aniqlash uchun)
-- loinc_code: natijani LOINC standartiga bog'laydi (HL7/FHIR/trend uchun)
-- flag: natija darajasi — normal / abnormal-low/high / critical-low/high
ALTER TABLE lab_results
  ADD COLUMN IF NOT EXISTS numeric_value NUMERIC,
  ADD COLUMN IF NOT EXISTS loinc_code TEXT REFERENCES loinc_tests(loinc_code),
  ADD COLUMN IF NOT EXISTS flag TEXT
    CHECK (flag IN ('normal','low','high','critical_low','critical_high'));

CREATE INDEX IF NOT EXISTS idx_lab_results_loinc ON lab_results(loinc_code);

COMMENT ON COLUMN lab_results.numeric_value IS
  'Raqamli natija qiymati (agar son bo''lsa) — trend grafik va abnormal '
  'aniqlash uchun. value matni asl ko''rinishni saqlaydi.';
COMMENT ON COLUMN lab_results.flag IS
  'Natija darajasi: normal / low / high / critical_low / critical_high. '
  'Smart entry referens diapazon asosida avtomatik belgilaydi.';
