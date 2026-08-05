-- =============================================================================
-- UMUMIY HISOBOT BOTI (@claryappbot) — barcha klinikalar bitta botga ulanadi
-- =============================================================================
-- Ilgari har klinika @BotFather'dan O'Z botini yaratib, tokenini dasturga
-- kiritishi kerak edi — ko'p klinika shu bosqichda to'xtab qolardi.
-- Endi bitta umumiy bot; klinika faqat bog'lanish kodini oladi.
--
-- ⚠️ QAT'IY QOIDA: bir chat — FAQAT bitta klinika.
-- Bu kodda emas, SXEMADA majburlanadi: chat_id = PRIMARY KEY. Ya'ni bitta
-- Telegram chat ikkita klinikaga bog'lana OLMAYDI — kodda xato qilinsa ham
-- baza ruxsat bermaydi. Hisobot doim shu qatordagi clinic_id bo'yicha
-- yig'iladi; klinika ID hech qachon foydalanuvchi xabaridan olinmaydi.
-- =============================================================================

CREATE TABLE IF NOT EXISTS telegram_app_links (
  -- PRIMARY KEY — izolyatsiyaning asosiy kafolati (bir chat = bir klinika).
  chat_id      BIGINT PRIMARY KEY,
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  bound_by     UUID REFERENCES profiles(id),
  username     TEXT,
  first_name   TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  daily_digest BOOLEAN NOT NULL DEFAULT TRUE,
  bound_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_app_links_clinic
  ON telegram_app_links(clinic_id) WHERE is_active;

-- Bog'lanish kodi: bir martalik, muddatli, bitta klinikaga qat'iy bog'langan.
CREATE TABLE IF NOT EXISTS telegram_app_bind_codes (
  code         TEXT PRIMARY KEY,
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by_chat BIGINT
);

CREATE INDEX IF NOT EXISTS idx_telegram_app_bind_codes_clinic
  ON telegram_app_bind_codes(clinic_id, created_at DESC);

-- RLS yoqilgan, policy YO'Q — faqat service_role (API) kira oladi.
-- Klinika foydalanuvchisi bu jadvallarga to'g'ridan murojaat qila olmaydi.
ALTER TABLE telegram_app_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_app_bind_codes ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
