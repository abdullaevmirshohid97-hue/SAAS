-- =============================================================================
-- B4 — Ismsiz (bo'sh/probel) bemorlarni placeholder bilan belgilash
-- =============================================================================
-- Sabab: patients validatsiyasida .trim() yo'q edi (9ae8d82 da tuzatilgan) —
-- MAGNUS'da 111 bemor probel ism bilan yaratilgan. Ro'yxat/qarzdorlarda bo'sh
-- qator ko'rinadi. Bu skript ularni "Nomsiz bemor #MRN" qilib belgilaydi —
-- klinika keyin har birini haqiqiy ismga tahrirlaydi.
--
-- ISHLATISH: Supabase SQL Editor'da ishga tushiring (bir marta, idempotent —
-- qayta ishlatilsa yangi bo'sh ismlargagina ta'sir qiladi).

-- 1) Oldin ko'rib olish (ixtiyoriy):
-- SELECT id, mrn, phone, created_at FROM patients WHERE btrim(coalesce(full_name,'')) = '';

-- 2) Placeholder qo'yish:
UPDATE patients
SET full_name = 'Nomsiz bemor #' || COALESCE(NULLIF(btrim(mrn), ''), LEFT(id::text, 8)),
    first_name = 'Nomsiz',
    last_name  = 'bemor'
WHERE btrim(coalesce(full_name,'')) = '';

-- 3) Natija: nechta belgilandi + klinika kesimida
SELECT c.name AS clinic, count(*) AS nomsiz_bemorlar
FROM patients p JOIN clinics c ON c.id = p.clinic_id
WHERE p.full_name LIKE 'Nomsiz bemor #%'
GROUP BY c.name;

-- 4) Klinikaga tuzatish ro'yxati (telefon/yaratilgan sana ipuchi bilan):
-- SELECT full_name, mrn, phone, created_at::date
-- FROM patients WHERE full_name LIKE 'Nomsiz bemor #%' ORDER BY created_at;
