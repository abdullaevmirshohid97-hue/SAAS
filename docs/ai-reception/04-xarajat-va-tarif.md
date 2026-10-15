# Xarajat, tarif va tejash yo'llari

## Bitta qo'ng'iroq (2 daqiqa, 8–10 marta gap almashish)

| Qism                                        | Hisob                                               | So'm      |
| ------------------------------------------- | --------------------------------------------------- | --------- |
| STT (o'zimizning Whisper serveri)           | o'z serverimizda — har qo'ng'iroq uchun to'lov yo'q | 0         |
| TTS (o'zimizning MMS serveri)               | o'z serverimizda; takroriy iboralar keshdan         | 0         |
| AI (claude-haiku-4-5: $1 / $5 har 1M token) | ~10 ming kirish + 600 chiqish token                 | ~170      |
| Telefon (Uztelecom IP-telefoniya)           | oylik paket ichida (45 000 daqiqa)                  | 0         |
| **Jami**                                    |                                                     | **≈ 170** |

Nutq serverining o'zi — doimiy xarajat: GPU'li server (jonli AI suhbat uchun) yoki mavjud
serverning CPU'si (ovozli xabar matni, Telegram). Bitta server barcha klinikalarga xizmat qiladi.
**Ovozli xabar** (AI'siz, bulutli ATS'da standart) — umuman bepul.

Ilovadagi "Taxminiy xarajat" shu formula bilan hisoblanadi (`USD_UZS_RATE`; nutq narxi
`AI_STT_UZS_PER_MIN`, `AI_TTS_UZS_PER_CHAR` — o'zimizning serverlarda 0).

## Oylik (klinika kuniga 40 ta "tushib qolgan" qo'ng'iroq)

- 40 × 30 kun = 1200 qo'ng'iroq × ~170 so'm ≈ **0.2 mln so'm/oy** (AI) + nutq serveri ulushi.
- Taqqoslash uchun: bitta qabulxona xodimi 3–5 mln so'm/oy, va u kechasi ishlamaydi.

**Tarif taklifi (premium):**

| Paket    | Qo'ng'iroq/oy  | Klinikaga narx | Tannarx (LLM; nutq serveri alohida) |
| -------- | -------------- | -------------- | ----------------------------------- |
| AI Start | 500            | 790 000 so'm   | ~85 000                             |
| AI Pro   | 1500           | 1 900 000 so'm | ~255 000                            |
| Oshgani  | har qo'ng'iroq | 1 500 so'm     | ~170                                |

Super admin'dagi "oylik limit" paketga mos qo'yiladi. Limit oshsa, qo'ng'iroqlar avtomatik
"ovozli xabar" rejimiga o'tadi (bepul) — klinika bemorlarni yo'qotmaydi.

**Bepul (hamma tarifda):** Telegram tugmali navbat, eslatma (Telegram), ovozli xabar rejimi,
shifokor jadvali va qabulxonadagi "Navbatga yozish".

## Tejash yo'llari (kodda bor)

1. **TTS keshi:** salomlashuv, "bir daqiqa", xayrlashuv kabi takrorlanuvchi iboralar bir marta
   sintez qilinib diskda saqlanadi (`TTS_CACHE_DIR`).
2. **Birinchi gapni 2 tilda tanish** (`STT_DUAL_FIRST`) faqat birinchi gapda ishlaydi. Server
   yuklamasini kamaytirish uchun `false` qilsa bo'ladi — AI baribir ruscha gapni tushunadi.
3. **Ish vaqtidan tashqari "ovozli xabar"** (sozlama): kechasi AI xarajati bo'lmaydi.
4. **Oylik limit** (super admin) — kutilmagan hisob kelmaydi.
5. **O'zimizning modellar:** `infra/voice-models/install.sh` — Whisper STT (jonli suhbat uchun
   GPU; ovozli xabar matni CPU'da ham) va MMS TTS (CPU, bepul). Doimiy iboralarni o'zingiz yozib
   olsangiz — eng tabiiy ovoz va TTS umuman kerak emas.
6. **Model:** `claude-haiku-4-5` — eng arzon. Sonnet'ga o'tish xarajatni ~2 baravar oshiradi.

## Ma'lumot lokalizatsiyasi

- Bemor ovozi va matni shaxsiy ma'lumot hisoblanadi. Yozuvlar Supabase'dagi
  `call-recordings` bucket'ida (private, imzolangan havola orqali) saqlanadi.
- Matn AI modelga (Anthropic, AQSh) yuboriladi: suhbat matni (bemor aytgan ism-familiya
  bilan), shifokorlar ro'yxati va qo'ng'iroq qilgan raqam. Kasallik tarixi, tashxis va
  to'lovlar **yuborilmaydi**.
- To'liq lokalizatsiya rejasi (`data_localization_uz`) amalga oshirilganda: Asterisk +
  voice-agent UZ VPS'da, STT/TTS — o'zimizning modellar (shu serverda), yozuvlar —
  self-hosted Supabase. Kod bunga tayyor: faqat URL va kalitlar o'zgaradi.
- Qonuniy talab: bemorga AI ekanini aytish (salomlashuvda bor) va yozib olinayotganini
  ogohlantirish. Kerak bo'lsa, salomlashuvga "Qo'ng'iroq sifat uchun yozib olinadi" jumlasini qo'shing.
