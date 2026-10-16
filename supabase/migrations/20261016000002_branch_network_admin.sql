-- =============================================================================
-- FILIAL TARMOG'I — Faza 1: super-admin filiallarni asosiy klinikaga ulaydi
-- =============================================================================
-- Avvalgi linkBranch/unlinkBranch (API'da, tranzaksiyasiz) o'rniga atomik RPC:
--   admin_network_preview      — ulashdan oldin nima bo'lishini ko'rsatadi
--   admin_network_link_branch  — klinikani tarmoqqa filial qilib ulaydi
--   admin_network_unlink_branch— filialni ajratib mustaqil klinika qiladi
--   admin_network_set_hq       — asosiy filialni (HQ) almashtiradi
-- Har biri: limit (trigger), bemorlar company_id'si, bo'sh qolgan eski
-- kompaniya, a'zolar ro'yxati va company_audit_log bitta tranzaksiyada.
-- Faqat service_role (API, SuperAdminGuard) chaqiradi.
-- =============================================================================

-- Bemor dublikat kaliti: telefonning oxirgi 9 raqami + normallashgan F.I.Sh.
CREATE OR REPLACE FUNCTION public.network_patient_dup_key(p_phone text, p_full_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) < 7 THEN NULL
    ELSE right(regexp_replace(p_phone, '\D', '', 'g'), 9) || '|' ||
         lower(btrim(regexp_replace(COALESCE(p_full_name, ''), '\s+', ' ', 'g')))
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_network_preview(p_company uuid, p_clinic uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company   companies%ROWTYPE;
  v_clinic    clinics%ROWTYPE;
  v_live      int;
  v_old_live  int := 0;
  v_patients  int;
  v_staff     int;
  v_open      int;
  v_dups      int;
  v_blockers  text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_company FROM companies WHERE id = p_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarmoq topilmadi'; END IF;
  SELECT * INTO v_clinic FROM clinics WHERE id = p_clinic;
  IF NOT FOUND THEN RAISE EXCEPTION 'Klinika topilmadi'; END IF;

  SELECT count(*) INTO v_live FROM clinics WHERE company_id = p_company AND deleted_at IS NULL;
  IF v_clinic.company_id IS NOT NULL AND v_clinic.company_id <> p_company THEN
    SELECT count(*) INTO v_old_live FROM clinics
     WHERE company_id = v_clinic.company_id AND deleted_at IS NULL AND id <> p_clinic;
  END IF;

  SELECT count(*) INTO v_patients FROM patients WHERE clinic_id = p_clinic AND deleted_at IS NULL;
  SELECT count(*) INTO v_staff FROM profiles WHERE clinic_id = p_clinic AND deleted_at IS NULL;
  SELECT count(*) INTO v_open FROM shifts WHERE clinic_id = p_clinic AND closed_at IS NULL;

  -- Tarmoqdagi boshqa filiallarda ham bor bo'lishi ehtimoli katta bemorlar
  -- (kalitlar oldin hisoblanadi — hash join, minglab bemorda ham tez)
  WITH a AS (
    SELECT network_patient_dup_key(phone, full_name) AS k
      FROM patients WHERE clinic_id = p_clinic AND deleted_at IS NULL
  ), b AS (
    SELECT DISTINCT network_patient_dup_key(phone, full_name) AS k
      FROM patients
     WHERE company_id = p_company AND clinic_id <> p_clinic AND deleted_at IS NULL
  )
  SELECT count(*) INTO v_dups FROM a JOIN b ON a.k = b.k;

  IF v_clinic.deleted_at IS NOT NULL THEN v_blockers := v_blockers || 'archived'; END IF;
  IF v_clinic.company_id = p_company THEN v_blockers := v_blockers || 'already_linked'; END IF;
  IF v_old_live > 0 THEN v_blockers := v_blockers || 'has_own_branches'; END IF;
  IF v_live + 1 > v_company.max_branches THEN v_blockers := v_blockers || 'limit'; END IF;

  RETURN jsonb_build_object(
    'company', jsonb_build_object('id', v_company.id, 'name', v_company.name,
                                  'max_branches', v_company.max_branches, 'branches', v_live),
    'clinic', jsonb_build_object('id', v_clinic.id, 'name', v_clinic.name,
                                 'current_company_id', v_clinic.company_id,
                                 'plan', v_clinic.current_plan,
                                 'subscription_status', v_clinic.subscription_status),
    'patients', v_patients,
    'staff', v_staff,
    'open_shifts', v_open,
    'possible_duplicates', v_dups,
    'blockers', to_jsonb(v_blockers)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_network_link_branch(p_company uuid, p_clinic uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clinic   clinics%ROWTYPE;
  v_old      uuid;
  v_has_hq   boolean;
  v_moved    int;
  v_dropped  boolean := false;
BEGIN
  PERFORM 1 FROM companies WHERE id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarmoq topilmadi'; END IF;

  SELECT * INTO v_clinic FROM clinics WHERE id = p_clinic FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Klinika topilmadi'; END IF;
  IF v_clinic.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Arxivdagi klinikani filial qilib bo''lmaydi';
  END IF;
  IF v_clinic.company_id = p_company THEN
    RAISE EXCEPTION 'Bu klinika allaqachon shu tarmoqda';
  END IF;
  v_old := v_clinic.company_id;
  IF v_old IS NOT NULL AND EXISTS (
    SELECT 1 FROM clinics WHERE company_id = v_old AND deleted_at IS NULL AND id <> p_clinic
  ) THEN
    RAISE EXCEPTION 'Bu klinikaning o''z filiallari bor — avval ularni ajrating';
  END IF;

  SELECT EXISTS (SELECT 1 FROM clinics
                  WHERE company_id = p_company AND is_hq AND deleted_at IS NULL) INTO v_has_hq;

  -- is_hq avval o'chiriladi (unique index: kompaniyada bitta HQ)
  UPDATE clinics SET is_hq = false WHERE id = p_clinic AND is_hq;
  UPDATE clinics SET company_id = p_company, is_hq = NOT v_has_hq WHERE id = p_clinic;

  UPDATE patients SET company_id = p_company WHERE clinic_id = p_clinic;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Eski (endi bo'sh) kompaniya. Uning a'zolari (filialning eski egasi) faqat
  -- o'z filialiga — uy filiali sifatida — kira oladi, tarmoqqa emas.
  IF v_old IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clinics WHERE company_id = v_old) THEN
    BEGIN
      DELETE FROM companies WHERE id = v_old;
      v_dropped := true;
    EXCEPTION WHEN foreign_key_violation THEN
      v_dropped := false;
    END;
  END IF;

  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (p_company, p_clinic, p_actor, 'branch_linked',
          jsonb_build_object('old_company_id', v_old, 'patients_moved', v_moved,
                             'old_company_deleted', v_dropped, 'became_hq', NOT v_has_hq));

  RETURN jsonb_build_object('ok', true, 'patients_moved', v_moved,
                            'old_company_deleted', v_dropped, 'is_hq', NOT v_has_hq);
END $$;

CREATE OR REPLACE FUNCTION public.admin_network_unlink_branch(p_clinic uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clinic  clinics%ROWTYPE;
  v_company uuid;
  v_new     uuid;
  v_moved   int;
BEGIN
  SELECT * INTO v_clinic FROM clinics WHERE id = p_clinic FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Klinika topilmadi'; END IF;
  v_company := v_clinic.company_id;
  IF v_company IS NULL OR NOT EXISTS (
    SELECT 1 FROM clinics WHERE company_id = v_company AND deleted_at IS NULL AND id <> p_clinic
  ) THEN
    RAISE EXCEPTION 'Klinika tarmoqda emas (mustaqil)';
  END IF;
  IF v_clinic.is_hq AND v_clinic.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Asosiy filialni (HQ) ajratib bo''lmaydi — avval boshqa filialni HQ qiling';
  END IF;

  INSERT INTO companies (name, legal_name, country, base_currency, package, max_branches)
  VALUES (v_clinic.name, v_clinic.legal_name, COALESCE(v_clinic.country, 'UZ'),
          COALESCE(v_clinic.currency, 'UZS'), 'small', 1)
  RETURNING id INTO v_new;

  UPDATE clinics SET company_id = v_new, is_hq = true WHERE id = p_clinic;
  UPDATE patients SET company_id = v_new WHERE clinic_id = p_clinic;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Tarmoq a'zolarining ruxsat ro'yxatidan shu filial olib tashlanadi
  UPDATE company_members
     SET accessible_clinic_ids = accessible_clinic_ids - p_clinic::text
   WHERE company_id = v_company AND accessible_clinic_ids ? p_clinic::text;

  -- Mustaqil klinikaning egasi/admini o'z kompaniyasida
  INSERT INTO company_members (company_id, user_id, role)
  SELECT v_new, p.id,
         CASE WHEN p.role::text = 'clinic_owner' THEN 'company_owner' ELSE 'company_admin' END
    FROM profiles p
   WHERE p.clinic_id = p_clinic AND p.role::text IN ('clinic_owner', 'clinic_admin')
     AND p.deleted_at IS NULL
  ON CONFLICT (company_id, user_id) DO NOTHING;

  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (v_company, p_clinic, p_actor, 'branch_unlinked',
          jsonb_build_object('new_company_id', v_new, 'patients_moved', v_moved));

  RETURN jsonb_build_object('ok', true, 'new_company_id', v_new, 'patients_moved', v_moved);
END $$;

CREATE OR REPLACE FUNCTION public.admin_network_set_hq(p_company uuid, p_clinic uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev uuid;
BEGIN
  PERFORM 1 FROM companies WHERE id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarmoq topilmadi'; END IF;
  IF NOT EXISTS (SELECT 1 FROM clinics
                  WHERE id = p_clinic AND company_id = p_company AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Filial shu tarmoqda emas';
  END IF;
  SELECT id INTO v_prev FROM clinics
   WHERE company_id = p_company AND is_hq AND deleted_at IS NULL;
  UPDATE clinics SET is_hq = false WHERE company_id = p_company AND is_hq AND id <> p_clinic;
  UPDATE clinics SET is_hq = true WHERE id = p_clinic;
  INSERT INTO company_audit_log (company_id, clinic_id, actor_id, action, detail)
  VALUES (p_company, p_clinic, p_actor, 'hq_changed', jsonb_build_object('previous_hq', v_prev));
  RETURN jsonb_build_object('ok', true, 'previous_hq', v_prev);
END $$;

REVOKE ALL ON FUNCTION public.admin_network_preview(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_network_link_branch(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_network_unlink_branch(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_network_set_hq(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_network_preview(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_network_link_branch(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_network_unlink_branch(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_network_set_hq(uuid, uuid, uuid) TO service_role;
