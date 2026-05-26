-- Seyfga qo'lda pul qo'shish (manual deposit).
-- Encashment'dan tashqari (masalan, klinika egasi eski naqdni keltirsa).
-- Edit/delete imkoniyati bilan (soft delete is_void).

CREATE TABLE IF NOT EXISTS public.safe_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id),
  amount_uzs bigint NOT NULL CHECK (amount_uzs > 0),
  reason text NOT NULL,
  recorded_by uuid REFERENCES public.profiles(id),
  is_void boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safe_deposits_clinic_time
  ON public.safe_deposits(clinic_id, created_at DESC)
  WHERE is_void = false;

ALTER TABLE public.safe_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p_safe_deposits_tenant"
  ON public.safe_deposits
  FOR ALL
  USING ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'::text))
  WITH CHECK ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'::text));

COMMENT ON TABLE public.safe_deposits IS 'Seyfga qo''lda pul qo''shish — encashment dan tashqari kirim';
