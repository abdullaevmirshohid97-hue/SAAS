-- =============================================================================
-- FILIAL TARMOG'I — Faza 0 (poydevor) + Faza 2 (filial almashtirish) bazasi
-- =============================================================================
-- Model: kompaniya (companies) = tarmoq, klinika (clinics) = filial. Bitta
-- kompaniyada bitta HQ (asosiy) va jami ko'pi bilan 10 ta filial.
--
-- Bu migratsiya:
--   1) companies'ga tarmoq parametrlari (limit, billing, umumiy bemorlar)
--   2) yangi klinikaga kompaniya AVTOMATIK ochiladi (iyundagi backfill'dan keyin
--      yaratilgan klinikalarda company_id NULL qolib ketgan edi) + backfill
--   3) hech qaysi klinikaga bog'lanmagan (yetim) kompaniyalar tozalanadi
--   4) bitta kompaniyada bitta HQ (unique index) + filial limiti (trigger)
--   5) company_audit_log — tarmoqdagi har muhim amal izi
--   6) filial almashtirish: network_my_branches() + network_switch_branch()
--      (JWT app_metadata.clinic_id ni server o'zgartiradi — RLS, Realtime va
--      API hammasi bir xil "faol filial"ni ko'radi)
--
-- 100% QO'SHIMCHA: mavjud clinic_id modeli va ma'lumot o'zgarmaydi. Idempotent.
-- =============================================================================

-- ── 1) Tarmoq parametrlari ────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS max_branches    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billing_mode    text    NOT NULL DEFAULT 'per_branch',
  ADD COLUMN IF NOT EXISTS branch_fee_uzs  bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shared_patients boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_max_branches_check') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_max_branches_check CHECK (max_branches BETWEEN 1 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_billing_mode_check') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_billing_mode_check CHECK (billing_mode IN ('per_branch', 'company'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_branch_fee_check') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_branch_fee_check CHECK (branch_fee_uzs >= 0);
  END IF;
END $$;

-- Filial belgisi (almashtirgichda rangli nuqta) — ixtiyoriy
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS branch_color text;

-- ── 2) Har klinikada kompaniya bo'lsin ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_clinics_ensure_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  IF NEW.company_id IS NULL THEN
    INSERT INTO companies (name, legal_name, country, base_currency, package, max_branches)
    VALUES (NEW.name, NEW.legal_name, COALESCE(NEW.country, 'UZ'), COALESCE(NEW.currency, 'UZS'),
            'small', 1)
    RETURNING id INTO v_company;
    NEW.company_id := v_company;
    NEW.is_hq := true;
    NEW.branch_code := COALESCE(NEW.branch_code, NEW.billing_code, NEW.slug);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_clinics_ensure_company ON public.clinics;
CREATE TRIGGER tg_clinics_ensure_company BEFORE INSERT ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.tg_clinics_ensure_company();

-- Backfill: company_id NULL bo'lgan klinikalar (arxivdagilar ham)
DO $$
DECLARE c record; v_company uuid;
BEGIN
  FOR c IN SELECT id, name, legal_name, country, currency, billing_code, slug, deleted_at
             FROM clinics WHERE company_id IS NULL LOOP
    INSERT INTO companies (name, legal_name, country, base_currency, package, max_branches)
    VALUES (c.name, c.legal_name, COALESCE(c.country, 'UZ'), COALESCE(c.currency, 'UZS'), 'small', 1)
    RETURNING id INTO v_company;
    UPDATE clinics
       SET company_id = v_company, is_hq = true,
           branch_code = COALESCE(branch_code, c.billing_code, c.slug)
     WHERE id = c.id;
    UPDATE patients SET company_id = v_company WHERE clinic_id = c.id AND company_id IS NULL;
    -- Mavjud egasi/admini o'z kompaniyasida (iyundagi backfill bilan bir xil qoida)
    INSERT INTO company_members (company_id, user_id, role)
    SELECT v_company, p.id,
           CASE WHEN p.role::text = 'clinic_owner' THEN 'company_owner' ELSE 'company_admin' END
      FROM profiles p
     WHERE p.clinic_id = c.id AND p.role::text IN ('clinic_owner', 'clinic_admin')
    ON CONFLICT (company_id, user_id) DO NOTHING;
  END LOOP;
END $$;

-- Bemorlarda company_id bo'sh qolgan bo'lsa — filialdan
UPDATE public.patients p
   SET company_id = c.company_id
  FROM public.clinics c
 WHERE c.id = p.clinic_id AND p.company_id IS NULL AND c.company_id IS NOT NULL;

-- ── 3) Yetim kompaniyalarni tozalash ──────────────────────────────────────────
-- Hech bir klinika (arxivdagisi ham) va bemor bog'lanmagan kompaniyalar.
-- company_members ON DELETE CASCADE. Boshqa bog'lanish chiqsa — tegilmaydi.
DO $$
DECLARE r record; v_deleted int := 0;
BEGIN
  FOR r IN SELECT co.id FROM companies co
            WHERE NOT EXISTS (SELECT 1 FROM clinics c WHERE c.company_id = co.id)
              AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.company_id = co.id) LOOP
    BEGIN
      DELETE FROM companies WHERE id = r.id;
      v_deleted := v_deleted + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      NULL;
    END;
  END LOOP;
  RAISE NOTICE 'Yetim kompaniyalar o''chirildi: %', v_deleted;
END $$;

-- ── 4) Bitta HQ + limit ───────────────────────────────────────────────────────
-- HQ'siz kompaniyada eng eski jonli filial HQ bo'ladi; ortiqcha HQ'lar olinadi.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.company_id,
           (array_agg(c.id ORDER BY c.is_hq DESC, c.created_at, c.id))[1] AS keep_id
      FROM clinics c
     WHERE c.deleted_at IS NULL AND c.company_id IS NOT NULL
     GROUP BY c.company_id
  LOOP
    UPDATE clinics SET is_hq = (id = r.keep_id)
     WHERE company_id = r.company_id AND deleted_at IS NULL
       AND is_hq IS DISTINCT FROM (id = r.keep_id);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clinics_company_hq
  ON public.clinics (company_id) WHERE is_hq AND deleted_at IS NULL;

-- Limit hozirgi holatdan kichik bo'lmasin (trigger mavjud ma'lumotni yiqitmasin)
UPDATE public.companies co
   SET max_branches = LEAST(10, GREATEST(co.max_branches, s.n))
  FROM (SELECT company_id, count(*)::int AS n FROM public.clinics
         WHERE deleted_at IS NULL AND company_id IS NOT NULL GROUP BY company_id) s
 WHERE s.company_id = co.id AND co.max_branches < s.n;

CREATE OR REPLACE FUNCTION public.tg_clinics_branch_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max int; v_count int;
BEGIN
  IF NEW.company_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.company_id IS NOT DISTINCT FROM NEW.company_id
     AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;
  END IF;
  -- Arxivdan qaytgan eski HQ: tarmoqda boshqa HQ bo'lsa — oddiy filial bo'lib qaytadi
  IF NEW.is_hq AND EXISTS (
    SELECT 1 FROM clinics
     WHERE company_id = NEW.company_id AND is_hq AND deleted_at IS NULL AND id <> NEW.id
  ) THEN
    NEW.is_hq := false;
  END IF;
  -- Kompaniya qatorini qulflaymiz: ikki parallel ulash limitni aylanib o'tmasin
  SELECT max_branches INTO v_max FROM companies WHERE id = NEW.company_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM clinics
   WHERE company_id = NEW.company_id AND deleted_at IS NULL AND id <> NEW.id;
  IF v_count + 1 > COALESCE(v_max, 1) THEN
    RAISE EXCEPTION 'Tarmoq limiti: bu tarmoqda ko''pi bilan % ta filial bo''lishi mumkin', COALESCE(v_max, 1)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_clinics_branch_limit ON public.clinics;
CREATE TRIGGER tg_clinics_branch_limit BEFORE INSERT OR UPDATE OF company_id, deleted_at
  ON public.clinics FOR EACH ROW EXECUTE FUNCTION public.tg_clinics_branch_limit();

-- HQ arxivlansa — tarmoq HQ'siz qolmasin: eng eski jonli filial HQ bo'ladi
CREATE OR REPLACE FUNCTION public.tg_clinics_hq_succession()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.is_hq AND NEW.company_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM clinics
                      WHERE company_id = NEW.company_id AND is_hq AND deleted_at IS NULL) THEN
    UPDATE clinics SET is_hq = true
     WHERE id = (SELECT id FROM clinics
                  WHERE company_id = NEW.company_id AND deleted_at IS NULL
                  ORDER BY created_at, id LIMIT 1);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_clinics_hq_succession ON public.clinics;
CREATE TRIGGER tg_clinics_hq_succession AFTER UPDATE OF deleted_at
  ON public.clinics FOR EACH ROW EXECUTE FUNCTION public.tg_clinics_hq_succession();

-- ── 5) Tarmoq audit izi ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  clinic_id  uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  actor_id   uuid,
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_audit_company
  ON public.company_audit_log (company_id, created_at DESC);
ALTER TABLE public.company_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_audit_log FROM anon, authenticated;

-- ── 6) Filialga kirish huquqi ─────────────────────────────────────────────────
-- Uy filiali (profiles.clinic_id) har doim; qolganlari company_members orqali.
-- company_owner / company_admin — tarmoqning hamma filiali; branch_user —
-- accessible_clinic_ids ([] = hammasi).
CREATE OR REPLACE FUNCTION public.can_access_branch(p_user uuid, p_clinic uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user AND clinic_id = p_clinic)
      OR EXISTS (
        SELECT 1
          FROM company_members cm
          JOIN clinics c ON c.company_id = cm.company_id
         WHERE cm.user_id = p_user
           AND c.id = p_clinic
           AND c.deleted_at IS NULL
           AND (cm.role IN ('company_owner', 'company_admin')
                OR cm.accessible_clinic_ids = '[]'::jsonb
                OR cm.accessible_clinic_ids ? p_clinic::text));
$$;

CREATE OR REPLACE FUNCTION public.network_my_branches(p_user uuid)
RETURNS TABLE (
  clinic_id    uuid,
  name         text,
  branch_code  text,
  is_hq        boolean,
  city         text,
  branch_color text,
  company_id   uuid,
  member_role  text,
  is_home      boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH home AS (
    SELECT p.clinic_id FROM profiles p WHERE p.id = p_user AND p.deleted_at IS NULL
  ),
  mem AS (
    SELECT cm.company_id, cm.role, cm.accessible_clinic_ids
      FROM company_members cm WHERE cm.user_id = p_user
  )
  SELECT c.id, c.name, c.branch_code, c.is_hq, c.city, c.branch_color, c.company_id,
         (SELECT m.role FROM mem m WHERE m.company_id = c.company_id),
         c.id = (SELECT h.clinic_id FROM home h)
    FROM clinics c
   WHERE c.deleted_at IS NULL
     AND (c.id = (SELECT h.clinic_id FROM home h)
          OR EXISTS (SELECT 1 FROM mem m
                      WHERE m.company_id = c.company_id
                        AND (m.role IN ('company_owner', 'company_admin')
                             OR m.accessible_clinic_ids = '[]'::jsonb
                             OR m.accessible_clinic_ids ? c.id::text)))
   ORDER BY c.is_hq DESC, c.name;
$$;

-- Faol filialni almashtirish. JWT keyingi refreshSession'da yangi clinic_id va
-- rol bilan chiqadi. profiles (uy filiali, HR) O'ZGARMAYDI.
CREATE OR REPLACE FUNCTION public.network_switch_branch(p_user uuid, p_clinic uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_home      uuid;
  v_home_role text;
  v_workspace text;
  v_member    text;
  v_role      text;
  v_current   uuid;
  v_open      int;
  v_company   uuid;
BEGIN
  SELECT p.clinic_id, p.role::text, p.workspace INTO v_home, v_home_role, v_workspace
    FROM profiles p WHERE p.id = p_user AND p.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Foydalanuvchi topilmadi';
  END IF;
  IF v_home_role = 'super_admin' THEN
    RAISE EXCEPTION 'Super admin filial almashtirmaydi';
  END IF;
  IF v_workspace = 'pharmacy' THEN
    RAISE EXCEPTION 'Dorixona akkaunti filial almashtira olmaydi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clinics WHERE id = p_clinic AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Filial topilmadi';
  END IF;

  IF p_clinic = v_home THEN
    v_role := v_home_role;
  ELSE
    SELECT b.member_role INTO v_member
      FROM network_my_branches(p_user) b WHERE b.clinic_id = p_clinic;
    IF v_member IS NULL THEN
      RAISE EXCEPTION 'Bu filialga kirish huquqingiz yo''q' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_role := CASE
      WHEN v_member = 'company_owner' AND v_home_role IN ('clinic_owner', 'clinic_admin') THEN v_home_role
      WHEN v_member = 'company_owner' THEN 'clinic_owner'
      ELSE 'clinic_admin'
    END;
  END IF;

  SELECT NULLIF(u.raw_app_meta_data ->> 'clinic_id', '')::uuid INTO v_current
    FROM auth.users u WHERE u.id = p_user;

  -- Ochiq kassa smenasi bilan boshqa filialga o'tilmaydi (pul noto'g'ri
  -- filialga yozilib ketmasin)
  IF v_current IS NOT NULL AND v_current <> p_clinic THEN
    SELECT count(*) INTO v_open FROM shifts
     WHERE user_id = p_user AND clinic_id = v_current AND closed_at IS NULL;
    IF v_open > 0 THEN
      RAISE EXCEPTION 'Avval joriy filialdagi kassa smenasini yoping';
    END IF;
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('clinic_id', p_clinic::text,
                               'role', v_role,
                               'home_clinic_id', v_home::text)
   WHERE id = p_user;

  SELECT company_id INTO v_company FROM clinics WHERE id = p_clinic;
  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_company, p_clinic, p_user, 'branch_switch',
          jsonb_build_object('from', v_current, 'to', p_clinic, 'role', v_role));

  RETURN jsonb_build_object('clinic_id', p_clinic, 'role', v_role, 'is_home', p_clinic = v_home);
END $$;

-- Faqat API (service_role) chaqiradi
REVOKE ALL ON FUNCTION public.network_my_branches(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_switch_branch(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_access_branch(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_my_branches(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_switch_branch(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_access_branch(uuid, uuid) TO service_role;
