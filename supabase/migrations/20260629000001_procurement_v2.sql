-- =============================================================================
-- Procurement v2 (Faza 9 v2) — requisition→approval, supplier invoices (3-way
-- matching), auto-reorder opt-in. Mavjud purchase_orders/_items + GL trigger
-- ustiga additive qatlam. Dorixona/GL kodi o'zgarmaydi.
-- =============================================================================

-- 1) Requisitions (talab → tasdiq → draft PO) -------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  req_no text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','converted')),
  note text,
  requested_by uuid REFERENCES public.profiles(id),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  po_id uuid REFERENCES public.purchase_orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_preq_clinic ON public.purchase_requisitions (clinic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.purchase_requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  req_id uuid NOT NULL REFERENCES public.purchase_requisitions(id) ON DELETE CASCADE,
  medication_id uuid REFERENCES public.medications(id),
  name_snapshot text NOT NULL,
  qty int NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_preq_items_req ON public.purchase_requisition_items (req_id);

-- PO -> requisition bog'lanish
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES public.purchase_requisitions(id);

-- 2) Supplier invoices (3-way matching: PO ↔ GRN ↔ invoice) -----------------
CREATE TABLE IF NOT EXISTS public.supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id),
  po_id uuid REFERENCES public.purchase_orders(id),
  invoice_no text NOT NULL,
  invoice_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  amount_uzs bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','disputed','paid')),
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sinv_clinic ON public.supplier_invoices (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sinv_po ON public.supplier_invoices (po_id);

-- 3) Auto-reorder sozlamasi (opt-in — surprise PO bo'lmaydi) -----------------
CREATE TABLE IF NOT EXISTS public.procurement_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  auto_reorder_enabled boolean NOT NULL DEFAULT false,
  reorder_hour int NOT NULL DEFAULT 6,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4) RLS — barcha amallar API service_role orqali --------------------------
ALTER TABLE public.purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requisition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_settings ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.purchase_requisitions, public.purchase_requisition_items,
  public.supplier_invoices, public.procurement_settings FROM anon, authenticated;
