# Klinikani ulash — ro'yxat (har klinikaga ~30 daqiqa)

## A. Navbat dvigateli va Telegram (bepul, telefonsiz ham ishlaydi)

1. **Xodimlar anketasi:** har shifokorda _mutaxassislik_ to'ldirilgan bo'lsin (masalan
   "Kardiolog", "LOR", "Ko'z shifokori"). AI va Telegram shifokorlarni shu bo'yicha guruhlaydi.
2. **Sozlamalar → Shifokorlar jadvali (navbat):** har shifokorni oching va quyidagilarni kiriting.
   - toifa (oliy/1/2), ilmiy daraja (PhD/DSc), unvon, tajriba — AI bemorga aytadi;
   - qabul davomiyligi (15/20/30 daqiqa), asosiy xizmat (narx shundan olinadi);
   - haftalik jadval — "Du–Ju 9–17 (tushlik 13–14)" tugmasi bilan tez kiritiladi;
   - izoh ("faqat kattalar") va kalit so'zlar ("EKG, UZI");
   - **"Online navbat ochiq"** belgisi;
   - ta'til yoki kasallik kunlari (shu kunlarga yozilgan bemorlar bo'lsa, ogohlantirish chiqadi).
   - "Bo'sh vaqtlar" bo'limida natijani tekshiring.
3. **Ish vaqti va bayramlar:** Sozlamalar → Katalog → Ish vaqti / Bayramlar. Bayram
   kunlariga navbat berilmaydi.
4. **Telegram havolasi:** Sozlamalar → AI qabulxona → "Telegram orqali navbat" (QR va
   havola). Uni saytga, Instagram'ga, eshikka va chekka joylashtiring.

## B. AI telefon (premium)

5. **Super admin** (admin.clary.uz → klinika → AI qabulxona): "AI rejimiga ruxsat" belgisini
   qo'ying va oylik limitni belgilang (masalan 1500 qo'ng'iroq).
6. **Sozlamalar → AI qabulxona:**
   - Rejim: **AI suhbat** (yoki boshlanishiga "Ovozli xabar");
   - yordamchi ismi, salomlashuv (bo'sh qoldirilsa standart matn ishlatiladi);
   - "Qo'shimcha ma'lumot": mo'ljal, parkovka, to'lov turlari, tahlilga tayyorgarlik — AI shundan javob beradi;
   - odamga ulash raqami — **asosiy raqam bo'lmasin**, masalan administratorning shaxsiy raqami;
   - eslatma soati (18:00), egasiga Telegram xabarlari.
7. **Sinov suhbati** (shu sahifada): 10–15 ta stsenariy
   ([00-faza0-tayyorgarlik.md](00-faza0-tayyorgarlik.md#33-aini-telefonsiz-sinash)).
   Javoblar noto'g'ri bo'lsa, odatda shifokor ma'lumoti yoki "Qo'shimcha ma'lumot"ni
   to'ldirish yetarli bo'ladi.
8. **Liniya:** SIM GoIP'ga qo'yiladi (yoki SIP raqam olinadi). Ilovada liniya qo'shiladi:
   kalit `goip3` (yoki DID), AI raqami va asosiy raqam kiritiladi.
9. **Pereadresatsiya:** asosiy telefonda shu sahifadagi kod teriladi (`**61*...**20#`, `**67*...#`).
10. **Jonli sinov** ([01-operator-va-pereadresatsiya.md](01-operator-va-pereadresatsiya.md#4-sinov-har-klinikada)).

## C. Xodimlarga 5 daqiqalik tushuntirish

- **Qo'ng'iroqlar (AI)** menyusi:
  - _Qayta qo'ng'iroq kerak_ — AI hal qilolmagan yoki ovozli xabar qoldirganlar. Yozuvni
    tinglang, bemorga qo'ng'iroq qiling, "Yozish" orqali navbat bering yoki "Qo'ng'iroq qilindi" bosing.
  - _Oldindan yozilganlar_ — kun bo'yicha ro'yxat (kim yozdi: AI telefon, Telegram, qabulxona;
    eslatma yuborilganmi, bemor "Kelaman" deganmi).
- Bemor kelganda **odatdagidek** qabul qiling. Shu shifokorga bugunga yozilgan qabul
  avtomatik "keldi" bo'ladi.
- Telefon orqali yozilish so'ralsa, "Navbatga yozish" tugmasi ishlatiladi (xuddi shu
  jadvaldan, ikki marta band qilinmaydi).

## Qabul mezonlari (pilot oxirida)

| Ko'rsatkich                                        | Maqsad      |
| -------------------------------------------------- | ----------- |
| AI hal qilgan qo'ng'iroqlar (yozildi + ma'lumot)   | ≥ 60%       |
| Noto'g'ri yozuv (bemor boshqa shifokorni so'ragan) | < 3%        |
| "Kelmadi" ulushi (eslatma bilan)                   | < 15%       |
| Bemor shikoyati                                    | 0           |
| O'rtacha xarajat / qo'ng'iroq                      | ≤ 1200 so'm |
