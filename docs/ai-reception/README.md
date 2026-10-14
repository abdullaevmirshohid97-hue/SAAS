# AI qabulxona — telefon va Telegram orqali avtomatik navbat

Klinika raqamiga qo'ng'iroq qilingan paytda qabulxona javob bermasa (band bo'lsa yoki
ish vaqti tugagan bo'lsa), qo'ng'iroq **pereadresatsiya** orqali AI liniyasiga o'tadi.
U yerda AI bemor bilan o'zbek yoki rus tilida gaplashadi va quyidagilarni qiladi:

- shifokorni mutaxassisligi, ism-familiyasi, toifasi, ilmiy darajasi va tajribasiga qarab tanlaydi;
- **shifokor jadvalidan** bo'sh vaqtni topadi va navbatga yozadi (band vaqtlar, ta'til va
  bayramlar avtomatik chiqarib tashlanadi);
- yozuvni bekor qiladi, narx, manzil va ish vaqtini aytadi;
- hal qila olmasa, qabulxonaga "qayta qo'ng'iroq qiling" so'rovini qoldiradi yoki xodimga ulaydi.

Xuddi shu navbat dvigatelidan **Telegram bot** ham foydalanadi. Unda tugmalar orqali
yozilish bepul, AI bilan matn yoki ovozli xabar orqali gaplashish esa premium.

```
Bemor ── klinika raqami ──(javob bo'lmasa: **61*AI_raqam**20#)──► AI liniya
                                                                   │  GoIP SIM yoki SIP DID
                                                                   ▼
                                                         Asterisk (UZ VPS)
                                                                   │  AudioSocket (8 kHz)
                                                                   ▼
                     ┌───────────── apps/voice-agent ─────────────┐
                     │ VAD → STT (Aisha / Whisper) → API → TTS     │
                     └───────────────────────┬─────────────────────┘
                                             │ HTTPS + VOICE_AGENT_SECRET
                                             ▼
   apps/api  modules/ai-reception: "miya" (Claude tool-use) + navbat dvigateli
             booking_reserve() — ikki marta yozilmaydi (advisory lock)
                                             ▲
   Telegram bot (@Clary_app_bot) ────────────┘   web-clinic: jadval, sozlama, qo'ng'iroqlar
```

## Fazalar va holati

| Faza | Nima                                                                        | Holat                              | Kim                                                           |
| ---- | --------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| 0    | Operator, STT sifati, narxlarni aniqlash                                    | Yo'riqnoma va sinov skripti tayyor | Siz — [00-faza0-tayyorgarlik.md](00-faza0-tayyorgarlik.md)    |
| 1    | Navbat dvigateli: shifokor jadvali, toifa/daraja, bo'sh vaqt, atomik yozish | **Kod tayyor**                     | Deploy: `scripts/deploy-ai-reception.sh`                      |
| 2    | Telegram: tugmali navbat (bepul) + AI matn/ovoz (premium)                   | **Kod tayyor**                     | Deploy bilan birga                                            |
| 3    | Telefon: Asterisk + voice-agent, pereadresatsiya                            | **Kod va konfiguratsiya tayyor**   | Server va SIM: [02-server-asterisk.md](02-server-asterisk.md) |
| 4    | Tasdiq va eslatma (Telegram/SMS), "kelmadi" belgisi, statistika, premium    | **Kod tayyor**                     | Super admin'da yoqiladi                                       |

## Kodda nimalar bor

| Joy                                                              | Nima                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261014000001_ai_reception.sql`            | 6 ta jadval, `appointments.source`, `booking_reserve()`, `call-recordings` bucket                                          |
| `packages/utils/src/booking.ts`                                  | Bo'sh vaqt hisobi, mutaxassislik lug'ati (kirill/lotin/xalq tili), toifa yorliqlari, raqamni so'z bilan yozish (TTS uchun) |
| `apps/api/src/modules/ai-reception/`                             | Navbat dvigateli, AI "miya" (Claude), voice-agent endpointlari, eslatmalar (cron), super admin                             |
| `apps/api/src/modules/telegram-patient/telegram-booking.flow.ts` | Telegram: navbat 2.0, "Yozuvlarim", eslatma tugmalari, AI chat va ovozli xabar                                             |
| `apps/voice-agent/`                                              | Telefon ko'prigi: AudioSocket, VAD, barge-in, STT/TTS, yozuv, Faza 0 sinov skriptlari                                      |
| `apps/web-clinic`                                                | Sozlamalar → **Shifokorlar jadvali** va **AI qabulxona**; asosiy menyuda **Qo'ng'iroqlar (AI)**                            |
| `apps/web-admin`                                                 | Klinika → **AI qabulxona** tabi (premium ruxsat va oylik limit)                                                            |
| `infra/asterisk/`                                                | `pjsip.conf` (GoIP va SIP trunk), `extensions.conf`, `install.sh`                                                          |
| `infra/voice-models/`                                            | Bepul variant: o'zimiz ko'taradigan Whisper STT va MMS TTS serverlari                                                      |

## Rejimlar (klinika tanlaydi)

| Rejim                   | Narxi                                                     | Nima bo'ladi                                                                                                                                  |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| O'chiq                  | —                                                         | Javob berilmaydi                                                                                                                              |
| **Ovozli xabar**        | AI xarajati yo'q (faqat ovozni matnga o'girish ixtiyoriy) | Bemor ismini va qaysi shifokor kerakligini aytadi. U "Qo'ng'iroqlar" bo'limida yozuv va matn bilan chiqadi, qabulxona qayta qo'ng'iroq qiladi |
| **AI suhbat** (premium) | Taxminan 600–1200 so'm / 2 daqiqalik qo'ng'iroq           | AI o'zi navbatga yozadi                                                                                                                       |

## Muhim qarorlar

- **Model:** `claude-haiku-4-5` — arzon va tez, telefonda kechikish sezilmaydi. Sifat yetmasa,
  serverda `AI_RECEPTION_MODEL=claude-sonnet-5-5` qo'yiladi, kod o'zgarmaydi.
- **Kalit:** `ANTHROPIC_API_KEY` (env) yoki klinikaning o'z kaliti (Sozlamalar → Integratsiyalar → anthropic).
- **Bemor kartasi:** familiya, ism va telefon mos kelsa, mavjud karta ishlatiladi
  (bemorlar daftari qoidasi bilan bir xil). Yangi bemorga karta faqat sozlamada ruxsat
  berilgan bo'lsa ochiladi.
- **Qabulxonada:** oldindan yozilgan bemor kelganda checkout odatdagidek qilinadi. Shu
  shifokorga bugunga yozilgan qabul avtomatik "keldi" bo'ladi, jurnalda dublikat paydo bo'lmaydi.
- **Jurnal:** bekor qilingan yoki kelmagan qabullar endi jurnalda "kutilmoqda" holatida qolib ketmaydi.
- **Xavfsizlik:** `clinic_id` va telefon raqami modeldan olinmaydi, ularni server qo'yadi.
  Bemor faqat o'z raqamiga tegishli yozuvni bekor qila oladi. Shoshilinch holatda AI "103 ga
  qo'ng'iroq qiling" deydi. AI tibbiy maslahat bermaydi.
- **Shaxsiy ma'lumot:** ovoz yozuvlari Supabase'dagi private bucket'da saqlanadi. Ma'lumot
  lokalizatsiyasi bo'yicha [04-xarajat-va-tarif.md](04-xarajat-va-tarif.md#malumot-lokalizatsiyasi) bo'limiga qarang.

## Hujjatlar

1. [00-faza0-tayyorgarlik.md](00-faza0-tayyorgarlik.md) — operatorlar, Aisha, STT sinovi, qaror
2. [01-operator-va-pereadresatsiya.md](01-operator-va-pereadresatsiya.md) — raqamni ulash, GSM kodlar, GoIP
3. [02-server-asterisk.md](02-server-asterisk.md) — server, Asterisk, voice-agent, nosozliklar
4. [03-klinikani-ulash.md](03-klinikani-ulash.md) — har yangi klinika uchun ro'yxat (30 daqiqa)
5. [04-xarajat-va-tarif.md](04-xarajat-va-tarif.md) — xarajat, tarif, tejash yo'llari
