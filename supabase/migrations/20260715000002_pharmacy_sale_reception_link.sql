-- Qabulxona "Dori bilan": pharmacy_sales'ni reception transaction'iga bog'lash.
-- Jurnal feed bog'langan dori savdosini transaction qatoriga birlashtiradi
-- (1 bemor amaliyoti = 1 yozuv: xizmat + dori, jami summa). Asosiy yozuvlar
-- ajralib qoladi → FEFO/COGS/ombor buxgalteriyasi buzilmaydi.
alter table public.pharmacy_sales
  add column if not exists reception_transaction_id uuid
  references public.transactions(id) on delete set null;

create index if not exists idx_pharmacy_sales_reception_tx
  on public.pharmacy_sales(reception_transaction_id)
  where reception_transaction_id is not null;
