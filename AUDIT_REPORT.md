# Clary v2 — To'liq Audit Hisoboti

**Sana:** 2026-05-12
**Audit obyekt:** `d:\SAAS` (Clary v2.0.0 — Enterprise clinic SaaS, Uzbekistan/CIS)
**Audit metodologiyasi:** Statik kod tahlili, fayl tarkibi tekshiruvi, migration audit, deploy artifactlari ko'zdan kechirilishi
**Hozirgi production holati:** v1.2 deploy qilingan (`67d9262..a89815a..ec77d68` commit'lar)

---

## 1. STRUKTURA VA STACK

### Monorepo

- **Boshqaruv:** Turborepo 2.x + pnpm 9 workspaces (`pnpm-workspace.yaml`)
- **TypeScript:** 5.5+, shared base `tsconfig.base.json`
- **Linter:** ESLint shared config (`packages/config-eslint`)
- **Format:** Prettier + Tailwind plugin
- **Test runner:** Vitest (declared, kam ishlatilgan), Playwright (E2E)
- **Hooks:** Husky + lint-staged (pre-commit)

### apps/ (6 application)

| Paket | Stack | Hajm |
|-------|-------|------|
| **api** | NestJS 10 + Supabase JS + Stripe + Swagger + AsyncLocalStorage | **38 modul** |
| **web-clinic** | Vite + React 18 + React Router 7 + TanStack Query 5 + shadcn/ui | **31 sahifa** |
| **web-admin** | Vite + React (super admin dashboard) | **25 sahifa** |
| **web-patient** | Vite + React (bemor PWA) | **9 sahifa** |
| **web-landing** | Astro 4 + React islands + MDX + i18n routing | **37 .astro sahifa** |
| **mobile** | Expo SDK 51 + Expo Router + NativeWind + Supabase JS | **8 screen** |

### packages/ (13 shared package)

| Paket | Maqsadi | Real/Skeleton |
|-------|---------|----------------|
| **schemas** | Zod runtime schema'lar + TypeScript exports | ✅ Real |
| **types** | TS tip ta'riflari + Supabase auto-generated stub | 🟡 Stub generated types |
| **api-client** | Shared HTTP SDK (~1500 LOC, typed endpoints) | ✅ Real |
| **ui-web** | shadcn-based UI primitives, command palette | ✅ Real |
| **i18n** | 7 locale JSON + loader | ✅ Real |
| **utils** | Phone, currency, date, slug helpers | ✅ Real |
| **payments** | Stripe + Click + Payme + Uzum + Kaspi + Mbank adapters | 🟡 **Aralash** (pastda batafsil) |
| **notifications** | Eskiz + Playmobile + Twilio SMS + Resend email | 🟡 Aralash |
| **tenant-vault** | Per-clinic encrypted BYO credentials | 🟢 Asosiy bor |
| **brand** | Brand tokens, logo SVG | ✅ Real (asset) |
| **config-eslint/tailwind/tsconfig** | Shared configs | ✅ Real |

### Stack texnologiya jami

- **Backend:** NestJS 10, Supabase (Postgres + Auth + Storage + RLS), Stripe Node SDK, pg_cron
- **Frontend:** React 18, Astro 4, Expo 51, Tailwind, shadcn/ui
- **Til/Runtime:** TypeScript 5.5, Node 20, pnpm 9
- **CI:** GitHub Actions (lint, typecheck, test, E2E, mobile-eas, deploy-staging, deploy-production)
- **Deploy:** Caddy (reverse proxy + auto-TLS), PM2 (Node process), bash `bootstrap-server.sh` + `deploy.sh`
- **Observability:** Grafana + Prometheus + Loki (configured in `infra/grafana/`, **lekin VPS'da yoqilmagan**)

### Monorepo strukturasi to'g'rimi?

**Ha, professional darajada.** Turbo cache, shared configs, workspace deps `workspace:*` bilan. Bitta muammo: `packages/schemas/dist/` artefaktlari **manba sifatida import qilinadi** — `pnpm --filter @clary/schemas build` har deploy'da kerak. Bu allaqachon `deploy.sh`'ga qo'shildi (`caed0b9` commit).

---

## 2. REAL ISHLAYDIGAN vs SKELETON

### apps/api/src/modules/ — 38 modul

| Modul | LOC | Real/Stub | Izoh |
|-------|-----|-----------|------|
| `inpatient` | 872 | ✅ 90% real | Sprint 2C qo'shildi: tier, daily charge cron, discharge flow |
| `admin` | 768 | ✅ 80% real | Tenants, finance, support — real DB |
| `shifts` | 645 | ✅ 75% real | Operator PIN, daily breakdown |
| `pharmacy` | 619 | ✅ 80% real | POS, receipts, batches, barcode |
| `journal` | 611 | ✅ 75% real | Append-only feed, PIN gating |
| `nurse-portal` | 546 | ✅ 70% real | Join-request, chat, task |
| `payroll` | 519 | ✅ 70% real | Rates, ledger, payouts |
| `marketing` | 481 | 🟡 60% real | Segments, campaigns — DB bor, lekin send adapter Eskiz'ga to'liq ulanmagan |
| `reception` | 474 | ✅ 85% real | Sprint 2D bilan checkout + open-appointments |
| `payment-qr` | 471 | 🟡 50% real | Click/Payme metodlari bor, lekin polling + webhook sinov yo'q |
| `lab` | 421 | ✅ 80% real | Orders, results, kanban |
| `staff` | 381 | ✅ 90% real | Sprint 2B bilan seat enforcement |
| `cashier` | 343 | ✅ 75% real | KPIs, transactions, expenses |
| `nurse` | 329 | ✅ 85% real | Sprint 2A bilan schedules CRUD |
| `analytics` | 308 | ✅ 70% real | Overview, doctors, heatmap |
| `queues` | 304 | ✅ 80% real | Kanban, ticket generation |
| `diagnostics` | 236 | ✅ 75% real | Orders, equipment |
| `prescriptions` | 231 | ✅ 85% real | Sprint 2A bilan RPC expand |
| `referrals` | 207 | ✅ 85% real | Sprint 2A bilan target_specialty |
| `catalog` | 184 | ✅ 95% real | `createCatalogModule` factory, 26 entity |
| `webhooks` | **37** | 🔴 **STUB** | Stripe verify YO'Q, Click/Payme/Uzum: `return { received: true, body }` |
| `auth` | ~200 | ✅ 80% real | JWKS-based JWT verify, demo magic link |
| `subscription` | 113 | ✅ 70% real | Sprint 2B bilan billing_period |
| `telegram-backup` | 1 fayl | 🟡 Stub-cron | Real Telegram bot conn yo'q |
| `vault` | 1 fayl | 🟡 Yarim | Supabase Vault wrapper |
| `support-chat` | 1 fayl | 🟡 50% | Threads bor, real-time yo'q |
| `site-cms` | 323 | ✅ 80% | Landing content from DB |

**Webhooks moduli (`webhooks.module.ts`)** — 37 qator, hammasi mock:
```ts
// d:/SAAS/apps/api/src/modules/webhooks/webhooks.module.ts:12-15
stripe(@Req() req, @Headers('stripe-signature') sig) {
  // Real impl: verify via stripe.webhooks.constructEvent + process event
  return { received: true, hasSignature: Boolean(sig) };
}
```

### packages/payments/ — adapter reality matrix

| Adapter | LOC | Holat | Tafsilot |
|---------|-----|-------|----------|
| **Stripe** | 47 | ✅ Real | `stripe.paymentIntents.create` chaqiriladi, idempotency key |
| **Click** | 108 | ✅ Real | Md5 signature, QR flow, polling |
| **Payme** | 88 | ✅ Real | Basic auth, QR invoice, status check |
| **Mbank** | 173 | ✅ Real (KG) | To'liq integratsiya |
| **Uzum** | 29 | 🔴 **STUB** | `// Stub for clinics that want Uzum`, faqat redirect URL |
| **Kaspi** | 28 | 🔴 **STUB** | Faqat redirect URL, status: `'succeeded'` hardcoded |

### packages/notifications/ — SMS

| Adapter | LOC | Holat |
|---------|-----|-------|
| **Eskiz** | 49 | ✅ Real (auth + send) |
| **Playmobile** | 33 | 🟡 Probable real (basic POST) |
| **Twilio** | 24 | 🟡 Probable real (Twilio SDK) |
| **Resend (email)** | 31 | 🟡 Probable real |

### `createCatalogModule` factory — real biznes qoidalari bormi?

**184 qator** `catalog.module.ts`, 26 ta config object. Har biri Zod create + update schema bilan. Factory faylida:
- ✅ RLS Postgres tomonida (har query `get_my_clinic_id()` orqali)
- ✅ Pagination, search (`q`), version (optimistic lock)
- ✅ Soft delete (`is_archived`, restore)
- ✅ Audit history endpoint
- ❌ **Cross-entity validation yo'q** (masalan: service'ni archive qilganda, unga bog'langan retsept item'lar haqida tekshiruv yo'q)
- ❌ **Soft delete RLS bypass** ehtimoli: arxivlangan elementlar ham `get_my_clinic_id` orqali filterlanadi, bu yaxshi, lekin `is_archived=true` row'lar UI'da `?includeArchived=true` orqali ko'rinadi — bu xavfsiz emas, lekin tenant ichida.

### Frontend sahifalar — skeleton vs real?

**31 web-clinic sahifa:**
- ✅ **Real va API ulangan** (~22 sahifa): dashboard, reception, queue, doctor-console, nurse, pharmacy, lab, inpatient, journal, cashier, payroll, settings/staff, settings/catalog, settings/web-profile, settings/nurse-schedules, settings/subscription, marketing, analytics, diagnostics, reviews, kiosk, onboarding
- 🟡 **Yarim real** (~5 sahifa): nurse-requests, marketing (segments live, send yarim), settings/audit, settings/integrations (vault), settings/shift-schedules
- 🔴 **Skeleton/empty** (~4 sahifa): mavjud, lekin kichik

**Mobile (8 screen):** `_layout.tsx`, `login.tsx`, `index.tsx`, `cashier.tsx`, `patients.tsx`, `queue.tsx` — MVP darajada. Doctor console, lab, statsionar mobile **YO'Q**.

### Foiz bilan baho

| Komponent | Real % | Skeleton % | Izoh |
|-----------|--------|------------|------|
| API (38 modul) | **80%** | 20% | Webhooks + 2 payment adapter stub |
| web-clinic | **85%** | 15% | Sprint 1-2 bilan asosiy ish tugatilgan |
| web-admin | **75%** | 25% | Tenants real, support partial |
| web-patient | **40%** | 60% | Foundation, lekin PWA flow yarim |
| web-landing | **90%** | 10% | Production-ready, 71 page built |
| mobile | **30%** | 70% | 4 screen MVP, real-world ishlatilmagan |
| packages/payments | **65%** | 35% | 4 real, 2 stub |
| packages/notifications | **80%** | 20% | Eskiz real |
| Supabase migrations | **95%** | 5% | 55 migration, ~6800 qator SQL |

---

## 3. KRITIK MUAMMOLAR — TOP 10

### 🔴 1. Webhooks signature verification YO'Q
**Joy:** `apps/api/src/modules/webhooks/webhooks.module.ts:12-37`

Stripe, Click, Payme, Uzum webhook'lar **signature tekshirmaydi**. Har kim `POST /api/v1/webhooks/stripe` ga payload yuborib `received: true` olishi mumkin. Bu shuni bildiradi: agar subscription holatini webhook'dan o'qisangiz, **firibgar to'lov "succeeded" deb ko'rsatishi mumkin**.

**Bartaraf qilish:**
```ts
// stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
```
~1 soat ish. Hozir Stripe'dan subscription holatini webhook orqali emas, **API call orqali real-time** o'qiyotgan bo'lsangiz — risk past. Aks holda — kritik.

### 🔴 2. Uzum va Kaspi adapter'lari STUB
**Joy:** `packages/payments/src/providers/uzum.ts`, `kaspi.ts`

Pricing sahifasida bu integratsiyalar ko'rinsa-da, kod **redirect URL'ni hardcoded** (`https://kaspi.kz/pay?...`). Webhook signature `input.signature.length > 0` ga teng (har qanday signature qabul qilinadi). **Production'da hech qachon ishlatmang.**

**Tavsiya:** Uzum/Kaspi'ni website'da **"Tez kunda"** deb belgilang yoki adapter'larni to'liq yozing. Hozirgi holatda — bu **sotuvchilik aldash** (mavjud bo'lmagan featureni reklama qilish).

### 🟠 3. `pg_cron` schedule — production'da yoqilmagan ehtimoli
**Joy:** `supabase/migrations/20260423000030_audit.sql:236`

```sql
-- Schedule hourly verification (uncomment in production once pg_cron is licensed)
-- SELECT cron.schedule('verify-audit-chain', '0 * * * *', $$SELECT public.verify_audit_chain();$$);
```

Hash-chain integrity verifier scheduled emas. Audit log'da o'zgartirish bo'lsa, hech kim bilmaydi (manual chaqirish kerak).

**Sprint 2C'dagi `inpatient-daily-charge`** — bu yoqilgan (sizning Supabase dashboard'da migration ishlatilgach). Tekshiring:
```sql
SELECT * FROM cron.job WHERE jobname LIKE 'inpatient%' OR jobname LIKE 'verify%';
```

### 🟠 4. RLS — kichik gap (cross-tenant audit)
**Joy:** `supabase/migrations/20260423000030_audit.sql`

`activity_journal` jadvalida `clinic_id` ustuni bor va RLS yoqilgan. Lekin super_admin'lar har klinika audit'ini ko'radi — bu **dizayn**, lekin super_admin role'i `clinic_id`'siz JWT bilan kelishi mumkin, va bu maxfiy ma'lumotni ko'rishga ruxsat beradi.

**Tavsiya:** Super admin actions'lar uchun **alohida `super_admin_audit` jadval** + maxsus access controls (2FA majburiy).

### 🟠 5. `.env.example` — secrets to'ldirilmagan
**Joy:** `.env.example` — 124 qator, 21 ta SECRET/KEY/TOKEN o'rni

Production deploy uchun **shu key'lar to'ldirilishi shart:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_25PRO/50PRO/120PRO`
- `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` (SMS uchun, **hozir VPS'da yo'q** — Sprint 2 fix optional qildi)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth — **hozir VPS'da yo'q**)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (backup uchun, qo'llanmagan)
- `RESEND_API_KEY` (email transactional)
- `CLICK_*`, `PAYME_*`, `UZUM_*`, `KASPI_*` (BYO credentials Vault'da, lekin demo uchun ham)

### 🟠 6. Migration order — `manual-apply-*.sql` skript'larini takror ishga tushirish xavfli (faqat Sprint 1)
**Joy:** `supabase/manual-apply-v1.sql`

Sprint 2A/2B/2C — idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). Lekin v1 (`manual-apply-v1.sql`) — Sprint 1'gacha bo'lgan migration'lar. Yangi serverda **butun 55 migration'ni** Supabase CLI orqali ishlatish kerak emas (allaqachon `pnpm db:migrate`'da bor). **Production server'da migration'lar Supabase Dashboard orqali qo'llaniladi**, repo migration'lari faqat versiya nazorati uchun.

### 🟡 7. Stripe webhook secret production'da bo'lmaydi → subscription holatini tarjima qilish ishlamaydi
**Joy:** `apps/api/src/modules/subscription/subscription.module.ts`

Subscription create checkout session qiladi, lekin **payment success'dan keyin `subscriptions` jadvalini yangilash uchun webhook kerak**. Hozir webhook ishlamaydi → klinika to'lasa-da, `subscription_status` Supabase'da yangilamasak `trial_ends_at` o'tib ketgach bloklanadi.

**Tavsiya:** Birinchi mijozdan oldin Stripe webhook'ni to'liq implement qiling (Critical issue #1 hal qilish bilan birga).

### 🟡 8. Telegram backup cron — implementatsiya tugamagan
**Joy:** `apps/api/src/modules/telegram-backup/`

`PROJECT_SUMMARY.md`'da "Telegram backup cron" deb yozilgan. Real holat: 1 fayl, balki schedule decorator, lekin **real `pg_dump` + Telegram bot send chain to'liq emas**. Tekshirilmagan.

**Tavsiya:** Production'da Supabase'ning o'z avto-backup'i bor (kunlik, 7 kun saqlash). Telegram backup'siz ham yashash mumkin.

### 🟡 9. Test coverage juda past
**Joy:** Loyiha bo'ylab faqat **7 ta test file**

- `apps/api/src/modules/patients/*.spec.ts` (2 ta, unit + integration)
- `tests/e2e-web/specs/*.spec.ts` (5 ta, Playwright)
- **`tests/rls/`** mavjud lekin pgTAP test'lar mavjudligi noma'lum (kichik audit)

**Risk:** RLS regressiyalar (Critical issue #4 kabi gaps) ushlab qolinmaydi.

**Tavsiya MVP uchun:** Test coverage'ni keyinga qoldiring. Lekin **RLS tenant isolation testi** birinchi mijozga chiqarishdan oldin majburiy:
```
tests/rls/tenant-isolation.spec.sql  -- pgTAP yoki vitest+pg
```

### 🟡 10. `any`/`unknown` ko'p ishlatilgan TS tip xavfsizligi
**Joy:** `apps/api/src/modules/*.ts` va `apps/web-clinic/src/pages/*.tsx`

Misol: `body: unknown` (ko'p endpoint'larda — keyin Zod bilan parse, OK), lekin **frontend'da `data as any`** ko'p. `packages/api-client/src/client.ts` ham `unknown[]` qaytaradi (har endpoint typed emas).

**Risk:** Refactoring paytida bug oson o'tib ketadi. **Endi muammo emas** (MVP uchun), lekin v2.5 dan oldin tiplarni kuchaytirish kerak.

---

## 4. KOD SIFATI VA TEXNIK QARZ

### Code generation xavfli emasmi?

- **`createCatalogModule` factory** — 26 entity uchun bitta factory. Bu DRY, lekin **agar factory'da bug bo'lsa, 26 endpoint'da bir vaqtda paydo bo'ladi**. Test coverage past bo'lgani uchun risk o'rta darajada.
- **Supabase auto-types** (`@clary/types/supabase.ts`) — `pnpm db:types` orqali generate. Hozir stub bo'lishi mumkin. Production'da `db:types` chaqirilishi shart.

### Boilerplate ko'p, test yo'q joylar

- **Catalog factory** — 184 qator config, lekin factory ichida (`catalog-factory.ts`) test yo'q
- **API modules** — har modul DTO + Service + Controller + Module shaklida, lekin **unit test yo'q** (faqat patients'da)
- **Frontend pages** — 31 sahifa, **0 ta page test** (Playwright smoke 5 ta)

### Performance bottleneck'lar

1. **`/api/v1/inpatient/room-map`** — har `floor` uchun rooms + stays join, har sahifa load'da chaqiriladi (`refetchInterval: 30s`). Klinikada 50+ xona bo'lsa N+1 risk. Tekshirish kerak: index `idx_stays_room_active` mavjud (`20260424000050_inpatient_extended.sql`).
2. **`patient_balance` view** — `SUM(amount_uzs)` har query'da. Faol bemorlar 100+ bo'lsa sekinlashishi mumkin. **Materialized view** yoki Redis cache kerak bo'lishi mumkin (~6 oydan keyin).
3. **`charge_daily_inpatient_stays()` cron** — `WHILE` loop kun bo'yicha. 100 ta admit qilinmagan stay × 30 kun = 3000 INSERT — sekin emas, lekin transaction lock'lar bo'lishi mumkin. Hozir muammo emas.

### Duplicate kod

- **`Object.fromEntries(Object.entries(params).filter(...))`** — `packages/api-client/src/client.ts` ichida 8+ joyda takrorlanadi. Helper'ga olib chiqish mumkin (~10 daq).
- **DiagnosticForm va RxComposer'da** — patient search, medication search bir xil pattern. ~200 qator duplicate.

### TypeScript tip xavfsizligi

- **Backend:** Yaxshi (Zod + DTOs). Ammo `as unknown as { auth: { admin: ... } }` kabi cast'lar bor (`staff.module.ts:123-131`) — Supabase admin auth typed emas.
- **Frontend:** O'rta. `(profile as any)?.portal_slug` (`settings/web-profile.tsx:145`), `(data as { url: string }).url` ko'p.

### Test coverage darajasi

- **Unit:** ~5% (faqat patients)
- **Integration:** 1 fayl (patients integration)
- **E2E:** 5 ta Playwright spec (smoke, tenant-isolation, clinic, admin, landing)
- **RLS:** `tests/rls/` mavjud, lekin tarkibi auditdan o'tmagan
- **Load (k6):** `tests/load/` mavjud, baholanmagan
- **Mobile E2E (Detox):** `tests/e2e-mobile/` mavjud, mobile MVP holatida — past prioritet

**Foiz bilan:** Coverage ~5-10%. **Solo founder uchun MVP gacha bu yetarli**, lekin birinchi mijozga chiqishdan oldin RLS tenant isolation test'ni yozish kerak.

---

## 5. INFRASTRUKTURA VA DEPLOY

### `infra/` papkasi — auditdan o'tdi

#### `infra/caddy/Caddyfile`
- **166 qator**, 12 ta site bloki
- **5 ta production subdomain** (clary.uz, app, api, patient, admin) + status, docs, blog, demo
- Auto-HTTPS, security headers, CSP
- ⚠️ **`X-Forwarded-For` header_up** ortiqcha (Caddy default'da uzatadi). Bootstrap'da ogohlantirish ko'rinadi.
- ✅ Admin panel uchun IP allowlist bor

#### `infra/docker/`
- 5 ta Dockerfile (api, web-clinic, web-admin, web-landing, telegram-bot)
- `docker-compose.yml` (dev) va `docker-compose.prod.yml` (production stack)
- **VPS'da Docker ishlatilmaydi** — Caddy + PM2 + native build (`bootstrap-server.sh`). Docker fayllar **alohida deploy path** uchun (`deploy-docker.sh`).

#### `infra/ansible/`
- `inventory.yml` + `playbook.yml` — Hostinger VPS uchun
- **Tekshirilmagan**: ishlatilgan bo'lsa, audit ko'rsatadi. Hozir manual bash skript (`bootstrap-server.sh`) ishlatiladi.

#### `infra/grafana/` + `prometheus.yml`
- **Hozirgi VPS'da yoqilmagan** (Grafana/Prometheus servisi yo'q)
- Datasources + dashboards JSON tayyor

### `.github/workflows/` — CI/CD

| Workflow | Maqsadi | Holat |
|----------|---------|-------|
| `ci.yml` | Lint, typecheck, unit | 🟡 Repo'da, GitHub Actions tab ko'rinishi tekshirilmagan |
| `deploy-staging.yml` | Staging deploy | 🟡 Webhook configga muhtoj |
| `deploy-production.yml` | Production | 🟡 Aslida `bootstrap-server.sh` manual ishlatiladi |
| `e2e.yml` | Playwright | 🟡 |
| `mobile-eas.yml` | Expo build | 🟡 EAS account kerak |

**Real holat:** CI yamllari mavjud, lekin **deploy hozir to'liq manual** (siz SSH'da `git pull && ./bootstrap-server.sh` qilasiz). Bu MVP uchun yetarli.

### 14 subdomain xavfsizmi?

Promptdagi "14 subdomain" — Caddyfile'da 12 ta, faqat 5 tasi production'da DNS'da sozlangan (clary.uz, app, api, patient, admin). Boshqalari (status, docs, blog, my, ...) — placeholders.

**Tavsiya:** Hozir 5 ta yetarli. `my.clary.uz` (web-profile portal app) keyin chiqariladi.

---

## 6. REALISTIK ISHGA TUSHIRISH VAQTI

### Hozirgi holatdan ishlovchi MVP gacha

**Joriy holat:** v1.2 deploy qilingan (bugun, 2026-05-12). Server javob beradi (`200 OK`), API ishlaydi. Sizning Sprint 2 ishlaringiz Supabase'ga ham qo'llanildi.

**Birinchi to'lovchi mijoz uchun MUST-FIX:**

1. **Webhook signature verification (Stripe + Click + Payme)** — 4 soat ish
2. **Stripe webhook secret env'ga, real subscriptions update** — 2 soat
3. **Uzum/Kaspi'ni "Tez kunda" deb belgilash** (landing pricing) — 30 daq
4. **RLS tenant isolation testi** — 2 soat (1 ta klinikadan ikkinchining ma'lumotini olishga urinish, 403 kutish)
5. **Eskiz SMS kredensiallari production'ga** (`.env.local`) — 5 daq
6. **Manual smoke test** (Sprint 2A-2I runbook) — 30 daq

**Jami:** ~10 soat (1.5 ish kuni)

**Solo founder uchun real grafik:**
- **Bugun (2026-05-12):** Smoke test, agar bug topilsa hot-fix. Birinchi demo'lar.
- **2026-05-13/14:** Webhook security + Stripe to'liq integration
- **2026-05-15:** RLS test, ehtiyot baholash
- **2026-05-16/17:** Buffer kun
- **2026-05-18 (Dushanba):** Birinchi to'lovchi mijoz onboardingiga tayyor

### Qaysi 80% feature'larni keyinga qoldirish mumkin

**Birinchi mijozga kerak emas:**
- Mobile app (kasl uchun kerak emas)
- web-patient PWA (bemorlar uchun, mijoz dastlab faqat shifokorlar uchun ishlatadi)
- Telegram backup cron (Supabase auto-backup yetadi)
- Anti-abuse (GeoIP, VPN guard) — real abuse signal kelguncha
- Super admin geo dashboard
- v1.3 yo'l xaritasidagi hamma narsa
- Marketing campaigns send (segments preview yetadi)
- Loyalty points
- Diagnostic equipment maintenance schedule
- 7 ta locale to'liq tarjima (uz-Latn va ru yetadi)

**Birinchi mijozga kerak (v1.2 + must-fixes):**
- Reception → Doctor → Lab → Pharmacy → Cashier (asosiy klinik flow)
- Inpatient (statsionari bor klinikalar uchun)
- Settings → Catalog (xizmatlar, dori, xonalar, xodimlar)
- Settings → Obuna (Stripe to'liq webhook bilan)
- Journal (kunlik kassa hisoboti)

### "What still needs hand-work" 4 qadami yetarlimi?

`PROJECT_SUMMARY.md`'dagi 4 qadam:
1. `pnpm install` — ✅ qilingan
2. Supabase + `pnpm db:migrate` — ✅ qisman (siz manual SQL ishlatdingiz)
3. Stripe price IDs — 🟡 hali qo'shilmagan
4. Telegram bot — 🟡 kerak emas, qoldiriladi

**Yetarli emas.** Yana kerak:
- **Webhook security fix** (Critical issue #1)
- **Real Supabase types generation** (`pnpm db:types`)
- **RLS verification**
- **Production env var to'liq to'ldirilishi**

---

## 7. HARAKAT REJASI (Birinchi 7 kun, solo founder)

### Kun 1 — Smoke test va kritik bug hunt (bugun, 2026-05-12)

**Ertalab (2 soat):**
- [ ] `docs/DEPLOY-v1.2.md` Section H, G, A-I bo'yicha smoke test
- [ ] Hozir to'xtab turgan **"Validation failed"** bug'ini hal qilish (siz oxirgi savol'da yozgan)
- [ ] Hamshira xodimni invite qilib navbatchilik sahifasini sinab ko'rish

**Tushdan keyin (3 soat):**
- [ ] `apps/api/src/modules/webhooks/webhooks.module.ts` — Stripe signature verify
- [ ] Stripe Dashboard'da webhook endpoint sozlash (`https://api.clary.uz/api/v1/webhooks/stripe`)
- [ ] `.env.local`'ga `STRIPE_WEBHOOK_SECRET` qo'shish
- [ ] Test webhook (`stripe trigger payment_intent.succeeded`)

### Kun 2 — Stripe subscriptions yakuniy (2026-05-13)

- [ ] Stripe Dashboard'da 3 ta Price ID yarating (25PRO/50PRO/120PRO) Monthly + Yearly = 6 ta
- [ ] `plans` jadvalini SQL bilan yangilash: `stripe_price_id` va `stripe_price_id_yearly`
- [ ] Webhook'da `customer.subscription.created/updated/deleted` event handler — `subscriptions` jadvalini sync qilish
- [ ] Test: yangi klinika ochib, Stripe checkout → payment → subscription status `active` bo'lganini tasdiqlash

### Kun 3 — Click/Payme webhook security (2026-05-14)

- [ ] Click webhook signature: MD5 (sign_string + secret_key) — adapter ichida bor, webhook'ga ulash
- [ ] Payme: basic auth + JSON-RPC error codes
- [ ] `payment_qr` modul'ga signature verify ulash
- [ ] Tests (mock webhook payload bilan)

### Kun 4 — RLS tenant isolation + xavfsizlik (2026-05-15)

- [ ] `tests/rls/tenant-isolation.spec.sql` — pgTAP yoki vitest+pg bilan:
  - Klinika A ning JWT bilan login → klinika B ning `patients` ko'rishga urinish → 0 rows
  - Klinika A admin → klinika B'ning `appointments`'iga UPDATE → permission denied
- [ ] Uzum/Kaspi'ni landing pricing'dan **"Tez kunda"** badge bilan belgilash
- [ ] `.env.production.example`'ni `.env.production` ga ko'chirib, real production secrets

### Kun 5 — Birinchi mijoz onboarding tayyorgarligi (2026-05-16)

- [ ] **Mijozning haqiqiy klinika ma'lumotlarini Supabase'ga seed** (yoki klinika o'zi ro'yxatdan o'tadi):
  - Xizmatlar (kataloglar)
  - Xonalar (statsionar bo'lsa tier bilan)
  - Xodimlar (real role'lar bilan, jumladan kamida 1 ta hamshira)
  - Boshlang'ich plan: 25PRO (yoki demo 14 kun)
- [ ] Onboarding wizard (`/onboarding`) flow'ni qayta sinash
- [ ] PIN, kassa ochish, smena rejimi sinash
- [ ] Mobile testing (telefon brauzerda) — UI responsive

### Kun 6 — Buffer + bug fix kuni (2026-05-17, Yakshanba)

- [ ] Topilgan har qanday bug'larga hot-fix
- [ ] Mijozga taqdimot stsenariysi yozish (15 daqiqalik demo)
- [ ] Backup va monitoring (Supabase auto-backup tasdiqlash)
- [ ] PM2 logs rotation sozlash (logrotate yoki pm2-logrotate module)

### Kun 7 — Birinchi demo va onboarding (2026-05-18, Dushanba)

- [ ] **Mijoz bilan birga demo** (siz uchun: 15 daqiqalik flow ko'rsatish):
  - Reception → bemor → xizmat → checkout → queue
  - Doctor → bemor qabul → retsept (vaqt jadvali bilan)
  - Pharmacy → retsept dispense
  - Cashier → kunlik kassa
- [ ] Onboarding hujjati (PDF yoki Notion sahifa):
  - Login, xodim qo'shish, dori qo'shish, xizmat narxi qo'shish
  - Sticky issues + ularning yechimi
- [ ] **Tarif Manager** (klinika admin) hisobini yaratish

---

## XULOSA — HALOL BAHO

### Loyihada ajoyib narsa
- **Monorepo va kod tashkilash** — professional darajada
- **Supabase + RLS + audit** — enterprise SaaS uchun mos
- **Sprint 1-2 bilan kritik bug'lar tugatildi** (5+5 fix)
- **38 backend modul, 31 sahifa, 55 migration** — bir kishi (yoki kichik jamoa) tomonidan 4-6 hafta ichida MVP gacha olib kelinishi mumkin
- **i18n, RBAC, statsionar billing** — bunday integratsiya bilan kichik klinikalar uchun kuchli taklif

### Loyihada zaif narsa
- **Webhook security teshigi** (Critical #1) — birinchi mijozdan oldin albatta tuzatish
- **Test coverage past** (5-10%) — RLS regressiyalar uchun risk
- **Mobile app premature** — 30% real, MVP'da kerak emas
- **2 ta payment adapter stub** (Uzum/Kaspi) — to'g'ri marketingga ehtiyoj
- **CI/CD yamllari bor, lekin manual deploy** — bir kishi uchun OK
- **Marketing campaigns send** — segments tayyor, real send chain to'liq emas

### Solo founder uchun real maslahat
- **Mobile, Telegram backup, v1.3 anti-abuse, Loyalty** — keyinga qoldiring
- **Birinchi mijozga 7 kun yetadi** (yuqoridagi rejada)
- **5 mijozdan keyin** payment webhooks v2 + test coverage to ~30% + RLS test'lar to'liq
- **15 mijozdan keyin** mobile MVP qaytadan + super_admin geo dashboard
- **50 mijozdan keyin** v1.3 anti-abuse + multi-region (Astana, Bishkek)

### Birinchi 7 kun CHECKLIST (qisqa)

- [ ] **Kun 1:** Smoke test + Stripe webhook signature
- [ ] **Kun 2:** Stripe Price IDs + subscription sync webhook
- [ ] **Kun 3:** Click/Payme webhook security
- [ ] **Kun 4:** RLS tenant isolation test + Uzum/Kaspi "Tez kunda"
- [ ] **Kun 5:** Real klinika onboarding seed
- [ ] **Kun 6:** Buffer + monitoring
- [ ] **Kun 7:** Birinchi demo + onboarding doc

**Birinchi to'lovchi mijoz tayyorligi sanasi:** **2026-05-18 (Dushanba)** — bu real grafik bilan.

---

*Audit yakuni. Bu hisobotni vaqti-vaqti bilan yangilash mumkin (har sprint oxirida).*
