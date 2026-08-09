-- =============================================================================
-- BEMOR TELEGRAM BOTI — chek → bot → navbat + tahlil javobi
-- =============================================================================
-- Oqim:
--   1. Qabulxona chek beradi; chek tagida bot havolasi (deep-link chek tokeni
--      bilan: t.me/<bot>?start=t_<transactions.public_token>).
--   2. Bemor botni ochadi → Telegram "Raqamni ulashish" tugmasi bilan telefonini
--      beradi (raqamni Telegram O'ZI tasdiqlaydi — qo'lda yozilgan raqamga
--      ishonib bo'lmaydi, birovning tahlil javobi ketib qolishi mumkin).
--   3. Bot chatni portal_users ga bog'laydi va chek qaysi klinikadan bo'lsa,
--      o'sha klinika bilan bog'laydi.
--   4. Bemor botdan online navbat oladi; tahlil javobi tayyor bo'lsa PDF darhol
--      shu chatga tushadi.
--
-- NEGA YANGI JADVAL (telegram_app_links ga qo'shilmadi): u jadval "bir chat =
-- bir KLINIKA" qoidasini chat_id PRIMARY KEY bilan majburlaydi va klinika
-- xodimlari uchun (hisobot, kassa boshqaruvi). Bemorni o'sha yerga qo'shsak,
-- bemor chati klinika kassasiga kirish huquqiga ega bo'lib qolishi mumkin edi.
-- Ikkalasi QAT'IY ajratilgan.
-- =============================================================================

CREATE TABLE IF NOT EXISTS telegram_patient_links (
  chat_id        BIGINT PRIMARY KEY,
  portal_user_id UUID REFERENCES portal_users(id) ON DELETE CASCADE,
  -- Telegram tasdiqlagan raqam (+998XXXXXXXXX). Tahlil javobi ayni shu raqam
  -- bo'yicha topiladi, shuning uchun u NOT NULL.
  phone          TEXT NOT NULL,
  username       TEXT,
  first_name     TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  -- Tibbiy natija Telegram orqali yuborilishiga bemor roziligi. Bot ichida
  -- istalgan vaqtda o'chiriladi — tibbiy ma'lumot majburan yuborilmaydi.
  lab_results_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ
);

-- Yuborishda raqam bo'yicha qidiriladi.
CREATE INDEX IF NOT EXISTS idx_tg_patient_links_phone
  ON telegram_patient_links(phone) WHERE is_active;

-- Bemor qaysi klinikalar bilan bog'langan (chek orqali). Bir bemor bir necha
-- klinikada davolanishi mumkin — shuning uchun alohida jadval.
CREATE TABLE IF NOT EXISTS telegram_patient_clinics (
  chat_id     BIGINT NOT NULL REFERENCES telegram_patient_links(chat_id) ON DELETE CASCADE,
  clinic_id   UUID   NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Qaysi klinikadagi bemor kartasi (chek orqali aniqlangan).
  patient_id  UUID   REFERENCES patients(id) ON DELETE SET NULL,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_patient_clinics_patient
  ON telegram_patient_clinics(patient_id) WHERE patient_id IS NOT NULL;

-- Tahlil javobi ikki marta yuborilmasin (lab holati qayta 'reported' bo'lsa ham).
CREATE TABLE IF NOT EXISTS telegram_lab_deliveries (
  lab_order_id UUID   NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lab_order_id, chat_id)
);

-- RLS yoqilgan, policy YO'Q — faqat service_role (API). Bemor bu jadvallarga
-- to'g'ridan-to'g'ri kira olmaydi.
ALTER TABLE telegram_patient_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_patient_clinics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_lab_deliveries   ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
