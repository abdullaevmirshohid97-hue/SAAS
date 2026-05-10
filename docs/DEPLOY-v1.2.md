# Clary v1.2 — Deploy Runbook

**Sprint 1 + Sprint 2A + 2B + 2C + 2D + 2E + 2H + 2I**

5 ta yangi commit GitHub'ga push qilindi (`2a13a30..05cf740`).

---

## Tartib (jiddiy)

**Xato tartibda qilinsa**: backend yangilangan, lekin migration qilinmagan bo'lsa — RPC chaqirsa fail bo'ladi va xizmat to'xtaydi. Shuning uchun **avval DB, keyin server**.

```
1. Supabase migrationlar (DB)
2. git pull + build + deploy (server)
3. Smoke test
```

---

## 1-bosqich — Supabase Dashboard (5 daq)

Supabase Dashboard → loyihangiz → **SQL Editor** → **New query**

Ikkita migration paste qiling, har birini alohida **Run** bosing:

### 1.1 — Sprint 2A (Klinik routing)

`supabase/manual-apply-sprint2a.sql` faylining **butun mazmunini** paste qiling, Run bosing.

**Verify:**
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='prescription_items'
   AND column_name IN ('schedule_times','days_count','assigned_nurse_id');
-- 3 qator chiqishi kerak

SELECT pg_get_functiondef('expand_prescription_to_nurse_tasks(uuid)'::regprocedure);
-- function source ko'rinishi kerak
```

### 1.2 — Sprint 2B (Billing periods)

`supabase/manual-apply-sprint2b.sql` paste qiling, Run.

### 1.3 — Sprint 2C (Inpatient billing + daily charge cron)

`supabase/manual-apply-sprint2c.sql` paste qiling, Run.

**Verify:**
```sql
-- Schema
SELECT column_name FROM information_schema.columns
 WHERE table_name='inpatient_stays'
   AND column_name IN ('discharge_reason','last_charged_date','daily_extras_uzs');
-- 3 qator chiqishi kerak

-- Cron schedule
SELECT jobname, schedule, command FROM cron.job
 WHERE jobname='inpatient-daily-charge';
-- 1 qator: '5 0 * * *' bilan

-- RPC manual test (ehtiyot bilan, production'da)
SELECT charge_daily_inpatient_stays();
-- Faol stay'lar uchun bugungi charge yozadi. Faqat bir marta ishlatib ko'ring;
-- pg_cron ertangi 00:05 da o'zi ishga tushadi.
```

**Eslatma:** `pg_cron` extension Supabase loyihangizda allaqachon yoqilgan
(extensions migration'da). Agar cron ishga tushmasa, Supabase Dashboard →
Database → Extensions → pg_cron ko'rinishini tasdiqlang.

**Verify:**
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='subscriptions' AND column_name='billing_period';
-- 1 qator chiqishi kerak

SELECT * FROM get_clinic_plan_limits(
  (SELECT id FROM clinics LIMIT 1)
);
-- Plan limitlari ko'rinishi kerak
```

---

## 2-bosqich — Production server (`/opt/clary`)

```bash
ssh user@your-vps
cd /opt/clary
./bootstrap-server.sh
```

`bootstrap-server.sh` quyidagilarni qiladi:
1. `git pull --ff-only origin main` — yangi 5 ta commitni oladi
2. `pnpm install --frozen-lockfile` — `xlsx` va boshqa yangi paketlar
3. Caddy config patch
4. 4 ta web app + API build
5. `pm2 restart clary-api` — 5-10 sek downtime
6. Caddy reload

Agar bootstrap script'da xato bo'lsa, **stdout'ni saqlang** va menga yuboring.

---

## 3-bosqich — Smoke test (telefon Incognito + browser Incognito)

### A. Sprint 2A — klinik routing
1. **Settings → Hamshira navbatchiligi** sahifasini oching
2. "Yangi qator" bos: hamshira tanlang, qavat = 2, kun = bugun, 08:00–20:00
3. Doctor console: bemor qabul qiling
4. Yangi retsept yozing:
   - Dori qidiring (masalan, "Analgin")
   - Vaqtlar: **09:00** va **21:00** chip'larini bosing
   - Kun = **5**
   - "Apteka'da berilsin" check ✓
   - Imzolang
5. **Pharmacy oynasida** retsept ko'rinishi kerak (`PrescriptionsTab`)
6. **Nurse (o'sha hamshira)** oynasida: 10 ta task ko'rishi kerak (5 kun × 2 vaqt), har biri "Rx" badge bilan

### B. Sprint 2B — subscription
7. **Settings → Obuna**: Monthly/Yearly toggle ko'ringan
8. Yearly tanlang → har plan narxi `/yil` ga o'zgaradi, `−20%` rozetka
9. Demo planda turgan klinikada: usage line ko'rinishi kerak (`Xodimlar: 1 / 2`)
10. 25PRO planda 3-chi xodim invite qilishga urinib ko'ring → **403** xato: "Plan'ingiz cheklovi tugadi"

### C. Sprint 2D — reception
11. Bemor (xizmatda turgan) tanlang → amber kartochka: "Bu bemor allaqachon qabulda"
12. Default = "qo'shish", radio'ni almashtirib ko'ring
13. Checkout → eski queue qoldi, yangi yaratilmadi (queue kanban'da bitta ticket)

### D. Sprint 2E — lab dialog
14. Lab → "Yangi tahlil" → bemor tanlang → "Bekor"
15. Yana "Yangi tahlil" → bo'sh form, eski draft yo'q ✓
16. Settings → Catalog → Lab tahlillari → "LOINC / ICD-10 kod" maydoni

### E. Sprint 2H — legal
17. clary.uz/legal/terms → uzun uzbekcha matn, **github.com link yo'q**
18. clary.uz/legal/privacy → 10 bo'lim
19. Footer'da 8 ta link guruhi: terms / privacy / dpa / sla / security / cookies / acceptable-use / compliance

### F. Sprint 2I — i18n
20. Til almashtiring: ru, kk, ky, tg, uz-Cyrl — `nav.doctor` literal stringi paydo bo'lmaydi (lokalizatsiya qilingan)

### H. Sprint 2F + 2G + Google OAuth — sinov

**Sprint 2F (Pharmacy Excel):**
- Pharmacy → Receipts tab → "Excel'dan import" → fayl yuklang (yoki Template'ni eksport qiling) → field mapping ko'rinadi
- Pharmacy → POS → "Eksport" → dorilar `clary-dorilar.xlsx` faylga yoziladi

**Sprint 2G (Web profile) — smoke test:**
- Settings → Web profili sahifa to'liq ochiladi
- 7 ta tab: Asosiy / Galereya / Xizmatlar / Ish soati / Lokatsiya / SEO / Statistika
- "is_published" toggle yoqing → "portal_slug" maydon to'ldiring (lotin harf + tire)
- Saqlang → toast "Profil saqlandi"
- Yuqori o'ng burchakdagi "Profilni ko'rish" link → `my.clary.uz/clinics/{slug}` (bu domain mavjudligini tasdiqlang — agar yo'q bo'lsa, DNS sozlanmagan; portal app keyin chiqariladi)

**Google OAuth:**
1. **Supabase Dashboard** → Authentication → Providers → Google:
   - **Enable Google provider** toggle yoqing
   - Google Cloud Console'da OAuth 2.0 Client ID yarating:
     - Authorized redirect URIs: `https://<your-supabase-project>.supabase.co/auth/v1/callback`
   - Client ID + Client Secret'ni Supabase'ga paste qiling
   - Save
2. **Klinika app'da:**
   - Site URL: `https://app.clary.uz` (Supabase → Authentication → URL Configuration)
   - Additional redirect URLs: `https://app.clary.uz/**`
3. **Sinov:**
   - app.clary.uz/login → "Google orqali davom etish" → Google account tanlash → /dashboard
   - Yangi user uchun: `clinic_id=NULL` bo'lgani uchun avto `/onboarding`'ga redirect (RequireAuth'da gating bor)
   - Onboarding'da klinika yarating → set_user_clinic RPC → JWT'da clinic_id paydo bo'ladi
   - Logout → qayta login: avval foydalanilgan Google account bilan to'g'ridan-to'g'ri dashboard

### G. Sprint 2C — statsionar
21. **Settings → Catalog → Xonalar** → yangi xona: tier=lyuks, daily=500000
22. **Settings → Catalog → ...** (yo'q): Hozir included_services CRUD UI'si yo'q (API tayyor, settings'ga sahifa qo'shilmadi). SQL orqali tekshirish:
    ```sql
    INSERT INTO room_included_services (clinic_id, room_id, service_id, frequency_per_week)
    VALUES ('<clinic>', '<room>', '<massage-service>', 2);
    ```
23. **Inpatient → "Yangi qabul"** → o'sha lyuks xonani tanlang → admit modal'da emerald kartochka: "Bu xonaga qo'shilgan xizmatlar: Massaj — 2/hafta"
24. Bemorni admit qiling
25. **SQL manual test:**
    ```sql
    SELECT charge_daily_inpatient_stays();
    -- Bugungi charge yoziladi
    SELECT * FROM patient_ledger WHERE stay_id = '<stay>' ORDER BY created_at DESC;
    -- 'charge' entry ko'rinadi
    ```
26. **Bemorga depozit qo'shing** (Hisob → +Yozish) — 1,000,000 so'm deposit
27. **"Chiqarish"** tugmasini bos: yangi modal — balance preview, sabab dropdown, payment method tabs
28. Sabab=tuzaldi, payment=naqd, paid=0 (outstanding=0 chunki deposit yetadi) → Tasdiqlash. Discharge bajariladi.
29. Boshqa bemor: outstanding>0 holatda paid<outstanding va force=off → tugma disabled, amber ogohlantirish ko'rinishi kerak
30. Force=on → "qarz bilan chiqarish" → discharge bajariladi (debt qoladi)
31. Deceased: write-off toggle → adjustment entry, balance=0

---

## Bug topilsa

Aniq qadam (Sprint X, qadam Y) + xato matni / screenshot menga yuboring. Hot-fix qilaman, push qilaman, siz `bootstrap-server.sh` ni yana ishga tushirasiz.

---

## Rollback (kerak bo'lsa)

Migrationlar additive (ADD COLUMN IF NOT EXISTS) — DB'ni qaytarish kerak emas. Faqat code'ni qaytarish:

```bash
cd /opt/clary
git reset --hard 2a13a30  # Sprint 2A frontend gacha qaytadi
./bootstrap-server.sh
```

Yangi qo'shilgan ustunlar foydalanilmasdan qoladi (eski code ularni o'qimaydi). Hech qanday data yo'qolmaydi.

---

## Yangi commit'lar ro'yxati (`2a13a30..05cf740`)

```
05cf740  sprint2i: i18n audit script + fill 14 missing nav/auth keys
2cb9404  sprint2h: legal pages — inline content, drop github links
78c1b96  sprint2e: lab dialog reset on close + LOINC label
a7d3220  sprint2b: billing periods (Monthly/Yearly) + seat enforcement
c2dda25  sprint2d: reception "add to existing appointment"
```

(Hashlar real tartibni aks ettirmasligi mumkin — `git log` orqali tekshiring.)
