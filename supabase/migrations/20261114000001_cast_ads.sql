-- =============================================================================
-- Clary Cast — TV reklama videolari
--
--   A) queue_displays.mode — 'queue' (navbat + chaqiruvdan 15 s keyin reklama)
--      yoki 'ads' (faqat reklama ekrani).
--   B) cast_ad_videos — klinikaning reklama videolari (tartib, yoqilgan/o'chiq).
--      Yozish faqat API (service role) orqali: tarif limiti (soni + jami hajm)
--      serverda tekshiriladi, fayl brauzerdan imzolangan URL bilan yuklanadi.
--   C) 'cast-ads' storage bucket — ommaviy o'qish (TV login'siz ijro etadi),
--      yo'l: <clinic_id>/<uuid>.<ext> (taxmin qilib bo'lmaydi).
--   D) Tariflar: Starter 5 ta / 1 GB, Business 10 ta / 2 GB, Enterprise 30 ta /
--      3 GB (super-admin tarif muharririda o'zgartiriladi; platforma chegarasi
--      30 ta / 3 GB — API'da).
--
-- Faqat QO'SHIMCHA va idempotent: eski kod bilan mos.
-- =============================================================================

ALTER TABLE public.queue_displays ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'queue';
ALTER TABLE public.queue_displays DROP CONSTRAINT IF EXISTS queue_displays_mode_chk;
ALTER TABLE public.queue_displays ADD CONSTRAINT queue_displays_mode_chk
  CHECK (mode IN ('queue', 'ads'));

COMMENT ON COLUMN public.queue_displays.mode IS
  'queue — navbat taxtasi (chaqiruvdan 15 s keyin reklama), ads — faqat reklama';

CREATE TABLE IF NOT EXISTS public.cast_ad_videos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  title        text CHECK (title IS NULL OR char_length(title) <= 120),
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  -- pending — yuklash boshlangan (URL berilgan), ready — fayl tekshirilgan
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cast_ad_videos_clinic
  ON public.cast_ad_videos (clinic_id, sort_order, created_at);

ALTER TABLE public.cast_ad_videos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cast_ad_videos FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cast-ads',
  'cast-ads',
  true,
  524288000, -- bitta video ≤ 500 MB (jami hajm tarif bo'yicha API'da)
  ARRAY['video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Tarif limitlari (agar super-admin hali o'zi belgilamagan bo'lsa).
UPDATE public.plans
   SET entitlements = jsonb_set(COALESCE(entitlements, '{}'::jsonb), '{cast_ads}',
                                '{"max_videos": 5, "max_storage_mb": 1024}'::jsonb, true)
 WHERE code IN ('25pro', 'demo')
   AND NOT (COALESCE(entitlements, '{}'::jsonb) ? 'cast_ads');

UPDATE public.plans
   SET entitlements = jsonb_set(COALESCE(entitlements, '{}'::jsonb), '{cast_ads}',
                                '{"max_videos": 10, "max_storage_mb": 2048}'::jsonb, true)
 WHERE code = '50pro'
   AND NOT (COALESCE(entitlements, '{}'::jsonb) ? 'cast_ads');

UPDATE public.plans
   SET entitlements = jsonb_set(COALESCE(entitlements, '{}'::jsonb), '{cast_ads}',
                                '{"max_videos": 30, "max_storage_mb": 3072}'::jsonb, true)
 WHERE code = '120pro'
   AND NOT (COALESCE(entitlements, '{}'::jsonb) ? 'cast_ads');
