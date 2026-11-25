-- =============================================================================
-- Laboratoriya natijasi — public token (QR skaner qilinganda ochiladigan havola).
-- Bemor qog'ozdagi QR'ni skaner qiladi → patient.clary.uz/r/<public_token> →
-- natija loginsiz ko'rinadi. Token taxmin qilib bo'lmaydi (uuid), qog'ozning
-- o'zi kabi maxfiylik (foydalanuvchi ochiq havolani tanladi).
-- =============================================================================

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS lab_orders_public_token_key
  ON public.lab_orders (public_token);
