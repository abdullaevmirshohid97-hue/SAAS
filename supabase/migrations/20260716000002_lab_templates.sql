-- =============================================================================
-- Laboratoriya moduli — TAYYOR KATALOG SHABLONLARI (Faza B)
-- =============================================================================
-- Oracle Health "seeded content" modeli: markazdan tayyor test + panel shablonlari
-- yetkaziladi, klinika bir klik bilan import qiladi va faqat NARXni o'zi qo'yadi.
--
-- Global jadvallar (clinic_id yo'q, hamma o'qiydi). Import logikasi API xizmatida
-- (service_role) — narxga tegmaydi (price_uzs = 0 qo'yiladi, klinika keyin belgilaydi).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) lab_test_templates — tayyor analiz shabloni (mahalliylashtirilgan nom bilan)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_test_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,      -- qisqa mnemonik: 'GLU', 'HGB'
  loinc_code          TEXT REFERENCES loinc_tests(loinc_code),
  name_i18n           JSONB NOT NULL,            -- {"uz-Latn","ru","en"}
  unit                TEXT,                      -- SI default
  sample_type         TEXT NOT NULL DEFAULT 'blood'
                        CHECK (sample_type IN ('blood','urine','stool','swab','tissue','other')),
  specimen_container  TEXT,                      -- probirka: 'Serum (qizil)', 'EDTA (binafsha)'
  tat_hours           INT,                       -- taxminiy tayyorlanish vaqti (soat)
  category            TEXT NOT NULL DEFAULT 'Chemistry',
  sort_order          INT NOT NULL DEFAULT 0
);

ALTER TABLE lab_test_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_test_templates_read ON lab_test_templates;
CREATE POLICY p_lab_test_templates_read ON lab_test_templates FOR SELECT USING (true);

COMMENT ON TABLE lab_test_templates IS
  'Global tayyor laborator analiz shablonlari. Klinika import qiladi → lab_tests. '
  'Narx tashimaydi (klinika o''zi belgilaydi).';

-- -----------------------------------------------------------------------------
-- 2) lab_panel_templates + items — tayyor panellar (CBC, Biokimyo, Lipid...)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lab_panel_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,            -- 'CBC', 'LIPID'
  name_i18n    JSONB NOT NULL,
  description  TEXT,
  sort_order   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lab_panel_template_items (
  panel_code   TEXT NOT NULL REFERENCES lab_panel_templates(code) ON DELETE CASCADE,
  loinc_code   TEXT NOT NULL REFERENCES loinc_tests(loinc_code),
  sort_order   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (panel_code, loinc_code)
);

ALTER TABLE lab_panel_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_panel_templates_read ON lab_panel_templates;
CREATE POLICY p_lab_panel_templates_read ON lab_panel_templates FOR SELECT USING (true);

ALTER TABLE lab_panel_template_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_panel_template_items_read ON lab_panel_template_items;
CREATE POLICY p_lab_panel_template_items_read ON lab_panel_template_items FOR SELECT USING (true);

COMMENT ON TABLE lab_panel_templates IS
  'Global tayyor panellar. Import qilinganda lab_panels + lab_panel_items va '
  'tarkibidagi testlar (lab_tests) klinikaga ko''chiriladi.';

-- =============================================================================
-- SEED — test shablonlari
-- =============================================================================
INSERT INTO lab_test_templates (code, loinc_code, name_i18n, unit, sample_type, specimen_container, tat_hours, category, sort_order)
VALUES
  -- ── Gematologiya (CBC) ─────────────────────────────────────────────────────
  ('WBC',  '6690-2',  '{"uz-Latn":"Leykotsitlar (WBC)","ru":"Лейкоциты (WBC)","en":"Leukocytes (WBC)"}',        '10*3/uL','blood','EDTA (binafsha)',2,'Hematology',10),
  ('RBC',  '789-8',   '{"uz-Latn":"Eritrotsitlar (RBC)","ru":"Эритроциты (RBC)","en":"Erythrocytes (RBC)"}',      '10*6/uL','blood','EDTA (binafsha)',2,'Hematology',11),
  ('HGB',  '718-7',   '{"uz-Latn":"Gemoglobin (HGB)","ru":"Гемоглобин (HGB)","en":"Hemoglobin"}',                 'g/dL',   'blood','EDTA (binafsha)',2,'Hematology',12),
  ('HCT',  '4544-3',  '{"uz-Latn":"Gematokrit (HCT)","ru":"Гематокрит (HCT)","en":"Hematocrit"}',                 '%',      'blood','EDTA (binafsha)',2,'Hematology',13),
  ('PLT',  '777-3',   '{"uz-Latn":"Trombotsitlar (PLT)","ru":"Тромбоциты (PLT)","en":"Platelets"}',               '10*3/uL','blood','EDTA (binafsha)',2,'Hematology',14),
  ('MCV',  '787-2',   '{"uz-Latn":"MCV","ru":"MCV","en":"MCV"}',                                                  'fL',     'blood','EDTA (binafsha)',2,'Hematology',15),
  ('MCH',  '785-6',   '{"uz-Latn":"MCH","ru":"MCH","en":"MCH"}',                                                  'pg',     'blood','EDTA (binafsha)',2,'Hematology',16),
  ('MCHC', '786-4',   '{"uz-Latn":"MCHC","ru":"MCHC","en":"MCHC"}',                                               'g/dL',   'blood','EDTA (binafsha)',2,'Hematology',17),
  ('RDW',  '788-0',   '{"uz-Latn":"RDW","ru":"RDW","en":"RDW"}',                                                  '%',      'blood','EDTA (binafsha)',2,'Hematology',18),
  ('NEU',  '770-8',   '{"uz-Latn":"Neytrofillar %","ru":"Нейтрофилы %","en":"Neutrophils %"}',                    '%',      'blood','EDTA (binafsha)',2,'Hematology',19),
  ('LYM',  '736-9',   '{"uz-Latn":"Limfotsitlar %","ru":"Лимфоциты %","en":"Lymphocytes %"}',                     '%',      'blood','EDTA (binafsha)',2,'Hematology',20),
  ('MON',  '5905-5',  '{"uz-Latn":"Monotsitlar %","ru":"Моноциты %","en":"Monocytes %"}',                         '%',      'blood','EDTA (binafsha)',2,'Hematology',21),
  ('EOS',  '713-8',   '{"uz-Latn":"Eozinofillar %","ru":"Эозинофилы %","en":"Eosinophils %"}',                    '%',      'blood','EDTA (binafsha)',2,'Hematology',22),
  ('BAS',  '706-2',   '{"uz-Latn":"Bazofillar %","ru":"Базофилы %","en":"Basophils %"}',                          '%',      'blood','EDTA (binafsha)',2,'Hematology',23),
  ('ESR',  '4537-7',  '{"uz-Latn":"ECHT (SOE)","ru":"СОЭ","en":"ESR"}',                                           'mm/h',   'blood','EDTA (binafsha)',2,'Hematology',24),
  ('RETIC','17849-1', '{"uz-Latn":"Retikulotsitlar","ru":"Ретикулоциты","en":"Reticulocytes"}',                   '%',      'blood','EDTA (binafsha)',4,'Hematology',25),
  ('ABO',  '882-1',   '{"uz-Latn":"Qon guruhi va Rezus","ru":"Группа крови и резус","en":"Blood group + Rh"}',    NULL,     'blood','EDTA (binafsha)',2,'Hematology',26),
  -- ── Biokimyo ───────────────────────────────────────────────────────────────
  ('GLU',  '2345-7',  '{"uz-Latn":"Glyukoza","ru":"Глюкоза","en":"Glucose"}',                                    'mmol/L', 'blood','Fluorid (kulrang)',2,'Chemistry',30),
  ('GLUF', '1558-6',  '{"uz-Latn":"Glyukoza (ochlik)","ru":"Глюкоза натощак","en":"Fasting glucose"}',           'mmol/L', 'blood','Fluorid (kulrang)',2,'Chemistry',31),
  ('HBA1C','4548-4',  '{"uz-Latn":"Glikirlangan gemoglobin (HbA1c)","ru":"Гликированный гемоглобин","en":"HbA1c"}','%',     'blood','EDTA (binafsha)',24,'Chemistry',32),
  ('UREA', '3094-0',  '{"uz-Latn":"Mochevina","ru":"Мочевина","en":"Urea"}',                                     'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',33),
  ('CREA', '2160-0',  '{"uz-Latn":"Kreatinin","ru":"Креатинин","en":"Creatinine"}',                              'umol/L', 'blood','Serum (qizil)',2,'Chemistry',34),
  ('EGFR', '33914-3', '{"uz-Latn":"eGFR (buyrak filtratsiyasi)","ru":"СКФ (eGFR)","en":"eGFR"}',                 'mL/min', 'blood','Serum (qizil)',2,'Chemistry',35),
  ('UA',   '62292-8', '{"uz-Latn":"Siydik kislotasi","ru":"Мочевая кислота","en":"Uric acid"}',                  'umol/L', 'blood','Serum (qizil)',2,'Chemistry',36),
  ('TP',   '2885-2',  '{"uz-Latn":"Umumiy oqsil","ru":"Общий белок","en":"Total protein"}',                      'g/L',    'blood','Serum (qizil)',2,'Chemistry',37),
  ('ALB',  '1751-7',  '{"uz-Latn":"Albumin","ru":"Альбумин","en":"Albumin"}',                                    'g/L',    'blood','Serum (qizil)',2,'Chemistry',38),
  ('ALT',  '1742-6',  '{"uz-Latn":"ALT (alaninaminotransferaza)","ru":"АЛТ","en":"ALT"}',                        'U/L',    'blood','Serum (qizil)',2,'Chemistry',39),
  ('AST',  '1920-8',  '{"uz-Latn":"AST (aspartataminotransferaza)","ru":"АСТ","en":"AST"}',                      'U/L',    'blood','Serum (qizil)',2,'Chemistry',40),
  ('GGT',  '2324-2',  '{"uz-Latn":"GGT (gamma-GT)","ru":"ГГТ","en":"GGT"}',                                      'U/L',    'blood','Serum (qizil)',2,'Chemistry',41),
  ('ALP',  '6768-6',  '{"uz-Latn":"Ishqoriy fosfataza (ALP)","ru":"Щелочная фосфатаза","en":"Alkaline phosphatase"}','U/L','blood','Serum (qizil)',2,'Chemistry',42),
  ('TBIL', '1975-2',  '{"uz-Latn":"Umumiy bilirubin","ru":"Билирубин общий","en":"Bilirubin total"}',            'umol/L', 'blood','Serum (qizil)',2,'Chemistry',43),
  ('DBIL', '1968-7',  '{"uz-Latn":"To''g''ri bilirubin","ru":"Билирубин прямой","en":"Bilirubin direct"}',       'umol/L', 'blood','Serum (qizil)',2,'Chemistry',44),
  ('AMY',  '1759-0',  '{"uz-Latn":"Amilaza","ru":"Амилаза","en":"Amylase"}',                                     'U/L',    'blood','Serum (qizil)',2,'Chemistry',45),
  ('LDH',  '2532-0',  '{"uz-Latn":"LDG (laktatdegidrogenaza)","ru":"ЛДГ","en":"LDH"}',                           'U/L',    'blood','Serum (qizil)',2,'Chemistry',46),
  ('CK',   '2157-6',  '{"uz-Latn":"KFK (kreatinkinaza)","ru":"КФК","en":"Creatine kinase"}',                    'U/L',    'blood','Serum (qizil)',2,'Chemistry',47),
  ('CRP',  '1988-5',  '{"uz-Latn":"C-reaktiv oqsil (CRP)","ru":"С-реактивный белок","en":"CRP"}',               'mg/L',   'blood','Serum (qizil)',2,'Chemistry',48),
  -- ── Lipid ──────────────────────────────────────────────────────────────────
  ('CHOL', '2093-3',  '{"uz-Latn":"Umumiy xolesterin","ru":"Холестерин общий","en":"Cholesterol total"}',        'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',50),
  ('TG',   '2571-8',  '{"uz-Latn":"Triglitseridlar","ru":"Триглицериды","en":"Triglycerides"}',                  'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',51),
  ('HDL',  '2085-9',  '{"uz-Latn":"HDL xolesterin","ru":"ЛПВП (HDL)","en":"HDL cholesterol"}',                   'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',52),
  ('LDL',  '2089-1',  '{"uz-Latn":"LDL xolesterin","ru":"ЛПНП (LDL)","en":"LDL cholesterol"}',                   'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',53),
  -- ── Elektrolitlar / mineral ────────────────────────────────────────────────
  ('NA',   '2951-2',  '{"uz-Latn":"Natriy (Na)","ru":"Натрий (Na)","en":"Sodium"}',                              'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',60),
  ('K',    '2823-3',  '{"uz-Latn":"Kaliy (K)","ru":"Калий (K)","en":"Potassium"}',                               'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',61),
  ('CL',   '2075-0',  '{"uz-Latn":"Xlor (Cl)","ru":"Хлор (Cl)","en":"Chloride"}',                                'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',62),
  ('CA',   '17861-6', '{"uz-Latn":"Kalsiy (Ca)","ru":"Кальций (Ca)","en":"Calcium"}',                            'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',63),
  ('MG',   '19123-9', '{"uz-Latn":"Magniy (Mg)","ru":"Магний (Mg)","en":"Magnesium"}',                           'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',64),
  ('PHOS', '2777-1',  '{"uz-Latn":"Fosfor (P)","ru":"Фосфор (P)","en":"Phosphorus"}',                            'mmol/L', 'blood','Serum (qizil)',2,'Chemistry',65),
  -- ── Temir almashinuvi ──────────────────────────────────────────────────────
  ('FE',   '2498-4',  '{"uz-Latn":"Zardob temiri","ru":"Сывороточное железо","en":"Serum iron"}',                'umol/L', 'blood','Serum (qizil)',4,'Chemistry',70),
  ('TIBC', '3034-6',  '{"uz-Latn":"Temir bog''lash qobiliyati (TIBC)","ru":"ОЖСС (TIBC)","en":"TIBC"}',          'umol/L', 'blood','Serum (qizil)',4,'Chemistry',71),
  ('FERR', '2276-4',  '{"uz-Latn":"Ferritin","ru":"Ферритин","en":"Ferritin"}',                                  'ng/mL',  'blood','Serum (qizil)',24,'Chemistry',72),
  -- ── Gormonlar ──────────────────────────────────────────────────────────────
  ('TSH',  '3016-3',  '{"uz-Latn":"TSH (tireotrop gormon)","ru":"ТТГ","en":"TSH"}',                              'mIU/L',  'blood','Serum (qizil)',24,'Hormones',80),
  ('FT4',  '3024-7',  '{"uz-Latn":"Erkin T4 (FT4)","ru":"Свободный T4","en":"Free T4"}',                         'ng/dL',  'blood','Serum (qizil)',24,'Hormones',81),
  ('FT3',  '3051-0',  '{"uz-Latn":"Erkin T3 (FT3)","ru":"Свободный T3","en":"Free T3"}',                         'pg/mL',  'blood','Serum (qizil)',24,'Hormones',82),
  ('ATPO', '27353-2', '{"uz-Latn":"Anti-TPO","ru":"Анти-ТПО","en":"Anti-TPO"}',                                 'IU/mL',  'blood','Serum (qizil)',24,'Hormones',83),
  ('HCG',  '2106-3',  '{"uz-Latn":"Beta-hCG (homiladorlik)","ru":"Бета-ХГЧ","en":"Beta-hCG"}',                   'mIU/mL', 'blood','Serum (qizil)',24,'Hormones',84),
  ('PRL',  '2842-3',  '{"uz-Latn":"Prolaktin","ru":"Пролактин","en":"Prolactin"}',                               'ng/mL',  'blood','Serum (qizil)',24,'Hormones',85),
  ('FSH',  '15067-2', '{"uz-Latn":"FSH","ru":"ФСГ","en":"FSH"}',                                                 'mIU/mL', 'blood','Serum (qizil)',24,'Hormones',86),
  ('LH',   '10501-5', '{"uz-Latn":"LH","ru":"ЛГ","en":"LH"}',                                                    'mIU/mL', 'blood','Serum (qizil)',24,'Hormones',87),
  ('TES',  '2986-8',  '{"uz-Latn":"Testosteron","ru":"Тестостерон","en":"Testosterone"}',                        'nmol/L', 'blood','Serum (qizil)',24,'Hormones',88),
  ('COR',  '2143-6',  '{"uz-Latn":"Kortizol","ru":"Кортизол","en":"Cortisol"}',                                  'nmol/L', 'blood','Serum (qizil)',24,'Hormones',89),
  ('VITD', '1989-3',  '{"uz-Latn":"Vitamin D (25-OH)","ru":"Витамин D (25-OH)","en":"Vitamin D"}',               'ng/mL',  'blood','Serum (qizil)',24,'Vitamins',90),
  ('VB12', '2132-9',  '{"uz-Latn":"Vitamin B12","ru":"Витамин B12","en":"Vitamin B12"}',                         'pg/mL',  'blood','Serum (qizil)',24,'Vitamins',91),
  -- ── Yurak ──────────────────────────────────────────────────────────────────
  ('TNI',  '10839-9', '{"uz-Latn":"Troponin I","ru":"Тропонин I","en":"Troponin I"}',                            'ng/mL',  'blood','Serum (qizil)',2,'Cardiac',95),
  -- ── Koagulyatsiya ──────────────────────────────────────────────────────────
  ('PT',   '5902-2',  '{"uz-Latn":"Protrombin vaqti (PT)","ru":"Протромбиновое время","en":"Prothrombin time"}', 's',      'blood','Sitrat (ko''k)',2,'Coagulation',100),
  ('INR',  '6301-6',  '{"uz-Latn":"INR","ru":"МНО (INR)","en":"INR"}',                                           '{ratio}','blood','Sitrat (ko''k)',2,'Coagulation',101),
  ('APTT', '3173-2',  '{"uz-Latn":"APTT","ru":"АЧТВ","en":"aPTT"}',                                              's',      'blood','Sitrat (ko''k)',2,'Coagulation',102),
  ('FIB',  '3255-7',  '{"uz-Latn":"Fibrinogen","ru":"Фибриноген","en":"Fibrinogen"}',                            'g/L',    'blood','Sitrat (ko''k)',2,'Coagulation',103),
  ('DDIM', '48065-7', '{"uz-Latn":"D-dimer","ru":"D-димер","en":"D-dimer"}',                                     'ug/mL',  'blood','Sitrat (ko''k)',4,'Coagulation',104),
  -- ── Siydik (test-strip / mikroskopiya) ─────────────────────────────────────
  ('UCOL', '5778-6',  '{"uz-Latn":"Siydik rangi","ru":"Цвет мочи","en":"Urine color"}',                          NULL,     'urine','Siydik idishi',2,'Urinalysis',110),
  ('UAPP', '5767-9',  '{"uz-Latn":"Tiniqligi","ru":"Прозрачность","en":"Appearance"}',                           NULL,     'urine','Siydik idishi',2,'Urinalysis',111),
  ('USG',  '5811-5',  '{"uz-Latn":"Solishtirma zichlik","ru":"Удельный вес","en":"Specific gravity"}',           '{ratio}','urine','Siydik idishi',2,'Urinalysis',112),
  ('UPH',  '5803-2',  '{"uz-Latn":"pH","ru":"pH","en":"pH"}',                                                    '{pH}',   'urine','Siydik idishi',2,'Urinalysis',113),
  ('UPRO', '5804-0',  '{"uz-Latn":"Oqsil (siydik)","ru":"Белок (моча)","en":"Protein (urine)"}',                 'mg/dL',  'urine','Siydik idishi',2,'Urinalysis',114),
  ('UGLU', '5792-7',  '{"uz-Latn":"Glyukoza (siydik)","ru":"Глюкоза (моча)","en":"Glucose (urine)"}',            'mg/dL',  'urine','Siydik idishi',2,'Urinalysis',115),
  ('UKET', '5797-6',  '{"uz-Latn":"Ketonlar","ru":"Кетоны","en":"Ketones"}',                                     'mg/dL',  'urine','Siydik idishi',2,'Urinalysis',116),
  ('UBLD', '5794-3',  '{"uz-Latn":"Qon (siydik)","ru":"Кровь (моча)","en":"Blood (urine)"}',                     NULL,     'urine','Siydik idishi',2,'Urinalysis',117),
  ('ULE',  '5799-2',  '{"uz-Latn":"Leykotsit esteraza","ru":"Лейкоцитарная эстераза","en":"Leukocyte esterase"}',NULL,    'urine','Siydik idishi',2,'Urinalysis',118),
  ('UNIT', '5802-4',  '{"uz-Latn":"Nitritlar","ru":"Нитриты","en":"Nitrite"}',                                   NULL,     'urine','Siydik idishi',2,'Urinalysis',119),
  ('URBC', '13945-1', '{"uz-Latn":"Eritrotsitlar (siydik, mikr.)","ru":"Эритроциты (микроскопия)","en":"RBC (urine)"}','/[HPF]','urine','Siydik idishi',2,'Urinalysis',120),
  ('UWBC', '5821-4',  '{"uz-Latn":"Leykotsitlar (siydik, mikr.)","ru":"Лейкоциты (микроскопия)","en":"WBC (urine)"}','/[HPF]','urine','Siydik idishi',2,'Urinalysis',121),
  -- ── Najas ──────────────────────────────────────────────────────────────────
  ('FOB',  '2335-8',  '{"uz-Latn":"Najasda yashirin qon","ru":"Скрытая кровь в кале","en":"Fecal occult blood"}',NULL,    'stool','Najas idishi',24,'Stool',125),
  ('OVA',  '10700-3', '{"uz-Latn":"Gijja va parazitlar","ru":"Яйца глистов и паразиты","en":"Ova & parasites"}', NULL,     'stool','Najas idishi',24,'Stool',126),
  -- ── Serologiya / infeksiya ─────────────────────────────────────────────────
  ('HBSAG','5196-1',  '{"uz-Latn":"HBsAg (gepatit B)","ru":"HBsAg (гепатит B)","en":"HBsAg"}',                   NULL,     'blood','Serum (qizil)',24,'Serology',130),
  ('HCV',  '16128-1', '{"uz-Latn":"Anti-HCV (gepatit C)","ru":"Анти-HCV (гепатит C)","en":"Anti-HCV"}',          NULL,     'blood','Serum (qizil)',24,'Serology',131),
  ('HIV',  '5017-9',  '{"uz-Latn":"HIV (OITS)","ru":"ВИЧ","en":"HIV Ab"}',                                       NULL,     'blood','Serum (qizil)',24,'Serology',132),
  ('SYPH', '14502-9', '{"uz-Latn":"Zahm (sifilis, RW)","ru":"Сифилис (RW)","en":"Syphilis"}',                    NULL,     'blood','Serum (qizil)',24,'Serology',133),
  ('ASO',  '7917-8',  '{"uz-Latn":"ASL-O (antistreptolizin)","ru":"АСЛ-О","en":"ASO"}',                          'IU/mL',  'blood','Serum (qizil)',24,'Serology',134),
  ('RF',   '11572-5', '{"uz-Latn":"Revmatoid faktor (RF)","ru":"Ревматоидный фактор","en":"Rheumatoid factor"}', 'IU/mL',  'blood','Serum (qizil)',24,'Serology',135),
  ('HPYL', '7902-0',  '{"uz-Latn":"Helicobacter pylori (antitelo)","ru":"H. pylori (антитела)","en":"H. pylori Ab"}',NULL, 'blood','Serum (qizil)',24,'Serology',136),
  -- ── Onkomarkerlar ──────────────────────────────────────────────────────────
  ('PSA',  '2857-1',  '{"uz-Latn":"PSA (umumiy)","ru":"ПСА общий","en":"PSA total"}',                            'ng/mL',  'blood','Serum (qizil)',24,'Oncology',140),
  ('CEA',  '2039-6',  '{"uz-Latn":"CEA (rak-embrional antigen)","ru":"РЭА (CEA)","en":"CEA"}',                    'ng/mL',  'blood','Serum (qizil)',24,'Oncology',141),
  ('AFP',  '1834-1',  '{"uz-Latn":"AFP (alfa-fetoprotein)","ru":"АФП","en":"AFP"}',                              'ng/mL',  'blood','Serum (qizil)',24,'Oncology',142),
  ('CA125','24108-3', '{"uz-Latn":"CA 125","ru":"CA 125","en":"CA 125"}',                                        'U/mL',   'blood','Serum (qizil)',24,'Oncology',143),
  ('CA199','24111-7', '{"uz-Latn":"CA 19-9","ru":"CA 19-9","en":"CA 19-9"}',                                     'U/mL',   'blood','Serum (qizil)',24,'Oncology',144)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- SEED — panel shablonlari
-- =============================================================================
INSERT INTO lab_panel_templates (code, name_i18n, description, sort_order)
VALUES
  ('CBC',    '{"uz-Latn":"Umumiy qon tahlili (CBC)","ru":"Общий анализ крови (ОАК)","en":"Complete blood count"}', 'Leykotsitlar, eritrotsitlar, gemoglobin, trombotsitlar, differensial, ECHT', 1),
  ('CHEM',   '{"uz-Latn":"Biokimyoviy tahlil","ru":"Биохимический анализ","en":"Biochemistry panel"}',           'Glyukoza, mochevina, kreatinin, jigar fermentlari, oqsil', 2),
  ('LIPID',  '{"uz-Latn":"Lipid profili","ru":"Липидный профиль","en":"Lipid panel"}',                           'Xolesterin, triglitseridlar, HDL, LDL', 3),
  ('LFT',    '{"uz-Latn":"Jigar paneli","ru":"Печёночные пробы","en":"Liver function tests"}',                   'ALT, AST, GGT, ALP, bilirubin, oqsil, albumin', 4),
  ('RFT',    '{"uz-Latn":"Buyrak paneli","ru":"Почечные пробы","en":"Renal function tests"}',                    'Mochevina, kreatinin, eGFR, siydik kislotasi, elektrolitlar', 5),
  ('THYROID','{"uz-Latn":"Qalqonsimon bez paneli","ru":"Щитовидная железа","en":"Thyroid panel"}',              'TSH, erkin T4, erkin T3, anti-TPO', 6),
  ('ELEC',   '{"uz-Latn":"Elektrolitlar","ru":"Электролиты","en":"Electrolytes"}',                               'Natriy, kaliy, xlor, kalsiy, magniy, fosfor', 7),
  ('COAG',   '{"uz-Latn":"Koagulogramma","ru":"Коагулограмма","en":"Coagulation panel"}',                        'PT, INR, APTT, fibrinogen', 8),
  ('UA',     '{"uz-Latn":"Siydik umumiy tahlili","ru":"Общий анализ мочи (ОАМ)","en":"Urinalysis"}',            'Rang, zichlik, pH, oqsil, glyukoza, mikroskopiya', 9),
  ('IRON',   '{"uz-Latn":"Temir almashinuvi","ru":"Обмен железа","en":"Iron studies"}',                          'Temir, TIBC, ferritin', 10),
  ('DIAB',   '{"uz-Latn":"Diabet nazorati","ru":"Контроль диабета","en":"Diabetes monitoring"}',                 'Ochlik glyukozasi, HbA1c', 11),
  ('PREOP',  '{"uz-Latn":"Operatsiya oldi skrining","ru":"Предоперационный скрининг","en":"Pre-op screening"}', 'HBsAg, anti-HCV, HIV, zahm, qon guruhi', 12)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lab_panel_template_items (panel_code, loinc_code, sort_order)
VALUES
  -- CBC
  ('CBC','6690-2',1),('CBC','789-8',2),('CBC','718-7',3),('CBC','4544-3',4),('CBC','777-3',5),
  ('CBC','787-2',6),('CBC','785-6',7),('CBC','786-4',8),('CBC','788-0',9),
  ('CBC','770-8',10),('CBC','736-9',11),('CBC','5905-5',12),('CBC','713-8',13),('CBC','706-2',14),('CBC','4537-7',15),
  -- CHEM (biokimyo asosiy)
  ('CHEM','2345-7',1),('CHEM','3094-0',2),('CHEM','2160-0',3),('CHEM','1742-6',4),('CHEM','1920-8',5),
  ('CHEM','1975-2',6),('CHEM','2885-2',7),('CHEM','1751-7',8),('CHEM','6768-6',9),('CHEM','62292-8',10),
  -- LIPID
  ('LIPID','2093-3',1),('LIPID','2571-8',2),('LIPID','2085-9',3),('LIPID','2089-1',4),
  -- LFT
  ('LFT','1742-6',1),('LFT','1920-8',2),('LFT','2324-2',3),('LFT','6768-6',4),
  ('LFT','1975-2',5),('LFT','1968-7',6),('LFT','2885-2',7),('LFT','1751-7',8),
  -- RFT
  ('RFT','3094-0',1),('RFT','2160-0',2),('RFT','33914-3',3),('RFT','62292-8',4),('RFT','2951-2',5),('RFT','2823-3',6),
  -- THYROID
  ('THYROID','3016-3',1),('THYROID','3024-7',2),('THYROID','3051-0',3),('THYROID','27353-2',4),
  -- ELEC
  ('ELEC','2951-2',1),('ELEC','2823-3',2),('ELEC','2075-0',3),('ELEC','17861-6',4),('ELEC','19123-9',5),('ELEC','2777-1',6),
  -- COAG
  ('COAG','5902-2',1),('COAG','6301-6',2),('COAG','3173-2',3),('COAG','3255-7',4),
  -- UA (siydik)
  ('UA','5778-6',1),('UA','5767-9',2),('UA','5811-5',3),('UA','5803-2',4),('UA','5804-0',5),
  ('UA','5792-7',6),('UA','5797-6',7),('UA','5794-3',8),('UA','5799-2',9),('UA','5802-4',10),
  ('UA','13945-1',11),('UA','5821-4',12),
  -- IRON
  ('IRON','2498-4',1),('IRON','3034-6',2),('IRON','2276-4',3),
  -- DIAB
  ('DIAB','1558-6',1),('DIAB','4548-4',2),
  -- PREOP
  ('PREOP','5196-1',1),('PREOP','16128-1',2),('PREOP','5017-9',3),('PREOP','14502-9',4),('PREOP','882-1',5)
ON CONFLICT (panel_code, loinc_code) DO NOTHING;
