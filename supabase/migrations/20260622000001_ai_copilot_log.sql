-- =============================================================================
-- AI Copilot audit log (Faza 5A)
-- Har bir Copilot so'rovi shu yerga yoziladi: monitoring, audit va suiiste'molni
-- aniqlash uchun. MUHIM: tool NATIJALARI (PII bo'lishi mumkin) saqlanmaydi —
-- faqat savol matni, tasnif va chaqirilgan tool nomlari.
-- Barcha amallar API service_role orqali (RLS yoqilgan — anon/authenticated kira olmaydi).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_copilot_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  question text NOT NULL,
  classification text,                       -- pre-classifier kategoriyasi (masalan: 'analytics', 'medical', 'injection', 'off_topic')
  allowed boolean NOT NULL DEFAULT true,      -- savol javob berish mumkin turida bo'lganmi
  refused boolean NOT NULL DEFAULT false,     -- rad etilganmi
  tool_calls text[] NOT NULL DEFAULT '{}',    -- chaqirilgan tool nomlari (natijasiz)
  model text,                                 -- ishlatilgan model (masalan claude-sonnet-4-6)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_copilot_log_clinic_created
  ON public.ai_copilot_log (clinic_id, created_at DESC);

-- RLS — barcha amallar API service_role orqali; tenant to'g'ridan-to'g'ri kira olmaydi.
ALTER TABLE public.ai_copilot_log ENABLE ROW LEVEL SECURITY;
