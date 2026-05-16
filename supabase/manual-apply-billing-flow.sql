-- ============================================================================
-- Billing flow: billing_code + trial/grace + activation RPCs + cron
-- Supabase Dashboard → SQL Editor → paste → Run
-- pg_cron yoqilgan bo'lishi shart.
-- ============================================================================

BEGIN;

-- 1) clinics: billing_code + grace_ends_at
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS billing_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;

CREATE SEQUENCE IF NOT EXISTS billing_code_seq START 1;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT id FROM clinics WHERE billing_code IS NULL ORDER BY created_at LOOP
    UPDATE clinics
       SET billing_code = 'CLR-' || LPAD(nextval('billing_code_seq')::TEXT, 5, '0')
     WHERE id = c.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION assign_billing_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

-- 2) start_trial RPC
CREATE OR REPLACE FUNCTION start_trial(p_clinic_id UUID, p_plan subscription_plan)
RETURNS TABLE (status subscription_status, trial_ends_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_trial_end TIMESTAMPTZ := NOW() + INTERVAL '30 days';
BEGIN
  IF p_plan = 'demo' THEN
    RAISE EXCEPTION 'Trial uchun pullik tarif tanlang (Base/Pro/Enterprise)';
  END IF;
  UPDATE clinics
     SET current_plan = p_plan, subscription_status = 'trialing',
         trial_ends_at = v_trial_end, grace_ends_at = NULL
   WHERE id = p_clinic_id;
  INSERT INTO subscriptions (clinic_id, plan_code, status, billing_period,
                             current_period_start, current_period_end)
  VALUES (p_clinic_id, p_plan, 'trialing', 'monthly', NOW(), v_trial_end);
  RETURN QUERY SELECT 'trialing'::subscription_status, v_trial_end;
END;
$$;
REVOKE ALL ON FUNCTION start_trial(UUID, subscription_plan) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_trial(UUID, subscription_plan) TO service_role;

-- 3) activate_subscription RPC
CREATE OR REPLACE FUNCTION activate_subscription(p_billing_code TEXT, p_months INT DEFAULT 1)
RETURNS TABLE (clinic_id UUID, plan subscription_plan, period_end TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic RECORD; v_period_end TIMESTAMPTZ;
BEGIN
  SELECT id, current_plan, subscription_ends_at INTO v_clinic
    FROM clinics WHERE billing_code = p_billing_code;
  IF v_clinic.id IS NULL THEN
    RAISE EXCEPTION 'Billing kod % topilmadi', p_billing_code;
  END IF;
  v_period_end := GREATEST(COALESCE(v_clinic.subscription_ends_at, NOW()), NOW())
                  + (p_months || ' months')::INTERVAL;
  UPDATE clinics
     SET subscription_status = 'active', subscription_ends_at = v_period_end,
         grace_ends_at = NULL, trial_ends_at = NULL
   WHERE id = v_clinic.id;
  INSERT INTO subscriptions (clinic_id, plan_code, status, billing_period,
                             current_period_start, current_period_end)
  VALUES (v_clinic.id, v_clinic.current_plan, 'active', 'monthly', NOW(), v_period_end);
  RETURN QUERY SELECT v_clinic.id, v_clinic.current_plan, v_period_end;
END;
$$;
REVOKE ALL ON FUNCTION activate_subscription(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_subscription(TEXT, INT) TO service_role;

-- 4) expire_trials_and_subscriptions RPC
CREATE OR REPLACE FUNCTION expire_trials_and_subscriptions()
RETURNS TABLE (transitioned_to_past_due INT, transitioned_to_unpaid INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_past_due INT := 0; v_unpaid INT := 0;
BEGIN
  WITH expired AS (
    UPDATE clinics SET subscription_status = 'past_due',
           grace_ends_at = NOW() + INTERVAL '3 days'
     WHERE subscription_status = 'trialing' AND trial_ends_at < NOW()
       AND trial_ends_at IS NOT NULL AND deleted_at IS NULL
    RETURNING id
  ) SELECT COUNT(*) INTO v_past_due FROM expired;

  WITH expired_active AS (
    UPDATE clinics SET subscription_status = 'past_due',
           grace_ends_at = NOW() + INTERVAL '3 days'
     WHERE subscription_status = 'active' AND subscription_ends_at < NOW()
       AND subscription_ends_at IS NOT NULL AND deleted_at IS NULL
    RETURNING id
  ) SELECT v_past_due + COUNT(*) INTO v_past_due FROM expired_active;

  WITH unpaid_now AS (
    UPDATE clinics SET subscription_status = 'unpaid'
     WHERE subscription_status = 'past_due' AND grace_ends_at < NOW()
       AND grace_ends_at IS NOT NULL AND deleted_at IS NULL
    RETURNING id
  ) SELECT COUNT(*) INTO v_unpaid FROM unpaid_now;

  RETURN QUERY SELECT v_past_due, v_unpaid;
END;
$$;
REVOKE ALL ON FUNCTION expire_trials_and_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_trials_and_subscriptions() TO service_role;

COMMIT;

-- 5) Cron (COMMIT'dan keyin alohida)
DO $$ BEGIN
  PERFORM cron.unschedule('expire-trials');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('expire-trials', '10 0 * * *',
  $$SELECT public.expire_trials_and_subscriptions();$$);

-- Tekshirish:
--   SELECT billing_code, name, subscription_status FROM clinics LIMIT 5;
--   SELECT jobname, schedule FROM cron.job WHERE jobname='expire-trials';
