-- Statsionar bemoriga qaragan shifokor almashtirish tarixi.
-- changeDoctor endpoint shu jadvalga INSERT qiladi (transfer pattern bilan
-- bir xil). Journal feed fetchDoctorChanges() shu yerdan o'qiydi.

CREATE TABLE IF NOT EXISTS public.inpatient_doctor_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id),
  stay_id uuid NOT NULL REFERENCES public.inpatient_stays(id) ON DELETE CASCADE,
  from_doctor_id uuid REFERENCES public.profiles(id),
  to_doctor_id uuid REFERENCES public.profiles(id),
  reason text,
  changed_by uuid REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idc_clinic_time
  ON public.inpatient_doctor_changes(clinic_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_idc_stay
  ON public.inpatient_doctor_changes(stay_id);

-- RLS — inpatient_transfers pattern'i bilan bir xil
ALTER TABLE public.inpatient_doctor_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p_idc_tenant"
  ON public.inpatient_doctor_changes
  FOR ALL
  USING ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'::text))
  WITH CHECK ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'::text));
