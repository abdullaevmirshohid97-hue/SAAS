-- =============================================================================
-- E2 — API xato jurnali: jim singan 4xx/5xx endi ko'rinadi
-- =============================================================================
-- GlobalExceptionFilter muhim xatolarni (5xx + 400/409/422) shu jadvalga yozadi;
-- telegram-reports kunlik digest (23:50) egaga Telegram'da yuboradi va 14 kundan
-- eski yozuvlarni tozalaydi. RLS yoqilgan, policy YO'Q — faqat service_role.

CREATE TABLE IF NOT EXISTS api_error_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      INT NOT NULL,
  code        TEXT,
  method      TEXT,
  path        TEXT,
  message     TEXT,
  clinic_id   UUID,
  request_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_error_log_time ON api_error_log(occurred_at DESC);

ALTER TABLE api_error_log ENABLE ROW LEVEL SECURITY;
