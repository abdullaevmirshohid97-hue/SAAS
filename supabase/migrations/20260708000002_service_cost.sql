-- =============================================================================
-- QISM 1 / F2 — Direct cost: xizmat tannarxi + sotuvda cost snapshot.
-- services.cost_uzs (to'g'ridan-to'g'ri tannarx) + transaction_items.cost_snapshot_uzs
-- (checkout'da qayd etiladi) → service profitability (daromad − tannarx).
-- Additive (default 0) — mavjud hisobotlar o'zgarmaydi.
-- =============================================================================
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS cost_uzs bigint NOT NULL DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES public.cost_centers(id);
ALTER TABLE public.transaction_items ADD COLUMN IF NOT EXISTS cost_snapshot_uzs bigint NOT NULL DEFAULT 0;
