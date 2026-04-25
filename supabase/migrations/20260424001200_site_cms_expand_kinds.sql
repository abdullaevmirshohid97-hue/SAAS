-- =============================================================================
-- Clary v2 — Migration 001200: Extend site_entries kind enum to support
-- additional landing content types: post (blog), doc, changelog, usecase,
-- feature_detail (marketing deep-dive), download (APK/build entries).
-- =============================================================================

ALTER TABLE site_entries DROP CONSTRAINT IF EXISTS site_entries_kind_check;
ALTER TABLE site_entries ADD CONSTRAINT site_entries_kind_check CHECK (kind IN (
  'hero', 'section', 'feature', 'testimonial', 'faq', 'plan',
  'media', 'seo', 'config', 'block',
  'post', 'doc', 'changelog', 'usecase', 'feature_detail', 'download'
));

-- Helpful composite index for slug lookups by kind (key is already unique)
CREATE INDEX IF NOT EXISTS idx_site_entries_kind_status
  ON site_entries(kind, status) WHERE status = 'published';

-- Seed a handful of starter content so the new pages render on fresh installs.
INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order, is_visible)
VALUES
  ('post.welcome', 'post',
   '{"uz-Latn": {"title": "Clary v2 — yangi avlod klinika boshqaruvi", "excerpt": "Nima uchun biz Clary v2 ni qurdik va u nimani yaxshilaydi.", "body": "Clary v2 — bu O‘zbekiston va CIS klinikalariga moslashtirilgan yangi avlod SaaS yechimi."}, "ru": {"title": "Clary v2 — новое поколение управления клиникой", "excerpt": "Почему мы построили Clary v2 и что он улучшает.", "body": "Clary v2 — новое поколение SaaS, адаптированное для клиник Узбекистана и СНГ."}}',
   '{"slug": "welcome", "cover": "/images/blog/welcome.jpg", "author": "Clary Team", "published": "2026-04-23", "reading_time_min": 5}',
   'published', now(), 0, true),
  ('post.security', 'post',
   '{"uz-Latn": {"title": "Bemor ma’lumotlari xavfsizligi: 5-qatlamli himoya", "excerpt": "RLS, pgsodium, audit, backup va tenant izolyatsiyasi haqida.", "body": "Biz bemor ma’lumotlarini 5 qatlamli himoya tizimi bilan saqlaymiz."}, "ru": {"title": "Безопасность данных пациентов: 5-уровневая защита", "excerpt": "RLS, pgsodium, аудит, резервные копии и изоляция тенантов.", "body": "Мы защищаем данные пациентов пятиуровневой системой."}}',
   '{"slug": "security", "cover": "/images/blog/security.jpg", "author": "Security Team", "published": "2026-04-15", "reading_time_min": 7}',
   'published', now(), 1, true),

  ('doc.getting-started', 'doc',
   '{"uz-Latn": {"title": "Ishni boshlash", "excerpt": "Hisobingizni tayyorlash va birinchi qadamlar.", "body": "1. Ro‘yxatdan o‘tish\n2. Klinika ma’lumotlarini kiritish\n3. Xodimlarni taklif qilish\n4. Xizmatlar katalogini sozlash"}, "ru": {"title": "Начало работы", "excerpt": "Подготовка аккаунта и первые шаги.", "body": "1. Регистрация\n2. Данные клиники\n3. Пригласите персонал\n4. Настройте каталог услуг"}}',
   '{"slug": "getting-started", "section": "Asoslar", "order": 1}',
   'published', now(), 0, true),
  ('doc.reception', 'doc',
   '{"uz-Latn": {"title": "Qabul moduli", "excerpt": "Bemor ro‘yxatdan o‘tkazish va uchrashuv yaratish.", "body": "Qabul moduli orqali bemorlarni tez ro‘yxatdan o‘tkazing, uchrashuv belgilang va QR to‘lovni qabul qiling."}, "ru": {"title": "Модуль приёма", "excerpt": "Регистрация пациентов и создание визитов.", "body": "В модуле приёма быстро регистрируйте пациентов, назначайте визиты и принимайте QR-платежи."}}',
   '{"slug": "reception", "section": "Modullar", "order": 10}',
   'published', now(), 1, true),
  ('doc.api', 'doc',
   '{"uz-Latn": {"title": "REST API", "excerpt": "Tashqi tizimlar uchun hujjatlangan API.", "body": "Biz OpenAPI 3.1 bilan to‘liq hujjatlangan REST API taqdim etamiz."}, "ru": {"title": "REST API", "excerpt": "Документированный API для внешних систем.", "body": "Мы предоставляем REST API с полной OpenAPI 3.1 документацией."}}',
   '{"slug": "api", "section": "Developer", "order": 50}',
   'published', now(), 2, true),

  ('changelog.v2-0-0', 'changelog',
   '{"uz-Latn": {"title": "v2.0.0 — Greenfield relaunch", "body": "- Multi-tenant ortiq 100% RLS bilan himoyalangan\n- 7 tilda i18n\n- Dental, Home Nurse, Online Queue qo‘shildi\n- MBank mock adapteri\n- Telegram kunlik backup"}, "ru": {"title": "v2.0.0 — полный перезапуск", "body": "- 100% RLS-защита multi-tenant\n- 7 языков\n- Модули Dental, Home Nurse, Online Queue\n- Mock-адаптер MBank\n- Ежедневный бэкап в Telegram"}}',
   '{"slug": "v2-0-0", "version": "2.0.0", "released": "2026-04-23", "level": "major"}',
   'published', now(), 0, true),
  ('changelog.v2-0-1', 'changelog',
   '{"uz-Latn": {"title": "v2.0.1 — Stabilizatsiya", "body": "- Diagnostika aparatlari katalogi\n- Hamshira modulida tezkor chaqiruv\n- Lab.tsx xatoliklari tuzatildi"}, "ru": {"title": "v2.0.1 — стабилизация", "body": "- Каталог диагностического оборудования\n- Экстренный вызов в модуле медсестры\n- Исправления в lab.tsx"}}',
   '{"slug": "v2-0-1", "version": "2.0.1", "released": "2026-04-25", "level": "patch"}',
   'published', now(), 1, true),

  ('usecase.private-clinic', 'usecase',
   '{"uz-Latn": {"title": "Xususiy klinikalar", "excerpt": "Multi-shifokor, ko‘p xizmatli xususiy klinikalar uchun.", "body": "10–50 xodimli xususiy klinikalar uchun optimal sozlamalar va workflow."}, "ru": {"title": "Частные клиники", "excerpt": "Для клиник с множеством врачей и услуг.", "body": "Оптимальные настройки для клиник 10–50 сотрудников."}}',
   '{"slug": "private-clinic", "icon": "🏥", "stats": {"clinics": 25, "doctors": 180}}',
   'published', now(), 0, true),
  ('usecase.dental', 'usecase',
   '{"uz-Latn": {"title": "Stomatologiya", "excerpt": "Maxsus tish kartasi va davolash rejalari.", "body": "FDI 32-tish diagrammasi, periodontogramm, davolash rejasi sehrgari bilan to‘liq yechim."}, "ru": {"title": "Стоматология", "excerpt": "Зубная карта и планы лечения.", "body": "FDI 32-зубная схема, пародонтограмма, мастер плана лечения."}}',
   '{"slug": "dental", "icon": "🦷"}',
   'published', now(), 1, true),
  ('usecase.diagnostic-center', 'usecase',
   '{"uz-Latn": {"title": "Diagnostika markazlari", "excerpt": "X-Ray, CT, MRI, USG, EKG workflow.", "body": "Uskunalar jadvali, natijalar, hisobotlar."}, "ru": {"title": "Диагностические центры", "excerpt": "Workflow X-Ray, CT, MRI, УЗИ, ЭКГ.", "body": "Расписание оборудования, результаты, отчёты."}}',
   '{"slug": "diagnostic-center", "icon": "🔬"}',
   'published', now(), 2, true),
  ('usecase.home-nurse', 'usecase',
   '{"uz-Latn": {"title": "Uy sharoitida hamshira", "excerpt": "Bemor ilovasi orqali buyurtma, soddalashgan billing.", "body": "Bemor uy hamshirasini chaqiradi, hamshira uchun sodda to‘lov yechimi."}, "ru": {"title": "Патронаж на дому", "excerpt": "Заказ через приложение пациента, упрощённый биллинг.", "body": "Пациент вызывает медсестру, упрощённый расчёт."}}',
   '{"slug": "home-nurse", "icon": "🏠"}',
   'published', now(), 3, true),

  ('feature_detail.queue', 'feature_detail',
   '{"uz-Latn": {"title": "Real-time navbat", "excerpt": "QR kiosk, SMS eslatma, o‘rtacha kutish vaqti.", "body": "Raqamli navbat, QR-kiosk, online booking, SMS eslatmalar va real-time holatni ko‘rish."}, "ru": {"title": "Очередь в реальном времени", "excerpt": "QR-киоск, SMS-напоминания, среднее время ожидания.", "body": "Цифровая очередь, QR-киоск, онлайн-запись, SMS."}}',
   '{"slug": "queue", "icon": "📅", "highlights": ["QR kiosk", "Online booking", "SMS remind"]}',
   'published', now(), 0, true),
  ('feature_detail.diagnostics', 'feature_detail',
   '{"uz-Latn": {"title": "Diagnostika", "excerpt": "X-Ray, CT, MRI, USG, ECG, mammografiya va ko‘proq.", "body": "Uskunalar jadvali, natijalar (rasm + xulosa), bemor portali orqali yuklab olish."}, "ru": {"title": "Диагностика", "excerpt": "X-Ray, CT, МРТ, УЗИ, ЭКГ и прочее.", "body": "Расписание оборудования, результаты, доступ через портал пациента."}}',
   '{"slug": "diagnostics", "icon": "🔬", "highlights": ["MRI", "CT", "X-Ray", "USG", "EKG"]}',
   'published', now(), 1, true),
  ('feature_detail.pharmacy', 'feature_detail',
   '{"uz-Latn": {"title": "Dorixona POS", "excerpt": "Ombor, FIFO partiyalar, barkod, sotuv.", "body": "Ichki dorixona uchun to‘liq POS va inventarizatsiya."}, "ru": {"title": "Аптечный POS", "excerpt": "Склад, FIFO партии, штрих-коды, продажи.", "body": "Полноценный POS и учёт для внутренней аптеки."}}',
   '{"slug": "pharmacy", "icon": "💊", "highlights": ["FIFO", "Barcode", "Stock alerts"]}',
   'published', now(), 2, true),

  ('download.apk', 'download',
   '{"uz-Latn": {"title": "Clary Android APK", "body": "Doctor va nurse uchun mobil ilovani yuklab oling."}, "ru": {"title": "Clary Android APK", "body": "Скачайте мобильное приложение для врачей и медсестёр."}}',
   '{"platform": "android", "version": "2.0.0", "size_mb": 32, "url": "https://downloads.clary.uz/clary-mobile-2.0.0.apk", "released": "2026-04-23"}',
   'published', now(), 0, true),
  ('download.patient-pwa', 'download',
   '{"uz-Latn": {"title": "Clary Patient (PWA)", "body": "Bemorlar uchun web-ilova: navbat olish, hamshira chaqirish, test natijalari."}, "ru": {"title": "Clary Patient (PWA)", "body": "Приложение для пациентов: очередь, вызов медсестры, результаты."}}',
   '{"platform": "pwa", "version": "1.0.0", "url": "https://my.clary.uz", "released": "2026-04-23"}',
   'published', now(), 1, true)
ON CONFLICT (key) DO NOTHING;
