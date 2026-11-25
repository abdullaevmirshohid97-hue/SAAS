-- =============================================================================
-- Laboratoriya moduli — FAZA 1: LOINC standart + Lab panellar + ICD-10 tavsiya
-- =============================================================================
-- Mavjud lab moduli (lab_orders/lab_order_items/lab_results/lab_tests) buzilmaydi.
-- Bu migratsiya faqat YANGI jadvallar va lab_tests'ga bitta nullable ustun qo'shadi.

-- -----------------------------------------------------------------------------
-- 1) loinc_tests — LOINC global reference (ICD-10 kabi, RLS yo'q, hamma o'qiydi)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loinc_tests (
  loinc_code  TEXT PRIMARY KEY,          -- '2345-7'
  long_name   TEXT NOT NULL,             -- 'Glucose [Mass/volume] in Serum or Plasma'
  short_name  TEXT NOT NULL,             -- 'Glucose'
  component   TEXT NOT NULL,             -- 'Glucose'
  unit        TEXT,                      -- 'mg/dL'
  category    TEXT NOT NULL,             -- 'Chemistry', 'Hematology', 'Hormones'...
  search_text TEXT NOT NULL              -- qidiruv uchun (lowercase)
);

CREATE INDEX IF NOT EXISTS idx_loinc_search_trgm
  ON loinc_tests USING GIN (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_loinc_category ON loinc_tests(category);

ALTER TABLE loinc_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_loinc_read ON loinc_tests;
CREATE POLICY p_loinc_read ON loinc_tests FOR SELECT USING (true);

COMMENT ON TABLE loinc_tests IS
  'LOINC (Logical Observation Identifiers Names and Codes) global reference. '
  'Har laborator analiz LOINC kodi bilan bog''lanadi — xalqaro standart, '
  'LIS/HL7/FHIR integratsiyasiga zarur.';

-- -----------------------------------------------------------------------------
-- 2) lab_tests'ga loinc_code — mavjud testlarni LOINC'ga bog'lash (nullable)
-- -----------------------------------------------------------------------------
ALTER TABLE lab_tests
  ADD COLUMN IF NOT EXISTS loinc_code TEXT REFERENCES loinc_tests(loinc_code);

CREATE INDEX IF NOT EXISTS idx_lab_tests_loinc ON lab_tests(loinc_code);

COMMENT ON COLUMN lab_tests.loinc_code IS
  'LOINC kodi — klinika testini xalqaro standartga bog''laydi. NULL bo''lishi mumkin '
  '(eski testlar yoki klinika-spetsifik testlar).';

-- -----------------------------------------------------------------------------
-- 3) lab_panels + lab_panel_items — test panellari (CBC, Diabetes panel...)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_panels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,             -- 'CBC', 'DIABETES'
  name_i18n   JSONB NOT NULL,            -- {"uz-Latn": "Umumiy qon tahlili", ...}
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

CREATE TABLE IF NOT EXISTS lab_panel_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  panel_id    UUID NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,
  lab_test_id UUID NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (panel_id, lab_test_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_panels_clinic ON lab_panels(clinic_id);
CREATE INDEX IF NOT EXISTS idx_lab_panel_items_panel ON lab_panel_items(panel_id);
CREATE INDEX IF NOT EXISTS idx_lab_panel_items_clinic ON lab_panel_items(clinic_id);

ALTER TABLE lab_panels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_panels_tenant ON lab_panels;
CREATE POLICY p_lab_panels_tenant ON lab_panels
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

ALTER TABLE lab_panel_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_panel_items_tenant ON lab_panel_items;
CREATE POLICY p_lab_panel_items_tenant ON lab_panel_items
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DROP TRIGGER IF EXISTS tg_lab_panels_updated ON lab_panels;
CREATE TRIGGER tg_lab_panels_updated
  BEFORE UPDATE ON lab_panels
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE lab_panels IS
  'Laboratoriya test panellari — bir klikda 10+ analiz buyurtma berish uchun. '
  'CBC, Liver panel, Diabetes panel kabi. Har klinika o''z panellarini sozlaydi.';

-- -----------------------------------------------------------------------------
-- 4) icd10_lab_recommendations — ICD-10 tashxis → tavsiya etilgan LOINC testlar
-- -----------------------------------------------------------------------------
-- Global reference: shifokor tashxis tanlaganda tizim qaysi analizlarni tavsiya
-- qilishini ko'rsatadi. Klinika-spetsifik emas — tibbiy bilim bazasi.
CREATE TABLE IF NOT EXISTS icd10_lab_recommendations (
  icd10_code  TEXT NOT NULL REFERENCES icd10_codes(code) ON DELETE CASCADE,
  loinc_code  TEXT NOT NULL REFERENCES loinc_tests(loinc_code) ON DELETE CASCADE,
  priority    INT NOT NULL DEFAULT 0,    -- past = muhimroq
  rationale   TEXT,                      -- nega tavsiya etiladi
  PRIMARY KEY (icd10_code, loinc_code)
);

CREATE INDEX IF NOT EXISTS idx_icd10_lab_rec_icd ON icd10_lab_recommendations(icd10_code);

ALTER TABLE icd10_lab_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_icd10_lab_rec_read ON icd10_lab_recommendations;
CREATE POLICY p_icd10_lab_rec_read ON icd10_lab_recommendations
  FOR SELECT USING (true);

COMMENT ON TABLE icd10_lab_recommendations IS
  'ICD-10 tashxis kodi → tavsiya etilgan laborator analizlar (LOINC). '
  'Shifokor tashxis qo''yganda tizim avtomatik tegishli analizlarni taklif qiladi.';

-- =============================================================================
-- SEED — LOINC kodlari (eng ko'p ishlatiladigan ~60 ta)
-- =============================================================================
INSERT INTO loinc_tests (loinc_code, long_name, short_name, component, unit, category, search_text)
VALUES
  -- Chemistry / Biokimyo
  ('2345-7',  'Glucose [Mass/volume] in Serum or Plasma',          'Glucose',      'Glucose',          'mg/dL',  'Chemistry',  'glucose glyukoza qand serum'),
  ('1558-6',  'Fasting glucose [Mass/volume] in Serum or Plasma',  'Fasting glucose','Glucose fasting','mg/dL',  'Chemistry',  'fasting glucose ochlik glyukoza'),
  ('4548-4',  'Hemoglobin A1c/Hemoglobin.total in Blood',          'HbA1c',        'Hemoglobin A1c',   '%',      'Chemistry',  'hba1c glycated hemoglobin gemoglobin a1c'),
  ('2093-3',  'Cholesterol [Mass/volume] in Serum or Plasma',      'Cholesterol',  'Cholesterol',      'mg/dL',  'Chemistry',  'cholesterol xolesterin lipid'),
  ('2571-8',  'Triglyceride [Mass/volume] in Serum or Plasma',     'Triglycerides','Triglyceride',     'mg/dL',  'Chemistry',  'triglyceride triglitserid lipid'),
  ('2085-9',  'Cholesterol in HDL [Mass/volume] in Serum or Plasma','HDL',         'HDL Cholesterol',  'mg/dL',  'Chemistry',  'hdl cholesterol yaxshi xolesterin'),
  ('2089-1',  'Cholesterol in LDL [Mass/volume] in Serum or Plasma','LDL',         'LDL Cholesterol',  'mg/dL',  'Chemistry',  'ldl cholesterol yomon xolesterin'),
  ('2160-0',  'Creatinine [Mass/volume] in Serum or Plasma',       'Creatinine',   'Creatinine',       'mg/dL',  'Chemistry',  'creatinine kreatinin buyrak'),
  ('3094-0',  'Urea nitrogen [Mass/volume] in Serum or Plasma',    'BUN',          'Urea nitrogen',    'mg/dL',  'Chemistry',  'urea bun mochevina'),
  ('1742-6',  'Alanine aminotransferase [Enzymatic activity/volume]','ALT',        'ALT',              'U/L',    'Chemistry',  'alt alanine aminotransferase jigar'),
  ('1920-8',  'Aspartate aminotransferase [Enzymatic activity/volume]','AST',      'AST',              'U/L',    'Chemistry',  'ast aspartate aminotransferase jigar'),
  ('1975-2',  'Bilirubin.total [Mass/volume] in Serum or Plasma',  'Bilirubin',    'Bilirubin total',  'mg/dL',  'Chemistry',  'bilirubin bilirubin jigar'),
  ('1751-7',  'Albumin [Mass/volume] in Serum or Plasma',          'Albumin',      'Albumin',          'g/dL',   'Chemistry',  'albumin albumin oqsil'),
  ('2885-2',  'Protein [Mass/volume] in Serum or Plasma',          'Total protein','Protein total',    'g/dL',   'Chemistry',  'total protein umumiy oqsil'),
  ('2951-2',  'Sodium [Moles/volume] in Serum or Plasma',          'Sodium',       'Sodium',           'mmol/L', 'Chemistry',  'sodium natriy elektrolit'),
  ('2823-3',  'Potassium [Moles/volume] in Serum or Plasma',       'Potassium',    'Potassium',        'mmol/L', 'Chemistry',  'potassium kaliy elektrolit'),
  ('2075-0',  'Chloride [Moles/volume] in Serum or Plasma',        'Chloride',     'Chloride',         'mmol/L', 'Chemistry',  'chloride xlor elektrolit'),
  ('17861-6', 'Calcium [Mass/volume] in Serum or Plasma',          'Calcium',      'Calcium',          'mg/dL',  'Chemistry',  'calcium kalsiy'),
  ('1759-0',  'Amylase [Enzymatic activity/volume] in Serum',      'Amylase',      'Amylase',          'U/L',    'Chemistry',  'amylase amilaza oshqozon osti'),
  ('1798-8',  'Amylase [Enzymatic activity/volume] in Serum -- Pancreatic','Lipase','Lipase',         'U/L',    'Chemistry',  'lipase lipaza'),
  ('1988-5',  'C reactive protein [Mass/volume] in Serum or Plasma','CRP',         'C-reactive protein','mg/L',  'Chemistry',  'crp c reactive protein yallig''lanish'),
  ('3016-3',  'Thyrotropin [Units/volume] in Serum or Plasma',     'TSH',          'TSH',              'mIU/L',  'Hormones',   'tsh thyrotropin qalqonsimon'),
  ('3024-7',  'Thyroxine (T4) free [Mass/volume] in Serum',        'Free T4',      'Free T4',          'ng/dL',  'Hormones',   'free t4 erkin t4 qalqonsimon'),
  ('3051-0',  'Triiodothyronine (T3) free [Mass/volume] in Serum', 'Free T3',      'Free T3',          'pg/mL',  'Hormones',   'free t3 erkin t3 qalqonsimon'),
  ('2106-3',  'Choriogonadotropin [Units/volume] in Serum',        'Beta-hCG',     'hCG',              'mIU/mL', 'Hormones',   'hcg homiladorlik xorionik'),
  ('2243-4',  'Estradiol [Mass/volume] in Serum or Plasma',        'Estradiol',    'Estradiol',        'pg/mL',  'Hormones',   'estradiol estrogen gormon'),
  ('2986-8',  'Testosterone [Mass/volume] in Serum or Plasma',     'Testosterone', 'Testosterone',     'ng/dL',  'Hormones',   'testosterone testosteron gormon'),
  ('2143-6',  'Cortisol [Mass/volume] in Serum or Plasma',         'Cortisol',     'Cortisol',         'ug/dL',  'Hormones',   'cortisol kortizol stress gormon'),
  ('14749-6', 'Glucose [Moles/volume] in Serum or Plasma',         'Glucose SI',   'Glucose',          'mmol/L', 'Chemistry',  'glucose glyukoza si'),
  -- Hematology / Gematologiya (CBC)
  ('718-7',   'Hemoglobin [Mass/volume] in Blood',                 'Hemoglobin',   'Hemoglobin',       'g/dL',   'Hematology', 'hemoglobin gemoglobin hb qon'),
  ('4544-3',  'Hematocrit [Volume Fraction] of Blood',             'Hematocrit',   'Hematocrit',       '%',      'Hematology', 'hematocrit gematokrit hct'),
  ('789-8',   'Erythrocytes [#/volume] in Blood',                  'RBC',          'Erythrocytes',     '10*6/uL','Hematology', 'rbc eritrotsit qizil tana'),
  ('6690-2',  'Leukocytes [#/volume] in Blood',                    'WBC',          'Leukocytes',       '10*3/uL','Hematology', 'wbc leykotsit oq tana'),
  ('777-3',   'Platelets [#/volume] in Blood',                     'Platelets',    'Platelets',        '10*3/uL','Hematology', 'platelets trombotsit'),
  ('787-2',   'Erythrocyte mean corpuscular volume',               'MCV',          'MCV',              'fL',     'Hematology', 'mcv eritrotsit hajmi'),
  ('785-6',   'Erythrocyte mean corpuscular hemoglobin',           'MCH',          'MCH',              'pg',     'Hematology', 'mch'),
  ('786-4',   'Erythrocyte mean corpuscular hemoglobin concentration','MCHC',      'MCHC',             'g/dL',   'Hematology', 'mchc'),
  ('4537-7',  'Erythrocyte sedimentation rate',                    'ESR',          'ESR',              'mm/h',   'Hematology', 'esr soe cho''kish tezligi'),
  ('770-8',   'Neutrophils/100 leukocytes in Blood',               'Neutrophils %','Neutrophils',      '%',      'Hematology', 'neutrophils neytrofil'),
  ('736-9',   'Lymphocytes/100 leukocytes in Blood',               'Lymphocytes %','Lymphocytes',      '%',      'Hematology', 'lymphocytes limfotsit'),
  -- Coagulation / Koagulyatsiya
  ('5902-2',  'Prothrombin time (PT)',                             'PT',           'Prothrombin time', 's',      'Coagulation','pt protrombin vaqti'),
  ('6301-6',  'INR in Platelet poor plasma by Coagulation assay',  'INR',          'INR',              '{ratio}','Coagulation','inr koagulyatsiya'),
  ('3173-2',  'Activated partial thromboplastin time (aPTT)',      'aPTT',         'aPTT',             's',      'Coagulation','aptt aktivlangan tromboplastin'),
  -- Urinalysis / Siydik tahlili
  ('5792-7',  'Glucose [Mass/volume] in Urine by Test strip',      'Urine glucose','Glucose urine',    'mg/dL',  'Urinalysis', 'urine glucose siydik glyukoza'),
  ('5804-0',  'Protein [Mass/volume] in Urine by Test strip',      'Urine protein','Protein urine',    'mg/dL',  'Urinalysis', 'urine protein siydik oqsil'),
  ('5811-5',  'Specific gravity of Urine by Test strip',           'Urine SG',     'Specific gravity', '{ratio}','Urinalysis', 'specific gravity siydik zichligi'),
  ('5803-2',  'pH of Urine by Test strip',                         'Urine pH',     'pH urine',         '{pH}',   'Urinalysis', 'urine ph siydik ph'),
  ('5799-2',  'Leukocyte esterase [Presence] in Urine by Test strip','Urine LE',   'Leukocyte esterase',NULL,   'Urinalysis', 'leukocyte esterase siydik leykotsit'),
  -- Infektsiya / Serologiya
  ('5196-1',  'Hepatitis B virus surface Ag [Presence] in Serum',  'HBsAg',        'HBsAg',            NULL,     'Serology',   'hbsag gepatit b'),
  ('16128-1', 'Hepatitis C virus Ab [Presence] in Serum',          'Anti-HCV',     'Hepatitis C Ab',   NULL,     'Serology',   'anti hcv gepatit c'),
  ('5017-9',  'HIV 1+2 Ab [Presence] in Serum',                    'HIV Ab',       'HIV antibody',     NULL,     'Serology',   'hiv oits zaxm'),
  ('14502-9', 'Treponema pallidum Ab [Presence] in Serum',         'Syphilis',     'Syphilis Ab',      NULL,     'Serology',   'syphilis zaxm sifilis rw')
ON CONFLICT (loinc_code) DO NOTHING;

-- =============================================================================
-- SEED — ICD-10 → LOINC tavsiyalar (eng keng tarqalgan tashxislar)
-- =============================================================================
-- Faqat icd10_codes'da mavjud bo'lgan kodlar uchun (FK xatosini oldini olish).
INSERT INTO icd10_lab_recommendations (icd10_code, loinc_code, priority, rationale)
SELECT v.icd10, v.loinc, v.prio, v.note
  FROM (VALUES
    -- E11.9 — 2-tip qandli diabet
    ('E11.9', '4548-4',  1, 'Diabet nazorati — HbA1c'),
    ('E11.9', '1558-6',  2, 'Ochlik glyukozasi'),
    ('E11.9', '2093-3',  3, 'Lipid profili xavfi'),
    ('E11.9', '2160-0',  4, 'Buyrak funksiyasi (nefropatiya)'),
    ('E11.9', '5804-0',  5, 'Siydikda oqsil — diabetik nefropatiya'),
    -- I10 — Birlamchi gipertenziya
    ('I10',   '2160-0',  1, 'Buyrak funksiyasi'),
    ('I10',   '2951-2',  2, 'Natriy elektroliti'),
    ('I10',   '2823-3',  3, 'Kaliy elektroliti'),
    ('I10',   '2093-3',  4, 'Lipid profili'),
    ('I10',   '2345-7',  5, 'Qand darajasi'),
    -- E78.5 — Giperlipidemiya
    ('E78.5', '2093-3',  1, 'Umumiy xolesterin'),
    ('E78.5', '2571-8',  2, 'Triglitseridlar'),
    ('E78.5', '2085-9',  3, 'HDL'),
    ('E78.5', '2089-1',  4, 'LDL'),
    -- E03.9 — Gipotireoz
    ('E03.9', '3016-3',  1, 'TSH — qalqonsimon bez'),
    ('E03.9', '3024-7',  2, 'Erkin T4'),
    -- D50.9 — Temir tanqisligi anemiyasi
    ('D50.9', '718-7',   1, 'Gemoglobin'),
    ('D50.9', '789-8',   2, 'Eritrotsitlar'),
    ('D50.9', '787-2',   3, 'MCV — anemiya tipi'),
    -- N39.0 — Siydik yo'llari infeksiyasi
    ('N39.0', '5799-2',  1, 'Siydikda leykotsitlar'),
    ('N39.0', '5804-0',  2, 'Siydikda oqsil'),
    ('N39.0', '6690-2',  3, 'Qonda leykotsitlar — infeksiya'),
    -- K76.0 — Jigarning yog'li distrofiyasi
    ('K76.0', '1742-6',  1, 'ALT — jigar fermenti'),
    ('K76.0', '1920-8',  2, 'AST — jigar fermenti'),
    ('K76.0', '1975-2',  3, 'Bilirubin')
  ) AS v(icd10, loinc, prio, note)
 WHERE EXISTS (SELECT 1 FROM icd10_codes c WHERE c.code = v.icd10)
   AND EXISTS (SELECT 1 FROM loinc_tests l WHERE l.loinc_code = v.loinc)
ON CONFLICT (icd10_code, loinc_code) DO NOTHING;
