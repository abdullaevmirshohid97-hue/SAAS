-- =============================================================================
-- Clary v2 — Migration 001030: Online queue (patient portal bookings)
-- Patients book an appointment slot published by a clinic.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- online_queue_slots — bookable time slots opened by a clinic
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS online_queue_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_min INT NOT NULL DEFAULT 30,
  capacity INT NOT NULL DEFAULT 1,
  booked_count INT NOT NULL DEFAULT 0,
  is_open BOOLEAN NOT NULL DEFAULT true,
  price_snapshot_uzs BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1,
  CHECK (booked_count <= capacity),
  CHECK (duration_min > 0 AND duration_min <= 480)
);

CREATE INDEX IF NOT EXISTS idx_oq_slots_clinic_time ON online_queue_slots(clinic_id, starts_at) WHERE is_open = true;
CREATE INDEX IF NOT EXISTS idx_oq_slots_doctor_time ON online_queue_slots(doctor_id, starts_at) WHERE is_open = true;

DROP TRIGGER IF EXISTS tg_oq_slots_updated ON online_queue_slots;
CREATE TRIGGER tg_oq_slots_updated BEFORE UPDATE ON online_queue_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE online_queue_slots ENABLE ROW LEVEL SECURITY;

-- Public can read open slots (for booking)
DROP POLICY IF EXISTS p_oq_slots_public_read ON online_queue_slots;
CREATE POLICY p_oq_slots_public_read ON online_queue_slots
  FOR SELECT
  USING (is_open = true AND starts_at > now());

-- Clinic staff can manage their own
DROP POLICY IF EXISTS p_oq_slots_tenant_write ON online_queue_slots;
CREATE POLICY p_oq_slots_tenant_write ON online_queue_slots
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- online_queue_bookings — patient's booking of a slot
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS online_queue_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES online_queue_slots(id) ON DELETE CASCADE,
  portal_user_id UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  -- Snapshot for stability
  patient_name_snapshot TEXT NOT NULL,
  patient_phone_snapshot TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','confirmed','checked_in','completed','no_show','canceled','refunded'
  )),
  canceled_at TIMESTAMPTZ,
  canceled_by TEXT CHECK (canceled_by IN ('patient','clinic','system')),
  canceled_reason TEXT,
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1,
  UNIQUE (slot_id, portal_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oq_book_patient ON online_queue_bookings(portal_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oq_book_clinic ON online_queue_bookings(clinic_id, status, created_at DESC);

DROP TRIGGER IF EXISTS tg_oq_book_updated ON online_queue_bookings;
CREATE TRIGGER tg_oq_book_updated BEFORE UPDATE ON online_queue_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-increment booked_count on new booking (and decrement on cancel)
CREATE OR REPLACE FUNCTION public.tg_oq_booking_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('pending','confirmed','checked_in','completed') THEN
    UPDATE online_queue_slots SET booked_count = booked_count + 1 WHERE id = NEW.slot_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('canceled','no_show','refunded') AND NEW.status IN ('canceled','no_show','refunded') THEN
      UPDATE online_queue_slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = NEW.slot_id;
    ELSIF OLD.status IN ('canceled','no_show','refunded') AND NEW.status NOT IN ('canceled','no_show','refunded') THEN
      UPDATE online_queue_slots SET booked_count = booked_count + 1 WHERE id = NEW.slot_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.status NOT IN ('canceled','no_show','refunded') THEN
    UPDATE online_queue_slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = OLD.slot_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_oq_book_count ON online_queue_bookings;
CREATE TRIGGER tg_oq_book_count
  AFTER INSERT OR UPDATE OF status OR DELETE ON online_queue_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_oq_booking_count();

ALTER TABLE online_queue_bookings ENABLE ROW LEVEL SECURITY;

-- Patient can see their own bookings; clinic sees theirs; super_admin all
DROP POLICY IF EXISTS p_oq_book_access ON online_queue_bookings;
CREATE POLICY p_oq_book_access ON online_queue_bookings
  FOR ALL
  USING (
    portal_user_id = auth.uid()
    OR clinic_id = public.get_my_clinic_id()
    OR public.get_my_role() = 'super_admin'
  )
  WITH CHECK (
    portal_user_id = auth.uid()
    OR clinic_id = public.get_my_clinic_id()
    OR public.get_my_role() = 'super_admin'
  );

COMMENT ON TABLE online_queue_slots IS 'Bookable appointment slots published by clinics to patient portal';
COMMENT ON TABLE online_queue_bookings IS 'Patient bookings against online_queue_slots';
