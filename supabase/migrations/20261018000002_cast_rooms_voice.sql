-- =============================================================================
-- Clary Cast — shifokor xonasi + navbat ovozi
--
--   A) profiles.room_label — shifokor hozir o'tirgan xona ("7", "205", "UZI").
--      TV chaqiruvi shu bilan aytiladi: "To'rt raqamli bemor, yettinchi xonaga
--      marhamat". Shifokor xonaga kirganda o'zi belgilaydi (ish joyi / sozlama).
--   B) 'cast-voice' storage bucket — navbat iboralarining yozib olingan ovozi
--      (raqamlar, "raqamli bemor", "xonaga marhamat"). Ommaviy o'qish (TV
--      login'siz), yozish faqat API (service role) orqali:
--        _default/<kalit>.<ext>  — platforma standart ovozi (super admin)
--        <clinic_id>/<kalit>.<ext> — klinikaning o'z ovozi (ixtiyoriy)
--
-- Faqat QO'SHIMCHA va idempotent: eski kod bilan mos.
-- =============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS room_label text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_room_label_chk;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_room_label_chk
  CHECK (room_label IS NULL OR char_length(btrim(room_label)) BETWEEN 1 AND 16);

COMMENT ON COLUMN public.profiles.room_label IS
  'Shifokorning hozirgi xonasi (Clary Cast TV chaqiruvi uchun)';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cast-voice',
  'cast-voice',
  true,
  2097152, -- 2 MB: bitta ibora bir necha soniya
  ARRAY[
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac',
    'audio/wav', 'audio/x-wav', 'audio/wave'
  ]
)
ON CONFLICT (id) DO NOTHING;
