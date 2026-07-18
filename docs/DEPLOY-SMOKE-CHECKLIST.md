# Deploy'dan keyingi smoke-test (E1) — 5 daqiqa

Har deploy'dan keyin shu ro'yxatni yurib chiqing. Maqsad: "jim singan" funksiyani
mijoz emas, BIZ birinchi topamiz.

## 1. Kirish va asosiy oqim (app.clary.uz)
- [ ] `Ctrl+Shift+R` (eski JS kesh tozalash) → login ochiladi, kirish ishlaydi
- [ ] Dashboard yuklanadi — KPI kartalari raqam ko'rsatadi (bo'sh/xato emas)

## 2. Qabulxona (pul oqimi — eng kritik)
- [ ] Bemor qidiruv ishlaydi
- [ ] Xizmat tanlab checkout → chek chiqadi, jurnal yozuvi paydo bo'ladi
- [ ] Qarz maydoni jami summadan oshirilmaydi (clamp)

## 3. Laboratoriya
- [ ] Buyurtma yaratish (narxsiz test bloklanadi — bu KUTILGAN xato xabari)
- [ ] Namuna holati "Olindi"ga o'tadi (jim 400 emas)
- [ ] Natija kiritish → saqlanadi, holat "kutilmoqda"da qolib ketmaydi
- [ ] Natija PDF/QR ochiladi, QR tiniq

## 4. Super-admin (admin.clary.uz)
- [ ] Lidlar sahifasi ochiladi, "30 soniyada yangilanadi" ishlaydi
- [ ] Sayt lidi holatini o'zgartirib Saqlash → xatosiz
- [ ] Klinikalar ro'yxati va tenant sahifasi ochiladi

## 5. Landing (clary.uz)
- [ ] `/demo` → Ism+Telefon forma chiqadi → demo ochiladi
- [ ] Yangi lid adminda (Sales tab, instant_demo) ko'rinadi
- [ ] Telegram'ga lid xabari keladi (env sozlangan bo'lsa)

## 6. API salomatlik
- [ ] `curl -s https://api.clary.uz/api/v1/health` → OK
- [ ] `pm2 logs clary-api --lines 30` — restart loopi/qizil xato yo'q

## Xato topilsa
1. `pm2 logs clary-api --lines 100` — stack trace oling
2. Supabase Dashboard → Logs → API/Postgres — 4xx/5xx qatorlarini ko'ring
3. Regressiya deploy'dan bo'lsa: `git log --oneline -10` → aybdor commitni aniqlang
4. DB xato ("column not found in schema cache") = migratsiya qo'llanmagan —
   `supabase/migrations/` dagi yangi fayllarni SQL Editor'da qo'llang + `NOTIFY pgrst, 'reload schema';`
