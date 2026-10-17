# Tarif imkoniyatlari (entitlements)

Super-admin tarifga nima kirishini belgilaydi: modullar, jurnal cheklovlari, to'lov
turlari, analitika, rollar va qurilmalar. Har bir klinikaga tarif ustidan individual
kelishuv qo'yish mumkin (imkoniyatlar, limitlar, maxsus narx/chegirma, muddat).

## Qayerda nima

| Qism                                                            | Fayl                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Katalog (modullar, to'lov turlari, rollar, ilovalar) va tuzilma | `packages/schemas/src/entitlements.ts`                                         |
| Baza: jadval, birlashtirish, to'lov triggeri                    | `supabase/migrations/20261018000001_plan_entitlements.sql`                     |
| O'qish + kesh (60 s), fail-open                                 | `apps/api/src/common/entitlements/entitlements.service.ts`                     |
| Qurilmalar ro'yxati (X-Clary-Device / X-Clary-Client)           | `apps/api/src/common/entitlements/device-registry.service.ts`                  |
| Nazorat (APP_GUARD)                                             | `apps/api/src/common/guards/entitlements.guard.ts`                             |
| API (super-admin, klinika, ochiq)                               | `apps/api/src/modules/entitlements/entitlements.module.ts`                     |
| Super-admin UI                                                  | `apps/web-admin/src/pages/plans.tsx`, `plan-editor.tsx`, `components/tenant/*` |
| Klinika UI                                                      | `apps/web-clinic/src/hooks/use-entitlements.ts`, `components/module-gate.tsx`  |

## Qoidalar

- **Yo'q kalit = ruxsat.** Tarif `entitlements = '{}'` — hamma narsa ochiq. Yangi modul
  qo'shilganda mavjud klinikalar yopilib qolmaydi.
- **Amaldagi qiymat** = tarif (`clinics.current_plan`; tarmoq "bitta obuna" rejimida —
  HQ tarifi) → HQ kelishuvi → klinikaning o'z kelishuvi. Muddati o'tgan kelishuv
  e'tiborsiz. Hisoblash bazada: `clinic_effective_entitlements(clinic)`.
- **Limitlar** tarifda `plans.max_staff/max_devices/max_patients` ustunlarida, kelishuvda
  `overrides.limits` da. `get_clinic_plan_limits()` endi shulardan o'qiydi.
- **Modul** — API yo'li prefiks bo'yicha (eng uzuni) modulga bog'lanadi; yopiq bo'lsa
  `403 MODULE_DISABLED`. `CORE_API_PATHS` (dashboard KPI, filial almashtirgich) hech
  qachon yopilmaydi. Ma'lumot o'chirilmaydi — faqat kirish yopiladi.
- **To'lov turlari** — bazadagi trigger (`transactions`, `transaction_payments`,
  `pharmacy_sales`): ro'yxatda yo'q usul bilan musbat to'lov yozilmaydi. Vozvrat,
  bekor qilish, aralash ('mixed' — oyoqlari alohida) va alohida dorixona kirishi
  (PIN operator) tekshirilmaydi.
- **Jurnal** — tahrir/o'chirish guard'da, tarix chuqurligi `journal/feed|summary` da
  qisiladi, eksport UI'da.
- **Qurilmalar** — sarlavhasiz eski mijozlar tekshirilmaydi. Qat'iy limit faqat
  `devices.enforce_limit = true` bo'lsa. Super-admin impersonation qurilma yozmaydi.
- **Fail-open** — imkoniyatlarni o'qib bo'lmasa cheklov qo'yilmaydi.

## Yangi modul qo'shish

1. `ENTITLEMENT_MODULES` ga `key`, `routes` (web), `api` (prefikslar) bilan yozing.
2. Kerak bo'lsa `CORE_API_PATHS` ga istisno qo'shing.
3. `apps/api/src/common/entitlements/entitlements.spec.ts` ga yo'l testi qo'shing.
