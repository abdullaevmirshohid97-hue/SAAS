-- =============================================================================
-- M4 — Statsionar bemor "Hamshira chaqirish" tugmasi
-- =============================================================================
-- nurse_tasks.created_by profiles'ga NOT NULL FK edi — bemor (profiles'da yozuvi
-- yo'q) chaqiruv yarata olmasdi. Endi NULL = bemor o'zi chaqirgan.
-- PROD'GA QO'LLANGAN (2026-07-19).
ALTER TABLE nurse_tasks ALTER COLUMN created_by DROP NOT NULL;
COMMENT ON COLUMN nurse_tasks.created_by IS
  'NULL = bemor o''zi chaqirgan (statsionar tugma) — profiles''da yozuvi yo''q';
