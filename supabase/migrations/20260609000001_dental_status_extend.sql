-- =============================================================================
-- Clary v2 — Migration 20260609000001: Dental status enum extend
-- dental_teeth.status CHECK ga 'pulpitis' va 'periodontitis' qo'shiladi.
-- Stomatolog butun-tish holatini belgilaganda Pulpit/Periodontit tashxislari
-- ham tanlanadi (interaktiv Dental Chart). Surface (yuza) shartlari — caries/
-- filling/sealant — `surfaces` JSONB ichida (CHECK yo'q, erkin).
-- Migration 20260424001040_dental.sql ustiga ishlaydi (inline CHECK nomi:
-- dental_teeth_status_check). Idempotent: IF EXISTS + qayta yaratish.
-- =============================================================================

ALTER TABLE dental_teeth DROP CONSTRAINT IF EXISTS dental_teeth_status_check;

ALTER TABLE dental_teeth
  ADD CONSTRAINT dental_teeth_status_check CHECK (status IN (
    'sound','caries','filling','root_canal','crown','bridge','implant','missing','extracted',
    'erupting','impacted','mobile','fractured','discolored','sensitive','watch',
    'pulpitis','periodontitis'
  ));
