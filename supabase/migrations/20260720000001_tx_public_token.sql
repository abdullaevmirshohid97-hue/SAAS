-- =============================================================================
-- To'lov cheki — public token (chekdagi QR skaner qilinganda ochiladigan havola).
-- Bemor chekdagi QR'ni skaner qiladi → patient.clary.uz/t/<public_token> →
-- chek (xizmatlar, to'langan/qarz holati) loginsiz ko'rinadi. Lab natija
-- (20260708000001_lab_public_token) bilan bir xil pattern: token taxmin qilib
-- bo'lmaydi (uuid), qog'ozning o'zi kabi maxfiylik.
-- =============================================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS transactions_public_token_key
  ON public.transactions (public_token);
