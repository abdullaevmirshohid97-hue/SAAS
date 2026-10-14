# Xarajat, tarif va tejash yo'llari

## Bitta qo'ng'iroq (2 daqiqa, 8–10 marta gap almashish)

| Qism                                        | Hisob                                                                                       | So'm           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| STT (Aisha, 425 so'm/daq)                   | bemor ~50 s gapiradi + birinchi gap 2 tilda                                                 | ~400           |
| TTS (Aisha, 1 so'm/belgi)                   | ~400 belgi, salomlashuv va iboralar keshdan                                                 | ~350           |
| AI (claude-haiku-4-5: $1 / $5 har 1M token) | ~10 ming kirish + 600 chiqish token                                                         | ~170           |
| Telefon                                     | kiruvchi qo'ng'iroq bepul; pereadresatsiya — klinika tarifi (ko'pincha tarmoq ichida bepul) | 0–200          |
| **Jami**                                    |                                                                                             | **≈ 900–1100** |

Ilovadagi "Taxminiy xarajat" shu formula bilan hisoblanadi. Kursni va narxlarni
`USD_UZS_RATE`, `AI_STT_UZS_PER_MIN`, `AI_TTS_UZS_PER_CHAR` (API `.env.local`) bilan yangilang.

> Faza 0'da Aisha'dan aniqlang: STT har so'rovda 1 daqiqagacha **yaxlitlanadimi**?
> Yaxlitlansa, bitta qo'ng'iroq ~8 daqiqa (≈3400 so'm) bo'ladi. Unda o'zimiz ko'targan Whisper
> (`infra/voice-models/stt_server.py`) yoki boshqa STT foydaliroq bo'ladi.

## Oylik (klinika kuniga 40 ta "tushib qolgan" qo'ng'iroq)

- 40 × 30 kun = 1200 qo'ng'iroq × ~1000 so'm ≈ **1.2 mln so'm/oy** tannarx.
- Taqqoslash uchun: bitta qabulxona xodimi 3–5 mln so'm/oy, va u kechasi ishlamaydi.

**Tarif taklifi (premium):**

| Paket    | Qo'ng'iroq/oy  | Klinikaga narx | Tannarx    |
| -------- | -------------- | -------------- | ---------- |
| AI Start | 500            | 790 000 so'm   | ~500 000   |
| AI Pro   | 1500           | 1 900 000 so'm | ~1 500 000 |
| Oshgani  | har qo'ng'iroq | 1 500 so'm     | ~1 000     |

Super admin'dagi "oylik limit" paketga mos qo'yiladi. Limit oshsa, qo'ng'iroqlar avtomatik
"ovozli xabar" rejimiga o'tadi (bepul) — klinika bemorlarni yo'qotmaydi.

**Bepul (hamma tarifda):** Telegram tugmali navbat, eslatma (Telegram), ovozli xabar rejimi,
shifokor jadvali va qabulxonadagi "Navbatga yozish".

## Tejash yo'llari (kodda bor)

1. **TTS keshi:** salomlashuv, "bir daqiqa", xayrlashuv kabi takrorlanuvchi iboralar bir marta
   sintez qilinib diskda saqlanadi (`TTS_CACHE_DIR`).
2. **Birinchi gapni 2 tilda tanish** (`STT_DUAL_FIRST`) faqat birinchi gapda ishlaydi. Aisha
   yaxlitlasa, `false` qiling — AI baribir ruscha gapni tushunadi.
3. **Ish vaqtidan tashqari "ovozli xabar"** (sozlama): kechasi AI xarajati bo'lmaydi.
4. **Oylik limit** (super admin) — kutilmagan hisob kelmaydi.
5. **O'zimizning modellar:** `infra/voice-models/` — Whisper STT (GPU server ~$150–250/oy;
   10 tadan ortiq klinika bo'lganda arzonroq) va MMS TTS (CPU, bepul, sifati pastroq).
6. **Model:** `claude-haiku-4-5` — eng arzon. Sonnet'ga o'tish xarajatni ~2 baravar oshiradi.

## Ma'lumot lokalizatsiyasi

- Bemor ovozi va matni shaxsiy ma'lumot hisoblanadi. Yozuvlar Supabase'dagi
  `call-recordings` bucket'ida (private, imzolangan havola orqali) saqlanadi.
- Matn AI modelga (Anthropic, AQSh) yuboriladi: suhbat matni (bemor aytgan ism-familiya
  bilan), shifokorlar ro'yxati va qo'ng'iroq qilgan raqam. Kasallik tarixi, tashxis va
  to'lovlar **yuborilmaydi**.
- To'liq lokalizatsiya rejasi (`data_localization_uz`) amalga oshirilganda: Asterisk +
  voice-agent UZ VPS'da, STT/TTS — Aisha (UZ) yoki o'zimizning modellar, yozuvlar —
  self-hosted Supabase. Kod bunga tayyor: faqat URL va kalitlar o'zgaradi.
- Qonuniy talab: bemorga AI ekanini aytish (salomlashuvda bor) va yozib olinayotganini
  ogohlantirish. Kerak bo'lsa, salomlashuvga "Qo'ng'iroq sifat uchun yozib olinadi" jumlasini qo'shing.
