-- =============================================================================
-- Laboratoriya moduli — GLOBAL KONTENT (Faza A)
-- =============================================================================
-- Maqsad: LOINC global reference'ni kengaytirish (biokimyo, gormonlar, gematologiya,
-- koagulyatsiya, siydik, serologiya, tumor markerlar, vitaminlar) + birlik
-- konvertatsiya jadvali (UCUM asosida, an'anaviy ↔ SI).
--
-- Hech narsa buzilmaydi: faqat loinc_tests'ga yangi qatorlar (ON CONFLICT DO NOTHING)
-- va yangi lab_unit_conversions jadvali qo'shiladi. Jahon standarti: LOINC + UCUM.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) loinc_tests — kengaytirilgan seed (klinik jihatdan eng ko'p buyuriladigan)
-- -----------------------------------------------------------------------------
INSERT INTO loinc_tests (loinc_code, long_name, short_name, component, unit, category, search_text)
VALUES
  -- ── Biokimyo / Chemistry (qo'shimcha) ──────────────────────────────────────
  ('2532-0',  'Lactate dehydrogenase [Enzymatic activity/volume] in Serum or Plasma', 'LDH',        'Lactate dehydrogenase', 'U/L',    'Chemistry',  'ldh laktatdegidrogenaza lactate dehydrogenase'),
  ('2157-6',  'Creatine kinase [Enzymatic activity/volume] in Serum or Plasma',       'CK',         'Creatine kinase',       'U/L',    'Chemistry',  'ck creatine kinase kfk kreatinkinaza'),
  ('13969-1', 'Creatine kinase.MB [Mass/volume] in Serum or Plasma',                  'CK-MB',      'Creatine kinase MB',    'ng/mL',  'Chemistry',  'ck mb creatine kinase mb kfk mv yurak'),
  ('6768-6',  'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma',  'ALP',        'Alkaline phosphatase',  'U/L',    'Chemistry',  'alp ishqoriy fosfataza alkaline phosphatase'),
  ('2324-2',  'Gamma glutamyl transferase [Enzymatic activity/volume] in Serum',      'GGT',        'GGT',                   'U/L',    'Chemistry',  'ggt gamma glutamil ggtp jigar'),
  ('1968-7',  'Bilirubin.direct [Mass/volume] in Serum or Plasma',                    'Direct bilirubin', 'Bilirubin direct', 'mg/dL', 'Chemistry',  'direct bilirubin togri bilirubin konyugirlangan'),
  ('1971-1',  'Bilirubin.indirect [Mass/volume] in Serum or Plasma',                  'Indirect bilirubin', 'Bilirubin indirect', 'mg/dL', 'Chemistry', 'indirect bilirubin bogliq bilirubin'),
  ('2777-1',  'Phosphate [Mass/volume] in Serum or Plasma',                           'Phosphorus', 'Phosphate',             'mg/dL',  'Chemistry',  'phosphorus fosfor phosphate fosfat'),
  ('19123-9', 'Magnesium [Mass/volume] in Serum or Plasma',                           'Magnesium',  'Magnesium',             'mg/dL',  'Chemistry',  'magnesium magniy mg'),
  ('2498-4',  'Iron [Mass/volume] in Serum or Plasma',                                'Iron',       'Iron',                  'ug/dL',  'Chemistry',  'iron temir serum iron zhelezo'),
  ('2500-7',  'Iron saturation [Mass Fraction] in Serum or Plasma',                   'Iron saturation', 'Iron saturation', '%',      'Chemistry',  'iron saturation temir toyinganligi'),
  ('3034-6',  'Iron binding capacity [Mass/volume] in Serum or Plasma',               'TIBC',       'Iron binding capacity', 'ug/dL',  'Chemistry',  'tibc temir boglash zhss'),
  ('2276-4',  'Ferritin [Mass/volume] in Serum or Plasma',                            'Ferritin',   'Ferritin',              'ng/mL',  'Chemistry',  'ferritin ferritin temir zaxira'),
  ('1863-0',  'Anion gap in Serum or Plasma',                                         'Anion gap',  'Anion gap',             'mmol/L', 'Chemistry',  'anion gap anion tanqisligi'),
  ('1959-6',  'Bicarbonate [Moles/volume] in Blood',                                  'Bicarbonate','Bicarbonate',           'mmol/L', 'Chemistry',  'bicarbonate bikarbonat hco3'),
  ('33914-3', 'Glomerular filtration rate/1.73 sq M.predicted [Volume Rate/Area] in Serum or Plasma by Creatinine-based formula (MDRD)', 'eGFR', 'GFR estimated', 'mL/min/{1.73_m2}', 'Chemistry', 'egfr gfr buyrak filtratsiya'),
  ('30522-7', 'C reactive protein [Mass/volume] in Serum or Plasma by High sensitivity method', 'hs-CRP', 'C-reactive protein HS', 'mg/L', 'Chemistry', 'hs crp yuqori sezgir c reactive protein'),
  ('62292-8', 'Uric acid [Mass/volume] in Serum or Plasma',                           'Uric acid',  'Urate',                 'mg/dL',  'Chemistry',  'uric acid siydik kislotasi urat mochevaya'),
  ('14957-5', 'Microalbumin [Mass/volume] in Urine',                                  'Microalbumin','Microalbumin urine',   'mg/L',   'Chemistry',  'microalbumin mikroalbumin siydik'),
  -- ── Gormonlar / Hormones (qo'shimcha) ──────────────────────────────────────
  ('3026-2',  'Thyroxine (T4) [Mass/volume] in Serum or Plasma',                      'Total T4',   'Thyroxine total',       'ug/dL',  'Hormones',   'total t4 umumiy t4 tiroksin'),
  ('3053-6',  'Triiodothyronine (T3) [Mass/volume] in Serum or Plasma',               'Total T3',   'Triiodothyronine total','ng/dL',  'Hormones',   'total t3 umumiy t3'),
  ('2842-3',  'Prolactin [Mass/volume] in Serum or Plasma',                           'Prolactin',  'Prolactin',             'ng/mL',  'Hormones',   'prolactin prolaktin gormon'),
  ('15067-2', 'Follitropin [Units/volume] in Serum or Plasma',                        'FSH',        'FSH',                   'mIU/mL', 'Hormones',   'fsh follitropin follikul'),
  ('10501-5', 'Lutropin [Units/volume] in Serum or Plasma',                           'LH',         'LH',                    'mIU/mL', 'Hormones',   'lh lutropin luteinlovchi'),
  ('2839-9',  'Progesterone [Mass/volume] in Serum or Plasma',                        'Progesterone','Progesterone',         'ng/mL',  'Hormones',   'progesterone progesteron gormon'),
  ('2191-5',  'Dehydroepiandrosterone sulfate [Mass/volume] in Serum or Plasma',      'DHEA-S',     'DHEA sulfate',          'ug/dL',  'Hormones',   'dhea s dgea gormon'),
  ('20448-7', 'Insulin [Units/volume] in Serum or Plasma',                            'Insulin',    'Insulin',               'uIU/mL', 'Hormones',   'insulin insulin gormon'),
  ('1986-9',  'Insulin-like growth factor-I [Mass/volume] in Serum or Plasma',        'IGF-1',      'IGF-1',                 'ng/mL',  'Hormones',   'igf 1 osish gormoni'),
  ('27353-2', 'Thyroid peroxidase Ab [Units/volume] in Serum or Plasma',              'Anti-TPO',   'TPO antibody',          'IU/mL',  'Hormones',   'anti tpo qalqonsimon antitelo'),
  ('2731-8',  'Parathyrin.intact [Mass/volume] in Serum or Plasma',                   'PTH',        'Parathyroid hormone',   'pg/mL',  'Hormones',   'pth paratgormon qalqonsimon oldi'),
  -- ── Yurak markerlari / Cardiac ─────────────────────────────────────────────
  ('10839-9', 'Troponin I.cardiac [Mass/volume] in Serum or Plasma',                  'Troponin I', 'Troponin I',            'ng/mL',  'Cardiac',    'troponin i yurak infarkt'),
  ('6598-7',  'Troponin T.cardiac [Mass/volume] in Serum or Plasma',                  'Troponin T', 'Troponin T',            'ng/mL',  'Cardiac',    'troponin t yurak infarkt'),
  ('33762-6', 'Natriuretic peptide.B prohormone N-Terminal [Mass/volume] in Serum or Plasma', 'NT-proBNP', 'NT-proBNP',      'pg/mL',  'Cardiac',    'nt probnp yurak yetishmovchilik'),
  -- ── Gematologiya / Hematology (CBC differensial to'ldirish) ─────────────────
  ('751-8',   'Neutrophils [#/volume] in Blood',                                      'Neutrophils #','Neutrophils abs',     '10*3/uL','Hematology', 'neutrophils absolyut neytrofil'),
  ('731-0',   'Lymphocytes [#/volume] in Blood',                                      'Lymphocytes #','Lymphocytes abs',     '10*3/uL','Hematology', 'lymphocytes absolyut limfotsit'),
  ('5905-5',  'Monocytes/100 leukocytes in Blood',                                    'Monocytes %','Monocytes',             '%',      'Hematology', 'monocytes monotsit'),
  ('713-8',   'Eosinophils/100 leukocytes in Blood',                                  'Eosinophils %','Eosinophils',         '%',      'Hematology', 'eosinophils eozinofil'),
  ('706-2',   'Basophils/100 leukocytes in Blood',                                    'Basophils %','Basophils',             '%',      'Hematology', 'basophils bazofil'),
  ('788-0',   'Erythrocyte distribution width [Ratio] by Automated count',            'RDW',        'RDW',                   '%',      'Hematology', 'rdw eritrotsit taqsimot'),
  ('32623-1', 'Platelet mean volume [Entitic volume] in Blood',                       'MPV',        'Platelet mean volume',  'fL',     'Hematology', 'mpv trombotsit hajmi'),
  ('17849-1', 'Reticulocytes/100 erythrocytes in Blood',                              'Reticulocytes','Reticulocytes',       '%',      'Hematology', 'reticulocytes retikulotsit'),
  ('882-1',   'ABO and Rh group [Type] in Blood',                                     'Blood group','ABO+Rh',                NULL,     'Hematology', 'blood group qon guruhi abo rezus rh'),
  -- ── Koagulyatsiya / Coagulation (qo'shimcha) ───────────────────────────────
  ('3255-7',  'Fibrinogen [Mass/volume] in Platelet poor plasma',                     'Fibrinogen', 'Fibrinogen',            'mg/dL',  'Coagulation','fibrinogen fibrinogen'),
  ('48065-7', 'Fibrin D-dimer FEU [Mass/volume] in Platelet poor plasma',             'D-dimer',    'D-dimer',               'ug/mL',  'Coagulation','d dimer tromboz'),
  -- ── Siydik tahlili / Urinalysis (qo'shimcha) ───────────────────────────────
  ('5794-3',  'Hemoglobin [Presence] in Urine by Test strip',                         'Urine blood','Hemoglobin urine',      NULL,     'Urinalysis', 'urine blood siydik qon gemoglobin'),
  ('5797-6',  'Ketones [Mass/volume] in Urine by Test strip',                         'Urine ketones','Ketones urine',       'mg/dL',  'Urinalysis', 'ketones ketonlar atseton'),
  ('5802-4',  'Nitrite [Presence] in Urine by Test strip',                            'Urine nitrite','Nitrite urine',       NULL,     'Urinalysis', 'nitrite nitrit infeksiya'),
  ('5770-3',  'Bilirubin [Presence] in Urine by Test strip',                          'Urine bilirubin','Bilirubin urine',   NULL,     'Urinalysis', 'urine bilirubin siydik bilirubin'),
  ('5818-0',  'Urobilinogen [Mass/volume] in Urine by Test strip',                    'Urobilinogen','Urobilinogen',         'mg/dL',  'Urinalysis', 'urobilinogen urobilinogen'),
  ('5767-9',  'Appearance of Urine',                                                  'Urine appearance','Appearance',       NULL,     'Urinalysis', 'appearance tiniqlik loyqalik'),
  ('5778-6',  'Color of Urine',                                                       'Urine color','Color',                NULL,     'Urinalysis', 'color rang siydik'),
  ('13945-1', 'Erythrocytes [#/area] in Urine sediment by Microscopy high power field','Urine RBC', 'RBC urine',            '/[HPF]', 'Urinalysis', 'urine rbc siydik eritrotsit mikroskopiya'),
  ('5821-4',  'Leukocytes [#/area] in Urine sediment by Microscopy high power field', 'Urine WBC',  'WBC urine',             '/[HPF]', 'Urinalysis', 'urine wbc siydik leykotsit mikroskopiya'),
  -- ── Najas / Stool ──────────────────────────────────────────────────────────
  ('2335-8',  'Hemoglobin.gastrointestinal [Presence] in Stool',                      'Fecal occult blood','FOB',            NULL,     'Stool',      'occult blood yashirin qon najas kal'),
  ('10700-3', 'Ova+Parasites identified in Stool by Light microscopy',                'Ova & parasites','Parasites stool',   NULL,     'Stool',      'parasites gijja parazit najas kopr'),
  -- ── Serologiya / Infeksiya (qo'shimcha) ────────────────────────────────────
  ('22322-2', 'Hepatitis B virus surface Ab [Units/volume] in Serum',                 'Anti-HBs',   'HBsAb',                 'mIU/mL', 'Serology',   'anti hbs gepatit b antitelo'),
  ('13952-7', 'Hepatitis B virus core Ab [Presence] in Serum',                        'Anti-HBc',   'HBcAb',                 NULL,     'Serology',   'anti hbc gepatit b core'),
  ('5195-3',  'Hepatitis B virus surface Ag [Units/volume] in Serum',                 'HBsAg quant','HBsAg quantitative',    'IU/mL',  'Serology',   'hbsag miqdoriy gepatit b'),
  ('7917-8',  'Antistreptolysin O Ab [Units/volume] in Serum',                        'ASO',        'Antistreptolysin O',    'IU/mL',  'Serology',   'aso antistreptolizin revmatizm'),
  ('11572-5', 'Rheumatoid factor [Units/volume] in Serum',                            'RF',         'Rheumatoid factor',     'IU/mL',  'Serology',   'rf revmatoid faktor'),
  ('7902-0',  'Helicobacter pylori Ab [Units/volume] in Serum',                       'H. pylori Ab','Helicobacter Ab',      NULL,     'Serology',   'helicobacter pylori xelikobakter'),
  ('94500-6', 'SARS-CoV-2 RNA [Presence] in Respiratory specimen by NAA',             'SARS-CoV-2 PCR','COVID PCR',          NULL,     'Serology',   'covid koronavirus sars cov 2 pcr'),
  ('22577-1', 'Toxoplasma gondii IgG Ab [Units/volume] in Serum',                     'Toxo IgG',   'Toxoplasma IgG',        'IU/mL',  'Serology',   'toxoplasma toksoplazma torch'),
  ('25514-1', 'Rubella virus IgG Ab [Presence] in Serum',                             'Rubella IgG','Rubella IgG',           NULL,     'Serology',   'rubella qizilcha torch'),
  ('22239-3', 'Cytomegalovirus IgG Ab [Presence] in Serum',                           'CMV IgG',    'CMV IgG',               NULL,     'Serology',   'cmv sitomegalovirus torch'),
  -- ── Tumor markerlar / Oncology ─────────────────────────────────────────────
  ('2857-1',  'Prostate specific Ag [Mass/volume] in Serum or Plasma',                'PSA',        'PSA total',             'ng/mL',  'Oncology',   'psa prostata prostat rak'),
  ('10886-0', 'Prostate specific Ag.free [Mass/volume] in Serum or Plasma',           'Free PSA',   'PSA free',              'ng/mL',  'Oncology',   'free psa erkin psa'),
  ('2039-6',  'Carcinoembryonic Ag [Mass/volume] in Serum or Plasma',                 'CEA',        'CEA',                   'ng/mL',  'Oncology',   'cea rak embrional'),
  ('1834-1',  'Alpha-1-Fetoprotein [Mass/volume] in Serum or Plasma',                 'AFP',        'Alpha-fetoprotein',     'ng/mL',  'Oncology',   'afp alfa fetoprotein'),
  ('24108-3', 'Cancer Ag 125 [Units/volume] in Serum or Plasma',                      'CA 125',     'CA 125',                'U/mL',   'Oncology',   'ca 125 tuxumdon rak'),
  ('24111-7', 'Cancer Ag 19-9 [Units/volume] in Serum or Plasma',                     'CA 19-9',    'CA 19-9',               'U/mL',   'Oncology',   'ca 19 9 oshqozon osti rak'),
  -- ── Vitaminlar / Vitamins ──────────────────────────────────────────────────
  ('1989-3',  '25-Hydroxyvitamin D3 [Mass/volume] in Serum or Plasma',                'Vitamin D',  '25-OH Vitamin D',       'ng/mL',  'Vitamins',   'vitamin d 25 oh kalsidiol'),
  ('2132-9',  'Cobalamin (Vitamin B12) [Mass/volume] in Serum or Plasma',             'Vitamin B12','Cobalamin',             'pg/mL',  'Vitamins',   'vitamin b12 kobalamin'),
  ('2284-8',  'Folate [Mass/volume] in Serum or Plasma',                              'Folate',     'Folate',                'ng/mL',  'Vitamins',   'folate folat b9 fol kislota')
ON CONFLICT (loinc_code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2) lab_unit_conversions — an'anaviy ↔ SI birlik konvertatsiya (UCUM asosida)
-- -----------------------------------------------------------------------------
-- Har analit uchun kanonik SI birligiga o'tkazish koeffitsiyenti. Klinika
-- an'anaviy birlikda kiritsa ham tizim SI'da solishtira oladi (referens SI'da).
--   si_value = conventional_value * factor
CREATE TABLE IF NOT EXISTS lab_unit_conversions (
  loinc_code    TEXT NOT NULL REFERENCES loinc_tests(loinc_code) ON DELETE CASCADE,
  from_unit     TEXT NOT NULL,           -- an'anaviy (masalan 'mg/dL')
  to_unit       TEXT NOT NULL,           -- SI (masalan 'mmol/L')
  factor        NUMERIC NOT NULL,        -- si = conv * factor
  is_si_target  BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (loinc_code, from_unit, to_unit)
);

ALTER TABLE lab_unit_conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lab_unit_conv_read ON lab_unit_conversions;
CREATE POLICY p_lab_unit_conv_read ON lab_unit_conversions FOR SELECT USING (true);

COMMENT ON TABLE lab_unit_conversions IS
  'Laborator birlik konvertatsiya (UCUM): an''anaviy ↔ SI. si = conventional * factor. '
  'O''zbekiston/MDH amaliyoti SI (mmol/L) ishlatadi; xalqaro manbalar mg/dL — shu jadval bog''laydi.';

INSERT INTO lab_unit_conversions (loinc_code, from_unit, to_unit, factor)
VALUES
  ('2345-7',  'mg/dL', 'mmol/L', 0.0555),   -- Glucose
  ('1558-6',  'mg/dL', 'mmol/L', 0.0555),   -- Fasting glucose
  ('2093-3',  'mg/dL', 'mmol/L', 0.0259),   -- Cholesterol
  ('2085-9',  'mg/dL', 'mmol/L', 0.0259),   -- HDL
  ('2089-1',  'mg/dL', 'mmol/L', 0.0259),   -- LDL
  ('2571-8',  'mg/dL', 'mmol/L', 0.0113),   -- Triglycerides
  ('2160-0',  'mg/dL', 'umol/L', 88.42),    -- Creatinine
  ('3094-0',  'mg/dL', 'mmol/L', 0.357),    -- Urea (BUN→urea SI)
  ('1975-2',  'mg/dL', 'umol/L', 17.1),     -- Bilirubin total
  ('1968-7',  'mg/dL', 'umol/L', 17.1),     -- Bilirubin direct
  ('62292-8', 'mg/dL', 'umol/L', 59.48),    -- Uric acid
  ('17861-6', 'mg/dL', 'mmol/L', 0.25),     -- Calcium
  ('2777-1',  'mg/dL', 'mmol/L', 0.323),    -- Phosphate
  ('19123-9', 'mg/dL', 'mmol/L', 0.411),    -- Magnesium
  ('2498-4',  'ug/dL', 'umol/L', 0.179),    -- Iron
  ('1989-3',  'ng/mL', 'nmol/L', 2.496),    -- Vitamin D
  ('2132-9',  'pg/mL', 'pmol/L', 0.738),    -- Vitamin B12
  ('2986-8',  'ng/dL', 'nmol/L', 0.0347),   -- Testosterone
  ('2143-6',  'ug/dL', 'nmol/L', 27.59)     -- Cortisol
ON CONFLICT (loinc_code, from_unit, to_unit) DO NOTHING;
