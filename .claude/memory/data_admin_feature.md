---
name: data-admin-feature
description: "Xavfli zona — moliyaviy ma'lumotlarni arxivlab hard-delete + undo (recycle bin). Sozlamalar > data-admin, owner+PIN."
metadata: 
  node_type: memory
  type: project
  originSessionId: 10d0df07-9d29-4572-a47f-bf5f8e147e96
---

# Xavfli zona — ma'lumotlarni o'chirish + undo (2026-05-31)

Sozlamalar > "Xavfli zona" > Ma'lumotlarni o'chirish (`/settings/data-admin`). Klinika **admini** (clinic_admin / clinic_owner / super_admin) jurnal/kassa/statsionar/maosh bo'limlarini **bittadan tanlab**, sana oralig'i bo'yicha **arxivlab hard-delete** qiladi + **undo** (qaytarish).

**Himoya:** owner gate (frontend + `@Roles`) + **journal PIN** (`clinics.journal_pin_hash` SHA-256, `verifyPin` mantig'i ko'chirilgan) + sana oralig'i + tasdiqda **'DELETE' yozish** + `@Audit`.

## Arxitektura
- **DB:** `deleted_records_archive` jadval (batch_id uuid, section, table_name, row_id, row_data jsonb, sort_order, deleted_by/at, restored_by/at). RLS tenant.
- **2 RPC (SECURITY DEFINER, postgres owner — RLS bypass):**
  - `data_admin_purge(p_clinic_id, p_section, p_from, p_to, p_deleted_by) RETURNS batch_id` — har jadval arxivla→DELETE. FK tartibi (NO ACTION bolalar avval, CASCADE bolalar oldindan arxivlanadi). `_purge_transactions`/`_purge_pharmacy`/`_dra_archive_delete` helperlar.
  - `data_admin_restore(p_clinic_id, p_batch_id, p_restored_by)` — `sort_order ASC` (parent oldin), `jsonb_populate_record` + `WHERE NOT EXISTS` (idempotent).
- **Bo'limlar→jadvallar:** journal=transactions+pharmacy_sales+expenses; cashier=+safe_deposits; inpatient=inpatient_stays+patient_ledger+bog'liq transactions (to'liq o'chadi); payroll=doctor_commissions+ledger+payouts (rates EMAS).
- **Backend:** `apps/api/src/modules/data-admin/data-admin.module.ts` — counts/purge/batches/restore. `app.module.ts` da ro'yxatda.
- **Frontend:** `apps/web-clinic/src/pages/settings/data-admin.tsx`; nav `settings/layout.tsx` (owner-only); `api.dataAdmin.*` (client.ts).

## KRITIK kashfiyotlar (qayta o'rganmaslik uchun)
1. **`patient_ledger` append-only** — `no_delete_patient_ledger`/`no_update_patient_ledger` RULE'lar DELETE/UPDATE'ni bloklaydi (silent 0 qaytaradi). Purge RPC boshida `ALTER TABLE ... DISABLE RULE`, oxirida ENABLE (EXCEPTION blok bilan).
2. **ON CONFLICT ishlamaydi** — `patient_ledger`da UPDATE rule borligi sabab `INSERT ... ON CONFLICT` xato beradi → restore'da `WHERE NOT EXISTS` ishlatiladi.
3. MCP `execute_sql` postgres BYPASSRLS bo'lsa-da, plain DO blokda RLS DELETE'ni to'sadi; RPC DEFINER bypass qiladi.

## Manual DB tozalash (men to'g'ridan qilganda)
Ba'zi tozalash standart purge qamramaydi — qo'lda `deleted_records_archive`ga `to_jsonb` arxivlab DELETE qilingan (section nomi bilan):
- `doctor_commission_rates` (maosh foiz stavkalari — payroll purge buni o'chirmaydi)
- `shifts` (smena farqi/anomaliya manbasi — `shift_cash_anomaly_view`/`recentClosed`)
- `appointments`+`queues`+`patients` (dashboard qabul/navbat/bemor statistikasi)
Tartib: bolalar avval (queues→appointments→patients). `patient_ledger` DELETE uchun rule DISABLE shart.

**Eslatma:** MAGNUS (`7e4ab36d-a750-43f6-8870-dd90a0d2da50`) test/tozalash uchun ishlatilgan — 2026-05-31 da kassa/jurnal/statsionar/maosh/dashboard/smena to'liq tozalandi (arxivda). Jurnal PIN test uchun `1234` ga o'rnatilgan — egasi o'zgartirishi kerak.

Bog'liq: [[clary-app-skill]], [[deploy-process]]
