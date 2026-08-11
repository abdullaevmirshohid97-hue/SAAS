-- =============================================================================
-- DAVR YOPISHNI QAYTARISH — nimani bekor qilishni bilish uchun havolalar
-- =============================================================================
-- "Yopishni qaytarish" tugmasi yopish paytida yaratilgan yozuvlarni bekor
-- qilishi kerak. Inkasatsiya (`encash_tx_id`) va hisob-kitob (`settle_id`)
-- allaqachon saqlanardi, kassa svertkasi tuzatuvi esa YO'Q edi — u faqat
-- javobda qaytardi va yo'qolib ketardi.
--
-- Busiz qaytarish chala bo'lardi: pul seyfdan qaytadi, lekin "kassada
-- 120 000 kam edi" degan tuzatuv yozuvi osilib qolaverardi.
-- =============================================================================

ALTER TABLE public.period_closings
  ADD COLUMN IF NOT EXISTS correction_tx_id uuid
    REFERENCES public.transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.period_closings.correction_tx_id IS
  'Kassa svertkasi farqi uchun yaratilgan tuzatuv yozuvi (qaytarishda bekor qilinadi)';

-- Qaytarishda nimalar bekor qilingani (audit uchun, matn ko'rinishida).
ALTER TABLE public.period_closings
  ADD COLUMN IF NOT EXISTS reopen_undone text;

COMMENT ON COLUMN public.period_closings.reopen_undone IS
  'Qaytarishda qaysi yozuvlar bekor qilingani — audit izi';

NOTIFY pgrst, 'reload schema';
