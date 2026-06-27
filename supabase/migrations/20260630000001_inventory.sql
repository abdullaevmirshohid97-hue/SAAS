-- =============================================================================
-- Pillar 3 — Umumiy inventar (lab reagent / consumable / xo'jalik). Dorixonadan
-- MUSTAQIL modul; pharmacy batch/FEFO/supplier-ledger patternini ko'chiradi.
-- GL: kirim -> Dr 1400 Inventory / Cr 2100 AP ; sarf -> Dr 5100 / Cr 1400.
-- Triggerlar EXCEPTION-SAFE (GL xatosi asosiy operatsiyani bloklamaydi).
-- =============================================================================

-- 1) Jadvallar -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'consumable' CHECK (category IN ('reagent','consumable','household','other')),
  unit text NOT NULL DEFAULT 'dona',
  reorder_level int NOT NULL DEFAULT 0,
  cost_uzs bigint NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_items_clinic ON public.inventory_items (clinic_id) WHERE is_archived = false;

DROP TRIGGER IF EXISTS tg_inv_items_updated ON public.inventory_items;
CREATE TRIGGER tg_inv_items_updated BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.inventory_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id),
  receipt_no text NOT NULL,
  received_at date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  total_cost_uzs bigint NOT NULL DEFAULT 0,
  paid_uzs bigint NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_receipts_clinic ON public.inventory_receipts (clinic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id),
  batch_no text,
  expiry_date date,
  unit_cost_uzs bigint NOT NULL DEFAULT 0,
  qty_received int NOT NULL,
  qty_remaining int NOT NULL,
  receipt_id uuid REFERENCES public.inventory_receipts(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);
-- FEFO indeks — eng erta muddat birinchi
CREATE INDEX IF NOT EXISTS idx_inv_batches_fefo
  ON public.inventory_batches (clinic_id, item_id, expiry_date) WHERE qty_remaining > 0;

CREATE TABLE IF NOT EXISTS public.inventory_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.inventory_receipts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  quantity int NOT NULL,
  unit_cost_uzs bigint NOT NULL DEFAULT 0,
  total_cost_uzs bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inv_receipt_items_receipt ON public.inventory_receipt_items (receipt_id);

CREATE TABLE IF NOT EXISTS public.inventory_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  kind text NOT NULL CHECK (kind IN ('in','out','adjust')),
  quantity int NOT NULL,
  unit_cost_uzs bigint NOT NULL DEFAULT 0,
  reason text,
  batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  performed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_moves_item ON public.inventory_stock_movements (clinic_id, item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_supplier_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id),
  entry_kind text NOT NULL CHECK (entry_kind IN ('purchase','payment','debt','adjustment')),
  amount_uzs bigint NOT NULL,
  payment_method text,
  invoice_no text,
  receipt_id uuid REFERENCES public.inventory_receipts(id) ON DELETE SET NULL,
  occurred_at date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_supl_clinic ON public.inventory_supplier_ledger (clinic_id, occurred_at DESC);

-- 2) Stok xulosa view ------------------------------------------------------
CREATE OR REPLACE VIEW public.inventory_stock_summary AS
  SELECT i.clinic_id, i.id AS item_id, i.name, i.category, i.unit, i.reorder_level,
    COALESCE(sum(b.qty_remaining), 0)::bigint AS qty_in_stock,
    COALESCE(sum(b.qty_remaining * b.unit_cost_uzs), 0)::bigint AS stock_value_uzs,
    min(b.expiry_date) AS earliest_expiry,
    count(*) FILTER (WHERE b.qty_remaining > 0 AND b.expiry_date <= (CURRENT_DATE + INTERVAL '90 days')) AS batches_expiring_soon
  FROM public.inventory_items i
  LEFT JOIN public.inventory_batches b ON b.item_id = i.id AND b.qty_remaining > 0
  WHERE i.is_archived = false
  GROUP BY i.clinic_id, i.id, i.name, i.category, i.unit, i.reorder_level;

-- 3) FEFO atomik sarf RPC --------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_consume(
  p_clinic uuid, p_user uuid, p_item uuid, p_qty int, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_remaining int := p_qty; v_avail bigint; b RECORD; v_take int;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Miqdor musbat bo''lishi kerak'; END IF;
  SELECT COALESCE(sum(qty_remaining), 0) INTO v_avail
    FROM inventory_batches WHERE clinic_id = p_clinic AND item_id = p_item AND qty_remaining > 0;
  IF v_avail < p_qty THEN RAISE EXCEPTION 'Zaxira yetarli emas (mavjud: %)', v_avail; END IF;
  FOR b IN SELECT * FROM inventory_batches
    WHERE clinic_id = p_clinic AND item_id = p_item AND qty_remaining > 0
    ORDER BY expiry_date ASC NULLS LAST, received_at ASC LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, b.qty_remaining);
    UPDATE inventory_batches SET qty_remaining = qty_remaining - v_take WHERE id = b.id;
    INSERT INTO inventory_stock_movements (clinic_id, item_id, kind, quantity, unit_cost_uzs, reason, batch_id, performed_by)
      VALUES (p_clinic, p_item, 'out', v_take, b.unit_cost_uzs, p_reason, b.id, p_user);
    v_remaining := v_remaining - v_take;
  END LOOP;
END; $$;

-- 4) GL ulanishi -----------------------------------------------------------
-- 4a) COA'ga 5100 (Materiallar/Reagent xarajati) qo'shish
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
    (p_clinic, '5000', 'Umumiy xarajat', 'expense'),
    (p_clinic, '5100', 'Materiallar/Reagent xarajati', 'expense')
  ON CONFLICT (clinic_id, code) DO NOTHING;
$$;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT id FROM clinics LOOP PERFORM seed_chart_of_accounts(c.id); END LOOP;
END $$;

-- 4b) inventory_supplier_ledger -> GL (kirim = 1400/2100, to'lov = 2100/kassa)
CREATE OR REPLACE FUNCTION public.gl_post_inventory_ledger(s public.inventory_supplier_ledger)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amt bigint; v_cash text;
BEGIN
  v_amt := ABS(s.amount_uzs);
  IF v_amt = 0 THEN RETURN; END IF;
  IF s.entry_kind = 'purchase' THEN
    PERFORM post_journal(s.clinic_id, 'inv_purchase', s.occurred_at, 'inventory_supplier_ledger', s.id, 'Inventar kirim',
      jsonb_build_array(
        jsonb_build_object('code','1400','debit',v_amt,'credit',0),
        jsonb_build_object('code','2100','debit',0,'credit',v_amt)));
  ELSIF s.entry_kind = 'payment' THEN
    v_cash := gl_cash_code(COALESCE(s.payment_method,'cash'), 'cash_drawer');
    PERFORM post_journal(s.clinic_id, 'inv_supplier_payment', s.occurred_at, 'inventory_supplier_ledger', s.id, 'Inventar supplierga to''lov',
      jsonb_build_array(
        jsonb_build_object('code','2100','debit',v_amt,'credit',0),
        jsonb_build_object('code',v_cash,'debit',0,'credit',v_amt)));
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_gl_inv_supl() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_inventory_ledger(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL inv_supl % xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_inv_supl ON public.inventory_supplier_ledger;
CREATE TRIGGER gl_after_inv_supl AFTER INSERT ON public.inventory_supplier_ledger FOR EACH ROW EXECUTE FUNCTION trg_gl_inv_supl();

-- 4c) inventory_stock_movements (sarf 'out') -> GL: Dr 5100 / Cr 1400
CREATE OR REPLACE FUNCTION public.gl_post_inventory_movement(m public.inventory_stock_movements)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amt bigint;
BEGIN
  IF m.kind <> 'out' THEN RETURN; END IF;
  v_amt := ABS(m.quantity) * COALESCE(m.unit_cost_uzs, 0);
  IF v_amt = 0 THEN RETURN; END IF;
  PERFORM post_journal(m.clinic_id, 'inventory_use', m.created_at::date, 'inventory_stock_movements', m.id, COALESCE(m.reason,'Material sarfi'),
    jsonb_build_array(
      jsonb_build_object('code','5100','debit',v_amt,'credit',0),
      jsonb_build_object('code','1400','debit',0,'credit',v_amt)));
END; $$;

CREATE OR REPLACE FUNCTION public.trg_gl_inv_move() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_inventory_movement(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL inv_move % xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_inv_move ON public.inventory_stock_movements;
CREATE TRIGGER gl_after_inv_move AFTER INSERT ON public.inventory_stock_movements FOR EACH ROW EXECUTE FUNCTION trg_gl_inv_move();

-- 5) RLS — barcha amallar API service_role orqali --------------------------
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_supplier_ledger ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.inventory_items, public.inventory_receipts, public.inventory_batches,
  public.inventory_receipt_items, public.inventory_stock_movements, public.inventory_supplier_ledger
  FROM anon, authenticated;
REVOKE SELECT ON public.inventory_stock_summary FROM anon, authenticated;
