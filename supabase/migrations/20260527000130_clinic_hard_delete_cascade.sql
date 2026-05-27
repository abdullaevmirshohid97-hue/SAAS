-- Klinika hard-delete'ida to'siq bo'lib qoluvchi 2 ta FK ni CASCADE'ga aylantirish.

ALTER TABLE public.inpatient_doctor_changes
  DROP CONSTRAINT inpatient_doctor_changes_clinic_id_fkey,
  ADD CONSTRAINT inpatient_doctor_changes_clinic_id_fkey
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;

ALTER TABLE public.safe_deposits
  DROP CONSTRAINT safe_deposits_clinic_id_fkey,
  ADD CONSTRAINT safe_deposits_clinic_id_fkey
    FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
