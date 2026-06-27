-- =============================================================================
-- Sug'urta — insurance_providers'ga API kalit (markaziy integratsiya konfiguratsiyasi).
-- integration_mode + api_base allaqachon bor; faqat maxfiy kalit qo'shiladi.
-- Faqat super-admin (service_role) o'qiydi — RLS anon/authenticated revoke qilingan.
-- =============================================================================
ALTER TABLE public.insurance_providers ADD COLUMN IF NOT EXISTS api_key text;
