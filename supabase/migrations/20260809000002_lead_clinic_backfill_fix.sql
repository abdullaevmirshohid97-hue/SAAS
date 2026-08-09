-- =============================================================================
-- LID ↔ DEMO KLINIKA — bog'lanishni tiklash (20260809000001 dagi backfill tuzatilishi)
-- =============================================================================
-- Oldingi migratsiyadagi backfill `demo_spawn_log.clinic_id` ga tayangan edi.
-- Ma'lum bo'ldiki, u ustun 2026-07 dan beri HAMMA yozuvda NULL:
--
--   spawn_demo_workspace() → TABLE(out_clinic_id, out_slug, out_expires_at)
--   demo.service.ts        → row.clinic_id / row.expires_at  ← boshqa nom!
--
-- Ya'ni `clinicId` kodda doim `undefined` bo'lgan. Demo baribir ochilgani uchun
-- bag ko'rinmasdi. Kod tuzatildi (out_ prefiksi), lekin MAVJUD lidlar hamon
-- bog'lanmagan — ularni klinikaning yaratilish vaqti bo'yicha tiklaymiz.
--
-- Instant demo oqimida klinika va lid bitta so'rovda, 1-3 soniya farq bilan
-- yoziladi, shuning uchun vaqt bo'yicha moslash ishonchli.
-- =============================================================================

-- ── 1. Lidlarni tirik demo klinikalariga bog'lash ────────────────────────────
UPDATE sales_leads l
SET clinic_id = (
  SELECT c.id
  FROM clinics c
  WHERE c.is_demo = TRUE
    AND c.deleted_at IS NULL
    AND c.created_at BETWEEN l.created_at - INTERVAL '5 minutes'
                         AND l.created_at + INTERVAL '5 minutes'
  ORDER BY abs(EXTRACT(EPOCH FROM (c.created_at - l.created_at)))
  LIMIT 1
)
WHERE l.source = 'instant_demo' AND l.clinic_id IS NULL;

-- ── 2. Kutib turgan xabarlarni darhol yetkazish ──────────────────────────────
-- Bog'lanish endi paydo bo'ldi, lekin xabarlar `delivered_at IS NULL` holatida
-- qolgan (yozilganda lid bog'lanmagan edi). Demosi hali tirik bo'lganlarini
-- shu yerda yetkazamiz — mijoz demoni yangilaganda modal chiqadi (60s poll).
DO $$
DECLARE
  m     RECORD;
  v_ann UUID;
BEGIN
  FOR m IN
    SELECT lm.id, lm.title, lm.body, lm.contact_phone, lm.created_by, l.clinic_id
    FROM lead_messages lm
    JOIN sales_leads l ON l.id = lm.lead_id
    JOIN clinics c     ON c.id = l.clinic_id
    WHERE lm.delivered_at IS NULL
      AND c.deleted_at IS NULL
      AND (c.demo_expires_at IS NULL OR c.demo_expires_at > now())
    ORDER BY lm.created_at
  LOOP
    INSERT INTO clinic_announcements
      (clinic_id, title, body, contact_phone, created_by, requires_ack, is_active)
    VALUES
      (m.clinic_id, m.title, m.body, m.contact_phone, m.created_by, TRUE, TRUE)
    RETURNING id INTO v_ann;

    UPDATE lead_messages
    SET delivered_at = now(), announcement_id = v_ann, clinic_id = m.clinic_id
    WHERE id = m.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
