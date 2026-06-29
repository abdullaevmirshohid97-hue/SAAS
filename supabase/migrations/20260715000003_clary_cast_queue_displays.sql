-- Clary Cast — TV navbat ekranlari (pairing). Cast signali Supabase Realtime
-- Broadcast orqali yuboriladi (login'siz TV uchun; jadval SELECT talab qilmaydi).
-- Bu jadval faqat TV ro'yxati/bog'lash uchun (backend service-role boshqaradi).
create table if not exists public.queue_displays (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade,
  device_id text not null unique,
  name text,
  pairing_code text,
  is_paired boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_queue_displays_clinic on public.queue_displays(clinic_id) where clinic_id is not null;
create index if not exists idx_queue_displays_code on public.queue_displays(pairing_code) where pairing_code is not null;

alter table public.queue_displays enable row level security;
revoke select on public.queue_displays from anon, authenticated;
