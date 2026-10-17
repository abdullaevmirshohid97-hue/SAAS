# Filial tarmog'i — 1 HQ + 10 tagacha filial

Bir egaga tegishli bir nechta klinikani bitta joydan boshqarish. Deploy:
`scripts/deploy-branch-network.sh` (kompyuterdan: `D:\1997\deploy-branch-network.ps1`).

## Model

| Tushuncha | Jadval | Izoh |
|---|---|---|
| Tarmoq | `companies` | `max_branches` (1–10), `billing_mode` (`per_branch` \| `company`), `branch_fee_uzs`, `shared_patients` |
| Filial | `clinics` | `company_id`, `is_hq` (kompaniyada bitta — `uq_clinics_company_hq`), `branch_code`, `branch_color` |
| Rahbariyat | `company_members` | `company_owner` / `company_admin` — hamma filial; `branch_user` — `accessible_clinic_ids` (`[]` = hammasi) |
| Iz | `company_audit_log` | har tarmoq amali (almashtirish, ulash, katalog, transfer...) |

Har klinikada kompaniya bor (`tg_clinics_ensure_company`); limit trigger bilan
(`tg_clinics_branch_limit`); HQ arxivlansa eng eski filial HQ bo'ladi
(`tg_clinics_hq_succession`).

## Filial almashtirish (eng muhim qaror)

Faol filial = JWT `app_metadata.clinic_id`. `POST /company/switch` →
`network_switch_branch()` huquqni tekshiradi va `auth.users.raw_app_meta_data`
dagi `clinic_id` + `role` ni o'zgartiradi → brauzer `refreshSession()` → to'liq
qayta yuklash. Shu sabab RLS, Realtime, storage va 40+ API moduli hech
o'zgarishsiz yangi filialda ishlaydi. `profiles.clinic_id` (uy filiali, HR)
o'zgarmaydi.

- Uy filialida — profildagi rol; boshqa filialda — `company_owner` → uy roli
  (owner/admin) yoki `clinic_owner`, qolganlar → `clinic_admin`.
- Ochiq kassa smenasi bilan boshqa filialga o'tilmaydi.
- Eskirgan oyna himoyasi: web-clinic har so'rovga `X-Clary-Branch` (sahifa
  ochilgandagi filial) yuboradi; token boshqa filialniki bo'lsa API
  `409 BRANCH_MISMATCH` qaytaradi va sahifa yangilanadi
  (`lib/branch-header.ts`, `auth.guard.ts`).
- `/auth/me` endi FAOL filialni qaytaradi (`clinic_id`, `home_clinic_id`).

## Kim nimani ko'radi (`modules/company/network.policy.ts`)

- Tarmoq markazi (`/company`): `company_owner`/`company_admin` — hamma filial;
  `branch_user` — ruxsat etilganlar; a'zo bo'lmagan filial admini — **ko'rmaydi**
  (faqat bitta filialli klinika rahbari o'z klinikasini ko'radi).
- Filiallararo transfer va yo'llanma — filial xodimlariga ham ochiq (o'z filiali
  doirasida).
- Bemor bazasi: `shared_patients=true` bo'lsa qabul, kassa, shifokor kartasi
  tarmoqdagi barcha bemorlar bilan ishlaydi (`common/network/network-scope.ts`).

## Pul va zaxira — mavjud yo'llar orqali

- Dori transferi: jo'natishda FEFO bo'yicha partiyalardan ayiriladi
  (`transfer_out`), qabulda `pharmacy_receive(source='transfer')` — oddiy prixod.
- Pul: manba seyfdan chiqim = `transactions` (adjustment, `source='safe'`,
  izohda **"inkasatsiya" yo'q** — aks holda hisobot uni kassa→seyf deb sanaydi);
  qabul = HQ `safe_deposits`. Bekor qilish = chiqim tranzaksiyasi void.
- Shu sababli kassa, seyf, oylik hisobot va GL o'zgarishsiz to'g'ri.

## Katalog tarqatish

`network_push_catalog`: xizmat / laboratoriya / diagnostika + toifalari.
Moslash `master_id` → bir xil nom; narx faqat `price_locked` yoki
`update_prices` bo'lsa HQ narxi; filialning o'z yozuvlariga tegilmaydi.
Sozlamalar: chek, A4 blanka, logo va ish tartibi (`clinics.settings` dagi
`reception_pharmacy_enabled`, `reception_parallel_enabled`,
`queue_skip_all_enabled`, `lab_mode` — qo'shib yoziladi).

## Xodimni boshqa filialga ko'chirish

`network_move_staff` (Tarmoq markazi → Xodimlar → "Ko'chirish"): HR anketa,
login (profil + JWT), ish jadvali, onlayn navbat profili va standart oylik
stavka yangi filialga o'tadi; tarix eski filialda qoladi. Manba filialda
to'lanmagan komissiya, yopilmagan avans/bonus yoki ochiq smena bo'lsa — rad
etiladi (avval maosh hisob-kitob qilinadi). Klinika egasi ko'chirilmaydi.

Bir vaqtning o'zida IKKI filialda ishlaydigan xodim (navbatma-navbat) hozircha
qo'llab-quvvatlanmaydi: `staff_profiles.profile_id` UNIQUE va maosh har filialda
alohida hisoblanadi — bu alohida dizayn talab qiladi.

## Bildirishnomalar va qarz

- Dori/pul transferi va boshqa filialdan yo'llanma qabul qiluvchi filialning
  header qo'ng'irog'iga keladi (`notifications_inapp`, filial bo'ylab).
- Qabulxonada bemor qarzi boshqa filialda bo'lsa — "X so'm — Chilonzor
  filialida" ko'rinadi (`patients/:id/stats` → `debt_elsewhere`). Qarz o'sha
  filial kassasida yopiladi (filiallararo qarz to'lovi pul hisobotlarini
  buzmasligi uchun ataylab qilinmagan).

## Obuna

`billing_mode='company'` — filial obuna holatini HQ'dan oladi
(`SubscriptionGuard`, `/subscription/current` → `billed_by_hq`). Super-admin
sahifasi oylik hisobni ko'rsatadi: HQ tarifi + filiallar × `branch_fee_uzs`.

## Sinov

- SQL: lokal Postgres'da prod sxemasi stub'i bilan to'liq ssenariy (ulash,
  limit, almashtirish, katalog, FEFO transfer, pul, dublikat birlashtirish,
  HQ vorisi); prod'da `scripts/verify-branch-network.sql` (ROLLBACK bilan).
- API: `network.policy.spec.ts`.
