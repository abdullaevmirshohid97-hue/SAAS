# Clary v1.2 — Deploy Runbook

**Sprint 1 + Sprint 2A + 2B + 2D + 2E + 2H + 2I**

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
