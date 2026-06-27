-- =============================================================================
-- P0 bugfix — 2 ta jonli xato (additive).
--   1) home_nurse_requests'ga yetishmagan ustunlar (assignNurse/completeTask
--      yozadi: assigned_at, quoted_price_uzs, scheduled_times, sessions_per_day,
--      days_count). `assigned_nurse_profile_id` prod'da allaqachon bor va
--      profiles(id)'ga FK (hamshira = profiles role='nurse'). Embed kodi
--      `profiles!assigned_nurse_profile_id` ga tuzatildi (staff_profiles emas).
--   2) 4 ta katalog jadvaliga `sort_order` (catalog-factory `.order('sort_order')`
--      barcha kataloglarga qo'llanadi; pattern = home_nurse_tariffs.sort_order).
-- =============================================================================

-- 1) Home-nurse: yetishmagan ustunlar (FK profiles'ga — yangi DB uchun) ------
ALTER TABLE public.home_nurse_requests
  ADD COLUMN IF NOT EXISTS assigned_nurse_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS quoted_price_uzs bigint,
  ADD COLUMN IF NOT EXISTS scheduled_times jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sessions_per_day int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS days_count int NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_hn_req_assigned_nurse
  ON public.home_nurse_requests (assigned_nurse_profile_id);

-- 2) Katalog: sort_order (4 jadval) ----------------------------------------
ALTER TABLE public.insurance_companies ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.referral_partners   ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.sms_templates       ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.email_templates     ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 3) PostgREST schema cache'ni yangilash (yangi FK darhol tanilsin) ---------
NOTIFY pgrst, 'reload schema';
