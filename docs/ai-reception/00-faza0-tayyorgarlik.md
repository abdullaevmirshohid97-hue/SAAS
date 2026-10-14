# Faza 0 — tayyorgarlik (kod yozilmaydi, 2–5 kun)

Maqsad: telefon qismini ishga tushirishdan oldin uchta savolga javob olish.

1. AI liniyasi qaysi yo'l bilan ulanadi: GSM-shlyuz yoki operator SIP?
2. O'zbekcha nutqni qaysi STT telefon sifatida yaxshiroq taniydi?
3. Bitta qo'ng'iroq qancha turadi?

> Telefon kutayotgan paytda **Faza 1–2 ni hoziroq ishlatish mumkin**: shifokor jadvalini
> kiriting, shunda Telegram bot orqali navbat bepul ishlaydi. Telefon keyin ulanadi.

---

## 1. Operatorlarga savollar

### Mobil operatorlar (Beeline, Ucell, Mobiuz, Uzmobile)

Asosiy yo'l shu: klinikaning hozirgi mobil raqamiga "javob bermasa" pereadresatsiyasi
qo'yiladi va qo'ng'iroq AI SIM kartasiga o'tadi. Operatordan quyidagilarni so'rang.

| #   | Savol                                                                                                                                         | Nega muhim                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | "Javob bermasa / band / o'chiq" pereadresatsiyasi (`**61*`, `**67*`, `**62*`) tarifimizda bormi? Ulash pullikmi?                              | Asosiy mexanizm                                                                                                |
| 2   | O'tkazilgan qo'ng'iroq daqiqasi kimning hisobidan yechiladi va narxi qancha? O'z tarmog'idagi raqamga o'tkazilsa paketdagi daqiqa ishlaydimi? | Odatda o'tkazayotgan raqam to'laydi. AI SIM bir operatorda bo'lsa, ko'pincha bepul daqiqalar ishlaydi          |
| 3   | O'tkazilgan qo'ng'iroqda AI SIM'ga **bemorning raqami** ko'rinadimi yoki klinika raqamimi?                                                    | AI bemorni raqami orqali taniydi                                                                               |
| 4   | Korporativ SIM (yuridik shaxsga) va cheksiz yoki katta daqiqa paketi bormi?                                                                   | AI SIM uchun                                                                                                   |
| 5   | SIM kartani GSM-shlyuzda (GoIP) ishlatish shartnomaga zid emasmi?                                                                             | Ba'zi operatorlar shlyuzdagi SIM'ni bloklaydi. Biz faqat **kiruvchi** qo'ng'iroq olamiz, bu odatda muammo emas |
| 6   | Korporativ SIP / virtual ATS xizmati bormi? Narxi qancha?                                                                                     | GSM-shlyuzga alternativa                                                                                       |

### Uztelecom (shahar raqami va IP-telefoniya)

| #   | Savol                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | IP-telefoniya (SIP) raqami ochish narxi va oylik to'lovi qancha? 71-kodli yoki 55-kodli raqam bo'ladimi?                                        |
| 2   | SIP akkauntga **tashqi IP'dan** (bizning VPS serverimizdan) ro'yxatdan o'tish mumkinmi? Yoki faqat ularning internet abonentlari ulana oladimi? |
| 3   | Bir akkauntga bir nechta raqam (DID) bersa bo'ladimi? (Har klinikaga alohida raqam kerak)                                                       |
| 4   | Kiruvchi qo'ng'iroqda chaqirilgan raqam (DID) SIP'da qaysi maydonda keladi? `Diversion` header bormi?                                           |
| 5   | Klinikaning shahar raqamiga "javob bermasa" pereadresatsiyasi (Переадресация) qanday yoqiladi va narxi qancha?                                  |
| 6   | Bir vaqtda nechta qo'ng'iroq o'tadi (kanal soni)?                                                                                               |

**Qaror jadvali:**

| Holat                                                                  | Tavsiya                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| Klinika raqami mobil, operator SIM'ni shlyuzda ishlatishga qarshi emas | **GoIP + o'sha operatorning SIM'i** (eng arzon)           |
| Klinika raqami shahar raqami (Uztelecom)                               | Uztelecom SIP raqami + Uztelecom'dagi pereadresatsiya     |
| Ko'p klinika (10 tadan ortiq)                                          | Bitta SIP trunk va ko'p DID, yoki GoIP-8/16 Clary ofisida |

---

## 2. Aisha AI (o'zbekcha nutq) bilan kelishuv

Narx (2026-10, saytdan): **STT 425 so'm/daqiqa, TTS 1 so'm/belgi**. Aisha'dan quyidagilarni so'rang.

1. STT qisqa gaplar uchun qanday hisoblanadi: soniyasiga, yoki har so'rov 1 daqiqagacha
   yaxlitlanadimi? Agar yaxlitlansa, bitta qo'ng'iroqdagi 8 ta gap ≈ 8 daqiqa hisoblanadi
   va narx 8 baravar oshadi.
2. 8 kHz telefon ovozini yaxshi taniydimi? Telefon uchun alohida model bormi?
3. TTS javob vaqti qancha (bitta jumla uchun)? Streaming bormi?
4. Biznes tarif yoki hajm bo'yicha chegirma bormi? Shartnoma va hisob-faktura beriladimi?
5. Ma'lumot O'zbekiston hududida saqlanadimi? (Lokalizatsiya talabi uchun ustunlik)

Kalit olish: aisha.group → ro'yxatdan o'tish → API kalit. Uni serverda `AISHA_API_KEY` ga yozing.

---

## 3. STT sifatini sinash (eng muhim qadam)

AI bemor gapini noto'g'ri eshitsa, qolgan hamma narsa ham buziladi. Shuning uchun real yozuvlarda o'lchab ko'ring.

### 3.1. Namunalar to'plash (30 daqiqa)

`apps/voice-agent/samples/` papkasiga **20–30 ta** juft fayl qo'ying:

```
01-kardiolog.wav   01-kardiolog.txt   ← "Kardiologga ertaga ertalabga yozilmoqchiman"
02-ism.wav         02-ism.txt         ← "Familiyam Abdullayev, ismim Jasur"
03-raqam.wav       03-raqam.txt       ← "Raqamim to'qson bir yuz yigirma uch qirq besh oltmish yetti"
04-rus.wav         04-rus.txt         ← "Можно записаться к терапевту на пятницу?"
...
```

Namunalarda quyidagilar bo'lsin:

- erkak, ayol, keksa va yosh ovozlar; shevalar (Toshkent, Farg'ona, Xorazm);
- shovqinli joy (ko'cha, mashina);
- o'zbek-rus aralash gap ("Menga терапевт kerak, завтра bo'ladimi?");
- shifokor familiyalari (klinikaning haqiqiy shifokorlari), telefon raqamlari, sanalar;
- `.txt` faylda aytilgan matn **aynan** yozilsin.

Eng yaxshi usul: telefonda qo'ng'iroqni yozib olish. Diktofon bilan yozilgan bo'lsa,
skript `--phone` bayrog'i bilan ovozni telefon sifatiga tushiradi.

### 3.2. Sinov

```bash
pnpm --filter @clary/voice-agent build
cd apps/voice-agent
cp .env.example .env     # AISHA_API_KEY ni yozing; Whisper bo'lsa STT_OPENAI_URL
node dist/scripts/stt-benchmark.js --dir ./samples --providers aisha,openai --phone
```

Natijada har provayder uchun WER (so'z xatosi), CER (harf xatosi) va kechikish chiqadi.
To'liq jadval `stt-benchmark.csv` fayliga yoziladi.

| Ko'rsatkich | Yaxshi | Chegarada | Yomon                                  |
| ----------- | ------ | --------- | -------------------------------------- |
| WER         | < 15%  | 15–25%    | > 25% (AI tez-tez noto'g'ri tushunadi) |
| Kechikish   | < 1 s  | 1–2 s     | > 2 s (suhbat sekinlashadi)            |

Ism-familiyalarda xato bo'lishi tabiiy. AI ularni shifokorlar ro'yxatidagiga eng yaqin
variantga moslaydi va bemordan tasdiqlatadi.

### 3.3. AI'ni telefonsiz sinash

Deploydan keyin: **Sozlamalar → AI qabulxona → Sinov suhbati**. Bu yerda yozib sinaysiz,
navbat bazaga yozilmaydi. Har klinika uchun 10–15 ta stsenariyni o'tkazing:

- "Yuragim og'riyapti, kimga borsam bo'ladi?" → AI kardiologni taklif qilishi kerak
- "Karimova doktorga ertaga" → bo'sh vaqtlar chiqishi, tasdiqdan keyin yozilishi kerak
- "Oliy toifali LOR bormi?" → AI toifa bo'yicha tanlashi kerak
- "Yozuvimni bekor qiling" → `find_my_appointments`, keyin bekor qilish
- "UZI qancha turadi?" → narx aytilishi kerak
- "Hushidan ketdi!" → AI "103 ga qo'ng'iroq qiling" deyishi va xodimga ulashi kerak
- ruscha gaplashish, aralash gaplar, "operator bilan gaplashmoqchiman"

---

## 4. Qaror varaqasi (Faza 0 oxirida to'ldiring)

| Savol                                              | Javob                                                  |
| -------------------------------------------------- | ------------------------------------------------------ |
| AI liniyasi                                        | GoIP + **\_\_** SIM / Uztelecom SIP / boshqa: **\_\_** |
| Bemor raqami o'tkazilgan qo'ng'iroqda ko'rinadimi? | ha / yo'q                                              |
| STT provayder (WER, kechikish)                     | Aisha: **_% / _** ms · Whisper: **_% / _** ms          |
| TTS                                                | Aisha (Gulnoza) / o'zimizning MMS                      |
| Server                                             | Clary VPS (Hostinger) / O'zbekistondagi VPS (tavsiya)  |
| Model                                              | claude-haiku-4-5 / claude-sonnet-5-5                   |
| Premium narxi klinikaga                            | **\_\_** so'm/oy (qarang: 04-xarajat-va-tarif.md)      |
| Pilot klinika                                      | **\_\_**                                               |
