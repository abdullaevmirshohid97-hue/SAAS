-- =============================================================================
-- Clary v2 — Migration 001110: Expand site_entries.kind for landing pages
-- Adds: post (blog), doc, changelog, usecase, feature_detail
-- =============================================================================

ALTER TABLE site_entries DROP CONSTRAINT IF EXISTS site_entries_kind_check;

ALTER TABLE site_entries ADD CONSTRAINT site_entries_kind_check CHECK (
  kind IN (
    'hero', 'section', 'feature', 'testimonial', 'faq', 'plan',
    'media', 'seo', 'config', 'block',
    'post', 'doc', 'changelog', 'usecase', 'feature_detail',
    'download'
  )
);

-- Seed minimal blog/docs/changelog content so landing pages aren't empty
INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('post.welcome-clary-v2', 'post',
   '{"uz-Latn": {"title": "Clary v2 ishga tushdi", "excerpt": "7 til, multi-tenant, BYO to''lov tizimi va to''liq diagnostika moduli.", "body": "Clary v2 — O''zbekiston va MDH klinikalari uchun yaratilgan zamonaviy SaaS yechim. Bu versiya bilan biz dental modul, bemor mobil ilovasi va MBank integratsiyasini taqdim etmoqdamiz.", "author": "Clary jamoasi", "date": "2026-04-24", "tag": "Yangiliklar"}}'::jsonb,
   '{"slug": "welcome-clary-v2", "cover": null, "reading_min": 4}'::jsonb,
   'published', now(), 10),
  ('post.byo-payment-explained', 'post',
   '{"uz-Latn": {"title": "BYO to''lov tizimi: pul to''g''ridan-to''g''ri sizning hisobingizga", "excerpt": "Click, Payme, Uzum, MBank — o''z API kalitlaringiz bilan ulang.", "body": "Clary biron-bir to''lov tizimi bilan ekskluziv shartnoma tuzmaydi. Siz o''zingiz tanlagan provayder bilan ishlaysiz va pul bevosita sizning hisobingizga keladi.", "author": "Clary jamoasi", "date": "2026-04-22", "tag": "Texnologiya"}}'::jsonb,
   '{"slug": "byo-payment-explained", "reading_min": 6}'::jsonb,
   'published', now(), 20),
  ('post.dental-module-launch', 'post',
   '{"uz-Latn": {"title": "Stomatologlar uchun maxsus modul", "excerpt": "FDI 32 tish chizmasi, davolash rejasi va periodontogramma.", "body": "Stomatologiya klinikalari endi Clary ichida to''liq ish jarayonini olib borishi mumkin: tish chizmasi, davolash rejalari, narxlar va sug''urta integratsiyasi.", "author": "Mahsulot jamoasi", "date": "2026-04-20", "tag": "Mahsulot"}}'::jsonb,
   '{"slug": "dental-module-launch", "reading_min": 5}'::jsonb,
   'published', now(), 30)
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('doc.getting-started', 'doc',
   '{"uz-Latn": {"title": "Boshlash", "excerpt": "Ro''yxatdan o''ting va 5 daqiqada birinchi qabulingizni oching.", "body": "1) Ro''yxatdan o''ting (Gmail yoki email).\n2) Klinika nomi va manzilini kiriting.\n3) Birinchi xizmatingizni qo''shing.\n4) Birinchi bemoringizni qo''shing va qabulga yozing.\nDemo 14 kun bepul, kredit karta talab qilinmaydi.", "section": "Asosiy"}}'::jsonb,
   '{"slug": "getting-started", "order": 1}'::jsonb,
   'published', now(), 10),
  ('doc.staff-rbac', 'doc',
   '{"uz-Latn": {"title": "Xodimlar va RBAC", "excerpt": "Rollar, ruxsatlar va invitatsiyalarni qanday boshqarish.", "body": "Clary granular RBAC bilan ta''minlangan: 60+ ruxsat kalitlari, 8 ta tayyor rol va cheksiz maxsus rollar. Har bir kabinet ruxsatlari Sozlamalar > Xodimlar bo''limida sozlanadi.", "section": "Boshqaruv"}}'::jsonb,
   '{"slug": "staff-rbac", "order": 2}'::jsonb,
   'published', now(), 20),
  ('doc.payments-setup', 'doc',
   '{"uz-Latn": {"title": "To''lov tizimlarini ulash", "excerpt": "Click, Payme, Uzum, MBank uchun BYO sozlamalari.", "body": "Sozlamalar > Integratsiyalar bo''limidan kerakli provayderni tanlang va o''z API kalitlaringizni kiriting. Test rejimi har bir provayder uchun mavjud.", "section": "Integratsiyalar"}}'::jsonb,
   '{"slug": "payments-setup", "order": 3}'::jsonb,
   'published', now(), 30),
  ('doc.backup-recovery', 'doc',
   '{"uz-Latn": {"title": "Backup va tiklash", "excerpt": "Kunlik avtomatik backup va Telegram orqali xabar berish.", "body": "Har kuni soat 02:00 da tizim avtomatik backup yaratadi. Xulosa Telegram bot orqali yuboriladi. Tiklash zarur bo''lsa, qo''llab-quvvatlash bilan bog''laning.", "section": "Xavfsizlik"}}'::jsonb,
   '{"slug": "backup-recovery", "order": 4}'::jsonb,
   'published', now(), 40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('changelog.v2.0.0', 'changelog',
   '{"uz-Latn": {"title": "v2.0.0 — Greenfield ishga tushdi", "body": "• Multi-tenant arxitektura (RLS + JWT + Tenant Guard)\n• 12+ asosiy modul: Reception, Queue, Doctor, Pharmacy, Lab, Diagnostics, Cashier, Marketing, Payroll\n• 7 til qo''llab-quvvatlash\n• BYO to''lov: Click, Payme, Uzum, MBank, Humo, Uzcard, Stripe\n• Bemor mobil ilovasi (PWA)\n• Stomatologiya moduli", "date": "2026-04-24"}}'::jsonb,
   '{"version": "2.0.0", "highlights": ["dental", "patient_app", "mbank"]}'::jsonb,
   'published', now(), 100),
  ('changelog.v1.9.0', 'changelog',
   '{"uz-Latn": {"title": "v1.9.0 — Marketing 2.0 va Payroll", "body": "• Drip kampaniyalar va segmentlar\n• Doctor commission accrual va to''lovlar\n• Loyalty/NPS\n• Click va Payme QR (merchant + customer)", "date": "2026-04-15"}}'::jsonb,
   '{"version": "1.9.0"}'::jsonb,
   'published', now(), 90)
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('usecase.private-clinic', 'usecase',
   '{"uz-Latn": {"title": "Xususiy klinika", "excerpt": "5–25 xodim, ko''p shifokorli, oilaviy klinika uchun.", "body": "Reception, qabul navbati, kassa, bemor bazasi va marketing — bitta dashboardda. Excel va qog''ozdan voz keching."}}'::jsonb,
   '{"slug": "private-clinic", "icon": "🏥"}'::jsonb,
   'published', now(), 10),
  ('usecase.dental', 'usecase',
   '{"uz-Latn": {"title": "Stomatologiya", "excerpt": "Tish chizmasi, davolash rejasi, sug''urta.", "body": "FDI 32 tooth chart bilan tish holatini saqlang, davolash rejasini bosqichlarga bo''ling va bemorga qulay shartnoma taqdim eting."}}'::jsonb,
   '{"slug": "dental", "icon": "🦷"}'::jsonb,
   'published', now(), 20),
  ('usecase.diagnostics', 'usecase',
   '{"uz-Latn": {"title": "Diagnostika markazi", "excerpt": "X-Ray, CT, MRI, USG, ECG va boshqa.", "body": "Aparatlar jadvalini boshqaring, natijalarni bemorga DICOM havolasi bilan yuboring va ish yukini real vaqtda kuzating."}}'::jsonb,
   '{"slug": "diagnostics", "icon": "🔬"}'::jsonb,
   'published', now(), 30),
  ('usecase.lab', 'usecase',
   '{"uz-Latn": {"title": "Laboratoriya", "excerpt": "Tahlil buyurtmalari, namuna olish, natijalar.", "body": "State machine bilan har bir tahlil bosqichini kuzating, SMS orqali natija yuboring va norma qiymatlari bilan taqqoslang."}}'::jsonb,
   '{"slug": "lab", "icon": "🧪"}'::jsonb,
   'published', now(), 40),
  ('usecase.home-nurse', 'usecase',
   '{"uz-Latn": {"title": "Uyga hamshira xizmati", "excerpt": "Bemor ilovasidan buyurtma, hamshira uchun marshrut.", "body": "Bemor uy manzilini ko''rsatadi, eng yaqin klinika hamshirasi avtomatik tayinlanadi. Soddalashtirilgan hisob-kitob."}}'::jsonb,
   '{"slug": "home-nurse", "icon": "🏠"}'::jsonb,
   'published', now(), 50)
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('feature_detail.reception', 'feature_detail',
   '{"uz-Latn": {"title": "Resepshn", "subtitle": "Bemor qabuli, navbat va to''lov bir oynada", "body": "Reception moduli klinikangizning birinchi nuqtasi. Yangi bemorni 30 soniyada ro''yxatdan o''tkazing, qabulga yozing, navbatni boshqaring va to''lovni qabul qiling — barchasi bir interfeysda. QR kod orqali Click va Payme to''lovlari, kalit kombinatsiyalari, real-time navbat ko''rsatkichi va mijoz hamyoni qo''llab-quvvatlanadi.", "bullets": "Tezkor ro''yxatdan o''tkazish • QR to''lov • Mijoz hamyoni • Kalit kombinatsiyalari"}}'::jsonb,
   '{"slug": "reception", "icon": "📋", "screenshot": null}'::jsonb,
   'published', now(), 10),
  ('feature_detail.queue', 'feature_detail',
   '{"uz-Latn": {"title": "Navbat", "subtitle": "Real-time navbat va kiosk", "body": "Bemorlar real vaqtda o''z navbatini ko''radi, kiosk ekrani avtomatik yangilanadi va shifokor o''z konsolida keyingi bemorni tanlaydi. SMS va Telegram orqali eslatmalar avtomatik yuboriladi.", "bullets": "Realtime ekran • Kiosk rejimi • Avtomatik SMS • Online navbat"}}'::jsonb,
   '{"slug": "queue", "icon": "📅"}'::jsonb,
   'published', now(), 20),
  ('feature_detail.diagnostics', 'feature_detail',
   '{"uz-Latn": {"title": "Diagnostika", "subtitle": "X-Ray, CT, MRI, USG, ECG, EEG, mammografiya", "body": "Har bir aparatga jadval, narxlar va tayyorgarlik yo''riqnomalari biriktiring. Buyurtmalarni real vaqtda kuzating, natijalarni bemorga xavfsiz havola orqali yuboring.", "bullets": "Aparatlar katalogi • Tayyorgarlik yo''riqnomalari • DICOM saqlash • Natija SMS"}}'::jsonb,
   '{"slug": "diagnostics", "icon": "🔬"}'::jsonb,
   'published', now(), 30),
  ('feature_detail.pharmacy', 'feature_detail',
   '{"uz-Latn": {"title": "Dorixona POS", "subtitle": "Ombor, barkod, FIFO va sotuvlar", "body": "Dori partiyalarini FIFO bo''yicha boshqaring, barkod bilan tezkor sotuv, qoldiq xabarnomalari va batafsil hisobotlar.", "bullets": "Barkod skaner • FIFO partiya • Qoldiq xabarnomasi • Retsept bilan integratsiya"}}'::jsonb,
   '{"slug": "pharmacy", "icon": "💊"}'::jsonb,
   'published', now(), 40),
  ('feature_detail.cashier', 'feature_detail',
   '{"uz-Latn": {"title": "Kassa va smena", "subtitle": "Click, Payme, Uzum, MBank, Humo, Uzcard", "body": "Smena oching, to''lovlarni qabul qiling, inkassatsiyani belgilang va smena oxirida avtomatik hisobot oling.", "bullets": "Smena ochish/yopish • Inkassatsiya • Bir nechta to''lov usuli • Avtomatik hisobot"}}'::jsonb,
   '{"slug": "cashier", "icon": "💰"}'::jsonb,
   'published', now(), 50),
  ('feature_detail.analytics', 'feature_detail',
   '{"uz-Latn": {"title": "Analitika", "subtitle": "Daromad, konversiya, cohort, per-doctor", "body": "Real vaqtda dashboard, eksport, taqqoslash va har bir shifokor bo''yicha samaradorlik. Marketing kampaniyalari ROI ham birga.", "bullets": "Realtime KPI • Cohort tahlili • Per-doctor • Eksport"}}'::jsonb,
   '{"slug": "analytics", "icon": "📊"}'::jsonb,
   'published', now(), 60)
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('download.android', 'download',
   '{"uz-Latn": {"title": "Android (APK)", "body": "Bemor ilovasi — Android uchun preview build", "cta": "APK yuklab olish"}}'::jsonb,
   '{"platform": "android", "url": "https://expo.dev/artifacts/eas/clary-patient-android.apk", "version": "0.1.0-preview", "size_mb": 28}'::jsonb,
   'published', now(), 10),
  ('download.ios', 'download',
   '{"uz-Latn": {"title": "iOS (TestFlight)", "body": "App Store rasmiy versiyasi tayyorlanmoqda", "cta": "TestFlightga qo''shilish"}}'::jsonb,
   '{"platform": "ios", "url": "https://testflight.apple.com/join/clary-patient", "version": "0.1.0-preview"}'::jsonb,
   'published', now(), 20),
  ('download.pwa', 'download',
   '{"uz-Latn": {"title": "PWA — brauzerdan o''rnating", "body": "Telefoningizning Chrome/Safari brauzeridan ‘Add to Home Screen’ tugmasini bosing", "cta": "Veb ilovani ochish"}}'::jsonb,
   '{"platform": "pwa", "url": "https://patient.clary.uz", "version": "current"}'::jsonb,
   'published', now(), 30)
ON CONFLICT (key) DO NOTHING;
