---
name: payroll-smart
description: 'Aqlli maosh — barcha xodimlar (ghost profil), oylik turlari (fixed/weekly/percent/bonus), payday sanasi, oldi/kerak + eslatma. Anketada sozlanadi.'
metadata:
  node_type: memory
  type: project
  originSessionId: 10d0df07-9d29-4572-a47f-bf5f8e147e96
---

# Aqlli maosh tizimi (2026-06-01)

Maosh (payroll) tizimi kengaytirildi: barcha xodimlar maoshda, anketada oylik turi/sanasi, oylik oldi/kerak ro'yxatlari + eslatma.

## Asosiy o'zgarishlar

1. **BARCHA faol xodimlar maoshda** — kassir/qabulxonachi/farrosh/praktikant ham. Mexanizm: anketaga xodim qo'shilganda **ghost profil** (login-imkonisiz `auth.users`+`profiles`, role='doctor') yaratiladi → maosh ro'yxatida chiqadi. Avval faqat KLINIK_POSITIONS (doctor/nurse/...) uchun edi; endi **barcha position** uchun. (payout/avans `profiles.id` FK'siga bog'langani uchun ghost SHART.)
2. **Anketa (staff_profiles) yangi maydonlar** (migration `payroll_smart_staff_profiles`):
   - `salary_type` CHECK: fixed/percent/**weekly**/**bonus**/mixed
   - `salary_bonus_uzs` (bonus/aralash)
   - `payday_kind` (monthly/weekly), `payday_day` (1-31; weekly: 1-7)
   - `show_in_reception` boolean (default true) — qabulxona dropdownida ko'rinishi
   - position CHECK ga **trainee** (Praktikant) + receptionist
3. **Qabulxona dropdowni** (`GET /doctors`, `reception.module.ts:list()`) endi `show_in_reception=true` filtri bilan. Login doctor (anketasi yo'q) default ko'rinadi. Non-clinical (kassir/qabulxona) create()'da `show_in_reception=false`.
4. **paydayStatus endpoint** (`payroll.module.ts`) — `GET /payroll/payday-status?from&to`: har xodimga {paid, due, due_date, net_uzs}. monthly=oy N-kun (oy oxiridan oshmaydi), weekly=hafta kuni; due=due_date<=bugun(Asia/Tashkent) AND !paid AND net>0.
5. **Maosh oynasi (payroll.tsx):**
   - OverviewTab: "Oylik oldi" / "Oylik olishi kerak" 2 ro'yxat (paydayStatus).
   - `PaydayReminder` banner — joriy oy due xodimlar, X→sessionStorage('payday-reminder-dismissed').

## Critical fayllar

- `apps/api/src/modules/staff-profiles/staff-profiles.module.ts` — POSITIONS, StaffProfileSchema, ghost create barcha position (POSITION_TO_ROLE), create() show_in_reception default
- `apps/api/src/modules/reception/reception.module.ts` — payrollList() PAYROLL_POSITIONS barcha; list() show_in_reception filtri
- `apps/api/src/modules/payroll/payroll.module.ts` — paydayStatus()
- `apps/web-clinic/src/pages/settings/staff-profiles.tsx` — anketa (salary_type weekly/bonus, payday, reception checkbox, trainee)
- `apps/web-clinic/src/pages/payroll.tsx` — oldi/kerak + PaydayReminder
- `packages/api-client/src/client.ts` — staffProfiles tip + payroll.paydayStatus

## Maosh NET formula (mavjud)

NET = commissions + monthly_base + bonuses − advances − penalties + inpatient_payroll. `payroll_clinic_period_summary` RPC hisoblaydi. doctor_commissions(komissiya), doctor_ledger(avans/bonus/jarima), doctor_payouts(oylik to'lov status draft/paid/canceled), doctor_commission_rates(foiz stavkalari + `monthly_base_uzs`).

**Eslatma:** mavjud xodimlar default `payday_day=3` monthly oladi — anketadan har biriga to'g'ri sana belgilash kerak.

## 2026-06-03 BUG FIX — avtomatik oylik yozilmayotgan edi

**Sabab:** anketa maoshi (`salary_fixed_uzs`) `doctor_commission_rates.fixed_uzs` (har-tranzaksiya fix)ga
yozilardi, **`monthly_base_uzs`ga emas**. Tranzaksiyasiz xodimga NET=0 edi. Anketa tahrirlanganda esa
sync UMUMAN bo'lmasdi (update() faqat staff_profiles patch qilardi).
**Yechim:** `apps/api/src/common/payroll-rate.util.ts` — `salaryToRate()` (fixed/mixed→monthly_base,
weekly→×4.33, bonus→bonus summa, percent→faqat %) + `syncSalaryRate()` (eski global rate arxivla →
yangi insert, `valid_from`=oy boshi Toshkent, RPC `valid_from <= p_from`ni qondiradi). Qo'llandi:
staff-profiles create/**update**/backfill + reception resolveDoctorId. Eski xodimlar uchun bir martalik:
**GET `/api/v1/staff-profiles/backfill-ghost-profiles`** (admin) — barcha linked xodim maoshini sync qiladi.
DB rollback-test bilan tasdiqlangan: monthly_base_uzs=5M → RPC net_uzs=5M.

## Qabulxonada shifokor mutaxassisligi (2026-06-03)

`GET /doctors` (reception.module.ts:list()) endi `specialization` qaytaradi (staff_profiles'dan; login
doctor uchun profile_id→staff_profiles join). Qabulxona DoctorPicker ism ostida mutaxassislikni ko'rsatadi.
Anketa saqlashda `doctors` query allaqachon invalidate bo'ladi.

Bog'liq: [[clary-app-skill]], [[data-admin-feature]]
