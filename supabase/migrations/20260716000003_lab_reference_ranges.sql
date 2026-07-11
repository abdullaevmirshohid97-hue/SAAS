-- =============================================================================
-- Laboratoriya moduli — STRUKTURALI REFERENS DIAPAZON (Faza C)
-- =============================================================================
-- Oracle Health "Normalcy Ranges" modeli: har analit uchun jins × yosh bandi ×
-- birlik bo'yicha alohida past/yuqori + kritik chegara. Natija kiritilganda
-- flag (normal/low/high/critical_*) avtomatik hisoblanadi.
--
-- clinic_id = NULL  → global standart (SI birliklar, xalqaro + MDH amaliyoti).
-- clinic_id = <uuid> → klinika o'z qiymatini override qiladi (ustunlik beriladi).
-- Yosh — kunlarda (age_min_days ≤ yosh < age_max_days); 0..43800 = barcha yoshlar.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lab_reference_ranges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loinc_code     TEXT NOT NULL REFERENCES loinc_tests(loinc_code) ON DELETE CASCADE,
  clinic_id      UUID REFERENCES clinics(id) ON DELETE CASCADE,  -- NULL = global
  sex            TEXT NOT NULL DEFAULT 'any' CHECK (sex IN ('male','female','any')),
  age_min_days   INT NOT NULL DEFAULT 0,
  age_max_days   INT NOT NULL DEFAULT 43800,
  unit           TEXT,
  low            NUMERIC,
  high           NUMERIC,
  critical_low   NUMERIC,
  critical_high  NUMERIC,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_ref_ranges_lookup
  ON lab_reference_ranges(loinc_code, clinic_id);

-- Global (standart) qatorlar uchun idempotent seed: bir loinc×jins×yosh bandi bir marta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_ref_global
  ON lab_reference_ranges(loinc_code, sex, age_min_days, age_max_days)
  WHERE clinic_id IS NULL;

ALTER TABLE lab_reference_ranges ENABLE ROW LEVEL SECURITY;
-- Global (clinic_id IS NULL) qatorlarni hamma o'qiydi; klinika qatorlarini faqat
-- o'sha klinika (yoki super_admin). Yozish API (service_role) orqali.
DROP POLICY IF EXISTS p_lab_ref_ranges_read ON lab_reference_ranges;
CREATE POLICY p_lab_ref_ranges_read ON lab_reference_ranges
  FOR SELECT
  USING (
    clinic_id IS NULL
    OR clinic_id = public.get_my_clinic_id()
    OR public.get_my_role() = 'super_admin'
  );
DROP POLICY IF EXISTS p_lab_ref_ranges_write ON lab_reference_ranges;
CREATE POLICY p_lab_ref_ranges_write ON lab_reference_ranges
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE lab_reference_ranges IS
  'Strukturali referens diapazon (jins × yosh × birlik). clinic_id NULL = global '
  'standart. Smart entry natija flag''ini avtomatik belgilaydi.';

-- =============================================================================
-- SEED — global standart referens diapazonlar (SI birliklar)
-- =============================================================================
-- Manba: xalqaro klinik referens qiymatlari (Tietz/Mayo) + MDH SI amaliyoti.
-- Ustunlar: loinc_code, sex, age_min_days, age_max_days, unit, low, high, crit_low, crit_high
INSERT INTO lab_reference_ranges
  (loinc_code, sex, age_min_days, age_max_days, unit, low, high, critical_low, critical_high, note)
VALUES
  -- ── Biokimyo ───────────────────────────────────────────────────────────────
  ('2345-7',  'any',    0, 43800, 'mmol/L', 3.9,   5.6,   2.2,  25.0, NULL),
  ('1558-6',  'any',    0, 43800, 'mmol/L', 3.9,   5.5,   2.2,  25.0, 'Ochlik'),
  ('4548-4',  'any',    0, 43800, '%',      4.0,   5.7,   NULL, NULL, 'Normadan yuqori = prediabet/diabet'),
  ('3094-0',  'any',    0, 43800, 'mmol/L', 2.5,   7.5,   NULL, NULL, NULL),
  ('2160-0',  'male',   6570, 43800, 'umol/L', 62,  106,  NULL, 707,  NULL),
  ('2160-0',  'female', 6570, 43800, 'umol/L', 44,  80,   NULL, 707,  NULL),
  ('2160-0',  'any',    0, 6570,  'umol/L', 20,   62,    NULL, NULL, 'Bola'),
  ('62292-8', 'male',   0, 43800, 'umol/L', 200,  420,   NULL, NULL, NULL),
  ('62292-8', 'female', 0, 43800, 'umol/L', 140,  360,   NULL, NULL, NULL),
  ('2885-2',  'any',    0, 43800, 'g/L',    64,   83,    NULL, NULL, NULL),
  ('1751-7',  'any',    0, 43800, 'g/L',    35,   52,    NULL, NULL, NULL),
  ('1742-6',  'male',   0, 43800, 'U/L',    0,    41,    NULL, NULL, NULL),
  ('1742-6',  'female', 0, 43800, 'U/L',    0,    33,    NULL, NULL, NULL),
  ('1920-8',  'any',    0, 43800, 'U/L',    0,    40,    NULL, NULL, NULL),
  ('2324-2',  'male',   0, 43800, 'U/L',    10,   71,    NULL, NULL, NULL),
  ('2324-2',  'female', 0, 43800, 'U/L',    6,    42,    NULL, NULL, NULL),
  ('6768-6',  'any',    6570, 43800, 'U/L', 40,   129,   NULL, NULL, NULL),
  ('6768-6',  'any',    0, 6570,  'U/L',    0,    400,   NULL, NULL, 'Bola (o''sish davri)'),
  ('1975-2',  'any',    0, 43800, 'umol/L', 3,    21,    NULL, 340,  NULL),
  ('1968-7',  'any',    0, 43800, 'umol/L', 0,    5,     NULL, NULL, NULL),
  ('1759-0',  'any',    0, 43800, 'U/L',    28,   100,   NULL, NULL, NULL),
  ('2532-0',  'any',    0, 43800, 'U/L',    125,  220,   NULL, NULL, NULL),
  ('2157-6',  'male',   0, 43800, 'U/L',    39,   308,   NULL, NULL, NULL),
  ('2157-6',  'female', 0, 43800, 'U/L',    26,   192,   NULL, NULL, NULL),
  ('1988-5',  'any',    0, 43800, 'mg/L',   0,    5,     NULL, NULL, NULL),
  -- ── Lipid ──────────────────────────────────────────────────────────────────
  ('2093-3',  'any',    0, 43800, 'mmol/L', 0,    5.2,   NULL, NULL, 'Maqsad <5.2'),
  ('2571-8',  'any',    0, 43800, 'mmol/L', 0,    1.7,   NULL, NULL, NULL),
  ('2085-9',  'any',    0, 43800, 'mmol/L', 1.0,  NULL,  NULL, NULL, 'Yuqori = yaxshi'),
  ('2089-1',  'any',    0, 43800, 'mmol/L', 0,    3.0,   NULL, NULL, NULL),
  -- ── Elektrolitlar / mineral ────────────────────────────────────────────────
  ('2951-2',  'any',    0, 43800, 'mmol/L', 136,  145,   120,  160,  NULL),
  ('2823-3',  'any',    0, 43800, 'mmol/L', 3.5,  5.1,   2.8,  6.2,  NULL),
  ('2075-0',  'any',    0, 43800, 'mmol/L', 98,   107,   NULL, NULL, NULL),
  ('17861-6', 'any',    0, 43800, 'mmol/L', 2.15, 2.55,  1.6,  3.4,  NULL),
  ('19123-9', 'any',    0, 43800, 'mmol/L', 0.66, 1.07,  NULL, NULL, NULL),
  ('2777-1',  'any',    0, 43800, 'mmol/L', 0.81, 1.45,  NULL, NULL, NULL),
  -- ── Temir almashinuvi ──────────────────────────────────────────────────────
  ('2498-4',  'male',   0, 43800, 'umol/L', 11,   30,    NULL, NULL, NULL),
  ('2498-4',  'female', 0, 43800, 'umol/L', 9,    27,    NULL, NULL, NULL),
  ('3034-6',  'any',    0, 43800, 'umol/L', 45,   72,    NULL, NULL, NULL),
  ('2276-4',  'male',   0, 43800, 'ng/mL',  30,   400,   NULL, NULL, NULL),
  ('2276-4',  'female', 0, 43800, 'ng/mL',  15,   150,   NULL, NULL, NULL),
  -- ── Gormonlar / vitaminlar ─────────────────────────────────────────────────
  ('3016-3',  'any',    0, 43800, 'mIU/L',  0.4,  4.0,   NULL, NULL, NULL),
  ('3024-7',  'any',    0, 43800, 'ng/dL',  0.9,  1.7,   NULL, NULL, NULL),
  ('3051-0',  'any',    0, 43800, 'pg/mL',  2.3,  4.2,   NULL, NULL, NULL),
  ('2986-8',  'male',   6570, 43800, 'nmol/L', 8.6, 29.0, NULL, NULL, NULL),
  ('2986-8',  'female', 6570, 43800, 'nmol/L', 0.3, 2.4,  NULL, NULL, NULL),
  ('2143-6',  'any',    0, 43800, 'nmol/L', 171,  536,   NULL, NULL, 'Ertalabki'),
  ('1989-3',  'any',    0, 43800, 'ng/mL',  30,   100,   NULL, NULL, 'Yetishmovchilik <20'),
  ('2132-9',  'any',    0, 43800, 'pg/mL',  191,  663,   NULL, NULL, NULL),
  ('2857-1',  'male',   0, 43800, 'ng/mL',  0,    4.0,   NULL, NULL, NULL),
  -- ── Koagulyatsiya ──────────────────────────────────────────────────────────
  ('6301-6',  'any',    0, 43800, '{ratio}',0.8,  1.2,   NULL, 5.0,  NULL),
  ('3255-7',  'any',    0, 43800, 'g/L',    2.0,  4.0,   NULL, NULL, NULL),
  -- ── Gematologiya (CBC) ─────────────────────────────────────────────────────
  ('718-7',   'male',   6570, 43800, 'g/dL', 13.0, 17.0,  7.0,  20.0, NULL),
  ('718-7',   'female', 6570, 43800, 'g/dL', 12.0, 15.5,  7.0,  20.0, NULL),
  ('718-7',   'any',    0, 6570,  'g/dL',   11.0, 14.0,  7.0,  20.0, 'Bola'),
  ('4544-3',  'male',   0, 43800, '%',      40,   50,    NULL, NULL, NULL),
  ('4544-3',  'female', 0, 43800, '%',      36,   46,    NULL, NULL, NULL),
  ('789-8',   'male',   0, 43800, '10*6/uL',4.5,  5.9,   NULL, NULL, NULL),
  ('789-8',   'female', 0, 43800, '10*6/uL',4.0,  5.2,   NULL, NULL, NULL),
  ('6690-2',  'any',    0, 43800, '10*3/uL',4.0,  10.0,  1.5,  30.0, NULL),
  ('777-3',   'any',    0, 43800, '10*3/uL',150,  400,   30,   1000, NULL),
  ('787-2',   'any',    0, 43800, 'fL',     80,   100,   NULL, NULL, NULL),
  ('785-6',   'any',    0, 43800, 'pg',     27,   33,    NULL, NULL, NULL),
  ('786-4',   'any',    0, 43800, 'g/dL',   32,   36,    NULL, NULL, NULL),
  ('788-0',   'any',    0, 43800, '%',      11.5, 14.5,  NULL, NULL, NULL),
  ('4537-7',  'male',   0, 43800, 'mm/h',   0,    15,    NULL, NULL, NULL),
  ('4537-7',  'female', 0, 43800, 'mm/h',   0,    20,    NULL, NULL, NULL),
  ('770-8',   'any',    0, 43800, '%',      40,   70,    NULL, NULL, NULL),
  ('736-9',   'any',    0, 43800, '%',      20,   40,    NULL, NULL, NULL),
  ('5905-5',  'any',    0, 43800, '%',      2,    8,     NULL, NULL, NULL),
  ('713-8',   'any',    0, 43800, '%',      1,    4,     NULL, NULL, NULL),
  ('706-2',   'any',    0, 43800, '%',      0,    1,     NULL, NULL, NULL)
ON CONFLICT (loinc_code, sex, age_min_days, age_max_days) WHERE clinic_id IS NULL DO NOTHING;
