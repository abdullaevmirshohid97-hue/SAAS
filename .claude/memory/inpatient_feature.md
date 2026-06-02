---
name: inpatient-feature
description: "Statsionar (inpatient) modul — xizmat qo'shish, qarovchi, deposit/to'lov, chek/PDF, jurnal amallari. To'liq feature bilimi (2026-05-30)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 10d0df07-9d29-4572-a47f-bf5f8e147e96
---

# Statsionar (Inpatient) — Feature bilimi (2026-05-30)

Bog'liq: [[clary-app-skill]], [[deploy-process]]

## Nima qilingan (2026-05-29/30)
Statsionar bemorga to'liq tahrir + hisob-kitob + hujjat oqimi qo'shildi. Commit'lar `9f9fee2` (asosiy), `5e87eab` (jurnal tugmalar), keyin Docker/deploy fixlar.

### 1. Xizmat qo'shish (`addService`)
- **Endpoint:** `POST /inpatient/services` ([inpatient.module.ts] `InpatientService.addService`)
- Reception checkout patternini qayta ishlatadi: `transactions` (kind='payment', `stay_id` to'ldirilgan) + `transaction_items` + komissiya.
- **Alohida shifokor** (`doctor_id`) — attending shifokordan MUSTAQIL. Komissiya `doctor_commissions` orqali (`accrueCommission` + `resolveDoctorId` reception'dan NUSXALANGAN, InpatientService private metod).
- **2 to'lov rejimi (`settle`):**
  - `pay` → `amount_uzs=total`, `payment_method` tanlangan (naqd/card/transfer/click/payme/humo/uzcard/**debt**). Real pul → kassaga tushadi.
  - `balance` → `amount_uzs=0`, **`payment_method='debt'`** (NOT NULL constraint!), + `patient_ledger` charge(-total). Bemor balansi qarzga ketadi.
- Jurnal `transactions`'ni `stay_id` orqali avtomatik "Statsionar" deb ko'rsatadi (`detectTxDepartment`). Kassa KPI `amount_uzs` ni avtomatik agregatlaydi (0 ni buzmaydi).
- Komissiya gross=total bo'yicha (to'lov rejimidan qat'i nazar).

### 2. Qarovchi (attendant)
- Migration `20260529000001_inpatient_attendant.sql`: `inpatient_stays.attendant_daily_uzs BIGINT DEFAULT 0` + `attendant_name TEXT`.
- `charge_daily_inpatient_stays()` RPC yangilandi → `+ attendant_daily_uzs` (kunlik charge'ga, "+ qarovchi" izoh).
- Qabulda (AdmitDialog) va batafsilda (AttendantPanel) tahrirlanadi. `updateExtras` endpoint kengaytirildi (daily_extras + attendant).

### 3. To'lov/deposit (LedgerPanel)
- Deposit/refund'da **to'lov turi** tugmalari (naqd/plastik/o'tkazma) qo'shildi — `recordLedger` allaqachon `payment_method` qabul qiladi, kassaga tushadi.

### 4. Chek/PDF
- **Termal chek** (har xizmat to'lovda): `printReceiptHybrid` + `paymentReceiptHtml` (mavjud, qayta ishlatildi).
- **Chiqish termal cheki:** `inpatientDischargeReceiptHtml()` ([print-receipt.ts]).
- **A4 PDF hisob-faktura:** `exportInpatientInvoicePdf()` ([inpatient-invoice-pdf.ts]) — jsPDF, DOM'siz to'g'ridan chizadi (kunlar, xizmatlar jadvali, jami, qarz/qoldiq).
- `getStay()` kengaytirildi: `services`, `days`, `totals` qaytaradi (chek/PDF uchun).

### 5. Jurnal oynasida statsionar amallari
- `GET /inpatient/active-stay?patient_id=...` — bemorning faol stay'ini (yoki null) qaytaradi (`activeStayForPatient`).
- Jurnal `DetailModal`'da: bemor faol statsionarda bo'lsa → "Statsionar amallari" karti (xizmat qo'shish / hisob). `ServicePanel`/`LedgerPanel` qayta ishlatiladi (inpatient.tsx'dan export).

### 6. Jurnal jadval tugmalari
- Jadval qatorida faqat "Batafsil ko'rish" (Eye) qoldi. Izoh/Tahrir/O'chirish olib tashlandi (DetailModal ichidagi tahrir/o'chirish QOLDI — unga tegilmadi).

## Asosiy fayllar
- `apps/api/src/modules/inpatient/inpatient.module.ts` — addService, activeStayForPatient, updateExtras, getStay, accrueCommission/resolveDoctorId nusxa
- `apps/web-clinic/src/pages/inpatient.tsx` — ServicePanel, AttendantPanel, LedgerPanel(payment_method), AdmitDialog(qarovchi)
- `apps/web-clinic/src/pages/inpatient-stay.tsx` — batafsil sahifa tugmalar + xizmatlar card + chek/PDF
- `apps/web-clinic/src/pages/journal.tsx` — DetailModal statsionar amallari, jadval tugmalar
- `apps/web-clinic/src/lib/inpatient-invoice-pdf.ts` — A4 PDF (YANGI)
- `apps/web-clinic/src/lib/print-receipt.ts` — inpatientDischargeReceiptHtml
- `packages/api-client/src/client.ts` — addService, activeStay, updateExtras, getStay types

## Muhim texnik nuqtalar (kelajakda eslab qol)
- **`transactions.payment_method` NOT NULL** + **`cashier_id` NOT NULL** — balance rejimida `payment_method='debt'`, cashier_id har doim userId.
- **`payment_method_type` enumda `debt` bor** (migration 20260524000030).
- **Jadval nomi `vital_signs`** (NOT `patient_vitals`). MAVJUD BAG: `getStay` `patient_vitals`'dan o'qiydi (jadval yo'q) → vitallar batafsilda hech qachon ko'rinmaydi. `recordVitals` to'g'ri `vital_signs`'ga yozadi. TUZATILMAGAN (scope'dan tashqari edi) — kelajakda 1 qatorli fix.
- DB test: production live ma'lumotga `BEGIN...RAISE EXCEPTION 'ROLLBACK_TEST'` bilan rollback-test qilish mumkin (Supabase MCP execute_sql).

## Hal qilingan eski muammo
Skill'dagi (2026-05-24) "hisobotda kassir o'rniga xizmat ko'rsatgan shifokor" muammosi — endi statsionar tomonida `addService` orqali alohida shifokor + komissiya bilan yopildi.
