-- =============================================================================
-- sales_leads.email — NOT NULL cheklovini bo'shatish
-- =============================================================================
-- Instant demo lidlari faqat ism + telefon bilan keladi (email ixtiyoriy).
-- Telefon-birinchi lidlar uchun email majburiy bo'lmasligi kerak.
ALTER TABLE public.sales_leads ALTER COLUMN email DROP NOT NULL;
