-- =============================================================================
-- Jadvallashtirilgan hisobot eksporti (Faza 5C)
-- Rahbar bir marta sozlaydi -> cron har kuni/hafta/oy Report Builder hisobotini
-- CSV qilib klinika Telegram botiga (ega chatlariga) yuboradi.
-- Barcha amallar API service_role orqali (RLS yoqilgan).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  dimension text NOT NULL,                 -- semantic.ts QUERY_DIMENSIONS
  grain text NOT NULL DEFAULT 'day',        -- day | week | month
  cadence text NOT NULL,                    -- daily | weekly | monthly
  send_hour int NOT NULL DEFAULT 7,         -- 0-23, Asia/Tashkent
  channel text NOT NULL DEFAULT 'telegram',
  format text NOT NULL DEFAULT 'csv',
  is_active boolean NOT NULL DEFAULT true,
  last_run_on date,                         -- kunlik dedup (bir kunda ikki marta yubormaslik)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_active
  ON public.report_schedules (clinic_id) WHERE is_active;

-- RLS — barcha amallar API service_role orqali; tenant to'g'ridan-to'g'ri kira olmaydi.
ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
