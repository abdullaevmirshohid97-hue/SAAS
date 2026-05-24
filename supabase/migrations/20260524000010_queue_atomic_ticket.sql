-- =============================================================================
-- Clary v2 — Migration: navbat raqami atomik allocation
--
-- BUG'LAR (eski generateTicketNo):
--  1) RACE CONDITION: count + alohida INSERT — 2 ta kassir bir vaqtda
--     chaqirsa, ikkalasi ham N+1 oladi va DUBLICAT ticket_no yaratiladi.
--     Production'da MAGNUS klinikasida 49-001 raqami 2 marta yozilgan!
--  2) Prefix UUID ning 2 ta belgisi (mantiqsiz) — '49-001' ko'rinishi
--  3) Sana UTC (server) — Toshkent 00:00–05:00 oralig'ida kun chalkash
--  4) Filter clinic bo'yicha, doctor bo'yicha emas — har shifokorga
--     individual raqam emas
--  5) Voided/left queue'lar ham sanaladi (raqamlar sakrab ketadi)
--
-- YECHIM:
--  * allocate_queue_ticket RPC: pg_advisory_xact_lock + MAX(queue_seq)+1
--    (atomik, race-condition'siz)
--  * UNIQUE INDEX (clinic, doctor, queue_date, ticket_no) — DB darajasida
--    dublicat oldini olish (defence in depth)
--  * Prefix backend tomondan shifokor familiyasidan (2 harf), default 'A'
--  * queue_date Asia/Tashkent kuni
-- =============================================================================

-- 1) UNIQUE INDEX — partial (ticket_no NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_queues_ticket_per_doctor_day
  ON queues (clinic_id, doctor_id, queue_date, ticket_no)
  WHERE ticket_no IS NOT NULL;

-- 2) Atomik allocator
CREATE OR REPLACE FUNCTION public.allocate_queue_ticket(
  p_clinic_id  UUID,
  p_doctor_id  UUID,
  p_prefix     TEXT DEFAULT 'A'
)
RETURNS TABLE(ticket_no TEXT, queue_date DATE, queue_seq INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Tashkent')::DATE;
  v_seq   INT;
  v_lock_key BIGINT;
BEGIN
  -- Lock kalit: clinic + doctor + day hash (sequence yaratishni serialize qiladi)
  v_lock_key := abs(
    hashtextextended(p_clinic_id::text || COALESCE(p_doctor_id::text,'-') || v_today::text, 0)
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COALESCE(MAX(q.queue_seq), 0) + 1
    INTO v_seq
    FROM queues q
   WHERE q.clinic_id = p_clinic_id
     AND q.queue_date = v_today
     AND ((p_doctor_id IS NULL AND q.doctor_id IS NULL)
          OR q.doctor_id = p_doctor_id);

  RETURN QUERY SELECT
    (UPPER(LEFT(p_prefix, 2)) || '-' || LPAD(v_seq::TEXT, 3, '0'))::TEXT,
    v_today,
    v_seq;
END;
$$;

COMMENT ON FUNCTION allocate_queue_ticket IS
  'Atomik navbat raqami yaratish: pg_advisory_xact_lock + MAX(queue_seq)+1. Race-condition''siz. Asia/Tashkent kuni bo''yicha. UNIQUE constraint ham himoyalaydi.';

REVOKE ALL ON FUNCTION allocate_queue_ticket(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_queue_ticket(UUID, UUID, TEXT) TO service_role;
