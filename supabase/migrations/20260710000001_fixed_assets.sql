-- =============================================================================
-- QISM 2 / E2 — Fixed Assets (asosiy vositalar) + amortizatsiya.
--   fixed_assets: xarid narxi, foydali muddat, qoldiq qiymat, cost_center, QR.
--   Oylik amortizatsiya (straight-line): Dr 5300 / Cr 1590 (idempotent per oy).
--   COA: 1500 (Asosiy vositalar), 1590 (Jamg'arilgan amortizatsiya), 5300 (Amortizatsiya xarajati).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'equipment' CHECK (category IN ('equipment','computer','furniture','vehicle','building','other')),
  acquisition_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  cost_uzs bigint NOT NULL DEFAULT 0,
  residual_uzs bigint NOT NULL DEFAULT 0,
  useful_life_months int NOT NULL DEFAULT 60,
  method text NOT NULL DEFAULT 'straight_line',
  accumulated_depreciation_uzs bigint NOT NULL DEFAULT 0,
  cost_center_id uuid REFERENCES public.cost_centers(id),
  location text,
  qr_code text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','fully_depreciated','disposed')),
  disposed_at date,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_clinic ON public.fixed_assets (clinic_id, status);

DROP TRIGGER IF EXISTS tg_fixed_assets_updated ON public.fixed_assets;
CREATE TRIGGER tg_fixed_assets_updated BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.depreciation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  period date NOT NULL,
  amount_uzs bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period)
);

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depreciation_entries ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.fixed_assets, public.depreciation_entries FROM anon, authenticated;

-- COA: 1500/1590/5300 qo'shish
CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_clinic uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chart_of_accounts (clinic_id, code, name, type) VALUES
    (p_clinic, '1010', 'Kassa', 'asset'),
    (p_clinic, '1020', 'Seyf', 'asset'),
    (p_clinic, '1030', 'Bank / Plastik', 'asset'),
    (p_clinic, '1200', 'Bemor qarzi (AR)', 'asset'),
    (p_clinic, '1210', 'Sug''urta qarzi (Insurer AR)', 'asset'),
    (p_clinic, '1400', 'Tovar-moddiy zaxira (Inventory)', 'asset'),
    (p_clinic, '1500', 'Asosiy vositalar', 'asset'),
    (p_clinic, '1590', 'Jamg''arilgan amortizatsiya', 'asset'),
    (p_clinic, '2100', 'Yetkazib beruvchi qarzi (AP)', 'liability'),
    (p_clinic, '2200', 'Maosh to''lanadigan', 'liability'),
    (p_clinic, '2300', 'QQS to''lov', 'liability'),
    (p_clinic, '3000', 'Kapital', 'equity'),
    (p_clinic, '4000', 'Xizmat daromadi', 'income'),
    (p_clinic, '4100', 'Dorixona daromadi', 'income'),
    (p_clinic, '5000', 'Umumiy xarajat', 'expense'),
    (p_clinic, '5100', 'Materiallar/Reagent xarajati', 'expense'),
    (p_clinic, '5200', 'Sug''urta komissiya/chegirma', 'expense'),
    (p_clinic, '5300', 'Amortizatsiya xarajati', 'expense'),
    (p_clinic, '5400', 'Maosh xarajati', 'expense')
  ON CONFLICT (clinic_id, code) DO NOTHING;
$$;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT id FROM clinics LOOP PERFORM seed_chart_of_accounts(c.id); END LOOP;
END $$;

-- Oylik amortizatsiya (straight-line) — idempotent (asset+period unique)
CREATE OR REPLACE FUNCTION public.run_depreciation(p_clinic uuid, p_period date DEFAULT CURRENT_DATE)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_monthly bigint; v_remaining bigint; v_entry uuid; v_count int := 0;
        v_period date := date_trunc('month', p_period)::date;
BEGIN
  FOR a IN SELECT * FROM fixed_assets
    WHERE clinic_id = p_clinic AND status = 'active' AND useful_life_months > 0 LOOP
    IF EXISTS (SELECT 1 FROM depreciation_entries WHERE asset_id = a.id AND period = v_period) THEN CONTINUE; END IF;
    v_remaining := (a.cost_uzs - a.residual_uzs) - a.accumulated_depreciation_uzs;
    IF v_remaining <= 0 THEN UPDATE fixed_assets SET status = 'fully_depreciated' WHERE id = a.id; CONTINUE; END IF;
    v_monthly := LEAST(v_remaining, ROUND((a.cost_uzs - a.residual_uzs)::numeric / a.useful_life_months));
    IF v_monthly <= 0 THEN CONTINUE; END IF;
    INSERT INTO depreciation_entries (clinic_id, asset_id, period, amount_uzs)
      VALUES (p_clinic, a.id, v_period, v_monthly) RETURNING id INTO v_entry;
    PERFORM post_journal(p_clinic, 'depreciation', v_period, 'depreciation_entries', v_entry, 'Amortizatsiya: ' || a.name,
      jsonb_build_array(
        jsonb_build_object('code','5300','debit',v_monthly,'credit',0,'cost_center_id', COALESCE(a.cost_center_id::text,'')),
        jsonb_build_object('code','1590','debit',0,'credit',v_monthly)));
    UPDATE fixed_assets
      SET accumulated_depreciation_uzs = accumulated_depreciation_uzs + v_monthly,
          status = CASE WHEN accumulated_depreciation_uzs + v_monthly >= (cost_uzs - residual_uzs) THEN 'fully_depreciated' ELSE status END
      WHERE id = a.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;
