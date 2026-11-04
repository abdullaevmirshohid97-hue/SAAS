-- =============================================================================
-- Clary v2 — Migration: statsionarga YO'LLANMA bilan kelgan bemor + agent ulushi
--
-- MAQSAD (2026-11-04):
--   Bemor statsionarga shifokor taklifi (yo'llanma) bilan keladi. Yo'llagan
--   shifokorga va agentga XONA to'lovidan foiz ulush ajratiladi.
--
--   1) referral_partners — mavjud (bo'sh) ma'lumotnoma kengaytiriladi:
--      turi faqat 'agent' | 'doctor', mutaxassislik, ish joyi, 2-telefon, izoh.
--      commission_percent = "xona to'lovidan necha foiz".
--   2) inpatient_stays — kelish turi (self | referral), yo'llagan shifokor,
--      agent va ikkalasining foizi (qabul paytidagi SNAPSHOT — keyin kartadagi
--      foiz o'zgarsa ham shu bemorga ta'sir qilmaydi).
--   3) referral_accruals — kunlik ulush: har kun × har sherik bitta qator.
--   4) referral_payouts — sherikka to'lov (statsionar kassasidan xarajat).
--   5) accrue_inpatient_referral_shares() — kunlik xona to'lovi yozilgan
--      kunlar (last_charged_date gacha) bo'yicha ulushni yozadi. IDEMPOTENT:
--      bir kun × bir rol uchun ikkinchi marta yozmaydi; kechikkan kunlarni
--      to'ldiradi. Asosiy charge_daily_inpatient_stays()'ga TEGILMAYDI.
--
-- ULUSH BAZASI: faqat xona narxi (tarif bo'lsa tarif narxi). Ovqat, qarovchi,
--   qo'shimcha xizmat va dorilar kirmaydi. Birinchi kun yarim kunlik bo'lsa —
--   yarim kunlik narx (charge_daily_inpatient_stays bilan bir xil formula).
--
-- ESLATMA: inpatient_stays'ning yangi ustunlari ataylab NULL bo'la oladi —
--   Savatchadan (trash_restore → jsonb_populate_recordset) eski yozuv
--   qaytarilganda yangi kalitlar NULL keladi; NOT NULL bo'lsa qaytarish yiqiladi.
--   Kod NULL'ni 'self' / 0 deb o'qiydi.
--
-- Idempotent: qayta ishga tushirsa xato bermaydi.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) referral_partners — agent / yo'llanma bergan shifokor
-- -----------------------------------------------------------------------------
ALTER TABLE public.referral_partners
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS workplace text,
  ADD COLUMN IF NOT EXISTS phone2    text,
  ADD COLUMN IF NOT EXISTS notes     text;

-- Eski erkin matnli turni ikki qiymatga keltiramiz (katalog sahifasida "Turi"
-- oddiy matn edi).
UPDATE public.referral_partners
   SET type = CASE
                WHEN lower(btrim(coalesce(type, ''))) IN
                     ('doctor', 'shifokor', 'vrach', 'doktor', 'врач', 'shifokor taklifi')
                  THEN 'doctor'
                ELSE 'agent'
              END
 WHERE type IS NULL OR type NOT IN ('agent', 'doctor');

UPDATE public.referral_partners
   SET commission_percent = LEAST(GREATEST(COALESCE(commission_percent, 0), 0), 100)
 WHERE commission_percent IS NULL OR commission_percent < 0 OR commission_percent > 100;

ALTER TABLE public.referral_partners ALTER COLUMN type SET DEFAULT 'agent';
ALTER TABLE public.referral_partners ALTER COLUMN type SET NOT NULL;
ALTER TABLE public.referral_partners ALTER COLUMN commission_percent SET DEFAULT 0;
ALTER TABLE public.referral_partners ALTER COLUMN commission_percent SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_partners_type_chk') THEN
    ALTER TABLE public.referral_partners
      ADD CONSTRAINT referral_partners_type_chk CHECK (type IN ('agent', 'doctor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_partners_percent_chk') THEN
    ALTER TABLE public.referral_partners
      ADD CONSTRAINT referral_partners_percent_chk
      CHECK (commission_percent >= 0 AND commission_percent <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS referral_partners_clinic_type_idx
  ON public.referral_partners (clinic_id, type)
  WHERE is_archived = false;

COMMENT ON COLUMN public.referral_partners.type IS
  'agent — bemorni olib keluvchi vositachi; doctor — yo''llanma bergan (tashqi) shifokor';
COMMENT ON COLUMN public.referral_partners.commission_percent IS
  'Statsionar XONA to''lovidan ulush foizi (0–100). Qabulda stay''ga snapshot qilinadi.';

-- -----------------------------------------------------------------------------
-- 2) inpatient_stays — kelish turi + yo'llagan shifokor + agent (snapshot foiz)
-- -----------------------------------------------------------------------------
ALTER TABLE public.inpatient_stays
  ADD COLUMN IF NOT EXISTS admission_channel        text DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS referring_doctor_id      uuid REFERENCES public.referral_partners(id),
  ADD COLUMN IF NOT EXISTS referring_doctor_percent numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_id                 uuid REFERENCES public.referral_partners(id),
  ADD COLUMN IF NOT EXISTS agent_percent            numeric(5,2) DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_stays_admission_channel_chk') THEN
    ALTER TABLE public.inpatient_stays
      ADD CONSTRAINT inpatient_stays_admission_channel_chk
      CHECK (admission_channel IN ('self', 'referral'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpatient_stays_referral_percent_chk') THEN
    ALTER TABLE public.inpatient_stays
      ADD CONSTRAINT inpatient_stays_referral_percent_chk
      CHECK (
        COALESCE(referring_doctor_percent, 0) >= 0
        AND COALESCE(agent_percent, 0) >= 0
        AND COALESCE(referring_doctor_percent, 0) + COALESCE(agent_percent, 0) <= 100
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inpatient_stays_referral_idx
  ON public.inpatient_stays (clinic_id, admitted_at DESC)
  WHERE admission_channel = 'referral';

COMMENT ON COLUMN public.inpatient_stays.admission_channel IS
  'self — o''zi keldi; referral — shifokor yo''llanmasi / agent orqali. NULL = self.';
COMMENT ON COLUMN public.inpatient_stays.referring_doctor_percent IS
  'Yo''llagan shifokor ulushi (xona to''lovidan %), qabul paytidagi snapshot.';
COMMENT ON COLUMN public.inpatient_stays.agent_percent IS
  'Agent ulushi (xona to''lovidan %), qabul paytidagi snapshot.';

-- -----------------------------------------------------------------------------
-- 3) referral_payouts — sherikka to'lov (statsionar kassasidan xarajat)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_payouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  partner_id  uuid NOT NULL REFERENCES public.referral_partners(id),
  amount_uzs  bigint NOT NULL CHECK (amount_uzs > 0),
  method      text NOT NULL DEFAULT 'cash',
  source      text NOT NULL DEFAULT 'cash_drawer' CHECK (source IN ('cash_drawer', 'safe')),
  expense_id  uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'canceled')),
  notes       text,
  paid_by     uuid REFERENCES public.profiles(id),
  paid_at     timestamptz NOT NULL DEFAULT now(),
  canceled_by uuid REFERENCES public.profiles(id),
  canceled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_payouts_partner_idx
  ON public.referral_payouts (clinic_id, partner_id, paid_at DESC);

-- -----------------------------------------------------------------------------
-- 4) referral_accruals — kunlik ulush (har kun × har rol bitta qator)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_accruals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  stay_id     uuid NOT NULL REFERENCES public.inpatient_stays(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL,
  partner_id  uuid NOT NULL REFERENCES public.referral_partners(id),
  role        text NOT NULL CHECK (role IN ('doctor', 'agent')),
  charge_date date NOT NULL,
  base_uzs    bigint NOT NULL CHECK (base_uzs >= 0),
  percent     numeric(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  amount_uzs  bigint NOT NULL CHECK (amount_uzs >= 0),
  status      text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'paid', 'void')),
  payout_id   uuid REFERENCES public.referral_payouts(id) ON DELETE SET NULL,
  voided_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Bir kun × bir rol uchun bitta amaldagi (bekor qilinmagan) yozuv.
CREATE UNIQUE INDEX IF NOT EXISTS referral_accruals_day_uniq
  ON public.referral_accruals (stay_id, role, charge_date)
  WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS referral_accruals_partner_idx
  ON public.referral_accruals (clinic_id, partner_id, status);
CREATE INDEX IF NOT EXISTS referral_accruals_payout_idx
  ON public.referral_accruals (payout_id)
  WHERE payout_id IS NOT NULL;

COMMENT ON TABLE public.referral_accruals IS
  'Statsionar yo''llanma ulushi: xona to''lovi yozilgan har kun uchun shifokor/agent ulushi. accrued → paid (to''lov) | void (yo''llanma o''zgardi).';

-- -----------------------------------------------------------------------------
-- RLS: yoqilgan, policy YO'Q → faqat service_role (API)
-- -----------------------------------------------------------------------------
ALTER TABLE public.referral_payouts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_accruals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_payouts  FROM anon, authenticated;
REVOKE ALL ON public.referral_accruals FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) accrue_inpatient_referral_shares — kunlik ulushni yozish (idempotent)
--   p_stay_id NULL → faol (admitted) va oxirgi 60 kunda chiqarilgan barcha
--   yo'llanmali stay'lar; berilsa → faqat o'sha stay (holatidan qat'i nazar).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_inpatient_referral_shares(p_stay_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_rows  integer;
  s       RECORD;
  v_first date;
  v_day   date;
  v_base  bigint;
  v_doc_pct numeric;
  v_agt_pct numeric;
BEGIN
  FOR s IN
    SELECT st.id, st.clinic_id, st.patient_id, st.admitted_at, st.last_charged_date,
           st.is_half_day,
           st.referring_doctor_id, st.referring_doctor_percent,
           st.agent_id, st.agent_percent,
           COALESCE(rt.price_uzs, rm.daily_price_uzs, 0)::bigint AS daily_price,
           COALESCE(rm.half_day_price_uzs,
                    FLOOR(COALESCE(rt.price_uzs, rm.daily_price_uzs, 0) / 2))::bigint AS half_price
      FROM inpatient_stays st
      LEFT JOIN rooms rm        ON rm.id = st.room_id
      LEFT JOIN room_tariffs rt ON rt.id = st.tariff_id
     WHERE st.admission_channel = 'referral'
       AND st.last_charged_date IS NOT NULL
       AND (
             (st.referring_doctor_id IS NOT NULL AND COALESCE(st.referring_doctor_percent, 0) > 0)
          OR (st.agent_id IS NOT NULL AND COALESCE(st.agent_percent, 0) > 0)
           )
       AND (
             (p_stay_id IS NOT NULL AND st.id = p_stay_id)
          OR (p_stay_id IS NULL AND (
                st.status = 'admitted'
             OR st.discharged_at >= now() - interval '60 days'))
           )
  LOOP
    v_first   := (s.admitted_at AT TIME ZONE 'Asia/Tashkent')::date;
    v_doc_pct := CASE WHEN s.referring_doctor_id IS NOT NULL
                      THEN COALESCE(s.referring_doctor_percent, 0) ELSE 0 END;
    v_agt_pct := CASE WHEN s.agent_id IS NOT NULL
                      THEN COALESCE(s.agent_percent, 0) ELSE 0 END;
    v_day := v_first;

    WHILE v_day <= s.last_charged_date LOOP
      v_base := CASE WHEN v_day = v_first AND s.is_half_day
                     THEN s.half_price ELSE s.daily_price END;

      IF COALESCE(v_base, 0) > 0 THEN
        IF v_doc_pct > 0 THEN
          INSERT INTO referral_accruals (
            clinic_id, stay_id, patient_id, partner_id, role, charge_date,
            base_uzs, percent, amount_uzs
          ) VALUES (
            s.clinic_id, s.id, s.patient_id, s.referring_doctor_id, 'doctor', v_day,
            v_base, v_doc_pct, FLOOR(v_base * v_doc_pct / 100.0)::bigint
          )
          ON CONFLICT (stay_id, role, charge_date) WHERE status <> 'void' DO NOTHING;
          GET DIAGNOSTICS v_rows = ROW_COUNT;
          v_count := v_count + v_rows;
        END IF;

        IF v_agt_pct > 0 THEN
          INSERT INTO referral_accruals (
            clinic_id, stay_id, patient_id, partner_id, role, charge_date,
            base_uzs, percent, amount_uzs
          ) VALUES (
            s.clinic_id, s.id, s.patient_id, s.agent_id, 'agent', v_day,
            v_base, v_agt_pct, FLOOR(v_base * v_agt_pct / 100.0)::bigint
          )
          ON CONFLICT (stay_id, role, charge_date) WHERE status <> 'void' DO NOTHING;
          GET DIAGNOSTICS v_rows = ROW_COUNT;
          v_count := v_count + v_rows;
        END IF;
      END IF;

      v_day := v_day + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.accrue_inpatient_referral_shares(uuid) IS
  'Statsionar yo''llanma ulushi: xona to''lovi yozilgan kunlar (last_charged_date gacha) uchun shifokor/agent ulushini referral_accruals''ga yozadi. Idempotent.';

REVOKE ALL ON FUNCTION public.accrue_inpatient_referral_shares(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_inpatient_referral_shares(uuid) TO service_role;
