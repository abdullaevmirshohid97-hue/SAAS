-- =============================================================================
-- Sug'urta — Faza C: insurer aging (qarzdorlik hisoboti) + eligibility cache.
--   insurer_aging: ochiq claim qoldig'i insurer bo'yicha, yosh-bucket.
--   insurer_patient_eligibility: bemor-polis cache (manual; kelajak: API).
-- =============================================================================

-- Eligibility cache (manual kiritish; kelajakda insurer API to'ldiradi) --------
CREATE TABLE IF NOT EXISTS public.insurer_patient_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  insurer_id uuid REFERENCES public.insurance_companies(id),
  policy_no text,
  enrolled_from date,
  enrolled_to date,
  max_benefit_used_uzs bigint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','api')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, patient_id, insurer_id)
);
CREATE INDEX IF NOT EXISTS idx_ins_elig_patient ON public.insurer_patient_eligibility (clinic_id, patient_id);

ALTER TABLE public.insurer_patient_eligibility ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.insurer_patient_eligibility FROM anon, authenticated;

-- Insurer aging — ochiq claim qoldig'i (claim_amount - paid) insurer bo'yicha
CREATE OR REPLACE FUNCTION public.insurer_aging(p_clinic uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(insurer_id uuid, insurer_name text, total_owed bigint,
              b0_30 bigint, b31_60 bigint, b61_90 bigint, b90_plus bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.insurer_id,
    COALESCE(ic.name, '—') AS insurer_name,
    SUM(c.claim_amount_uzs - c.paid_amount_uzs)::bigint AS total_owed,
    SUM(CASE WHEN (p_as_of - c.created_at::date) <= 30 THEN c.claim_amount_uzs - c.paid_amount_uzs ELSE 0 END)::bigint AS b0_30,
    SUM(CASE WHEN (p_as_of - c.created_at::date) BETWEEN 31 AND 60 THEN c.claim_amount_uzs - c.paid_amount_uzs ELSE 0 END)::bigint AS b31_60,
    SUM(CASE WHEN (p_as_of - c.created_at::date) BETWEEN 61 AND 90 THEN c.claim_amount_uzs - c.paid_amount_uzs ELSE 0 END)::bigint AS b61_90,
    SUM(CASE WHEN (p_as_of - c.created_at::date) > 90 THEN c.claim_amount_uzs - c.paid_amount_uzs ELSE 0 END)::bigint AS b90_plus
  FROM insurance_claims c
  LEFT JOIN insurance_companies ic ON ic.id = c.insurer_id
  WHERE c.clinic_id = p_clinic
    AND c.status IN ('submitted','approved','partial')
    AND c.claim_amount_uzs > c.paid_amount_uzs
    AND c.created_at::date <= p_as_of
  GROUP BY c.insurer_id, ic.name
  HAVING SUM(c.claim_amount_uzs - c.paid_amount_uzs) > 0;
$$;
