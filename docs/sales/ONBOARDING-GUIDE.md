# Clary — Klinika Onboarding qo'llanmasi

**Mijoz uchun: birinchi kunda nima qilish kerak**

Bu hujjatni klinikangiz egasi yoki administratorga bering. 30 daqiqada Clary ishga tushadi.

---

## 1. Ro'yxatdan o'tish (5 daqiqa)

1. Brauzerda **clary.uz** ni oching → **"Bepul boshlash"** tugmasini bosing
2. Email + parol kiriting (yoki **"Google orqali davom etish"**)
3. Email tasdiqlash xabari keladi → link bosing
4. Endi siz `app.clary.uz/onboarding` sahifada bo'lasiz

## 2. Klinika ma'lumotlarini kiriting (5 daqiqa)

5 qadamli sehrgar:

### Qadam 1 — Klinika nomi
- **Klinika nomi:** masalan "NUR Diagnostika"
- **URL slug:** avtomatik yaratiladi (`nur-diagnostika`)
- Davom etish

### Qadam 2 — Til va vaqt zonasi
- **Asosiy til:** O'zbek (lotin) yoki rus
- **Mamlakat:** O'zbekiston
- **Vaqt zonasi:** Asia/Tashkent (avtomatik)

### Qadam 3 — Klinika turi
- Klinika / Diagnostika markazi / Stomatologiya / Laboratoriya / Dorixona

### Qadam 4 — Jamoa hajmi
- 1-3 / 4-10 / 11-25 / 25+ xodim
- Bu ma'lumot **plan tavsiyasi uchun**

### Qadam 5 — Brend rangi
- Klinikangiz asosiy rangi (avtomatik ishlatiladi UI'da)
- **Tugatish** tugmasi → Dashboard'ga olib boradi

---

## 3. Asosiy sozlamalar (15 daqiqa)

### A. Xodimlarni qo'shing

**Sozlamalar → Xodimlar (kirish) → "Xodim taklif qilish"**

Har bir xodim uchun:
- To'liq ism
- Email (real email, invitation link shu yerga keladi)
- Telefon
- **Rol:**
  - **Shifokor** — bemor qabul qiladi, retsept yozadi
  - **Hamshira** — ukol, kapelnitsa, hisobotlar
  - **Qabulxona** — bemor qabuli, navbat
  - **Kassir** — to'lov qabul qilish, kunlik hisob
  - **Dorixonachi** — apteka POS
  - **Laborant** — laboratoriya tahlillari
  - **Administrator** — barcha sozlamalar
  - **Egasi** — to'liq kirish

Klinikangizda statsionar bo'lsa — kamida 1 ta **Hamshira** qo'shing.

### B. Xizmatlar narxlari

**Sozlamalar → Biznes katalog → Xizmatlar**

- "Yangi qator" → har bir xizmat uchun:
  - Nomi (o'zbek + rus)
  - Narxi (so'mda)
  - Davomiyligi (daqiqa)
  - Kategoriya (Konsultatsiya / Diagnostika / Laboratoriya / ...)

**Tavsiya:** kamida 10-15 ta asosiy xizmat. Keyinroq qo'shasiz.

### C. Xonalar (statsionar uchun)

**Sozlamalar → Biznes katalog → Xonalar**

- Raqami: 201, 202, ...
- Qavat: 1, 2, 3
- Sig'im: 1, 2, 4 (necha o'rin)
- Toifa: **Lyuks** / **Standart** / **Comfort** / **Depozit**
- Kunlik narxi (so'm)

**Lyuks xonaga qo'shilgan xizmatlar** (massaj, parafin) — keyingi sprint'da UI bo'ladi, hozircha admin bilan bog'laning.

### D. Hamshira navbatchiligi (statsionar uchun)

**Sozlamalar → Hamshira navbatchiligi → "Yangi qator"**

Har bir hamshira uchun:
- Qavat (1, 2, ...)
- Hafta kunlari (Du, Se, Ch, ...)
- Vaqt (08:00–20:00)

Doktor retsept yozsa, **tizim avtomatik** to'g'ri hamshiraga vazifa yuboradi.

### E. Dorilar (apteka bo'lsa)

**Sozlamalar → Biznes katalog → Dorilar**

- Excel'dan import (sozlamalar/templatedan tushiriling)
- Yoki qo'lda: nomi, narxi, omborda soni, srok godnosti

---

## 4. Birinchi bemor — to'liq aylanma (5 daqiqa)

### Reception (Qabulxona)
1. **Reception** sahifasiga o'ting
2. Smena ochish (kassa) — PIN kiritib
3. **Bemor** tanlang yoki yangi qo'shing (Familiya, Ism, telefon)
4. **Shifokor** tanlang (ixtiyoriy, navbat uchun)
5. **Xizmatlar** qo'shing (savatga)
6. **To'lov turi**: Naqd / Karta / Click / Payme
7. **Naqd to'langan summa** kiriting
8. **Yakunlash** → chek beriladi, navbat raqami yaratiladi

### Shifokor
9. Shifokor `app.clary.uz` ga kirib **Shifokor oynasi** ni ochadi
10. O'zining ismini tanlaydi (birinchi marta)
11. **"Keyingi bemorni chaqirish"** — bemor navbatda paydo bo'ladi
12. **"Qabul qilish"** → bemor karta ochiladi (tarix, retseptlar)
13. **"Yangi retsept"** → dori qidirish, vaqt jadvali (09:00 + 21:00 chips), kun soni
14. **"Apteka'da berilsin"** belgilang → retsept apteka'ga tushadi
15. **Imzolash** → retsept bilan tugatiladi
16. **"Qabulni yakunlash"**

### Hamshira (agar retsept'da vaqt bor)
17. Hamshira `app.clary.uz` ga kirib **Hamshira posti** ni ochadi
18. **"Mening vazifalarim"** — avtomatik task'lar: "Rx: Analgin 09:00", "21:00"
19. Bajargach **"Yakunlash"**

### Apteka (agar "Apteka'da berilsin" belgilangan bo'lsa)
20. Apteka POS → **Retseptlar tab** → kelgan retsept ko'rinadi
21. Dorilarni terib → to'lov qabul qilish

### Kassa (kunning oxirida)
22. **Kassa** sahifasi → bugungi tushum
23. **Smena yopish** → naqd hisobot

---

## 5. Statsionar (agar klinikangizda bor)

1. **Statsionar** sahifasi → xonalar xaritasi
2. Bo'sh xonaga **"Yangi qabul"** → bemor, shifokor, depozit
3. Faol bemor ro'yxatida ko'rinadi
4. **Har kun 00:05 da** — tizim avtomatik kunlik to'lov hisoblaydi (xona narxi + qo'shimcha xizmatlar)
5. **Chiqarish** tugmasi → modal:
   - **Sabab** (tuzaldi / davolanishdan voz kechdi / vafot etgan / ...)
   - **To'lov turi** (naqd, karta, ...)
   - **To'langan summa**
   - Agar qarz qoldirsa **"Qarz bilan chiqarish"** checkbox
   - Vafot etgan bo'lsa **"Balance write-off"** toggle

---

## 6. Kunlik ish ritmi (oddiy klinika)

### Ertalab (08:00)
- Kassir smena ochadi
- Hamshira o'zining tasklarni ko'radi
- Reception bemorlarni qabul qilishni boshlaydi

### Kun bo'yi
- Reception → Shifokor → (Lab/Pharmacy/Diagnostics) → Cashier zanjiri
- Statsionar uchun hamshira tasklari + vital signs

### Tushlikdan keyin (14:00)
- Marketing tab — SMS yuborish (tug'ilgan kunlar, follow-up)

### Kun oxirida (20:00)
- Cashier smena yopadi
- Journal sahifasi → kunlik hisobot

---

## 7. Yordam va aloqa

- **Texnik muammo:** support@clary.uz
- **Telegram:** @clary_support
- **WhatsApp:** +998 XX XXX XX XX
- **Online docs:** clary.uz/docs

---

## 8. Birinchi hafta checklist

- [ ] Kun 1: Onboarding, 5 ta xodim, 10 ta xizmat
- [ ] Kun 2: Dorilar (apteka bor bo'lsa), Xonalar (statsionar bor bo'lsa)
- [ ] Kun 3: Birinchi 5 bemor real ish
- [ ] Kun 4: Hamshira navbatchiligi (agar kerak)
- [ ] Kun 5: Marketing — bemorlarga SMS yuborish
- [ ] Kun 6: Kassir smena rejimi (PIN)
- [ ] Kun 7: Analytics ko'rib chiqing — birinchi hafta natijasi

---

## 9. Tarif tanlash

| Plan | Narx (oyiga) | Xodim | Qurilma | Imkoniyatlar |
|------|--------------|-------|---------|--------------|
| **Demo** | Bepul | 2 | 2 | 14 kun, barcha funksiyalar |
| **25PRO** | $25 | 2 | 2 | Asosiy klinika |
| **50PRO** | $50 | 10 | 10 | + Analitika |
| **120PRO** | $120 | Cheksiz | Cheksiz | + Custom rollar + SLA |

**Yillik to'lov** — 20% chegirma (`/yil` ko'rinishida).

To'lov yo'llari:
- **Click yoki Payme** orqali (O'zbekiston)
- Manual aktivatsiya — administrator bilan bog'laning (birinchi 6 oy)

---

**Salomatlik va omad! 🚀**
