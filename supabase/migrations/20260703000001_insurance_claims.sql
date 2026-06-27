-- =============================================================================
-- Sug'urta — Faza B: Claims + Settlement + GL.
--   insurance_claims: insurer qoplaydigan qism (Dr 1210 Insurer AR / Cr 4000).
--   insurance_settlements + allocations: insurer to'lovi (Dr kassa/Cr 1210),
--     writeoff (Dr 5200/Cr 1210).
-- Triggerlar EXCEPTION-SAFE — checkout/kassa oqimini bloklamaydi.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.insurance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid REFERENCES public.insurance_companies(id),
  provider_id uuid REFERENCES public.insurance_providers(id),
  patient_id uuid REFERENCES public.patients(id),
  transaction_id uuid REFERENCES public.transactions(id),
  claim_no text NOT NULL,
  claim_amount_uzs bigint NOT NULL DEFAULT 0,
  copay_amount_uzs bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','partial','paid','denied')),
  submitted_at timestamptz,
  paid_amount_uzs bigint NOT NULL DEFAULT 0,
  paid_at timestamptz,
  denial_reason text,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ins_claims_clinic ON public.insurance_claims (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ins_claims_insurer ON public.insurance_claims (insurer_id);
CREATE INDEX IF NOT EXISTS idx_ins_claims_status ON public.insurance_claims (clinic_id, status);

CREATE TABLE IF NOT EXISTS public.insurance_claim_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES public.insurance_claims(id) ON DELETE CASCADE,
  transaction_item_id uuid REFERENCES public.transaction_items(id),
  service_id uuid REFERENCES public.services(id),
  name_snapshot text,
  covered_amount_uzs bigint NOT NULL DEFAULT 0,
  copay_amount_uzs bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ins_claim_items_claim ON public.insurance_claim_items (claim_id);

CREATE TABLE IF NOT EXISTS public.insurance_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  insurer_id uuid REFERENCES public.insurance_companies(id),
  amount_uzs bigint NOT NULL,
  method text NOT NULL DEFAULT 'transfer' CHECK (method IN ('cash','card','transfer','bank','writeoff')),
  settled_at date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ins_settle_clinic ON public.insurance_settlements (clinic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.insurance_settlement_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES public.insurance_settlements(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES public.insurance_claims(id),
  amount_uzs bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ins_alloc_settle ON public.insurance_settlement_allocations (settlement_id);
CREATE INDEX IF NOT EXISTS idx_ins_alloc_claim ON public.insurance_settlement_allocations (claim_id);

-- GL: claim -> Dr 1210 (Insurer AR) / Cr 4000 (daromad)
CREATE OR REPLACE FUNCTION public.gl_post_insurance_claim(c public.insurance_claims)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amt bigint;
BEGIN
  v_amt := c.claim_amount_uzs;
  IF v_amt = 0 THEN RETURN; END IF;
  PERFORM post_journal(c.clinic_id, 'insurance_claim', c.created_at::date, 'insurance_claims', c.id, 'Sug''urta da''vo',
    jsonb_build_array(
      jsonb_build_object('code','1210','debit',v_amt,'credit',0),
      jsonb_build_object('code','4000','debit',0,'credit',v_amt)));
END; $$;

CREATE OR REPLACE FUNCTION public.trg_gl_ins_claim() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_insurance_claim(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL ins_claim % xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_ins_claim ON public.insurance_claims;
CREATE TRIGGER gl_after_ins_claim AFTER INSERT ON public.insurance_claims FOR EACH ROW EXECUTE FUNCTION trg_gl_ins_claim();

-- GL: settlement allocation -> Dr kassa(yoki 5200 writeoff) / Cr 1210
CREATE OR REPLACE FUNCTION public.gl_post_insurance_alloc(a public.insurance_settlement_allocations)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amt bigint; v_method text; v_cash text;
BEGIN
  v_amt := ABS(a.amount_uzs);
  IF v_amt = 0 THEN RETURN; END IF;
  SELECT method INTO v_method FROM insurance_settlements WHERE id = a.settlement_id;
  IF v_method = 'writeoff' THEN
    PERFORM post_journal(a.clinic_id, 'insurance_writeoff', CURRENT_DATE, 'insurance_settlement_allocations', a.id, 'Sug''urta chegirma/komissiya',
      jsonb_build_array(
        jsonb_build_object('code','5200','debit',v_amt,'credit',0),
        jsonb_build_object('code','1210','debit',0,'credit',v_amt)));
  ELSE
    v_cash := gl_cash_code(COALESCE(v_method,'transfer'), 'cash_drawer');
    PERFORM post_journal(a.clinic_id, 'insurance_settlement', CURRENT_DATE, 'insurance_settlement_allocations', a.id, 'Sug''urta to''lovi',
      jsonb_build_array(
        jsonb_build_object('code',v_cash,'debit',v_amt,'credit',0),
        jsonb_build_object('code','1210','debit',0,'credit',v_amt)));
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_gl_ins_alloc() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_insurance_alloc(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL ins_alloc % xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_ins_alloc ON public.insurance_settlement_allocations;
CREATE TRIGGER gl_after_ins_alloc AFTER INSERT ON public.insurance_settlement_allocations FOR EACH ROW EXECUTE FUNCTION trg_gl_ins_alloc();

-- RLS
ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_settlement_allocations ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.insurance_claims, public.insurance_claim_items,
  public.insurance_settlements, public.insurance_settlement_allocations FROM anon, authenticated;
