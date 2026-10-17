-- =============================================================================
-- TARIF IMKONIYATLARI (entitlements) — super-admin tarif muharriri,
-- klinikaga individual kelishuv va qurilmalar ro'yxati.
-- =============================================================================
-- Tuzilma (packages/schemas/src/entitlements.ts bilan bir xil):
--   { modules: {pharmacy: false, ...},          -- yo'q kalit = ochiq
--     journal: {history_days, allow_edit, allow_delete, allow_export},
--     payments: {methods: [...] | null},
--     roles: {allowed: [...] | null, custom_roles},
--     devices: {clients: {web, desktop, mobile, kiosk}, enforce_limit},
--     limits: {max_staff, max_devices, max_patients} }  -- faqat override'da;
--                                                       -- tarifda plans ustunlari
-- XAVFSIZ: barcha mavjud tariflar entitlements = '{}' bilan boshlanadi —
-- hech bir klinika hech narsadan mahrum bo'lmaydi, super-admin o'zi yopadi.
-- Idempotent: qayta qo'llash xavfsiz.
-- =============================================================================

-- 1) Tariflar: imkoniyatlar + landing uchun tavsif ------------------------------
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS highlights   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_public    boolean NOT NULL DEFAULT true;

-- 2) Klinikaga individual kelishuv ---------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_entitlements (
  clinic_id               uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  overrides               jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_price_uzs        bigint CHECK (custom_price_uzs IS NULL OR custom_price_uzs >= 0),
  custom_price_yearly_uzs bigint CHECK (custom_price_yearly_uzs IS NULL OR custom_price_yearly_uzs >= 0),
  discount_percent        numeric(5,2) CHECK (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100),
  note                    text,
  valid_until             date,
  updated_by              uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE clinic_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinic_entitlements FROM anon, authenticated;

-- 3) O'zgarishlar tarixi (oldin/keyin) ------------------------------------------
CREATE TABLE IF NOT EXISTS entitlement_changes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope      text NOT NULL CHECK (scope IN ('plan', 'clinic')),
  plan_code  text,
  clinic_id  uuid REFERENCES clinics(id) ON DELETE CASCADE,
  actor_id   uuid,
  action     text NOT NULL,
  before     jsonb,
  after      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entitlement_changes_clinic
  ON entitlement_changes (clinic_id, created_at DESC) WHERE clinic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entitlement_changes_plan
  ON entitlement_changes (plan_code, created_at DESC) WHERE plan_code IS NOT NULL;
ALTER TABLE entitlement_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON entitlement_changes FROM anon, authenticated;

-- 4) Qurilmalar: qaysi ilovadan kirgani ----------------------------------------
ALTER TABLE user_devices
  ADD COLUMN IF NOT EXISTS client      text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS user_agent  text;
CREATE INDEX IF NOT EXISTS idx_user_devices_clinic_used
  ON user_devices (clinic_id, last_used_at DESC);

-- 5) jsonb chuqur birlashtirish (b ustun; JSON null ham qiymat) -----------------
CREATE OR REPLACE FUNCTION jsonb_deep_merge(a jsonb, b jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $f$
DECLARE
  k   text;
  out jsonb;
BEGIN
  IF a IS NULL THEN RETURN b; END IF;
  IF b IS NULL THEN RETURN a; END IF;
  IF jsonb_typeof(a) <> 'object' OR jsonb_typeof(b) <> 'object' THEN RETURN b; END IF;
  out := a;
  FOR k IN SELECT jsonb_object_keys(b) LOOP
    IF out ? k AND jsonb_typeof(out -> k) = 'object' AND jsonb_typeof(b -> k) = 'object' THEN
      out := jsonb_set(out, ARRAY[k], jsonb_deep_merge(out -> k, b -> k));
    ELSE
      out := jsonb_set(out, ARRAY[k], b -> k);
    END IF;
  END LOOP;
  RETURN out;
END
$f$;

-- 6) Klinikaning amaldagi imkoniyatlari -----------------------------------------
-- Tarif: clinics.current_plan. Tarmoq (billing_mode='company') filiali HQ
-- tarifini oladi; avval HQ kelishuvi, keyin filialning o'zi qo'llanadi.
-- Muddati o'tgan (valid_until < bugun) kelishuv e'tiborsiz qoladi.
CREATE OR REPLACE FUNCTION clinic_effective_entitlements(p_clinic uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  c       record;
  o       record;
  v_src   uuid;
  v_plan  record;
  v_today date := (now() AT TIME ZONE 'Asia/Tashkent')::date;
  v_e     jsonb;
BEGIN
  SELECT id, current_plan, is_hq, company_id INTO c FROM clinics WHERE id = p_clinic;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_src := c.id;
  IF c.company_id IS NOT NULL AND NOT COALESCE(c.is_hq, false)
     AND EXISTS (SELECT 1 FROM companies co WHERE co.id = c.company_id AND co.billing_mode = 'company') THEN
    SELECT h.id INTO v_src FROM clinics h
     WHERE h.company_id = c.company_id AND h.is_hq AND h.deleted_at IS NULL
     LIMIT 1;
    v_src := COALESCE(v_src, c.id);
  END IF;

  SELECT p.code, p.name, p.max_staff, p.max_devices, p.max_patients, p.entitlements
    INTO v_plan
    FROM plans p
   WHERE p.code = (SELECT current_plan FROM clinics WHERE id = v_src);

  v_e := jsonb_build_object(
    'plan', v_plan.code,
    'plan_name', v_plan.name,
    'limits', jsonb_build_object(
      'max_staff', v_plan.max_staff,
      'max_devices', v_plan.max_devices,
      'max_patients', v_plan.max_patients));
  v_e := jsonb_deep_merge(
    v_e, COALESCE(v_plan.entitlements, '{}'::jsonb) - 'plan' - 'plan_name' - 'override' - 'limits');

  FOR o IN
    SELECT ce.overrides, ce.valid_until, (ce.clinic_id = c.id) AS own
      FROM clinic_entitlements ce
     WHERE ce.clinic_id IN (v_src, c.id)
     ORDER BY (ce.clinic_id = c.id)
  LOOP
    IF o.valid_until IS NULL OR o.valid_until >= v_today THEN
      v_e := jsonb_deep_merge(v_e, COALESCE(o.overrides, '{}'::jsonb) - 'plan' - 'plan_name' - 'override');
    END IF;
  END LOOP;

  SELECT * INTO o FROM clinic_entitlements WHERE clinic_id = c.id;
  IF FOUND THEN
    v_e := v_e || jsonb_build_object('override', jsonb_build_object(
      'active', (o.valid_until IS NULL OR o.valid_until >= v_today),
      'custom_price_uzs', o.custom_price_uzs,
      'custom_price_yearly_uzs', o.custom_price_yearly_uzs,
      'discount_percent', o.discount_percent,
      'valid_until', o.valid_until,
      'note', o.note));
  END IF;

  RETURN v_e;
END
$f$;

-- 7) Xodim/qurilma/bemor limitlari — endi amaldagi imkoniyatlardan ------------
-- (imzo o'zgarmagan: staff.module va obuna sahifasi shu funksiyani chaqiradi)
CREATE OR REPLACE FUNCTION get_clinic_plan_limits(p_clinic_id uuid)
RETURNS TABLE(plan_code subscription_plan, max_staff int, max_devices int, max_patients int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $f$
  SELECT (e ->> 'plan')::subscription_plan,
         (e #>> '{limits,max_staff}')::int,
         (e #>> '{limits,max_devices}')::int,
         (e #>> '{limits,max_patients}')::int
    FROM (SELECT clinic_effective_entitlements(p_clinic_id) AS e) x
   WHERE e IS NOT NULL AND e ->> 'plan' IS NOT NULL;
$f$;

-- 8) To'lov turlari cheklovi — bazada (barcha kirish yo'llari uchun) ------------
CREATE OR REPLACE FUNCTION clinic_allowed_payment_methods(p_clinic uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $f$
  SELECT CASE WHEN jsonb_typeof(e #> '{payments,methods}') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(e #> '{payments,methods}'))
         END
    FROM (SELECT clinic_effective_entitlements(p_clinic) AS e) x;
$f$;

-- TG_ARGV[0] = usul ustuni, TG_ARGV[1] = summa ustuni.
-- Faqat yangi/o'zgargan musbat to'lov tekshiriladi; vozvrat, tuzatish,
-- bekor qilingan yozuv va aralash ('mixed' — oyoqlari alohida tekshiriladi)
-- o'tkaziladi. Cheklov yo'q (methods = null) bo'lsa hech narsa qilmaydi.
CREATE OR REPLACE FUNCTION tg_enforce_payment_method()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_new     jsonb := to_jsonb(NEW);
  v_method  text  := v_new ->> TG_ARGV[0];
  v_allowed text[];
BEGIN
  IF v_method IS NULL OR v_method = 'mixed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT DISTINCT FROM v_method THEN
    RETURN NEW;
  END IF;
  IF COALESCE((v_new ->> TG_ARGV[1])::numeric, 0) <= 0 THEN RETURN NEW; END IF;
  IF COALESCE((v_new ->> 'is_void')::boolean, false) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'transactions' AND (v_new ->> 'kind') IS DISTINCT FROM 'payment' THEN
    RETURN NEW;
  END IF;
  -- Alohida dorixona kirishi (PIN operator) — o'z obunasi, klinika tarifiga bog'liq emas
  IF TG_TABLE_NAME = 'pharmacy_sales' AND (v_new ->> 'operator_id') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_allowed := clinic_allowed_payment_methods((v_new ->> 'clinic_id')::uuid);
  IF v_allowed IS NULL OR v_method = ANY (v_allowed) THEN RETURN NEW; END IF;

  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = format('To''lov turi tarifingizda ruxsat etilmagan: %s', v_method),
    HINT    = 'PAYMENT_METHOD_NOT_ALLOWED';
END
$f$;

DROP TRIGGER IF EXISTS trg_enforce_payment_method ON transactions;
CREATE TRIGGER trg_enforce_payment_method
  BEFORE INSERT OR UPDATE OF payment_method ON transactions
  FOR EACH ROW EXECUTE FUNCTION tg_enforce_payment_method('payment_method', 'amount_uzs');

DROP TRIGGER IF EXISTS trg_enforce_payment_method ON transaction_payments;
CREATE TRIGGER trg_enforce_payment_method
  BEFORE INSERT OR UPDATE OF method ON transaction_payments
  FOR EACH ROW EXECUTE FUNCTION tg_enforce_payment_method('method', 'amount_uzs');

DROP TRIGGER IF EXISTS trg_enforce_payment_method ON pharmacy_sales;
CREATE TRIGGER trg_enforce_payment_method
  BEFORE INSERT OR UPDATE OF payment_method ON pharmacy_sales
  FOR EACH ROW EXECUTE FUNCTION tg_enforce_payment_method('payment_method', 'total_uzs');

-- 9) Huquqlar — faqat API (service_role) --------------------------------------
REVOKE ALL ON FUNCTION clinic_effective_entitlements(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION clinic_allowed_payment_methods(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_clinic_plan_limits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION clinic_effective_entitlements(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION clinic_allowed_payment_methods(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_clinic_plan_limits(uuid) TO service_role;
GRANT ALL ON clinic_entitlements, entitlement_changes TO service_role;

COMMENT ON TABLE clinic_entitlements IS
  'Klinikaga individual tarif kelishuvi: imkoniyatlar ustidan yozish, maxsus narx/chegirma, muddat.';
COMMENT ON FUNCTION clinic_effective_entitlements(uuid) IS
  'Tarif + (HQ) + klinika kelishuvi chuqur birlashtirilgan amaldagi imkoniyatlar (jsonb).';
