-- Klinikani BUTUNLAY o'chirish funksiyasi (super-admin Arxiv > Butunlay o'chirish).
-- Muammo: clinics ON DELETE CASCADE bu sxemada ishlamaydi, chunki bir nechta
-- jadvalda immutability RULE (no_delete_*) va audit USER-trigger bor + ba'zi
-- klinika-ichi FK'lar CASCADE emas → "referential integrity ... unexpected result".
-- Yechim: USER trigger + rule'larni vaqtincha o'chirib (system RI/cascade saqlanadi),
-- clinic_id jadvallarini ITERATIV (bola avval) o'chirish, so'ng klinikani o'chirish.
-- SECURITY DEFINER (jadval egasi) — trigger/rule boshqarish uchun. Xatoda butun
-- tranzaksiya rollback bo'ladi (trigger/rule avtomatik tiklanadi).
create or replace function public.admin_purge_clinic(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record; t text; tbls text[]; pass int := 0; failed int;
begin
  for r in
    select distinct c.relname tn from pg_attribute a join pg_class c on c.oid=a.attrelid
    where a.attname='clinic_id' and c.relkind='r' and c.relnamespace='public'::regnamespace and not a.attisdropped
  loop execute format('alter table public.%I disable trigger user', r.tn); end loop;
  for r in
    select c.relname tn, rw.rulename rn from pg_rewrite rw join pg_class c on c.oid=rw.ev_class
    where c.relnamespace='public'::regnamespace and rw.rulename <> '_RETURN'
  loop execute format('alter table public.%I disable rule %I', r.tn, r.rn); end loop;

  select array_agg(distinct c.relname) into tbls from pg_attribute a join pg_class c on c.oid=a.attrelid
    where a.attname='clinic_id' and c.relkind='r' and c.relnamespace='public'::regnamespace and not a.attisdropped;
  loop
    pass := pass + 1; failed := 0;
    foreach t in array tbls loop
      begin
        execute format('delete from public.%I where clinic_id = $1', t) using p_clinic_id;
      exception when others then failed := failed + 1; end;
    end loop;
    exit when failed = 0 or pass > 30;
  end loop;
  if failed > 0 then
    raise exception 'Klinika malumotlarini tozalab bolmadi: % jadval qoldi (FK halqasi?)', failed;
  end if;

  delete from public.clinics where id = p_clinic_id;

  for r in
    select distinct c.relname tn from pg_attribute a join pg_class c on c.oid=a.attrelid
    where a.attname='clinic_id' and c.relkind='r' and c.relnamespace='public'::regnamespace and not a.attisdropped
  loop execute format('alter table public.%I enable trigger user', r.tn); end loop;
  for r in
    select c.relname tn, rw.rulename rn from pg_rewrite rw join pg_class c on c.oid=rw.ev_class
    where c.relnamespace='public'::regnamespace and rw.rulename <> '_RETURN'
  loop execute format('alter table public.%I enable rule %I', r.tn, r.rn); end loop;
end $$;

revoke all on function public.admin_purge_clinic(uuid) from public, anon, authenticated;
grant execute on function public.admin_purge_clinic(uuid) to service_role;
