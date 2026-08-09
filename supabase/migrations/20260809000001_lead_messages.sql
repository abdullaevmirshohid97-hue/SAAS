-- =============================================================================
-- LIDGA XABAR — super-admin yozadi, mijoz demo klinikasiga kirganda ochiladi
-- =============================================================================
-- MUAMMO: lid demo oladi (1-klik), ichida yuradi va ketadi. Uni ushlab qolish
-- uchun aynan O'SHA demo ichida gaplashish kerak, lekin lid bilan uning demo
-- klinikasi o'rtasida hech qanday bog'lanish yo'q edi — `sales_leads` da
-- clinic_id yo'q, `demo_spawn_log` da esa kontakt yo'q (u anti-abuse jurnali).
--
-- YECHIM: mavjud yetkazish kanalini QAYTA ISHLATAMIZ. `clinic_announcements`
-- allaqachon klinikada bloklovchi modal bo'lib ochiladi (app-shell.tsx →
-- AnnouncementModal, 60s poll, per-user ack). Ya'ni yangi kanal qurish shart
-- emas — faqat "qaysi klinikaga" degan bog'lanishni qo'shamiz.
--
-- NEGA ALOHIDA `lead_messages` JADVALI (to'g'ridan-to'g'ri announcement emas):
-- demo klinika 24 soatdan keyin O'CHADI (cleanup_expired_demos). Agar xabarni
-- faqat announcement sifatida yozsak, mijoz ertaga qaytib yangi demo ochsa
-- xabar yo'qolgan bo'ladi — aynan ushlab qolmoqchi bo'lgan odamni boy beramiz.
-- Shuning uchun xabar lidda saqlanadi va mijoz QAYSI demoni ochsa ham
-- (telefon raqami bo'yicha) o'sha yerda yetkaziladi.
-- =============================================================================

-- ── 1. Lid ↔ demo klinika bog'lanishi ────────────────────────────────────────
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL;

COMMENT ON COLUMN sales_leads.clinic_id IS
  'Instant demo lidining demo klinikasi. Demo o''chsa NULL bo''ladi (24 soat TTL).';

CREATE INDEX IF NOT EXISTS idx_sales_leads_clinic
  ON sales_leads(clinic_id) WHERE clinic_id IS NOT NULL;

-- ── 2. Xabarlar ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  contact_phone   TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Yetkazilgan = klinikada announcement yaratilgan. NULL bo'lsa mijoz keyingi
  -- demo ochganida avtomatik yetkaziladi.
  delivered_at    TIMESTAMPTZ,
  announcement_id UUID REFERENCES clinic_announcements(id) ON DELETE SET NULL,
  clinic_id       UUID REFERENCES clinics(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead ON lead_messages(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_messages_pending
  ON lead_messages(delivered_at) WHERE delivered_at IS NULL;

-- Faqat service_role (API) tegadi — policy YO'Q, bu `clinic_announcements`
-- bilan bir xil naqsh.
ALTER TABLE lead_messages ENABLE ROW LEVEL SECURITY;

-- ── 3. Eski instant_demo lidlarni bog'lash (backfill) ────────────────────────
-- demo.service.ts da demo_spawn_log va sales_leads bitta so'rovda, bir necha
-- soniya farq bilan yoziladi — vaqt bo'yicha eng yaqinini olamiz. Demosi
-- allaqachon o'chgan lidlarda demo_spawn_log.clinic_id ham NULL (ON DELETE
-- SET NULL), ya'ni ular tabiiy ravishda chetda qoladi.
UPDATE sales_leads l
SET clinic_id = (
  SELECT d.clinic_id
  FROM demo_spawn_log d
  WHERE d.clinic_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM clinics c WHERE c.id = d.clinic_id)
    AND d.created_at BETWEEN l.created_at - INTERVAL '5 minutes'
                         AND l.created_at + INTERVAL '5 minutes'
  ORDER BY abs(EXTRACT(EPOCH FROM (d.created_at - l.created_at)))
  LIMIT 1
)
WHERE l.source = 'instant_demo' AND l.clinic_id IS NULL;

-- ── 4. Kutayotgan xabarlarni yangi demoga yetkazish ──────────────────────────
-- Mijoz qayta demo ochganda chaqiriladi (demo.service.ts). Telefon raqamining
-- OXIRGI 9 RAQAMI bo'yicha solishtiramiz: lidlar "+998971984949", "(97) 198 49 49",
-- "996934183" ko'rinishida keladi — formatga tayanib bo'lmaydi.
CREATE OR REPLACE FUNCTION deliver_pending_lead_messages(p_clinic_id UUID, p_phone TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tail  TEXT;
  v_count INTEGER := 0;
  v_ann   UUID;
  m       RECORD;
BEGIN
  v_tail := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  IF length(v_tail) < 9 THEN
    RETURN 0;
  END IF;

  FOR m IN
    SELECT lm.id, lm.title, lm.body, lm.contact_phone, lm.created_by
    FROM lead_messages lm
    JOIN sales_leads sl ON sl.id = lm.lead_id
    WHERE lm.delivered_at IS NULL
      AND right(regexp_replace(coalesce(sl.phone, ''), '\D', '', 'g'), 9) = v_tail
    ORDER BY lm.created_at
  LOOP
    INSERT INTO clinic_announcements
      (clinic_id, title, body, contact_phone, created_by, requires_ack, is_active)
    VALUES
      (p_clinic_id, m.title, m.body, m.contact_phone, m.created_by, TRUE, TRUE)
    RETURNING id INTO v_ann;

    UPDATE lead_messages
    SET delivered_at = now(), announcement_id = v_ann, clinic_id = p_clinic_id
    WHERE id = m.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Xavfsizlik hardening naqshi: secdef funksiya faqat service_role uchun.
REVOKE EXECUTE ON FUNCTION deliver_pending_lead_messages(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION deliver_pending_lead_messages(UUID, TEXT) FROM anon, authenticated;
