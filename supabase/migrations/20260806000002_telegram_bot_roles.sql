-- =============================================================================
-- HISOBOT BOTIDA ROLLAR + ro'yxatdan o'tish sessiyasi
-- =============================================================================
--   super_admin — platforma egasi: yangi lidlar real vaqtda, platforma hisoboti
--   clinic      — klinika rahbari: FAQAT o'z klinikasi
--
-- Izolyatsiya kuchaytirildi: rol va clinic_id JUFTLIGI baza darajasida
-- tekshiriladi — super_admin qatorida clinic_id bo'lmaydi, clinic qatorida
-- clinic_id majburiy. Ya'ni "klinika roli, lekin klinikasiz" yoki "super-admin,
-- lekin klinikaga bog'langan" holat umuman yozilmaydi.
-- =============================================================================

ALTER TABLE telegram_app_links
  ALTER COLUMN clinic_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'clinic';

ALTER TABLE telegram_app_bind_codes
  ALTER COLUMN clinic_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'clinic';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_app_links_role_check') THEN
    ALTER TABLE telegram_app_links ADD CONSTRAINT telegram_app_links_role_check
      CHECK (
        (role = 'clinic'      AND clinic_id IS NOT NULL) OR
        (role = 'super_admin' AND clinic_id IS NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_app_bind_codes_role_check') THEN
    ALTER TABLE telegram_app_bind_codes ADD CONSTRAINT telegram_app_bind_codes_role_check
      CHECK (
        (role = 'clinic'      AND clinic_id IS NOT NULL) OR
        (role = 'super_admin' AND clinic_id IS NULL)
      );
  END IF;
END $$;

-- Ro'yxatdan o'tish suhbati (ism → klinika → telefon). Bot holatsiz ishlashi
-- uchun qadam shu yerda saqlanadi. Yakunlanganda yoki eskirganda tozalanadi.
CREATE TABLE IF NOT EXISTS telegram_bot_sessions (
  chat_id    BIGINT PRIMARY KEY,
  step       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE telegram_bot_sessions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
