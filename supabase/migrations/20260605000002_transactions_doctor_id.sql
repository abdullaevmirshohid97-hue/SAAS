-- Tranzaksiyaga bevosita shifokor bog'lash. Ilgari shifokor faqat appointment
-- orqali bilvosita edi; jurnal tahririda shifokorni almashtirish/o'chirish uchun
-- ishonchli manba kerak. Nullable — shifokorsiz tranzaksiya (masalan laborator).
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES profiles(id);

-- Eski yozuvlar uchun bir martalik backfill — appointment'dagi shifokordan.
UPDATE public.transactions t
   SET doctor_id = a.doctor_id
  FROM public.appointments a
 WHERE t.appointment_id = a.id
   AND t.doctor_id IS NULL
   AND a.doctor_id IS NOT NULL;
