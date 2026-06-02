---
name: clary-app-skill
description: "Clary CRM SaaS loyihasi haqida to'plangan bilim — arxitektura, asosiy modullar, DB sxemasi, ish oqimlari, prod kontekst, ko'p sodir bo'ladigan baglar"
metadata: 
  node_type: memory
  type: project
  originSessionId: a0c8194c-093d-421c-a6c9-17e5526f3f78
---

# Clary CRM — Loyiha Skill (Knowledge Base)

## Umumiy

- **Stack:** NestJS (API) + Supabase (Postgres + RLS) + Vite/React (frontend) + pnpm monorepo
- **Multi-tenant:** klinika (`clinics` jadval), har user `clinic_id` bilan bog'lanadi, RLS asosida ajratiladi
- **Til:** Asosan o'zbek (uz-Latn) UI, kod ingliz
- **Working dir:** `d:\SAAS` (Windows, PowerShell)
- **Server prod:** `/opt/clary` (Linux, pm2 + nginx + Supabase managed)
- **Supabase project ID:** `aoubdvlkcatbeifuysau` (SAAS, ACTIVE_HEALTHY)
- **Live klinikalar (5 ta):** MAGNUS, Demo Klinika, Diagnostika Markaz, jui, Klinika NUR
- **Solo developer**, har commit oxirida deploy qilinadi

## Monorepo strukturasi

```
apps/
  api/                 — NestJS backend
    src/modules/
      reception/       — Qabulxona (checkout, ticket, doctor list, /doctors, payroll-list)
      cashier/         — Kassa KPI, transactions list, chek reprint, export
      shifts/          — Kassa smenalari (operator, pin, open/close, X/Z report)
      journal/         — Universal jurnal (transactions + pharmacy + shifts + ...)
      staff-profiles/  — Xodimlar anketasi (login bo'lmagan ham, ghost yaratish)
      staff/           — Login user yaratish (auth+profiles+claim)
      payroll/         — Maosh (commissions, ledger, payouts, rates, paydayStatus)
      inpatient/       — Statsionar (xizmat, qarovchi, qarzdorlar, debtors)
      analytics/       — Analitika (overview, allDoctors, serviceDetail, inpatientShare)
      data-admin/      — Xavfli zona (hard-delete + undo, purge/restore RPC) — YANGI
      pharmacy/        — Dorixona
      billing/         — Schyot-faktura
      queues/          — Navbat
      doctor/          — Shifokor workspace
      thermal-printers — Termal printer config
      webhooks/        — Click/Payme/Telegram
apps/
  web-clinic/          — Klinika frontend (Vite/React)
  web-admin/           — Super admin paneli
  web-landing/         — Astro landing
packages/
  schemas/             — Zod schemas, PERMISSION_MODULES, role types
  config/              — Konstantalar
  i18n/                — Tarjima
tests/
  e2e-web/             — Playwright spec'lar
```

## Asosiy DB jadvallar (tez-tez ishlatiladi)

- **profiles** — auth.users bilan 1-1, `id` (=auth.user_id), `clinic_id`, `role` (user_role enum: super_admin, clinic_owner, clinic_admin, doctor, nurse, receptionist, cashier, staff), `full_name`, `email`, `phone`, `is_active`, `permissions_override`
- **staff_profiles** — HR anketa (login bo'lmasligi mumkin). `id`, `clinic_id`, `profile_id` (NULL bo'lsa ghost yaratiladi), `first_name/last_name/patronymic`, `position` (doctor/nurse/administrator/pharmacist/lab_tech/manager/cleaner/cashier/receptionist/**trainee**/other). MAOSH: `salary_type` (fixed/percent/**weekly**/**bonus**/mixed), `salary_fixed_uzs`, `salary_percent`, `salary_bonus_uzs`, `payday_kind` (monthly/weekly), `payday_day` (1-31), `show_in_reception` (qabulxona dropdownida ko'rinishi), `inpatient_payroll_mode/percent/monthly_uzs/admission_bonus_uzs`, `is_active`. Detallar: [[payroll-smart]]
- **deleted_records_archive** — Xavfli zona arxivi (hard-delete + undo). `batch_id`, `section`, `table_name`, `row_id`, `row_data` jsonb, `sort_order`, `restored_at`. Detallar: [[data-admin-feature]]
- **clinics** — klinika ma'lumotlari
- **patients** — bemorlar
- **appointments** — qabullar (`patient_id`, `doctor_id`, `clinic_id`, `status`, `scheduled_at`, `service_id`, snapshot maydonlar)
- **transactions** — to'lovlar. Ustunlar: `id`, `clinic_id`, `patient_id`, `appointment_id`, `lab_order_id`, `diagnostic_order_id`, `stay_id`, `shift_id`, `cashier_id`, `kind` (payment/refund/...), `amount_uzs`, `payment_method` (cash/card/humo/uzcard/debt/...), `is_void`, `notes`. **`doctor_id` ustuni YO'Q** — shifokor faqat appointment orqali bog'lanadi.
- **transaction_items** — har xizmat alohida (snapshot bilan)
- **queues** — navbat (`ticket_no`, `queue_date`, `queue_seq`, `appointment_id`, `doctor_id`, `status`)
- **shifts** — kassa smenasi (`operator_id`, `opened_at`, `closed_at`, `opening_cash_uzs`, `actual_cash_uzs`, `cash_total_uzs`, ...)
- **shift_operators** — kassa xodimlari (PIN bilan)
- **doctor_commissions** — har transaction uchun komissiya yozuvi (`transaction_id`, `doctor_id`, `service_id`, `amount_uzs`, `status`)
- **doctor_commission_rates** — foiz/fix konfiguratsiyasi (doctor + service yoki doctor + NULL global)
- **doctor_payouts** — maosh to'lovlari
- **patient_ledger** — bemor balansi (qarz)
- **expenses** — rasxotlar
- **pharmacy_sales** — dorixona savdosi
- **audit_log** — barcha mutating action'lar (AuditInterceptor)
- **inpatient_stays** — statsionar
- **rooms** — palatalar
- **expense_categories** — rasxot kategoriyalar

## Asosiy oqimlar (workflows)

### 1. Reception checkout
- Frontend: `apps/web-clinic/src/pages/reception.tsx`
- Backend: `apps/api/src/modules/reception/reception.module.ts` → `ReceptionService.checkout()`
- Oqim:
  1. Bemor tanlash (yangi yoki mavjud)
  2. Xizmatlar (cart)
  3. Shifokor (DoctorPicker — `api.doctors.list()`)
  4. To'lov usuli + summa
  5. `existingApptId` (default `null` = yangi qabul) yoki mavjud appointment'ga qo'shish
  6. Backend:
     - `transaction` + `transaction_items` yaratiladi
     - Agar `add_to_queue` true va doctor bor → `appointment` + `queue` ham yaratiladi (RPC `allocate_queue_ticket`)
     - `doctor_commissions` yoziladi (rate bo'lsa)
     - `patient_ledger` ga qarz yoziladi (bor bo'lsa)

### 2. Doctor list (Qabulxona dropdown)
- Endpoint: `GET /api/v1/doctors` (reception.module.ts:list())
- 2 manba MERGED: profiles (role doctor/admin/owner) + staff_profiles (KLINIK_POSITIONS, profile_id NULL).
- **YANGI (2026-06-01):** `show_in_reception=true` filtri — faqat anketada belgilangan shifokor/hamshira chiqadi. Login doctor (anketasi yo'q) default ko'rinadi. [[payroll-smart]]

### 3. Ghost profile creation (barcha xodim maoshda)
- `staff_profiles.profile_id` NULL bo'lsa — yangi auth.user + profiles "ghost" (login-imkonisiz random parol, role='doctor', administrator→clinic_admin).
- **YANGI:** ghost endi **BARCHA position** uchun yaratiladi (kassir/qabulxona/praktikant/farrosh ham) — maoshda chiqishi uchun. `reception.payrollList()` PAYROLL_POSITIONS barcha position. (payout/avans profiles.id FK'siga bog'langani uchun ghost SHART.)

### 4. Smena (shift) oqimi
- Kassir PIN bilan smena ochadi (`shift_operators.pin_hash` argon2id)
- Klinikada faqat 1 ta faol smena bo'lishi mumkin (boshqa user/operator bo'lsa ConflictException)
- Smena yopilganda: aggregateShiftTotals (cash/card/electronic), `cash_total_uzs` saqlanadi, `actual_cash_uzs` user'dan
- **Kassa KPI** (`cashier.module.ts:kpis()`) faqat faol smena `shift_id` bo'yicha hisoblanadi → smena yopilsa today=0, yesterday/month tegmaydi (tarix saqlanadi)
- Journal'da `shift_opened` va `shift_closed` sintetik feed entrylar

### 5. Journal feed
- `apps/api/src/modules/journal/journal.module.ts`
- 8+ manba: transaction, pharmacy_sale, inpatient_charge, inpatient_admit, inpatient_discharge, expense, shift_opened, shift_closed
- 2-darajali sozlanadigan layout (admin defaults + clinic overrides)
- Har entryda: occurred_at, patient_name, patient_phone, doctor_name, cashier_name, amount_uzs, payment_method, status, is_void

## RBAC (permissions)

- `@RequirePerm()` decorator + global `PermissionsGuard` (app.module.ts)
- `@Roles()` decorator ham bor
- `clinic_owner` va `clinic_admin` — `PermissionsGuard` bypass (line 43)
- `PERMISSION_MODULES` — `packages/schemas/src/permissions.ts`
- `clinic_owner` va `clinic_admin` = `ALL_PERMISSIONS` (least-privilege buzilishi — auditda flagged, lekin sodda qoldirildi)

## Important conventions / patterns

- **Asia/Tashkent timezone** (kunlik charge'lar)
- **Atomik queue allocation:** `allocate_queue_ticket` RPC (advisory lock + MAX+1)
- **AuditInterceptor** har mutating endpoint'da (`@Audit({ action, resourceType })`)
- **Soft delete** (is_archived, is_active) — hard delete cheklangan, FK bo'lsa BadRequestException
- **Self-heal pattern** in `payrollList()` — orphan staff_profiles uchun ghost yaratiladi
- **Snapshot fields** (service_name_snapshot, service_price_snapshot) — narx o'zgarsa hisobot buzilmaydi

## Production kontekst

- **Server:** `/opt/clary` (cd, git pull, pnpm install, pnpm --filter @clary/<x> build, pm2 restart clary-api, nginx static)
- **Deploy script formati:** SSH root yozmang, `cd /opt/clary` dan boshlang
- **Asosiy aybdor:** ko'p baglar deploy qilinmasdan oldin yashirin — har commit'dan keyin server'da deploy kerak
- **Brauzerda hard refresh** (Ctrl+Shift+R) — eski JS bundle cache muammosi tez-tez bo'ladi
- **React Query global staleTime: 30_000** (`apps/web-clinic/src/main.tsx`)

## Foydalanuvchi (loyiha egasi) — ish uslubi

- **O'zbek tilida muloqot qiladi (uz-Latn).** Texnik terminlar inglizcha bo'lishi mumkin, lekin tushuntirish o'zbek.
- **Production tezligi muhim** — har bug iloji boricha tez tuzatilishi kerak.
- **MAGNUS asosiy klinika**, lekin "loyiha bo'yicha ishla, faqat MAGNUS emas" — barcha 5 klinikani tekshirish kerak.
- **Katta refactoring/audit'larni xohlamaydi** — bir marta to'liq audit qilinib hammasi buzildi va revert qilindi. Hozir: kichik, testlangan o'zgarishlar.
- **Deploy script har commit'dan keyin so'raydi** — qisqa, `cd /opt/clary` dan boshlanuvchi script ber.
- **"Chuqurroq tekshir"** so'rasa — DB darajasida (Supabase MCP), kod darajasida, frontend+backend birga.
- **Charchaganda ham aniq fix bering, savol bilan o'ralashmang** — savol so'rash kerak bo'lsa, qisqa.

## Ko'p bo'ladigan baglar/edge case'lar

1. **`appointment_id=NULL` tx:** reception checkout'da doctor tanlanmasa, appointment yaratilmaydi → jurnalda shifokor bo'sh, navbat ham qo'shilmaydi
2. **`existingApptId` avtomatik tanlanishi:** bemorda ochiq appointment bor bo'lsa, default "qo'shish"ga tushib ketardi → kritik bug, 2026-05-24 da fix
3. **React Query cache invalidation:** xodim qo'shilganda faqat `staff-profiles` invalidate qilinardi, reception/payroll cache 30s eski qoladi
4. **Ghost profile create silently fails:** ba'zi yangi staff_profiles'larda profile role='staff', clinic_id=NULL bo'lib qoladi (sabab to'liq aniqlanmagan)
5. **doctor_commissions bo'sh:** agar rate=0 bo'lsa, kommissiya yozilmaydi → fallback ham ishlamaydi
6. **Smena race condition:** klinikada faqat 1 faol smena, ConflictException default
7. **FK violation hard delete'da:** profiles.id boshqa jadvallarda (doctor_commissions, appointments, transactions) FK bilan bog'liq — to'liq DELETE qilib bo'lmaydi. Yechim: soft-disable (is_active=false, email=NULL, clinic_id=NULL) + auth.users delete.

## 2026-05-31/06-01 yangi featurelar (qisqacha — to'liq: bog'liq memorylar)
- **Xavfli zona** (Sozlamalar>data-admin): moliyaviy ma'lumotlarni arxivlab hard-delete+undo. [[data-admin-feature]]
- **Aqlli maosh:** barcha xodimlar (ghost), oylik turlari, payday, oldi/kerak+eslatma. [[payroll-smart]]
- **Kassa standartlari** (chek reprint, X-hisobot, custom oraliq+export, void PIN), **statsionar qarzdorlar** (qarz yopish+chek), **super analitika** (drill-down sahifalar). [[features-2026-05-31]]

## Hal qilingan muammolar (avval skill'da "ochiq" deb yozilgan)
- **"Hisobotda kassir o'rniga shifokor/navbatchi":** HAL QILINDI. Smena hisoboti + jurnalda **kassir = smenadagi navbatchi operator** (shift_id→shift_operators.full_name), login user emas. Shifokor esa appointment.doctor + doctor_commissions fallback orqali.
- **Hard delete FK muammosi:** endi **Xavfli zona (data-admin)** orqali — arxivlab o'chirish + undo. patient_ledger append-only rule bypass qilinadi. [[data-admin-feature]]

## Quick reference
- API URL: `/api/v1/...` ; Auth: Supabase JWT (clinic_id+role app_metadata) ; DB: Postgres 17
- Frontend env: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- MAGNUS clinic_id: `7e4ab36d-a750-43f6-8870-dd90a0d2da50` (2026-05-31 to'liq tozalangan — test/demo)
- Skill oxirgi yangilanish: 2026-06-01
