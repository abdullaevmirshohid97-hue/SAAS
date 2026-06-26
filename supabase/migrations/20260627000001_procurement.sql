-- =============================================================================
-- Procurement (Pillar 2, Odoo) — Purchase Order workflow + GL integratsiya.
-- PO = rejalashtirish/tasdiq/qabul-nazorat qatlami. Qabul mavjud pharmacy
-- receipt oqimini qayta ishlatadi. GL ulanishi: pharmacy_supplier_ledger ustidagi
-- BITTA trigger (xarid -> Inventory/AP, to'lov -> AP/Kassa). Dorixona kodi o'zgarmaydi.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id),
  po_no text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','partial','received','cancelled')),
  ordered_at date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  expected_at date,
  subtotal_uzs bigint NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_clinic ON public.purchase_orders (clinic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  medication_id uuid REFERENCES public.medications(id),
  name_snapshot text NOT NULL,
  qty_ordered int NOT NULL,
  unit_cost_uzs bigint NOT NULL DEFAULT 0,
  qty_received int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items (po_id);

ALTER TABLE public.pharmacy_receipts ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES public.purchase_orders(id);

-- GL: hisoblar rejasiga 1400 Inventory qo'shish (mavjud funksiyani yangilash)
CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_clinic uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chart_of_accounts (clinic_id, code, name, type) VALUES
    (p_clinic, '1010', 'Kassa', 'asset'),
    (p_clinic, '1020', 'Seyf', 'asset'),
    (p_clinic, '1030', 'Bank / Plastik', 'asset'),
    (p_clinic, '1200', 'Bemor qarzi (AR)', 'asset'),
    (p_clinic, '1400', 'Tovar-moddiy zaxira (Inventory)', 'asset'),
    (p_clinic, '2100', 'Yetkazib beruvchi qarzi (AP)', 'liability'),
    (p_clinic, '2300', 'QQS to''lov', 'liability'),
    (p_clinic, '3000', 'Kapital', 'equity'),
    (p_clinic, '4000', 'Xizmat daromadi', 'income'),
    (p_clinic, '4100', 'Dorixona daromadi', 'income'),
    (p_clinic, '5000', 'Umumiy xarajat', 'expense')
  ON CONFLICT (clinic_id, code) DO NOTHING;
$$;
-- Mavjud klinikalarga 1400 qo'shish
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT id FROM clinics LOOP PERFORM seed_chart_of_accounts(c.id); END LOOP;
END $$;

-- pharmacy_supplier_ledger -> GL (xarid = Inventory/AP, to'lov = AP/Kassa)
CREATE OR REPLACE FUNCTION public.gl_post_supplier_ledger(s public.pharmacy_supplier_ledger)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amt bigint; v_cash text;
BEGIN
  v_amt := ABS(s.amount_uzs);
  IF v_amt = 0 THEN RETURN; END IF;
  IF s.entry_kind = 'purchase' THEN
    PERFORM post_journal(s.clinic_id, 'purchase', s.occurred_at, 'pharmacy_supplier_ledger', s.id, 'Xarid (kirim)',
      jsonb_build_array(
        jsonb_build_object('code','1400','debit',v_amt,'credit',0),
        jsonb_build_object('code','2100','debit',0,'credit',v_amt)));
  ELSIF s.entry_kind = 'payment' THEN
    v_cash := gl_cash_code(COALESCE(s.payment_method,'cash'), 'cash_drawer');
    PERFORM post_journal(s.clinic_id, 'supplier_payment', s.occurred_at, 'pharmacy_supplier_ledger', s.id, 'Supplierga to''lov',
      jsonb_build_array(
        jsonb_build_object('code','2100','debit',v_amt,'credit',0),
        jsonb_build_object('code',v_cash,'debit',0,'credit',v_amt)));
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_gl_supl() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_supplier_ledger(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL supplier_ledger % xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_supl ON public.pharmacy_supplier_ledger;
CREATE TRIGGER gl_after_supl AFTER INSERT ON public.pharmacy_supplier_ledger FOR EACH ROW EXECUTE FUNCTION trg_gl_supl();

-- Backfill mavjud supplier ledger -> GL
DO $$ DECLARE s public.pharmacy_supplier_ledger; BEGIN
  FOR s IN SELECT * FROM pharmacy_supplier_ledger LOOP PERFORM gl_post_supplier_ledger(s); END LOOP;
END $$;

-- RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.purchase_orders, public.purchase_order_items FROM anon, authenticated;
