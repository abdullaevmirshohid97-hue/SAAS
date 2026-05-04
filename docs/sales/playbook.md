# Clary Sales Playbook

Internal — do not publish.

## ICP (Ideal Customer Profile)

- **Klinika rahbari** yoki **direktor** (qaror qabul qiluvchi)
- 3-30 xodim, kuniga 30+ bemor
- Hozir Excel + qog'oz daftar bilan ishlaydi
- Toshkent, Samarqand, Buxoro, Andijon, Farg'ona shaharlari
- 50PRO ($50/oy) maqsadli tarif

## Discovery savollar (15 daqiqa)

1. Hozir bemor qabuli qanday yuritiladi? (Excel/qog'oz/boshqa SaaS)
2. Kuniga necha bemor? Oylik daromad taxminan?
3. Hisobot tayyorlashga qancha vaqt ketadi?
4. Eng katta og'riq nuqta nima — navbat, kassa, hisobot, bemor tarixi?
5. To'lov tizimlari ulangan — Click/Payme bormi?
6. Qaror qabul qilishda kim ishtirok etadi (oilaviy biznes / hamkor)?

---

## Cold Telegram outreach

### Variant 1 — Painpoint-first (qisqa)

> Salom [Ism], Clary'dan [Ism] yozyapti. [Klinika nomi] uchun Excel'dan klinika SaaS'ga o'tish bo'yicha 4 hafta ichida qabul vaqtini 40% tezlashtirgan keys bor — qiziq bo'lsa 10 daqiqa demo bera olamanmi?

### Variant 2 — Social proof

> Salom! Toshkentdagi NUR Klinika Clary'ga 4 haftada o'tdi va hisobot tayyorlash 3 soatdan 10 daqiqaga tushdi. [Klinika nomi] uchun ham bir ko'rsatib bersam? 14 kun bepul, karta kerak emas.

### Variant 3 — Direct demo offer

> [Ism], Clary klinika boshqaruv tizimi 14 kun bepul. 1 click bilan demo: clary.uz/demo — 5 daqiqada to'liq dashboard'ni ko'rasiz. Savollar bo'lsa shu yerda yozing.

---

## Cold Email (3 variant)

### Variant A — Klinika rahbari uchun

**Subject:** [Klinika nomi] uchun klinika boshqaruv tizimi — 14 kun bepul

```
Hurmatli [Ism],

Men Clary'dan [Ism]. Biz O'zbekiston klinikalari uchun yagona tizim
ishlab chiqamiz — navbat, kassa, diagnostika, bemor bazasi va hisobotlar
bitta dashboardda.

Hozirgi mijozlarimizdan biri (NUR Klinika, Toshkent) Excel'dan o'tib,
4 hafta ichida quyidagilarga erishdi:
- Bemor qabuli 40% tezlashdi
- Oylik hisobot 3 soatdan 10 daqiqaga
- Kassa xatolari 0 ga tushdi

[Klinika nomi] uchun ham 14 kun bepul demo akkaunt ochib bera olamiz.
Karta so'ralmaydi. 5 daqiqa vaqtingiz bo'lsa: clary.uz/demo

Hurmat bilan,
[Ism]
+998 XX XXX XX XX
```

### Variant B — IT direktor uchun

```
Salom [Ism],

Texnik tomondan: Clary multi-tenant SaaS, Postgres + RLS, audit log,
30 kun PITR backup. Click/Payme/Stripe API integratsiyalari (BYO key).
Self-hosted variant ham mavjud.

Demo: clary.uz/demo (5 daqiqa)
Hujjatlar: clary.uz/docs

Savollaringiz bo'lsa shu yerda yozing.
```

### Variant C — Finansist/hamkor uchun (ROI-driven)

```
[Ism],

3 daqiqada hisoblang — clary.uz/pricing'dagi ROI kalkulyator orqali
klinikangiz oyiga qancha tejashini ko'rasiz.

Misol uchun, kuniga 40 bemor + 180K UZS o'rtacha chek bo'lgan klinika
uchun: oyiga ~28 mln UZS tejov, ROI 44x, payback < 1 kun.

Demo: clary.uz/demo
```

---

## Demo Call Script (15-20 daqiqa)

### 0-2 daq — Tanishuv
- "Vaqt ajratganingiz uchun rahmat. Bugun 15 daqiqada ko'rib chiqamiz: 5 daq sizning vaziyatingiz, 7 daq mahsulot, 3 daq savollar."

### 2-7 daq — Discovery
- Yuqoridagi 6 savol
- **Tinglang.** Yozib oling. Pain'ni qaytaring: "To'g'ri tushundimmi — eng katta muammo X?"

### 7-14 daq — Demo (faqat ularning pain'iga moslab)
- **Excel chaos** desa: import demo + bir click hisobot
- **Navbat** desa: drag-drop calendar + SMS
- **Kassa** desa: Click/Payme integratsiya + smena yopish
- **Hisobot** desa: dashboard AI summary + per-doctor KPI

**Demo qoida:** mahsulotning hammasini ko'rsatma — ularga kerak bo'lgan 2-3 modulni ko'rsat.

### 14-17 daq — Tarif va savollar
- "[Klinika hajmingiz uchun] Business ($50/oy) yetarli. Yillik to'lovda -20%."
- ROI kalkulyator natijasini eslat

### 17-20 daq — Close
- "Sinashga tayyormisiz? 14 kun bepul, hozir akkaunt ochaman."
- Tasdiq olsa: WhatsApp/Telegram'da signup link yubor + 24 soatdan keyin follow-up

---

## Objection Handling

| Eshitganingiz | Javob |
|---|---|
| **"Qimmat"** | "ROI kalkulyatorni 30 sekundga ochamiz — kuniga 30 bemor bo'lsa ham oyiga 12+ mln UZS tejaysiz. Yillik to'lovda -20%." |
| **"Vaqtim yo'q o'tish uchun"** | "1 hafta ichida hech qaysi xodim ishi to'xtatilmasdan o'tamiz. Onboarding'imiz 50PRO va 120PRO'da bepul." |
| **"Excel ham yetadi"** | "Yetadi, lekin xatolar va vaqt yo'qotish ko'rinmaydi. NUR Klinika 4 haftadan keyin oylik 18% daromad o'sishini qayd etdi." |
| **"Internet uzilsa?"** | "Offline rejim bor — local cache, internet kelganda sync. Backup 30 kun saqlanadi." |
| **"Ma'lumotlarim xavfsizmi?"** | "RLS + TLS 1.3 + audit hash chain. Persdata 547-son compliance. SOC 2 infra. Boshqa klinikalar sizning ma'lumotlaringizni ko'ra olmaydi." |
| **"Hamkor bilan maslahatlashishim kerak"** | "Albatta. ROI hisobi PDF'da yuboraman, hamkor ko'rib chiqsin. Ertaga yana bog'lanaymizmi?" |
| **"Boshqa SaaS sinab ko'rdim, foyda yo'q"** | "Qaysi modul ishlamadi? [Tinglang] — Clary'da bu boshqacha sababli: O'zbekiston uchun yaratilgan, Click/Payme native, UZ tilida." |

---

## KPI

- **Activity:** 50 cold outreach/hafta, 10 demo/hafta
- **Conversion targets:**
  - Outreach → Reply: ≥ 15%
  - Reply → Demo: ≥ 40%
  - Demo → Trial: ≥ 60%
  - Trial → Paid: ≥ 30%
- **Sales cycle target:** 14 kun (outreach → paid)

## Tools

- **Lead tracker:** `/admin/leads` (Clary admin) — kanban
- **Telegram bot notification:** har lead Telegram'ga keladi (env: `TELEGRAM_LEADS_BOT_TOKEN`, `TELEGRAM_LEADS_CHAT_ID`)
- **Sequence:** outreach → 3 kun follow-up → 7 kun follow-up → close/disqualify
