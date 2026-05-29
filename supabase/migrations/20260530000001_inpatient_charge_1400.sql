-- =============================================================================
-- Clary v2 — Migration: statsionar kunlik charge vaqtini 14:00 ga moslash
--
-- O'ZGARISH (2026-05-30):
--   Kunlik statsionar to'lov vaqti 00:05 -> 14:00 (Toshkent) ga ko'chirildi.
--   Sabab: foydalanuvchi talabi — qabulda 1-kun DARROV hisoblanadi (admit()
--   ichida RPC chaqiriladi), keyingi kunlar har kuni soat 14:00 da.
--
--   14:00 Toshkent (UTC+5) = 09:00 UTC -> cron '0 9 * * *'.
--   RPC idempotent (last_charged_date) — qabuldagi darrov charge bilan
--   takrorlanmaydi.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('inpatient-daily-charge');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Toshkent 14:00 = UTC 09:00
    PERFORM cron.schedule(
      'inpatient-daily-charge',
      '0 9 * * *',
      $cron$SELECT public.charge_daily_inpatient_stays();$cron$
    );
  END IF;
END $$;
