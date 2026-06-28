-- =============================================================================
-- Fix — tg_set_updated_at NEW.version'ni o'rnatadi, lekin bu jadvallarda version
-- ustuni yo'q edi → UPDATE triggerlari xato berardi. version qo'shamiz.
-- (e2e test fixed_assets UPDATE'da aniqladi.)
-- =============================================================================
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
ALTER TABLE public.insurance_providers ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
