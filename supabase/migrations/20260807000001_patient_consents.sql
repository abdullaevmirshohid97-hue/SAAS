-- =============================================================================
-- INFORMED CONSENT — bemorning tibbiy aralashuvga yozma roziligi
-- =============================================================================
-- Huquqiy asos: "Fuqarolar sog'lig'ini saqlash to'g'risida"gi qonun (265-I,
-- 29.08.1996) — fuqaro tibbiy aralashuvga ixtiyoriy rozilik beradi yoki undan
-- bosh tortadi; 14 yoshgacha bo'lganlar uchun ota-ona/vasiy imzolaydi.
--
-- Oqim: shablon (klinika o'zi tahrirlaydi) → chop etish (matn SNAPSHOT bilan
-- muzlatiladi) → bemor qo'lda imzolaydi → skan yuklanadi → status 'signed'.
--
-- Nega snapshot: shablon keyin tahrirlansa ham imzolangan hujjat matni
-- o'zgarmasligi SHART — aks holda hujjatning sud uchun qiymati yo'q. Bu
-- loyihadagi mavjud konvensiya (service_name_snapshot, issuer/customer jsonb).
--
-- Hammasi IDEMPOTENT — prod'da ham, toza bazada ham xavfsiz qayta ishga tushadi.
-- =============================================================================

-- --- 1) consent_templates — klinika shablonlari (uz/ru) ---------------------
CREATE TABLE IF NOT EXISTS consent_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- general       — umumiy tibbiy aralashuv (birinchi tashrif)
  -- inpatient     — statsionarga yotqizish
  -- dental        — stomatologik davolash
  -- personal_data — shaxsiy ma'lumotlarga ishlov berishga rozilik
  code        TEXT NOT NULL CHECK (code IN ('general', 'inpatient', 'dental', 'personal_data')),
  lang        TEXT NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz', 'ru')),
  title       TEXT NOT NULL,
  -- Matn {{bemor_fio}} kabi placeholder'lar bilan. Chop etishda almashtiriladi.
  body        TEXT NOT NULL,
  version     INT  NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bitta klinikada bitta kod+til uchun bitta FAOL shablon.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_templates_active
  ON consent_templates (clinic_id, code, lang) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_consent_templates_clinic
  ON consent_templates (clinic_id, code, lang);

-- --- 2) patient_consents — imzolangan (yoki chop etilgan) hujjat ------------
CREATE TABLE IF NOT EXISTS patient_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  template_id       UUID REFERENCES consent_templates(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,
  lang              TEXT NOT NULL DEFAULT 'uz',

  -- MUZLATILGAN NUSXA — shablon keyin o'zgarsa ham bu tegilmaydi.
  title_snapshot    TEXT NOT NULL,
  body_snapshot     TEXT NOT NULL,
  template_version  INT,

  -- Kontekst: qaysi voqeaga tegishli (ixtiyoriy).
  stay_id           UUID REFERENCES inpatient_stays(id) ON DELETE SET NULL,
  dental_plan_id    UUID REFERENCES dental_treatment_plans(id) ON DELETE SET NULL,
  appointment_id    UUID REFERENCES appointments(id) ON DELETE SET NULL,

  -- printed — chop etilgan, imzo kutilmoqda
  -- signed  — bemor imzoladi (skan biriktirilgan bo'lishi mumkin)
  -- refused — bemor bosh tortdi (bu ham huquqiy fakt, saqlanadi)
  -- revoked — bemor keyinchalik rozilikni qaytarib oldi
  status            TEXT NOT NULL DEFAULT 'printed'
                    CHECK (status IN ('printed', 'signed', 'refused', 'revoked')),

  -- Imzolovchi: bemorning o'zi yoki vasiy (14 yoshgacha / muomalaga layoqatsiz).
  signer_name       TEXT,
  signer_relation   TEXT NOT NULL DEFAULT 'self'
                    CHECK (signer_relation IN ('self', 'parent', 'guardian')),
  signed_at         TIMESTAMPTZ,
  refused_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT,

  -- Imzolangan qog'ozning skani (private bucket 'patient-consents').
  storage_path      TEXT,
  file_name         TEXT,
  mime_type         TEXT,
  size_bytes        BIGINT,
  uploaded_by       UUID REFERENCES profiles(id),

  notes             TEXT,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_consents_patient
  ON patient_consents (clinic_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_consents_status
  ON patient_consents (clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_consents_stay
  ON patient_consents (stay_id) WHERE stay_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_consents_plan
  ON patient_consents (dental_plan_id) WHERE dental_plan_id IS NOT NULL;

-- --- 3) updated_at triggerlari ---------------------------------------------
DROP TRIGGER IF EXISTS trg_consent_templates_updated ON consent_templates;
CREATE TRIGGER trg_consent_templates_updated
  BEFORE UPDATE ON consent_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_patient_consents_updated ON patient_consents;
CREATE TRIGGER trg_patient_consents_updated
  BEFORE UPDATE ON patient_consents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- --- 4) RLS — tenant izolyatsiyasi (mavjud jadvallar bilan bir xil) ---------
ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consents  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_consent_templates_tenant ON consent_templates;
CREATE POLICY p_consent_templates_tenant ON consent_templates
  FOR ALL
  USING      ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'))
  WITH CHECK ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'));

DROP POLICY IF EXISTS p_patient_consents_tenant ON patient_consents;
CREATE POLICY p_patient_consents_tenant ON patient_consents
  FOR ALL
  USING      ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'))
  WITH CHECK ((clinic_id = get_my_clinic_id()) OR (get_my_role() = 'super_admin'));

-- --- 5) Storage bucket — imzolangan skanlar (PRIVATE) ----------------------
-- Bu bemorning imzosi bilan tibbiy hujjati — eng sezgir PII. Shuning uchun
-- staff-documents/dental-files'dan QAT'IYROQ: authenticated FAQAT yuklay oladi,
-- o'qish esa faqat API bergan signed URL orqali (service_role RLS'ni chetlab
-- o'tadi, signed URL esa imzo bilan tekshiriladi — policy talab qilmaydi).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'patient-consents', 'patient-consents', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "patient_consents_auth_insert" ON storage.objects;
CREATE POLICY "patient_consents_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patient-consents');

-- --- 6) PostgREST sxema keshini yangilash ----------------------------------
NOTIFY pgrst, 'reload schema';
