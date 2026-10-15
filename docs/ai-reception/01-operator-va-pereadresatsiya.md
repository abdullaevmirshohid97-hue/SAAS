# Raqamni ulash: pereadresatsiya, GoIP, SIP

## Asosiy g'oya — klinika raqami O'ZGARMAYDI

Bemorlar klinikaning hozirgi raqamiga qo'ng'iroq qilishda davom etadi. Shu raqamga
**shartli pereadresatsiya** qo'yiladi: qabulxona 15–20 soniyada olmasa yoki band bo'lsa,
qo'ng'iroq AI liniyasiga o'tadi. Qabulxona ishlayotgan paytda ham AI ish yo'qotmaydi,
faqat "tushib qolgan" qo'ng'iroqlarni ushlab qoladi.

```
Bemor → +998 90 111 22 33 (klinika, qabulxonadagi telefon)
           │ 20 s javob yo'q / band / o'chiq
           ▼
        +998 90 444 55 66 (AI SIM — GoIP ichida) → Asterisk → AI
```

## 1. Mobil raqam: GSM kodlar

Kodlar **klinikaning asosiy telefonida** teriladi (qo'ng'iroq tugmasi bosiladi). Ilovada
**Sozlamalar → AI qabulxona → Telefon liniyasi** bo'limida AI raqami kiritilgach, quyidagi
kodlar tayyor ko'rinishda chiqadi va ularni nusxa olish mumkin.

| Nima                              | Kod                       | Izoh                                                                    |
| --------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| Javob bermasa (N soniyadan keyin) | `**61*+998XXXXXXXXX**20#` | **Asosiy.** Vaqt 5–30 s (5 ga karrali)                                  |
| Band bo'lsa                       | `**67*+998XXXXXXXXX#`     | Qabulxona boshqa qo'ng'iroqda                                           |
| O'chiq yoki aloqa yo'q            | `**62*+998XXXXXXXXX#`     | Telefon o'chiq yoki zaryadi tugagan                                     |
| Barcha shartlilar birga           | `**004*+998XXXXXXXXX#`    | 61 + 62 + 67 bitta kodda (hamma operatorda ishlamasligi mumkin)         |
| Hammasi (shartsiz)                | `**21*+998XXXXXXXXX#`     | Kechasi yoki dam olish kuni — hamma qo'ng'iroq to'g'ridan-to'g'ri AI'ga |
| Shartsizni o'chirish              | `##21#`                   | Ertalab                                                                 |
| Hammasini o'chirish               | `##002#`                  |                                                                         |
| Holatni tekshirish                | `*#61#`, `*#67#`, `*#21#` |                                                                         |

Bu kodlar xalqaro GSM standarti (3GPP TS 22.030) bo'yicha ishlaydi, shuning uchun Beeline,
Ucell, Mobiuz va Uzmobile'da bir xil. Agar ishlamasa, operatorga "pereadresatsiya
xizmatini ulang" deb qo'ng'iroq qiling.

**Kechasi avtomatik:** telefonning o'zi vaqt bo'yicha yoqib-o'chira olmaydi. Ikki yo'l bor.

1. Doimiy `**61*` (javob bermasa) qo'yiladi. Kechasi hech kim olmaydi, shuning uchun 20 soniyadan
   keyin baribir AI'ga o'tadi. **Tavsiya etiladi: qo'shimcha ish yo'q.**
2. Kechqurun `**21*...#`, ertalab `##21#` terish — kechasi bemor 20 soniya kutib o'tirmaydi.

**Qo'ng'iroq daqiqasi kimga yoziladi:** odatda o'tkazayotgan raqamga, ya'ni klinikaga,
oddiy chiquvchi qo'ng'iroq narxida. AI SIM bilan klinika raqami **bir operatorda** bo'lsa,
ko'p tariflarda bu tarmoq ichidagi bepul daqiqa hisoblanadi. Faza 0'da operatordan aniqlang.

## 2. Shahar raqami (Uztelecom) yoki ofis mini-ATS

- **Uztelecom:** "Переадресация вызова" qo'shimcha xizmati operator orqali yoqiladi
  (ofisda yoki 1093 raqami orqali), AI raqamiga "javob bermasa" sharti bilan.
- **Ofis mini-ATS** (Panasonic, Yeastar, Grandstream...): ATS sozlamasida "No answer →
  External number" yoki to'g'ridan-to'g'ri SIP trunk (bizning Asterisk) qo'shiladi.

## 3. AI liniyasining o'zi — 2 variant

### A) GSM-shlyuz (GoIP) — eng arzon

- **Uskuna:** GoIP-1 (1 SIM, ~$60–90), GoIP-4 (4 SIM, ~$150–250), GoIP-8/16 — ko'p klinika uchun.
  Toshkentdagi telekom do'konlarida yoki AliExpress'da (Hybertone/DBL GoIP) sotiladi.
- **Joyi:** klinikada (internet va GSM signali bor joyda) yoki Clary ofisida. Agar barcha
  klinikalarning SIM kartalari bitta GoIP-8'da bo'lsa, boshqarish osonlashadi.
- **Sozlash (GoIP veb-paneli, 192.168.x.x):**
  1. _Configurations → Basic VoIP_: Config Mode = **Config by Line**; Line 1: SIP Registrar =
     Asterisk server IP, Phone Number / Auth ID = `goip1`, Password = `install.sh` bergan parol.
  2. _Call In → Line 1_: **Forward to VoIP** = `clary` (kiruvchi GSM → SIP).
  3. _Media_: codec PCMU, PCMA. _Advanced_: NAT keep-alive yoqiladi.
  4. Asterisk'da tekshirish: `asterisk -rx "pjsip show endpoints"` → `goip1 ... Avail`.

  (Panel bo'limlarining nomi firmware versiyasiga qarab biroz farq qilishi mumkin. Asosiysi:
  har liniya alohida SIP akkaunt bo'lsin va kiruvchi GSM qo'ng'iroq SIP'ga yo'naltirilsin.)

- **Ilovada:** liniya kaliti = `goip1`, AI raqami = shu SIM raqami.
- **Cheklovlar:**
  - 1 SIM = bir vaqtda 1 qo'ng'iroq. Ikkinchi bemor "band" eshitadi va klinika raqamining
    "band bo'lsa" pereadresatsiyasi ishlamaydi. Ko'p qo'ng'iroqli klinikaga GoIP-4
    (4 ta SIM, bitta raqamga "seriyali" ulash) yoki SIP kerak.
  - GoIP-1'da "xodimga ulash" ishlamaydi, chunki liniya band. Buning o'rniga "qayta
    qo'ng'iroq so'rovi" ishlaydi. GoIP-4'da `TRANSFER_ENDPOINT=goip2` qo'yiladi.
  - Operator shlyuzdagi SIM'ni "SIM-bank" deb bloklasa, korporativ SIM va shartnoma oling.

### B) Operator SIP raqami (Uztelecom va boshqalar)

- Uskuna kerak emas. Asterisk operatorga ro'yxatdan o'tadi (`/etc/asterisk/pjsip_local.conf` —
  B bo'limi, izohdan chiqaring). Klinikaning **o'z** IP-telefoniyasi bo'lsa (qo'ng'iroq stol
  telefonlari va Clary softfonida ham jiringlasin) — qo'lda yozmang, **bulutli ATS**dan foydalaning:
  [05-bulut-ats.md](05-bulut-ats.md) (ilovada kiritiladi, Asterisk avtomatik sozlanadi).
- Bir trunk'da ko'p raqam (DID) bo'lishi mumkin. Ilovada liniya kaliti = raqamning oxirgi 9 raqami.
- Bir vaqtda bir nechta qo'ng'iroq o'tadi (kanal soni operatorga bog'liq).

## 4. Sinov (har klinikada)

1. Boshqa telefondan klinika raqamiga qo'ng'iroq qiling va qabulxonada **olmang**.
2. 20 soniyadan keyin AI salomlashishi kerak ("Assalomu alaykum! ... klinikasi, men Malika").
3. "Kardiologga ertaga yozilmoqchiman" deng, familiya va ism ayting, tasdiqlang.
4. Ilovada **Qo'ng'iroqlar → Oldindan yozilganlar** bo'limida yozuv paydo bo'lishi kerak.
   Telegram'da tasdiq keladi (raqam botga ulangan bo'lsa).
5. Yozuvni ilovadan bekor qiling.

| Muammo                                  | Sabab                                               | Yechim                                                                                        |
| --------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Pereadresatsiya bo'lmayapti             | Kod noto'g'ri yoki xizmat ulanmagan                 | `*#61#` bilan tekshiring yoki operatorga murojaat qiling                                      |
| AI raqami jiringlaydi, lekin javob yo'q | GoIP yoki Asterisk ulanmagan                        | [02-server-asterisk.md](02-server-asterisk.md) → nosozliklar                                  |
| AI "raqam aniqlanmadi" deydi            | Operator o'tkazilgan qo'ng'iroqda raqamni yashiradi | Operatordan CLIP (raqamni ko'rsatish) so'rang. Bunda AI raqamni o'zi so'raydi va ishlayveradi |
| Ovoz bir tomonlama                      | NAT / RTP portlari yopiq                            | `rtp_symmetric`, firewall 10000–10200/udp                                                     |
