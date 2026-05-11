# Clary — 15 daqiqalik Sales Demo skripti

**Auditoriya:** Klinika egasi yoki bosh administrator
**Maqsad:** Demo'dan keyin "Beta-tester sifatida qo'shilaman" javobi
**Vaqt:** 15 daqiqa (10 demo + 5 savol-javob)

---

## DEMO OLDIDAN — Tayyorgarlik (10 daqiqa)

1. Brauzerda **app.clary.uz** ochiq turibdi (incognito rejimda)
2. Test klinika seed qilingan: 3 ta shifokor, 10 ta xizmat, 20 ta bemor
3. Microphone va ekran o'zaro tekshirish
4. **Slayd 1** — Clary logo, "Klinika boshqaruvi, bir oynada"
5. Telefon yaqinda turadi (kerak bo'lsa demoda ko'rsatish)

---

## QISIM 1 — Muammoni eslash (1 daqiqa)

> "Salom, [Ism]. Bugun sizga **Clary** mahsulotini ko'rsataman.
>
> Avval bir savol — klinikada **kunlik tushum hisobotini** qancha vaqt o'tib ko'rasiz? Soatga aniq emasligini bilamiz."
>
> "Yana — bemoringiz qabuldan chiqib, **shifokor retseptini** apteka qachon ko'radi? Qog'oz bilan o'tkaziladi, vaqt yo'qoladi."
>
> "Yoki — **statsionar bemor** yotadi, kunlik hisobotini administrator har kuni qo'lda yozadi. Xato bo'lsa — pul yo'qoladi."

**Pauza.** Mijoz boshini liqillatishi kerak.

---

## QISIM 2 — Reception flow (2 daqiqa)

> "Mana qarayng — bu **Clary**'ning Qabulxona oynasi."

**Ekranda:** `app.clary.uz/reception`

1. **Bemor tanlang** — qidiruvda "Aziza" yozing, tanlang
2. **Shifokor tanlang** — Dr. Karimov
3. **Xizmat qo'shing** — "Kardiolog konsultatsiya" 250,000 so'm
4. **To'lov:** Naqd 250,000 so'm
5. **Yakunlash**

> "Yakunlandi. **8 soniya** ichida:
> - Bemor navbatga qo'shildi
> - Chek tayyor
> - Kassir statistikasiga qo'shildi
> - Shifokor o'z navbatida ko'radi
>
> Qog'oz, hisob-kitob mashinasi, alohida jurnal yo'q."

---

## QISIM 3 — Doctor + Klinik routing (3 daqiqa)

> "Endi shifokor tomonida ko'ramiz."

**Ekran:** `app.clary.uz/doctor` → Dr. Karimov tanlanadi

1. **"Keyingi bemorni chaqirish"** → Aziza paydo bo'ladi
2. **"Qabul qilish"** → bemor karta ochiladi
3. Tarix, oldingi retseptlar ko'rinadi
4. **"Yangi retsept"** dialog:
   - Dori: **Analgin** (qidiruv)
   - Vaqtlar: **09:00** va **21:00** chip'larini bosing
   - Kun: **3**
   - **"Apteka'da berilsin"** ☑
   - **Imzolash**

> "E'tibor qiling — bu 'shunchaki retsept emas'. Tizim hozir **6 ta vazifa** yaratdi:
> - Hamshiraga 3 kun × 2 vaqt = 6 ta ukol vazifasi
> - **Avtomatik** bemor qaysi qavatda yotgan + qaysi hamshira bugun navbatchi — qarab vazifa to'g'ri odamga keldi
> - Apteka oynasida retsept paydo bo'ldi"

**Hamshira oynasini oching:** 6 ta task ko'rinadi, har biri "Rx" rozetkasi bilan.

**Apteka oynasini oching:** retsept "Pending dispense" tab'da.

> "Tasavvur qiling — siz tushlikdan qaytdingiz, **hech kim sizga eslatma yubormagan** holatda hamshira ukolni ham, apteka dorini ham allaqachon bajarib bo'lgan. Bu vaqtni soat'lar bilan tejaydi."

---

## QISIM 4 — Statsionar billing (2 daqiqa)

> "Statsionari bor klinikalar uchun eng asab beradigan ish — **kunlik hisob**. Mana Clary qanday hal qiladi."

**Ekran:** `app.clary.uz/inpatient`

1. **Faol bemorlar** ro'yxati — har biri uchun kunlik to'lov ko'rsatilgan
2. Bemorni tanlang → **"Hisob"** → ledger jurnali:
   - Depozit: 2,000,000 so'm
   - Kunlik to'lov: -500,000 × 3 kun = -1,500,000 so'm
   - **Balans:** +500,000 so'm
3. **"Chiqarish"** modal:
   - Sabab: **Tuzaldi**
   - To'lov turi: **Naqd**
   - Qoldiq: 0 so'm (deposit yetadi)
   - **Tasdiqlash**

> "Eng muhimi: **har kuni soat 00:05 da** tizim avtomatik ravishda har bir faol bemor uchun kunlik to'lovni hisoblaydi. Administrator hech narsa qilmaydi.
>
> Lyuks xona uchun avtomatik massaj va parafin xizmati ham qo'shiladi. Bemor chiqayotganda yagona tugma — chek va balans tayyor."

---

## QISIM 5 — Boshqaruv paneli (2 daqiqa)

> "Klinika egasi uchun — **kun yakuni bir oynada**."

**Ekran:** `app.clary.uz/journal` (Jurnal sahifa)

- Bugungi tushum: 3,450,000 so'm
- Bugungi chiqim: 200,000 so'm (dori sotib olish)
- Sof foyda: 3,250,000 so'm
- 12 ta bemor, 18 ta xizmat, 4 ta retsept
- Filtrlar: kun, hafta, oy

**Ekran:** `app.clary.uz/analytics`

- Eng faol shifokor: Dr. Karimov (8 bemor)
- Eng ko'p sotilgan xizmat: USG abdominal (5 marta)
- O'rtacha chek: 287,000 so'm
- Heatmap: qaysi soatda ko'p bemor

> "Bularning hammasi **real vaqtda**. Soat 14:00 da telefon orqali ko'rasiz. Hech qanday excel yo'q."

---

## QISIM 6 — Multi-til + Mobile (1 daqiqa)

> "Klinika xodimingiz rus tilida ishlashni xohlaydimi? Yuqori o'ngdagi tugma → RU. Hammasi tarjima qilingan."

**Til o'zgartiriladi** — sahifa darhol rus tiliga o'tadi.

> "Telefonda? Mana qarayng."

**Telefonni ko'rsating** — app.clary.uz responsive, telefon brauzerida ham ishlatish mumkin.

---

## QISIM 7 — Tarif va beta-tester taklif (2 daqiqa)

> "Endi narx haqida.
>
> **Standart tariflar:**
> - 25PRO — 2 xodim — $25/oy
> - 50PRO — 10 xodim — $50/oy
> - 120PRO — cheksiz — $120/oy
>
> Yillik to'lov — 20% chegirma.
>
> **LEKIN sizga taklifim alohida:**
> - **Bepul birinchi 30 kun** (xohlaganingizcha sinab ko'ring)
> - Keyin **6 oy — 75% chegirma** ($6/oy)
> - Bu sizdan kerak: **Beta-tester sifatida feedback**, screenshot, bitta testimonial
>
> Sababi — sizning klinikangiz birinchilardan biri. Sizning ish jarayoningizga moslashtirib, bizning mahsulotni yaxshilaymiz."

**Pauza.** Mijozni o'ylashga vaqt bering.

---

## QISIM 8 — Savol-javob (5 daqiqa)

### Eng tez-tez beriladigan savollar

**Savol 1:** "Ma'lumotlar qayerda saqlanadi? Xavfsizmi?"

> "Supabase Cloud (AB Frankfurt). Har bir klinika **alohida ajratilgan** — sizning ma'lumotingizni boshqa hech qaysi klinika ko'rmaydi (Row Level Security PostgreSQL'da).
>
> Har bir muhim harakat **7 yil audit log'ga** yoziladi. Kim qachon nima qilgani aniq ko'rinadi.
>
> Kunlik avtomatik backup — 7 kun saqlanadi."

**Savol 2:** "Internet yo'q bo'lsa-chi?"

> "Hozircha — offline rejim yo'q. Lekin **mobile internet** bilan ham ishlaydi (1 MB sahifa). Toshkentda internet uzilishi nodir, statsionar bor klinikalar **2-i routerni tavsiya qilamiz**."

**Savol 3:** "Boshqa tizimdan ma'lumotni qanday ko'chirib o'tkazaman?"

> "Excel orqali. Bemorlar, xizmatlar, dorilar — barchasi import shabloni bor.
>
> Birinchi oyda **men yordam beraman** — sizning excel'larni Clary'ga ko'chirish bepul."

**Savol 4:** "Click/Payme bilan to'lashim mumkinmi?"

> "Bemorlardan to'lov olish uchun — **ha**, Click va Payme integratsiya qilingan.
>
> Clary uchun obuna to'lash — hozircha **men bilan bog'laning** (transfer yoki naqd). Avtomatlashtirish keyingi 2 oy ichida."

**Savol 5:** "Stomatologiya / pediatriya / [boshqa profil] uchun ham mosmi?"

> "Klinika turini onboarding'da tanlaysiz. Stomatologiya uchun maxsus modul bor (tooth chart, treatment plan). Pediatriya — bemor profillarida bola/ota-ona bog'lash mumkin."

---

## Yopilish

> "[Ism], shaxsan men bu mahsulotni 6 oy yaratganman. **Sizning kabi klinika** birinchi mijoz bo'lib ko'paytirishi men uchun muhim.
>
> Sinab ko'rasizmi? Hozir sizga onboarding link yuboraman, 30 daqiqada ishga tushishi mumkin."

**Pauza. Javob kuting.**

### Agar "Ha" desa:
> "Ajoyib! [Mijoz email]'ga onboarding qo'llanma va tarif tafsilotini hozir yuboraman. Ertaga ertalab sizga qo'ng'iroq qilib, sozlashda yordam beraman."

### Agar "O'ylab ko'raman" desa:
> "Albatta. Sizga **2 ta narsa** yuboraman:
> 1. Demo videoning yozuvi (5 daqiqa)
> 2. Onboarding hujjati (PDF)
>
> Bir hafta ichida qaytib chiqing — qiziq tomonlari yoki savollaringiz bo'lsa, men javob beraman."

### Agar "Yo'q" desa:
> "Tushundim. Iltimos, **nima yoqmadi**? Bu mening keyingi versiya uchun muhim feedback."

**Yozib oling.** Bu **eng qimmatli ma'lumot**.

---

## DEMO oxirida

- Mijozdan **email** so'rang (agar yo'q bo'lsa)
- Onboarding hujjatini **darhol yuboring**
- 24 soat ichida **follow-up email** yozing
- 7 kun davomida har 2-3 kunda Telegram'da yengil-yelpi xabar
