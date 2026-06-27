-- =============================================================================
-- QISM 0 / F0.2 (data model) — company_members: kompaniya darajasidagi kirish.
-- CEO/company_admin bir nechta filialni ko'radi. ADDITIVE. Backfill: mavjud
-- clinic_owner profillar o'z kompaniyasiga company_owner sifatida bog'lanadi.
-- (Branch switcher / auth-context logikasi keyingi qadamda — bu faqat ma'lumot.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'branch_user' CHECK (role IN ('company_owner','company_admin','branch_user')),
  -- bo'sh [] = kompaniyaning BARCHA filiallari; aks holda ruxsat etilgan clinic id'lar
  accessible_clinic_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_members_user ON public.company_members (user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members (company_id);

-- Backfill: mavjud clinic_owner/clinic_admin → o'z kompaniyasida company_owner
DO $$
DECLARE p record; v_company uuid;
BEGIN
  FOR p IN
    SELECT pr.id AS user_id, pr.role, c.company_id
    FROM profiles pr JOIN clinics c ON c.id = pr.clinic_id
    WHERE pr.role IN ('clinic_owner','clinic_admin') AND c.company_id IS NOT NULL
  LOOP
    INSERT INTO company_members (company_id, user_id, role)
      VALUES (p.company_id, p.user_id, CASE WHEN p.role = 'clinic_owner' THEN 'company_owner' ELSE 'company_admin' END)
    ON CONFLICT (company_id, user_id) DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.company_members FROM anon, authenticated;

-- Helper: foydalanuvchi shu filialga kira oladimi (kompaniya a'zoligi bo'yicha)
CREATE OR REPLACE FUNCTION public.can_access_branch(p_user uuid, p_clinic uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM company_members cm
    JOIN clinics c ON c.company_id = cm.company_id
    WHERE cm.user_id = p_user
      AND c.id = p_clinic
      AND (cm.accessible_clinic_ids = '[]'::jsonb
           OR cm.accessible_clinic_ids ? p_clinic::text)
  );
$$;
