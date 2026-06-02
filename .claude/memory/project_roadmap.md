---
name: CLARY CARE — Qolgan ishlar yo'l xaritasi
description: Barcha keyingi sessiyalar uchun to'liq roadmap: Admin, Landing, Clinic UX, KMP Mobile
type: project
originSessionId: e9fe43ce-71e4-4b2c-90ce-b8646e06e3d7
---
## Holat (2026-05-03)
**Bosqich 1 (Admin)**: ✅ TUGALLANGAN — `e6a9503`
**Bosqich 2 (Landing)**: ✅ 2.1-2.4 tugadi — `3990af2`, `07fc24e`. 2.5 (About/Career/Contact) ixtiyoriy.
**Bosqich 3 (Clinic UX)**: ✅ TUGALLANGAN — `a5441f6`, `eca1f34`, `14c1d97`, `2258cdf`, `b8fe3ce`, `41ffb33`
  - 3.1 Sidebar grouping + ⌘K, 3.2 Dashboard AI summary, 3.3 Hamshira so'rovlari, 3.4 Sharhlar, 3.5 Web profile (gallery+SEO), 3.6 Mobile bottom nav
**Bosqich 4 (KMP Mobile)**: ❌ Boshlanmagan — chatda emas, Android Studio + Xcode kerak (14 sessiya)
**Bosqich 5 (Google Auth)**: ❌ Web tomon Supabase Console'da Google provider yoqilishi kerak; UI button qo'shish kichik ish
**Bosqich 6 (Production)**: ❌ CI/CD workflow + TestFlight + Play Store + Sentry

## Bosqich 1 — Admin paneli to'ldirish (~5 sessiya)
1. **NotificationsLog** `/admin/notifications` — SMS/email jurnal, filter, re-send, CSV export
2. **Database Insights** `/admin/database` — jadval o'lchamlari, index stats, sekin queries, backup holat
3. **Webhook Delivery Log** `/admin/webhooks` — retry queue, manual retry, failed alerts
4. **API Usage Analytics** `/admin/api-usage` — top endpoints, javob vaqti, rate limit hits
5. **Background Jobs Monitor** `/admin/jobs` — BullMQ, worker holat, failed jobs

## Bosqich 2 — Landing redesign (clary.uz) (~4 sessiya)
1. Hero + asosiy sahifa (animatsiya, video demo, role-based CTA)
2. Bemorlar sahifasi (app download, sharhlar, FAQ)
3. Klinikalar sahifasi (pricing, demo zakaz, success stories)
4. Hamshiralar + About/Career/Contact

## Bosqich 3 — Clinic web UX overhaul (~6.5 sessiya)
1. Sidebar redesign (grouping, ⌘K palette, tor/keng rejim)
2. Dashboard yangilash (AI summary, real-time KPI)
3. Hamshira so'rovlari sahifasi
4. Sharhlar boshqaruvi
5. Web profile editor (SEO, galereya, preview)
6. Mobile responsive + PWA
7. Keyboard shortcuts kuchaytirish

## Bosqich 4 — KMP Mobile (~14 sessiya)
Stack: Kotlin 2.0 + Compose Multiplatform 1.7+, Ktor, SQLDelight, Voyager, Koin, Material 3

1. Loyiha setup (composeApp, iosApp, shared)
2. Brand/theme (tokens.json → Color.kt, Typography.kt)
3. Auth: Splash → Role selector → SMS OTP → Onboarding
4. **Bemor flow**: Bosh sahifa → Klinikalar (xarita) → Navbat → Hamshira chaqirish → Chat/status
5. **Hamshira flow**: Google Sign-In → Klinika ariza → Vazifalar → Bajarish flow
6. Push notifications (FCM), Offline cache (SQLDelight), Maps, Kamera/galereya

## Bosqich 5 — Google Auth (~1 sessiya)
My ID o'rniga Google OAuth: web (Supabase Auth Google provider), mobile KMP (Google Sign-In SDK), portal_users mapping. My ID rejasi bekor qilindi.

## Bosqich 6 — Production launch (~3 sessiya)
CI/CD (GitHub Actions), TestFlight/Play Store beta, Store listings, Sentry/PostHog

## Tavsiya etilgan tartib
| Hafta | Ish |
|-------|-----|
| 1 | Admin 1.1–1.3 (3 sessiya) |
| 2 | Landing 2.1–2.3 (3 sessiya) |
| 3–4 | KMP setup + Bemor flow asoslari |
| 5–7 | Bemor + Hamshira flow |
| 8 | Push, offline, maps |
| 9–10 | Beta + Production |

**Why:** Roadmap faqat suhbat kontekstida emas, keyingi sessiyalarda ham esda tursin.
**How to apply:** Har sessiya boshida shu faylni o'qib, qaysi bosqichda ekanligini aniqlash.
