-- =============================================================================
-- Clary v2 — Migration: Journal layout (defaults + overrides, 2-darajali)
--
-- MAQSAD: jurnal ko'rinishini (manbalar nomi/rangi/icon/tartibi/ko'rinishi)
-- ikki darajada sozlash:
--   1) journal_layout_defaults — GLOBAL platforma defaultlari (super admin)
--   2) journal_layout_overrides — har klinika alohida (clinic admin)
-- Override NULL bo'lsa default'dan meros, qulflangan maydon (lock_*) bo'lsa
-- override e'tiborga olinmaydi.
--
-- Audit immutability: jurnal yozuvlari (transactions, ledger, va h.k.) bu yerda
-- ZINHOR o'zgartirilmaydi — biz faqat ko'rinish/layout sozlayapmiz.
-- =============================================================================

-- 1) Global defaults
CREATE TABLE IF NOT EXISTS journal_layout_defaults (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key          TEXT NOT NULL UNIQUE,
  display_label_i18n  JSONB NOT NULL DEFAULT '{}'::jsonb,
  color_tone          TEXT NOT NULL DEFAULT 'slate',
  icon_key            TEXT NOT NULL DEFAULT 'file-text',
  sort_order          INT NOT NULL DEFAULT 100,
  is_visible          BOOLEAN NOT NULL DEFAULT true,
  -- Har maydon alohida qulflanadi: true = clinic admin o'zgartira olmaydi
  lock_label          BOOLEAN NOT NULL DEFAULT false,
  lock_color          BOOLEAN NOT NULL DEFAULT false,
  lock_icon           BOOLEAN NOT NULL DEFAULT false,
  lock_order          BOOLEAN NOT NULL DEFAULT false,
  lock_visible        BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE journal_layout_defaults IS
  'Jurnal manbalari uchun GLOBAL standart shablon. Faqat super admin yozadi.';

-- 2) Per-clinic overrides
CREATE TABLE IF NOT EXISTS journal_layout_overrides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  source_key          TEXT NOT NULL,
  display_label_i18n  JSONB,   -- NULL = default'dan meros
  color_tone          TEXT,
  icon_key            TEXT,
  sort_order          INT,
  is_visible          BOOLEAN,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_journal_overrides_clinic ON journal_layout_overrides(clinic_id);

COMMENT ON TABLE journal_layout_overrides IS
  'Klinika darajasida override. NULL maydonlar default''dan meros oladi. '
  'Default''da lock_* true bo''lsa, bu yerdagi qiymat e''tiborga olinmaydi.';

-- 3) updated_at trigger
CREATE OR REPLACE FUNCTION touch_journal_layout() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_journal_layout_defaults ON journal_layout_defaults;
CREATE TRIGGER touch_journal_layout_defaults
  BEFORE UPDATE ON journal_layout_defaults
  FOR EACH ROW EXECUTE FUNCTION touch_journal_layout();

DROP TRIGGER IF EXISTS touch_journal_layout_overrides ON journal_layout_overrides;
CREATE TRIGGER touch_journal_layout_overrides
  BEFORE UPDATE ON journal_layout_overrides
  FOR EACH ROW EXECUTE FUNCTION touch_journal_layout();

-- 4) RLS
ALTER TABLE journal_layout_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_layout_overrides ENABLE ROW LEVEL SECURITY;

-- Defaults: hamma o'qiy oladi (frontend GET), faqat service_role yoza oladi
-- (super admin endpoint service_role bilan ishlaydi).
DROP POLICY IF EXISTS defaults_read_all ON journal_layout_defaults;
CREATE POLICY defaults_read_all ON journal_layout_defaults
  FOR SELECT USING (true);

DROP POLICY IF EXISTS defaults_write_service ON journal_layout_defaults;
CREATE POLICY defaults_write_service ON journal_layout_defaults
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Overrides: faqat o'z klinikasi
DROP POLICY IF EXISTS overrides_tenant_read ON journal_layout_overrides;
CREATE POLICY overrides_tenant_read ON journal_layout_overrides
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS overrides_write_service ON journal_layout_overrides;
CREATE POLICY overrides_write_service ON journal_layout_overrides
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5) Seed: hozirgi hardcoded ko'rinishni jadvalga ko'chiramiz
INSERT INTO journal_layout_defaults (source_key, display_label_i18n, color_tone, icon_key, sort_order) VALUES
  ('transaction',       '{"uz-Latn":"Kassa","ru":"Касса"}'::jsonb,                'emerald', 'wallet',       10),
  ('pharmacy_sale',     '{"uz-Latn":"Dorixona","ru":"Аптека"}'::jsonb,            'violet',  'receipt',      20),
  ('inpatient_stay',    '{"uz-Latn":"Statsionar","ru":"Стационар"}'::jsonb,       'sky',     'stethoscope',  30),
  ('inpatient_ledger',  '{"uz-Latn":"Statsionar hisob","ru":"Счёт стационара"}'::jsonb,'indigo','stethoscope', 40),
  ('appointment',       '{"uz-Latn":"Qabul","ru":"Приём"}'::jsonb,                'amber',   'user',         50),
  ('expense',           '{"uz-Latn":"Rasxot","ru":"Расход"}'::jsonb,              'rose',    'arrow-down',   60),
  ('shift_opened',      '{"uz-Latn":"Smena ochildi","ru":"Смена открыта"}'::jsonb,'cyan',    'shield-check', 70),
  ('shift_closed',      '{"uz-Latn":"Smena yopildi","ru":"Смена закрыта"}'::jsonb,'slate',   'log-out',      80)
ON CONFLICT (source_key) DO NOTHING;

-- 6) Effective layout RPC — defaults + overrides merge, lock_* hisobga olib
CREATE OR REPLACE FUNCTION resolve_journal_layout(p_clinic_id UUID)
RETURNS TABLE (
  source_key          TEXT,
  display_label_i18n  JSONB,
  color_tone          TEXT,
  icon_key            TEXT,
  sort_order          INT,
  is_visible          BOOLEAN,
  is_locked_label     BOOLEAN,
  is_locked_color     BOOLEAN,
  is_locked_icon      BOOLEAN,
  is_locked_order     BOOLEAN,
  is_locked_visible   BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    d.source_key,
    CASE WHEN d.lock_label   THEN d.display_label_i18n
         ELSE COALESCE(o.display_label_i18n, d.display_label_i18n) END,
    CASE WHEN d.lock_color   THEN d.color_tone
         ELSE COALESCE(o.color_tone, d.color_tone) END,
    CASE WHEN d.lock_icon    THEN d.icon_key
         ELSE COALESCE(o.icon_key, d.icon_key) END,
    CASE WHEN d.lock_order   THEN d.sort_order
         ELSE COALESCE(o.sort_order, d.sort_order) END,
    CASE WHEN d.lock_visible THEN d.is_visible
         ELSE COALESCE(o.is_visible, d.is_visible) END,
    d.lock_label, d.lock_color, d.lock_icon, d.lock_order, d.lock_visible
  FROM journal_layout_defaults d
  LEFT JOIN journal_layout_overrides o
    ON o.source_key = d.source_key AND o.clinic_id = p_clinic_id
  ORDER BY
    CASE WHEN d.lock_order THEN d.sort_order
         ELSE COALESCE(o.sort_order, d.sort_order) END,
    d.source_key;
$$;

COMMENT ON FUNCTION resolve_journal_layout IS
  'Klinika uchun effektiv jurnal layout (defaults + overrides, lock_* hisobga olib).';
