-- =============================================================================
-- Vital signs — ambulator qabul uchun appointment_id qo'shish
-- =============================================================================
-- Hozir vital_signs faqat stay_id (statsionar) bilan. Consultation workspace'da
-- shifokor ambulator bemorga ham vitals yozadi — appointment_id kerak.

ALTER TABLE vital_signs
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id);

CREATE INDEX IF NOT EXISTS idx_vital_signs_appointment
  ON vital_signs(appointment_id)
  WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN vital_signs.appointment_id IS
  'Ambulator qabul — consultation workspace''da yozilgan vitals. '
  'stay_id (statsionar) bilan birga ishlatiladi.';
