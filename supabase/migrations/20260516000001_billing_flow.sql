-- =============================================================================
-- Billing flow: billing_code + trial → past_due → grace → unpaid + activation
-- =============================================================================
-- Oqim:
--   demo (14 kun) → trialing (1 oy bepul, tanlangan plan)
--   → past_due (trial tugadi, +3 kun grace)
--   → unpaid (grace tugadi, bloklanadi)
--   → active (klinika billing_code bilan to'ladi → webhook → +30 kun)

-- -----------------------------------------------------------------------------
-- 1) clinics.billing_code — CLR-00001, CLR-00002, ...
-- -----------------------------------------------------------------------------
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS billing_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;

CREATE SEQUENCE IF NOT EXISTS billing_code_seq START 1;

-- Backfill: mavjud klinikalarga billing_code
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT id FROM clinics WHERE billing_code IS NULL ORDER BY created_at LOOP
    UPDATE clinics
       SET billing_code = 'CLR-' || LPAD(nextval('billing_code_seq')::TEXT, 5, '0')
     WHERE id = c.id;
  END LOOP;
END $$;

-- Yangi klinika uchun trigger
CREATE OR REPLACE FUNCTION assign_billing_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.billing_code IS NULL THEN
    NEW.billing_code := 'CLR-' || LPAD(nextval('billing_code_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_clinics_billing_code ON clinics;
CREATE TRIGGER tg_clinics_billing_code
  BEFORE INSERT ON clinics
  FOR EACH ROW EXECUTE FUNCTION assign_billing_code();

COMMENT ON COLUMN clinics.billing_code IS
  'Klinikaning to''lov kodi (CLR-00042). Click/Payme to''lov izohiga yoziladi, '
  'webhook shu kod orqali klinikani topib obunani faollashtiradi.';
COMMENT ON COLUMN clinics.grace_ends_at IS
  'past_due holatdagi klinika uchun grace muddati. Bu o''tsa unpaid → bloklanadi.';

-- -----------------------------------------------------------------------------
-- 2) RPC: start_trial — demo'dan keyin "1 oy bepul" tugmasi chaqiradi
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_trial(
  p_clinic_id UUID,
  p_plan subscription_plan
)
RETURNS TABLE (status subscription_status, trial_ends_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trial_end TIMESTAMPTZ := NOW() + INTERVAL '30 days';
BEGIN
  IF p_plan = 'demo' THEN
    RAISE EXCEPTION 'Trial uchun pullik tarif tanlang (Base/Pro/Enterprise)';
  END IF;

  UPDATE clinics
     SET current_plan = p_plan,
         subscription_status = 'trialing',
         trial_ends_at = v_trial_end,
         grace_ends_at = NULL
   WHERE id = p_clinic_id;

  -- subscriptions tarixiga ham yozamiz
  INSERT INTO subscriptions (
    clinic_id, plan_code, status, billing_period,
    current_period_start, current_period_end
  ) VALUES (
    p_clinic_id, p_plan, 'trialing', 'monthly',
    NOW(), v_trial_end
  );

  RETURN QUERY SELECT 'trialing'::subscription_status, v_trial_end;
END;
$$;

REVOKE ALL ON FUNCTION start_trial(UUID, subscription_plan) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_trial(UUID, subscription_plan) TO service_role;

-- -----------------------------------------------------------------------------
-- 3) RPC: activate_subscription — webhook / admin chaqiradi (to'lov tasdiqlandi)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION activate_subscription(
  p_billing_code TEXT,
  p_months INT DEFAULT 1
)
RETURNS TABLE (clinic_id UUID, plan subscription_plan, period_end TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic RECORD;
  v_period_end TIMESTAMPTZ;
BEGIN
  SELECT id, current_plan, subscription_ends_at
    INTO v_clinic
    FROM clinics
   WHERE billing_code = p_billing_code;

  IF v_clinic.id IS NULL THEN
    RAISE EXCEPTION 'Billing kod % topilmadi', p_billing_code;
  END IF;

  -- Agar obuna hali amal qilsa — uzaytiriladi, aks holda bugundan
  v_period_end := GREATEST(
    COALESCE(v_clinic.subscription_ends_at, NOW()),
    NOW()
  ) + (p_months || ' months')::INTERVAL;

  UPDATE clinics
     SET subscription_status = 'active',
         subscription_ends_at = v_period_end,
         grace_ends_at = NULL,
         trial_ends_at = NULL
   WHERE id = v_clinic.id;

  INSERT INTO subscriptions (
    clinic_id, plan_code, status, billing_period,
    current_period_start, current_period_end
  ) VALUES (
    v_clinic.id, v_clinic.current_plan, 'active', 'monthly',
    NOW(), v_period_end
  );

  RETURN QUERY SELECT v_clinic.id, v_clinic.current_plan, v_period_end;
END;
$$;

REVOKE ALL ON FUNCTION activate_subscription(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_subscription(TEXT, INT) TO service_role;

-- -----------------------------------------------------------------------------
-- 4) RPC: expire_trials_and_subscriptions — cron kunlik chaqiradi
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_trials_and_subscriptions()
RETURNS TABLE (transitioned_to_past_due INT, transitioned_to_unpaid INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_past_due INT := 0;
  v_unpaid INT := 0;
BEGIN
  -- trialing → past_due (trial tugadi)
  WITH expired AS (
    UPDATE clinics
       SET subscription_status = 'past_due',
           grace_ends_at = NOW() + INTERVAL '3 days'
     WHERE subscription_status = 'trialing'
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at < NOW()
       AND deleted_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_past_due FROM expired;

  -- active → past_due (obuna muddati tugadi, to'lanmadi)
  WITH expired_active AS (
    UPDATE clinics
       SET subscription_status = 'past_due',
           grace_ends_at = NOW() + INTERVAL '3 days'
     WHERE subscription_status = 'active'
       AND subscription_ends_at IS NOT NULL
       AND subscription_ends_at < NOW()
       AND deleted_at IS NULL
    RETURNING id
  )
  SELECT v_past_due + COUNT(*) INTO v_past_due FROM expired_active;

  -- past_due → unpaid (grace tugadi)
  WITH unpaid_now AS (
    UPDATE clinics
       SET subscription_status = 'unpaid'
     WHERE subscription_status = 'past_due'
       AND grace_ends_at IS NOT NULL
       AND grace_ends_at < NOW()
       AND deleted_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_unpaid FROM unpaid_now;

  RETURN QUERY SELECT v_past_due, v_unpaid;
END;
$$;

REVOKE ALL ON FUNCTION expire_trials_and_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_trials_and_subscriptions() TO service_role;

-- -----------------------------------------------------------------------------
-- 5) Cron — har kuni 00:10 da trial/obuna muddatini tekshirish
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM cron.unschedule('expire-trials');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'expire-trials',
  '10 0 * * *',
  $$SELECT public.expire_trials_and_subscriptions();$$
);
