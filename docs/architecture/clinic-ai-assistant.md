# Klinika AI yordamchisi — arxitektura (kelajak)

> Holat: **arxitektura hujjati**. Kod yo'q. ERP roadmap FAZA 4 (P3) doirasida —
> kelajakda AI qatlamini qo'shish uchun qaysi ma'lumot, interfeys va chegaralar
> tayyorligini belgilaydi. Soxta/qo'g'irchoq AI qo'shilmaydi — bu haqiqiy ish
> rejasi.

## Maqsad

Klinika operatori (egasi, administrator) tabiiy tilda so'rov bera oladigan AI
yordamchi:
- "Oxirgi 7 kunda qarzdor bemorlar"
- "Bu oy eng band shifokor kim"
- "Daromad o'tgan oyga nisbatan qancha o'zgardi"

Va proaktiv signallar: kutilmagan qarz o'sishi, navbat haddan tashqari yuklanishi,
daromad pasayishi.

## Nega hozir QILINMAYDI

AI yordamchi — **mahsulot xususiyati**, UI polish emas. To'g'ri qilish uchun:
1. LLM provayder (xarajat, maxfiylik qarori) — bemor ma'lumoti tashqi API'ga
   ketmasligi kerak yoki anonimlashtirilishi kerak.
2. Text-to-SQL yoki tool-calling qatlami — xavfsiz, faqat o'qish (read-only),
   tenant-scoped.
3. Baholash — noto'g'ri javob klinik qaror emas, lekin moliyaviy qaror bo'lishi
   mumkin.

Bu alohida tashabbus — bir necha haftalik backend/ML ishi.

## TAYYOR ma'lumot bazasi (allaqachon mavjud)

AI qatlami yangi jadval talab qilmaydi. Mavjud:

| Manba | Beradi |
|-------|--------|
| `analytics` moduli (`overview/heatmap/topServices/doctors`) | Agregatsiyalangan KPI, trend, doctor yuki |
| `activity_journal` jadval | Har klinik amal — AI kontekst uchun |
| `patient_balance` view + `transactions` | Qarzdorlik, to'lov tarixi |
| `queues` + realtime | Joriy navbat holati |
| `lab_orders`, `appointments` | Operatsion oqim |
| `notifications_inapp` | AI signallar shu yerga yoziladi |

## Tavsiya etilgan arxitektura

### 1-bosqich — qoida asosidagi "smart signallar" (model EMAS)
LLM'siz, aniq biznes qoidalari. Tez, tushunarli, baholash oson:
- pg_cron funksiya har soatda: qarz o'sishi, navbat tiqilishi, daromad pasayishi
  tekshiradi → `notifications_inapp`'ga `severity='warning'` yozadi.
- Bu allaqachon `check_clinic_sla()` cron pattern'iga o'xshaydi (SLA moduli).

### 2-bosqich — tabiiy til so'rovi (tool-calling)
- `apps/api/src/modules/ai-assistant/` — yangi modul.
- LLM **tool-calling** rejimida: oldindan belgilangan, xavfsiz funksiyalar
  to'plami (`getRevenue`, `getDebtors`, `getDoctorLoad`...) — har biri
  tenant-scoped, read-only. LLM erkin SQL yozmaydi.
- Sof funksiya sifatida — `ai-assistant/tools.ts`. Har tool mavjud
  `analytics`/`journal` servis metodlarini chaqiradi.

### 3-bosqich — bashorat (ML)
Yetarli anonimlashtirilgan ma'lumot to'plangach: daromad bashorati, navbat yuki
bashorati. Alohida ML pipeline.

## Interfeys (kelajak)

```ts
interface AiQuery {
  clinicId: string;       // har doim — tenant izolyatsiya
  question: string;
}
interface AiAnswer {
  text: string;
  data?: unknown;          // jadval/grafik uchun
  sources: string[];       // qaysi tool ishlatildi (shaffoflik)
}
```

## Xavfsizlik / maxfiylik chegaralari

- AI faqat **tenant ichidagi** ma'lumot bilan — RLS o'zgarmaydi, har tool
  `clinicId` filtri bilan.
- Bemorning shaxsiy ma'lumoti (ism, telefon) tashqi LLM API'ga **yuborilmaydi**
  — faqat agregat raqamlar yoki anonimlashtirilgan. `docs/compliance/` ga muvofiq.
- LLM **erkin SQL yozmaydi** — faqat oldindan belgilangan, audit qilingan
  tool'lar. Text-to-SQL xavfli (injection, noto'g'ri JOIN).
- AI javobi **hech qachon** klinik yoki moliyaviy avtomatik amal bajarmaydi —
  faqat ma'lumot va tavsiya. Operator qaror qabul qiladi.
- Har AI so'rovi `activity_journal`'ga yoziladi (kim, qachon, nima so'radi).

## Mavjud "AI" — eslatma

Dashboard'da allaqachon "AI kunlik xulosa" bor (`dashboard.tsx`) — lekin u
**qoida asosidagi** matn generatsiyasi, haqiqiy LLM emas. Bu 1-bosqich uslubiga
mos. Kelajakdagi AI yordamchi shuni kengaytiradi, almashtirmaydi.
