-- =============================================================================
-- Clary v2 — Migration: thermal_printers universal kengaytma
--
-- Maqsad:
--   * thermal_printers jadvaliga preset/purpose/encoding/cutter/cash drawer
--     maydonlari qo'shish.
--   * Multi-purpose default: har klinikada har purpose uchun bitta default
--     printer bo'lishi mumkin (receipt/queue/report/label).
--   * Bluetooth qo'shimcha maydonlari (bt_mac, bt_name).
-- =============================================================================

ALTER TABLE thermal_printers
  ADD COLUMN IF NOT EXISTS has_cutter      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_cash_drawer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purpose         TEXT NOT NULL DEFAULT 'receipt'
    CHECK (purpose IN ('receipt','queue','report','label')),
  ADD COLUMN IF NOT EXISTS preset_key      TEXT NULL,
  ADD COLUMN IF NOT EXISTS encoding        TEXT NOT NULL DEFAULT 'CP1251'
    CHECK (encoding IN ('CP1251','UTF-8','CP866')),
  ADD COLUMN IF NOT EXISTS bt_mac          TEXT NULL,
  ADD COLUMN IF NOT EXISTS bt_name         TEXT NULL;

COMMENT ON COLUMN thermal_printers.purpose IS
  'receipt|queue|report|label — har klinika har purpose uchun bitta default';
COMMENT ON COLUMN thermal_printers.preset_key IS
  'apps/web-clinic/src/lib/printer-presets.ts dagi kalit (epson_tm_t20iii, va h.k.)';
COMMENT ON COLUMN thermal_printers.encoding IS
  'CP1251 — kirill (default), UTF-8 — zamonaviy printerlar, CP866 — eski DOS';

-- Eski (clinic_id) WHERE is_default unique indexni almashtirish — endi
-- per-purpose default.
DROP INDEX IF EXISTS thermal_printers_default_per_clinic_idx;
CREATE UNIQUE INDEX IF NOT EXISTS thermal_printers_default_per_purpose_idx
  ON thermal_printers (clinic_id, purpose)
  WHERE is_default = true;
