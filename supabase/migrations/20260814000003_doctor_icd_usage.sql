-- =============================================================================
-- Shifokorning ICD-10 sevimlilari va oxirgi ishlatganlari — SERVERDA
-- =============================================================================
-- Ilgari `localStorage` da edi (icd10-recent / icd10-favorites): shifokor
-- boshqa kompyuterga o'tsa yoki brauzer keshini tozalasa — hammasi yo'qolardi.
-- Endi profilga bog'langan.
--
-- Nomlar bu yerda SAQLANMAYDI — faqat kod. Nomlar icd10_codes dan olinadi,
-- shunda lug'at tuzatilganda sevimlilar ham avtomatik to'g'rilanadi.

CREATE TABLE IF NOT EXISTS doctor_icd_usage (
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code         TEXT NOT NULL REFERENCES icd10_codes(code) ON DELETE CASCADE,
  clinic_id    UUID REFERENCES clinics(id) ON DELETE CASCADE,
  is_favorite  BOOLEAN NOT NULL DEFAULT false,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);

-- "Oxirgi ishlatilganlar" ro'yxati uchun.
CREATE INDEX IF NOT EXISTS idx_doctor_icd_recent
  ON doctor_icd_usage (user_id, last_used_at DESC);

-- "Sevimlilar" ro'yxati uchun (qisman indeks — sevimlilar oz).
CREATE INDEX IF NOT EXISTS idx_doctor_icd_fav
  ON doctor_icd_usage (user_id, code)
  WHERE is_favorite;

-- API service_role bilan ishlaydi; PostgREST orqali to'g'ridan-to'g'ri
-- kirishga ruxsat bermaymiz (boshqa jadvallar bilan bir xil tartib).
ALTER TABLE doctor_icd_usage ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE doctor_icd_usage IS
  'Shifokorning ICD-10 sevimlilari va oxirgi ishlatganlari. Nomlar icd10_codes dan olinadi.';
