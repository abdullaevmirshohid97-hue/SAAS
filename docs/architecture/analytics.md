# Analitika — yagona ta'riflar

Klinika analitikasi (`/analytics`, BI builder, AI CFO), kassa KPI, super-admin
(dashboard, Moliyaviy markaz, platforma analitikasi) va Telegram hisobotlari
**bir xil ta'riflardan** foydalanadi. Yangi hisobot yozganda shu qoidalarga amal qiling.

## Ta'riflar

| Ko'rsatkich                | Manba                                          | Qoida                                                                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tushum**                 | `transaction_payment_legs`                     | `kind IN ('payment','refund')`, `is_void = false`, `method <> 'debt'`. Kassa asosida: qarzga berilgan xizmat to'langan kuni tushum bo'ladi (ikki marta sanalmaydi).                                                                                                                                 |
| **Vozvrat**                | `kind = 'refund'`                              | Doim **manfiy** saqlanadi va tushumdan ayiriladi. Kodda `-Math.abs(amount)`.                                                                                                                                                                                                                        |
| **Qarz (hozirgi)**         | `patient_balance`                              | Manfiy balanslar yig'indisi. Manfiy _to'lov_ qarz EMAS (bu vozvrat).                                                                                                                                                                                                                                |
| **Qarzga berilgan (davr)** | `patient_ledger` (`finance_debt_flows`)        | Bekor qilinmagan to'lov cheki bo'yicha SOF qarz (charge + shu chekka bog'liq tuzatish), `stay_id IS NULL`, chek sanasi bo'yicha. Legs `method='debt'` ISHLATILMAYDI — qabulxona qarzni u yerga yozmaydi (doim 0 edi).                                                                               |
| **Qarz undirildi (davr)**  | `patient_ledger`, `entry_kind='deposit'`       | `stay_id IS NULL`, chek bekor qilinmagan. Ayniyat: boshlang'ich qarz + berilgan − undirilgan ± tuzatish = yakuniy qarz.                                                                                                                                                                             |
| **Xizmat qiymati**         | `transaction_items.final_amount_uzs`           | Qator jami (miqdor allaqachon ichida). Tannarx — `cost_snapshot` ham qator jami.                                                                                                                                                                                                                    |
| **Shifokor**               | `COALESCE(t.doctor_id, appointment.doctor_id)` | Navbat statusi talab qilinmaydi (prod'da navbatlar `checked_in` da qoladi).                                                                                                                                                                                                                         |
| **Rasxot**                 | `daily_expense_view`                           | `is_void = false`, `expense_date` bo'yicha.                                                                                                                                                                                                                                                         |
| **Kassa foydasi**          |                                                | Klinika analitikasida: tushum − rasxot − to'langan maosh (`cash_profit_uzs`; dorixona va qarz kirmaydi, `profit_with_pharmacy_uzs` = + dorixona foydasi). Super-admin: tushum − rasxot. CFO Dashboard GL daromadini alohida "buxgalteriya" deb ko'rsatadi va kassa tushumidan farqini ochiq yozadi. |
| **Kun**                    | `Asia/Tashkent` (UTC+5)                        | Hech qachon `created_at.slice(0, 10)` (UTC) ishlatmang.                                                                                                                                                                                                                                             |

## Kod qoidalari

- **Huquq** — klinika bo'yicha pul ko'rsatkichlari (`analytics/overview`, `doctors`, `top-services`, …) faqat `analytics.view_clinic` (owner/admin avtomatik). `analytics.view_self` (shifokor, kassir) ularni OCHMAYDI.
- **Yopilgan smena** — yopilgan smenadagi chekni tahrirlash/usulini o'zgartirish/bekor qilish/o'chirish faqat rahbar (`common/shift-lock.ts`); eski va yangi qiymat `activity_journal.metadata.details` da.

- **Sana oralig'i** — `apps/api/src/common/tashkent-range.ts`: `presetRange()`,
  `tashkentBounds()`, `tashkentDate()`, `addDays()`.
- **PostgREST 1000 qator chegarasi** — so'rov 1000 qatordan ko'p qaytarishi mumkin
  bo'lsa: SQL agregat (view/RPC) yoki `fetchAllRows()` (`common/fetch-all.ts`,
  barqaror `.order(...)` bilan). Chegara xato bermaydi — natija jimgina kesiladi.
- **SQL funksiyalar** (migratsiya `20261017000001_analytics_fixes.sql`, faqat
  `service_role`): `analytics_period_extras`, `analytics_doctors`,
  `analytics_services`, `analytics_heatmap`, `analytics_patient_segments`,
  `analytics_query` (BI).
- **Tekshiruv** — `scripts/verify-analytics.sql` (har klinika: view = legs,
  shifokor analitikasi bo'sh emas, segmentlar jami = bemorlar soni). Deploy
  skripti (`scripts/deploy-branch-network.sh`) migratsiyadan keyin avtomatik ishga tushiradi.
