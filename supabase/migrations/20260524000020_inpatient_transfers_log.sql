-- =============================================================================
-- Clary v2 — Migration: statsionar ko'chirish tarixi
--
-- Bug: eski transfer() metodi yangi room_id ni inpatient_stays'ga yozardi
-- va sababni attending_notes'ga overrride qilardi (eski notlar yo'qolardi).
-- Tarix va jurnal uchun audit log YO'Q edi.
--
-- Yechim: inpatient_transfers jadval — har ko'chirish alohida qator.
-- Jurnalda "Xonadan xonaga ko'chirildi" event sifatida ko'rinadi.
-- =============================================================================

CREATE TABLE IF NOT EXISTS inpatient_transfers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  stay_id        UUID NOT NULL REFERENCES inpatient_stays(id) ON DELETE CASCADE,
  from_room_id   UUID REFERENCES rooms(id),
  to_room_id     UUID NOT NULL REFERENCES rooms(id),
  from_bed_no    TEXT,
  to_bed_no      TEXT,
  reason         TEXT,
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transferred_by UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_clinic_date
  ON inpatient_transfers(clinic_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_stay
  ON inpatient_transfers(stay_id);

ALTER TABLE inpatient_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_transfers_tenant ON inpatient_transfers;
CREATE POLICY p_transfers_tenant ON inpatient_transfers FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE inpatient_transfers IS
  'Statsionar bemorlarni xonadan xonaga ko''chirish tarixi (audit log).';
