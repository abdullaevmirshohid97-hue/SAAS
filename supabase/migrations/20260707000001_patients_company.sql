-- =============================================================================
-- QISM 0 / F0.3 (schema) — Cross-branch bemor: patients.company_id.
-- Bemor kompaniyaga tegishli (filiallar aro tarix). ADDITIVE + avto-to'ldirish.
-- O'qish-scoping API'da (patients anon/auth SELECT revoke — faqat service_role).
-- =============================================================================
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- Backfill: filialdan kompaniya
UPDATE public.patients p
  SET company_id = c.company_id
  FROM public.clinics c
  WHERE c.id = p.clinic_id AND p.company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_patients_company ON public.patients (company_id);

-- Yangi bemorlar company_id'ni filialdan avtomatik oladi
CREATE OR REPLACE FUNCTION public.tg_patient_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id FROM clinics WHERE id = NEW.clinic_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tg_patients_company ON public.patients;
CREATE TRIGGER tg_patients_company BEFORE INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION tg_patient_company();
