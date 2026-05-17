// =============================================================================
// Programmatic SEO ma'lumotlari — solutions, soha (for), shahar (regions)
// =============================================================================
// Har sahifa: target kalit so'z, unique meta, FAQ (FAQPage schema), ichki
// havolalar. O'zbek (uz-Latn) + rus (ru). Astro dinamik route'lar shu manbadan
// quriladi. CMS shart emas — SEO landing'lar barqaror.

export type Lang = 'uz' | 'ru';
export type Bi = Record<Lang, string>;

export interface SeoFaq {
  q: Bi;
  a: Bi;
}

export interface SeoLandingData {
  slug: string;
  /** H1 / target kalit so'z. */
  keyword: Bi;
  metaTitle: Bi;
  metaDescription: Bi;
  intro: Bi;
  benefits: Bi[];
  faq: SeoFaq[];
  /** Ichki havola — /features/* slug'lari. */
  relatedFeatures: string[];
}

// -----------------------------------------------------------------------------
// SOLUTIONS — mahsulot kalit so'z sahifalari (/solutions/[slug])
// -----------------------------------------------------------------------------
export const SOLUTIONS: SeoLandingData[] = [
  {
    slug: 'klinika-dasturi',
    keyword: {
      uz: 'Klinika boshqaruv dasturi',
      ru: 'Программа управления клиникой',
    },
    metaTitle: {
      uz: 'Klinika boshqaruv dasturi — Clary | Bemorlar, navbat, kassa',
      ru: 'Программа управления клиникой — Clary | Пациенты, очередь, касса',
    },
    metaDescription: {
      uz: 'Clary — O‘zbekiston klinikalari uchun zamonaviy boshqaruv dasturi. Bemorlar bazasi, elektron navbat, kassa, diagnostika, dorixona va analitika bitta tizimda.',
      ru: 'Clary — современная программа для клиник Узбекистана. База пациентов, электронная очередь, касса, диагностика, аптека и аналитика в одной системе.',
    },
    intro: {
      uz: 'Clary — klinikangizni to‘liq raqamlashtiruvchi bulutli boshqaruv dasturi. Bemorlar qabuli, navbat, shifokor ko‘rigi, diagnostika, dorixona, kassa va hisobotlar — barchasi bitta oynada. Excel va qog‘oz daftarlardan butunlay voz keching.',
      ru: 'Clary — облачная программа, которая полностью оцифровывает вашу клинику. Приём пациентов, очередь, осмотр врача, диагностика, аптека, касса и отчёты — всё в одном окне. Полностью откажитесь от Excel и бумажных журналов.',
    },
    benefits: [
      { uz: 'Bemor bazasi va kasallik tarixi — bir necha soniyada qidiruv', ru: 'База пациентов и история болезни — поиск за секунды' },
      { uz: 'Elektron navbat va QR-kiosk — navbat tartibsizligini yo‘qotadi', ru: 'Электронная очередь и QR-киоск — устраняет беспорядок в очереди' },
      { uz: 'Kassa, smena va moliyaviy hisobot — real vaqtda', ru: 'Касса, смена и финансовый отчёт — в реальном времени' },
      { uz: 'Rollar va ruxsatlar — har xodim faqat o‘z bo‘limini ko‘radi', ru: 'Роли и права — каждый сотрудник видит только свой раздел' },
      { uz: 'Bulutli — istalgan qurilmadan, o‘rnatish shart emas', ru: 'Облачное — с любого устройства, установка не требуется' },
    ],
    faq: [
      {
        q: { uz: 'Clary qancha turadi?', ru: 'Сколько стоит Clary?' },
        a: {
          uz: 'Demo 3 kun bepul. Keyin tarif: Base $25/oy, Pro $50/oy, Enterprise $120/oy. Tarifni tanlagach 1 oy bepul sinov beriladi.',
          ru: 'Демо 3 дня бесплатно. Далее тариф: Base $25/мес, Pro $50/мес, Enterprise $120/мес. После выбора тарифа даётся 1 месяц бесплатного пробного периода.',
        },
      },
      {
        q: { uz: 'Ma’lumotlarim xavfsizmi?', ru: 'Безопасны ли мои данные?' },
        a: {
          uz: 'Ha. Har klinika ma’lumoti alohida ajratilgan (multi-tenant), shifrlangan va kunlik zaxiralanadi. Har bir o‘zgarish auditda qayd etiladi.',
          ru: 'Да. Данные каждой клиники изолированы (multi-tenant), шифруются и резервируются ежедневно. Каждое изменение фиксируется в аудите.',
        },
      },
      {
        q: { uz: 'Excel’dan ko‘chirib o‘tish qiyinmi?', ru: 'Сложно ли перейти с Excel?' },
        a: {
          uz: 'Yo‘q. Onboarding bosqichida klinika, xodimlar va xizmatlar ro‘yxati ko‘chiriladi. Ko‘pchilik klinikalar 7 kun ichida to‘liq ishga tushadi.',
          ru: 'Нет. На этапе онбординга переносятся клиника, сотрудники и список услуг. Большинство клиник полностью запускаются за 7 дней.',
        },
      },
    ],
    relatedFeatures: ['reception', 'queue', 'cashier', 'analytics'],
  },
  {
    slug: 'hospital-crm',
    keyword: { uz: 'Hospital CRM tizimi', ru: 'Hospital CRM система' },
    metaTitle: {
      uz: 'Hospital CRM — Clary | Shifoxona uchun bemor va jarayon boshqaruvi',
      ru: 'Hospital CRM — Clary | Управление пациентами и процессами больницы',
    },
    metaDescription: {
      uz: 'Clary Hospital CRM — shifoxona va ko‘p filialli klinikalar uchun. Bemorlar, statsionar, diagnostika, moliyaviy oqim va xodimlar — yagona tizimda.',
      ru: 'Clary Hospital CRM — для больниц и многофилиальных клиник. Пациенты, стационар, диагностика, финансовый поток и персонал — в единой системе.',
    },
    intro: {
      uz: 'Clary Hospital CRM — shifoxona miqyosidagi jarayonlarni boshqaradi: bemor yo‘li (qabul → shifokor → diagnostika → statsionar → kassa), ko‘p filial, xodim navbatlari va to‘liq moliyaviy nazorat.',
      ru: 'Clary Hospital CRM управляет процессами больничного масштаба: путь пациента (приём → врач → диагностика → стационар → касса), несколько филиалов, графики персонала и полный финансовый контроль.',
    },
    benefits: [
      { uz: 'Bemor yo‘li — qabuldan kassagacha to‘liq kuzatiladi', ru: 'Путь пациента — отслеживается от приёма до кассы' },
      { uz: 'Ko‘p filial — barcha filiallar bitta dashboard’da', ru: 'Несколько филиалов — все в одном дашборде' },
      { uz: 'Statsionar: palatalar, vitals, parvarish jadvali', ru: 'Стационар: палаты, витальные показатели, график ухода' },
      { uz: 'Tamper-evident audit — har amal o‘zgarmas log’da', ru: 'Tamper-evident аудит — каждое действие в неизменяемом логе' },
    ],
    faq: [
      {
        q: { uz: 'Clary ko‘p filialni qo‘llab-quvvatlaydimi?', ru: 'Поддерживает ли Clary несколько филиалов?' },
        a: {
          uz: 'Ha. Enterprise tarifda cheksiz filial, xodim va qurilma. Har filial ma’lumoti ajratilgan, lekin yagona hisobotda birlashtiriladi.',
          ru: 'Да. В тарифе Enterprise — неограниченное число филиалов, сотрудников и устройств. Данные каждого филиала изолированы, но объединяются в едином отчёте.',
        },
      },
      {
        q: { uz: 'Statsionar moduli bormi?', ru: 'Есть ли модуль стационара?' },
        a: {
          uz: 'Ha. Palatalar, yotqizish/chiqarish, vital belgilar, parvarish jadvali va statsionar hisob-kitobi to‘liq qo‘llab-quvvatlanadi.',
          ru: 'Да. Палаты, госпитализация/выписка, витальные показатели, график ухода и расчёт стационара полностью поддерживаются.',
        },
      },
    ],
    relatedFeatures: ['inpatient', 'diagnostics', 'analytics', 'staff'],
  },
  {
    slug: 'clinic-management-software',
    keyword: { uz: 'Clinic management software', ru: 'Clinic management software' },
    metaTitle: {
      uz: 'Clinic Management Software — Clary | Built for Uzbekistan & CIS',
      ru: 'Clinic Management Software — Clary | Для Узбекистана и СНГ',
    },
    metaDescription: {
      uz: 'Clary is a multi-tenant clinic management software for Uzbekistan and CIS: patients, queue, diagnostics, pharmacy, billing and analytics in one cloud platform.',
      ru: 'Clary — clinic management software для Узбекистана и СНГ: пациенты, очередь, диагностика, аптека, биллинг и аналитика в одной облачной платформе.',
    },
    intro: {
      uz: 'Clary is an enterprise clinic management software built for the realities of Uzbekistan and CIS — local payment providers (Click, Payme), 7 languages, BYO SMS, and offline-tolerant workflows.',
      ru: 'Clary — clinic management software корпоративного уровня, созданная с учётом реалий Узбекистана и СНГ: локальные платёжные провайдеры (Click, Payme), 7 языков, BYO SMS и устойчивые к офлайну процессы.',
    },
    benefits: [
      { uz: 'Local payments — Click & Payme, no Stripe needed', ru: 'Локальные платежи — Click и Payme, без Stripe' },
      { uz: '7 languages — Uzbek (Latin/Cyrillic), Russian, English and more', ru: '7 языков — узбекский (латиница/кириллица), русский, английский и др.' },
      { uz: 'Multi-tenant — strict per-clinic data isolation', ru: 'Multi-tenant — строгая изоляция данных по клиникам' },
      { uz: 'Cloud — no installation, works on any device', ru: 'Облако — без установки, работает на любом устройстве' },
    ],
    faq: [
      {
        q: { uz: 'Does Clary work without Stripe?', ru: 'Работает ли Clary без Stripe?' },
        a: {
          uz: 'Yes. Clary uses Click and Payme — the payment providers that actually work in Uzbekistan. Each clinic connects its own merchant account.',
          ru: 'Да. Clary использует Click и Payme — платёжные провайдеры, которые реально работают в Узбекистане. Каждая клиника подключает свой merchant-аккаунт.',
        },
      },
    ],
    relatedFeatures: ['payments', 'i18n', 'reception', 'analytics'],
  },
  {
    slug: 'laboratoriya-dasturi',
    keyword: { uz: 'Laboratoriya boshqaruv dasturi', ru: 'Программа для лаборатории' },
    metaTitle: {
      uz: 'Laboratoriya dasturi — Clary | Tahlillar, namuna, natija va validatsiya',
      ru: 'Программа для лаборатории — Clary | Анализы, образцы, результаты',
    },
    metaDescription: {
      uz: 'Clary laboratoriya moduli — tahlil buyurtmasi, QR-probirka, LOINC standart, natija validatsiyasi va bemorga avtomatik xabar. Diagnostika markazlari uchun.',
      ru: 'Лабораторный модуль Clary — заказ анализов, QR-пробирка, стандарт LOINC, валидация результатов и автоуведомление пациента. Для диагностических центров.',
    },
    intro: {
      uz: 'Clary laboratoriya moduli — tahlil oqimini to‘liq raqamlashtiradi: shifokor buyurtmasi → QR-probirka → namuna → tahlil → validatsiya → natija. LOINC xalqaro standarti va smart natija kiritish bilan.',
      ru: 'Лабораторный модуль Clary полностью оцифровывает поток анализов: заказ врача → QR-пробирка → образец → анализ → валидация → результат. С международным стандартом LOINC и умным вводом результатов.',
    },
    benefits: [
      { uz: 'QR/barkod probirka — namuna xatosiz kuzatiladi', ru: 'QR/штрихкод пробирка — образец отслеживается без ошибок' },
      { uz: 'LOINC standart — har tahlil xalqaro kod bilan', ru: 'Стандарт LOINC — каждый анализ с международным кодом' },
      { uz: 'Natija validatsiyasi — laborant → validator → shifokor', ru: 'Валидация результата — лаборант → валидатор → врач' },
      { uz: 'Bemorga natija tayyor bo‘lganda avtomatik SMS/Telegram', ru: 'Автоматический SMS/Telegram пациенту при готовности результата' },
    ],
    faq: [
      {
        q: { uz: 'Laboratoriya apparatlari bilan integratsiya bormi?', ru: 'Есть ли интеграция с лабораторным оборудованием?' },
        a: {
          uz: 'Clary HL7 standartini qo‘llab-quvvatlaydi — analizator natijalarini qabul qilish arxitekturasi tayyor (Mindray, Roche va boshqalar).',
          ru: 'Clary поддерживает стандарт HL7 — архитектура приёма результатов анализаторов готова (Mindray, Roche и др.).',
        },
      },
    ],
    relatedFeatures: ['lab', 'diagnostics', 'reception'],
  },
  {
    slug: 'stomatologiya-dasturi',
    keyword: { uz: 'Stomatologiya klinika dasturi', ru: 'Программа для стоматологии' },
    metaTitle: {
      uz: 'Stomatologiya dasturi — Clary | Tish kartasi, qabul, kassa',
      ru: 'Программа для стоматологии — Clary | Зубная карта, приём, касса',
    },
    metaDescription: {
      uz: 'Clary stomatologiya klinikalari uchun: bemor tish kartasi, qabul jadvali, davolash rejasi, kassa va bemor eslatmalari — bitta tizimda.',
      ru: 'Clary для стоматологических клиник: зубная карта пациента, расписание приёмов, план лечения, касса и напоминания пациентам — в одной системе.',
    },
    intro: {
      uz: 'Clary stomatologiya klinikalarini boshqaradi: bemor tish kartasi, davolash rejasi, qabul jadvali, kassa va avtomatik eslatmalar. Stomatolog ish jarayoniga moslangan.',
      ru: 'Clary управляет стоматологическими клиниками: зубная карта пациента, план лечения, расписание приёмов, касса и автоматические напоминания. Адаптировано под рабочий процесс стоматолога.',
    },
    benefits: [
      { uz: 'Bemor qabul jadvali va online booking', ru: 'Расписание приёмов и онлайн-запись пациентов' },
      { uz: 'Davolash rejasi va bosqichma-bosqich nazorat', ru: 'План лечения и поэтапный контроль' },
      { uz: 'Kassa, qarzdorlik va to‘lov tarixi', ru: 'Касса, задолженность и история платежей' },
      { uz: 'Bemorga qabul oldidan avtomatik eslatma', ru: 'Автонапоминание пациенту перед приёмом' },
    ],
    faq: [
      {
        q: { uz: 'Tish kartasi (dental chart) bormi?', ru: 'Есть ли зубная карта (dental chart)?' },
        a: {
          uz: 'Ha, Clary stomatologiya moduli bemor tish kartasi va davolash rejasini qo‘llab-quvvatlaydi.',
          ru: 'Да, стоматологический модуль Clary поддерживает зубную карту пациента и план лечения.',
        },
      },
    ],
    relatedFeatures: ['dental', 'reception', 'cashier', 'queue'],
  },
  {
    slug: 'diagnostika-markazi-dasturi',
    keyword: { uz: 'Diagnostika markazi dasturi', ru: 'Программа для диагностического центра' },
    metaTitle: {
      uz: 'Diagnostika markazi dasturi — Clary | X-Ray, MRI, CT, USG, ECG',
      ru: 'Программа для диагностического центра — Clary | Рентген, МРТ, КТ',
    },
    metaDescription: {
      uz: 'Clary diagnostika markazlari uchun: tekshiruv buyurtmasi, apparatlar jadvali, natija va xulosa, bemor hisoboti. X-Ray, MRI, CT, USG, ECG.',
      ru: 'Clary для диагностических центров: заказ исследований, расписание оборудования, результаты и заключения, отчёт пациента. Рентген, МРТ, КТ, УЗИ, ЭКГ.',
    },
    intro: {
      uz: 'Clary diagnostika markazini boshqaradi: tekshiruv buyurtmasi, apparat va xona jadvali, shifokor xulosasi, bemor hisoboti. X-Ray, MRI, CT, USG, ECG va boshqalar.',
      ru: 'Clary управляет диагностическим центром: заказ исследований, расписание оборудования и кабинетов, заключение врача, отчёт пациента. Рентген, МРТ, КТ, УЗИ, ЭКГ и др.',
    },
    benefits: [
      { uz: 'Apparat va xona jadvali — bandlik nazorati', ru: 'Расписание оборудования и кабинетов — контроль занятости' },
      { uz: 'Tekshiruv buyurtmasi va xulosa bir tizimda', ru: 'Заказ исследования и заключение в одной системе' },
      { uz: 'Natijaga rasm/PDF biriktirish', ru: 'Прикрепление изображения/PDF к результату' },
      { uz: 'Bemorga natija haqida avtomatik xabar', ru: 'Автоуведомление пациента о результате' },
    ],
    faq: [
      {
        q: { uz: 'Qaysi tekshiruv turlari qo‘llab-quvvatlanadi?', ru: 'Какие виды исследований поддерживаются?' },
        a: {
          uz: 'X-Ray, MRI, CT, USG, ECG, EXO, EEG, mammografiya va boshqalar — apparatlar katalogi orqali sozlanadi.',
          ru: 'Рентген, МРТ, КТ, УЗИ, ЭКГ, ЭХО, ЭЭГ, маммография и др. — настраивается через каталог оборудования.',
        },
      },
    ],
    relatedFeatures: ['diagnostics', 'lab', 'reception', 'analytics'],
  },
  {
    slug: 'navbat-tizimi',
    keyword: { uz: 'Elektron navbat tizimi', ru: 'Система электронной очереди' },
    metaTitle: {
      uz: 'Elektron navbat tizimi — Clary | QR-kiosk, online booking, ekran',
      ru: 'Система электронной очереди — Clary | QR-киоск, онлайн-запись',
    },
    metaDescription: {
      uz: 'Clary elektron navbat tizimi — QR-kiosk, online booking, real-time ekran va shifokor chaqiruvi. Klinikada navbat tartibsizligini yo‘qotadi.',
      ru: 'Система электронной очереди Clary — QR-киоск, онлайн-запись, экран в реальном времени и вызов врача. Устраняет беспорядок в очереди клиники.',
    },
    intro: {
      uz: 'Clary elektron navbat tizimi — bemor QR-kiosk yoki online orqali navbat oladi, ekranda raqamlar ko‘rinadi, shifokor bir tugma bilan keyingi bemorni chaqiradi. Navbat tartibsizligi yo‘qoladi.',
      ru: 'Система электронной очереди Clary — пациент берёт очередь через QR-киоск или онлайн, номера отображаются на экране, врач одной кнопкой вызывает следующего пациента. Беспорядок в очереди исчезает.',
    },
    benefits: [
      { uz: 'QR-kiosk — bemor o‘zi navbat oladi', ru: 'QR-киоск — пациент сам берёт очередь' },
      { uz: 'Online booking — uydan navbatga yozilish', ru: 'Онлайн-запись — запись в очередь из дома' },
      { uz: 'Real-time ekran — navbat raqamlari ko‘rinadi', ru: 'Экран в реальном времени — отображаются номера очереди' },
      { uz: 'Shoshilinch bemor uchun ustuvorlik', ru: 'Приоритет для срочных пациентов' },
    ],
    faq: [
      {
        q: { uz: 'Bemor uydan navbat olishi mumkinmi?', ru: 'Может ли пациент взять очередь из дома?' },
        a: {
          uz: 'Ha, Clary bemorlar ilovasi orqali online booking — bemor uydan ham qabul vaqtini band qiladi.',
          ru: 'Да, через приложение для пациентов Clary — пациент бронирует время приёма даже из дома.',
        },
      },
    ],
    relatedFeatures: ['queue', 'patient-app', 'reception'],
  },
];

// -----------------------------------------------------------------------------
// SOHA (for) — kim uchun sahifalari (/for/[slug])
// -----------------------------------------------------------------------------
export const INDUSTRIES: SeoLandingData[] = [
  {
    slug: 'klinikalar',
    keyword: { uz: 'Klinikalar uchun dastur', ru: 'Программа для клиник' },
    metaTitle: {
      uz: 'Klinikalar uchun Clary | Xususiy va ko‘p filialli klinika dasturi',
      ru: 'Clary для клиник | Программа для частных и сетевых клиник',
    },
    metaDescription: {
      uz: 'Xususiy klinika, ko‘p filialli tarmoq yoki oilaviy poliklinika — Clary klinikangizning barcha jarayonini bitta tizimga birlashtiradi.',
      ru: 'Частная клиника, сеть филиалов или семейная поликлиника — Clary объединяет все процессы вашей клиники в одну систему.',
    },
    intro: {
      uz: 'Clary turli klinikalar uchun moslashadi — xususiy klinika, ko‘p filialli tarmoq, oilaviy poliklinika. Bemor qabuli, navbat, kassa, dorixona va analitika — barchasi bir joyda.',
      ru: 'Clary подходит для разных клиник — частная клиника, сеть филиалов, семейная поликлиника. Приём пациентов, очередь, касса, аптека и аналитика — всё в одном месте.',
    },
    benefits: [
      { uz: 'Xususiy klinika — tez ishga tushish, kam sozlash', ru: 'Частная клиника — быстрый запуск, минимум настройки' },
      { uz: 'Ko‘p filial — yagona hisobot, ajratilgan ma’lumot', ru: 'Сеть филиалов — единый отчёт, изолированные данные' },
      { uz: 'Har bo‘lim uchun moslashuvchan rollar', ru: 'Гибкие роли для каждого отдела' },
    ],
    faq: [
      {
        q: { uz: 'Kichik klinika uchun ham mosmi?', ru: 'Подходит ли для небольшой клиники?' },
        a: {
          uz: 'Ha. Base tarifi 2 xodim va 2 qurilma uchun — kichik klinika uchun ideal. Klinika o‘sgan sari tarifni oshirasiz.',
          ru: 'Да. Тариф Base рассчитан на 2 сотрудников и 2 устройства — идеален для небольшой клиники. По мере роста клиники повышаете тариф.',
        },
      },
    ],
    relatedFeatures: ['reception', 'queue', 'cashier', 'analytics'],
  },
  {
    slug: 'laboratoriyalar',
    keyword: { uz: 'Laboratoriyalar uchun dastur', ru: 'Программа для лабораторий' },
    metaTitle: {
      uz: 'Laboratoriyalar uchun Clary | Tahlil oqimi va natija boshqaruvi',
      ru: 'Clary для лабораторий | Управление потоком анализов',
    },
    metaDescription: {
      uz: 'Mustaqil laboratoriya yoki klinika tarkibidagi laboratoriya — Clary tahlil oqimini, namuna kuzatuvini va natija validatsiyasini boshqaradi.',
      ru: 'Независимая лаборатория или лаборатория в составе клиники — Clary управляет потоком анализов, отслеживанием образцов и валидацией результатов.',
    },
    intro: {
      uz: 'Clary laboratoriyalar uchun — tahlil buyurtmasidan natija topshirilgunga qadar to‘liq oqim. QR-probirka, LOINC, validatsiya va bemorga avtomatik xabar.',
      ru: 'Clary для лабораторий — полный поток от заказа анализа до выдачи результата. QR-пробирка, LOINC, валидация и автоуведомление пациента.',
    },
    benefits: [
      { uz: 'Tahlil oqimi — buyurtma, namuna, natija, validatsiya', ru: 'Поток анализов — заказ, образец, результат, валидация' },
      { uz: 'QR-probirka bilan namuna kuzatuvi', ru: 'Отслеживание образцов через QR-пробирку' },
      { uz: 'Sifat nazorati — ko‘p bosqichli validatsiya', ru: 'Контроль качества — многоэтапная валидация' },
    ],
    faq: [
      {
        q: { uz: 'Klinikadan tashqari laboratoriya uchun ham ishlaydimi?', ru: 'Работает ли для лаборатории вне клиники?' },
        a: {
          uz: 'Ha. Clary mustaqil laboratoriyalar uchun ham ishlaydi — boshqa klinikalardan tahlil buyurtmalarini qabul qilish mumkin.',
          ru: 'Да. Clary работает и для независимых лабораторий — можно принимать заказы анализов от других клиник.',
        },
      },
    ],
    relatedFeatures: ['lab', 'diagnostics'],
  },
  {
    slug: 'stomatologiya',
    keyword: { uz: 'Stomatologiya uchun dastur', ru: 'Программа для стоматологии' },
    metaTitle: {
      uz: 'Stomatologiya uchun Clary | Tish klinikasi boshqaruvi',
      ru: 'Clary для стоматологии | Управление стоматологической клиникой',
    },
    metaDescription: {
      uz: 'Stomatologiya klinikalari uchun Clary — tish kartasi, davolash rejasi, qabul jadvali va kassa. Stomatolog ish oqimiga moslangan.',
      ru: 'Clary для стоматологических клиник — зубная карта, план лечения, расписание приёмов и касса. Адаптировано под рабочий процесс стоматолога.',
    },
    intro: {
      uz: 'Clary stomatologiya klinikalari uchun maxsus modul beradi: bemor tish kartasi, bosqichma-bosqich davolash rejasi, qabul jadvali va to‘lov nazorati.',
      ru: 'Clary предоставляет специальный модуль для стоматологических клиник: зубная карта пациента, поэтапный план лечения, расписание приёмов и контроль платежей.',
    },
    benefits: [
      { uz: 'Tish kartasi va davolash rejasi', ru: 'Зубная карта и план лечения' },
      { uz: 'Qabul jadvali va online booking', ru: 'Расписание приёмов и онлайн-запись' },
      { uz: 'Qarzdorlik va to‘lov tarixi nazorati', ru: 'Контроль задолженности и истории платежей' },
    ],
    faq: [
      {
        q: { uz: 'Stomatologiya moduli alohida to‘lanadimi?', ru: 'Оплачивается ли модуль стоматологии отдельно?' },
        a: {
          uz: 'Yo‘q, stomatologiya moduli barcha tariflarga kiradi — qo‘shimcha to‘lov yo‘q.',
          ru: 'Нет, модуль стоматологии входит во все тарифы — без дополнительной оплаты.',
        },
      },
    ],
    relatedFeatures: ['dental', 'reception', 'cashier'],
  },
  {
    slug: 'diagnostika-markazlari',
    keyword: { uz: 'Diagnostika markazlari uchun dastur', ru: 'Программа для диагностических центров' },
    metaTitle: {
      uz: 'Diagnostika markazlari uchun Clary | Tekshiruv va apparat boshqaruvi',
      ru: 'Clary для диагностических центров | Управление исследованиями',
    },
    metaDescription: {
      uz: 'Diagnostika markazlari uchun Clary — tekshiruv buyurtmasi, apparat jadvali, shifokor xulosasi va bemor hisoboti. X-Ray, MRI, CT, USG.',
      ru: 'Clary для диагностических центров — заказ исследований, расписание оборудования, заключение врача и отчёт пациента. Рентген, МРТ, КТ, УЗИ.',
    },
    intro: {
      uz: 'Clary diagnostika markazlari uchun — apparat va xona bandligini boshqaradi, tekshiruv buyurtmasi va shifokor xulosasini bitta tizimga birlashtiradi.',
      ru: 'Clary для диагностических центров — управляет занятостью оборудования и кабинетов, объединяет заказ исследования и заключение врача в одну систему.',
    },
    benefits: [
      { uz: 'Apparat bandligi va xona jadvali', ru: 'Занятость оборудования и расписание кабинетов' },
      { uz: 'Tekshiruv xulosasi va rasm biriktirish', ru: 'Заключение исследования и прикрепление изображений' },
      { uz: 'Bemor hisoboti — klinika brendi bilan PDF', ru: 'Отчёт пациента — PDF с брендом клиники' },
    ],
    faq: [
      {
        q: { uz: 'Apparat jadvalini sozlash mumkinmi?', ru: 'Можно ли настроить расписание оборудования?' },
        a: {
          uz: 'Ha. Har apparat va xona uchun bandlik jadvali sozlanadi — qo‘shaloq buyurtma oldini oladi.',
          ru: 'Да. Для каждого оборудования и кабинета настраивается расписание занятости — предотвращает двойные заказы.',
        },
      },
    ],
    relatedFeatures: ['diagnostics', 'lab', 'analytics'],
  },
  {
    slug: 'shifokorlar',
    keyword: { uz: 'Shifokorlar uchun dastur', ru: 'Программа для врачей' },
    metaTitle: {
      uz: 'Shifokorlar uchun Clary | Bemor kartasi, ko‘rik, retsept',
      ru: 'Clary для врачей | Карта пациента, осмотр, рецепт',
    },
    metaDescription: {
      uz: 'Shifokorlar uchun Clary — bemor kartasi, SOAP ko‘rik, ICD-10 tashxis, retsept va vital belgilar. Tezkor, klaviatura bilan optimallashtirilgan.',
      ru: 'Clary для врачей — карта пациента, осмотр SOAP, диагноз ICD-10, рецепт и витальные показатели. Быстро, оптимизировано под клавиатуру.',
    },
    intro: {
      uz: 'Clary shifokor ish oynasini beradi — bemor kartasi, kasallik tarixi, SOAP ko‘rik, ICD-10 tashxis, retsept va vital belgilar. Tezkor, minimal klik bilan.',
      ru: 'Clary предоставляет рабочее окно врача — карта пациента, история болезни, осмотр SOAP, диагноз ICD-10, рецепт и витальные показатели. Быстро, минимум кликов.',
    },
    benefits: [
      { uz: 'Bemor kartasi va to‘liq kasallik tarixi', ru: 'Карта пациента и полная история болезни' },
      { uz: 'ICD-10 tashxis — 3 tilda qidiruv', ru: 'Диагноз ICD-10 — поиск на 3 языках' },
      { uz: 'SOAP ko‘rik va avtomatik qoralama saqlash', ru: 'Осмотр SOAP и автосохранение черновика' },
      { uz: 'Retsept va vital belgilar bir oynada', ru: 'Рецепт и витальные показатели в одном окне' },
    ],
    faq: [
      {
        q: { uz: 'ICD-10 tashxis qo‘llab-quvvatlanadimi?', ru: 'Поддерживается ли диагноз ICD-10?' },
        a: {
          uz: 'Ha. Clary ICD-10 (МКБ-10) tasniflagichi bilan ishlaydi — tashxisni o‘zbek, rus yoki ingliz tilida qidirib tanlash mumkin.',
          ru: 'Да. Clary работает с классификатором ICD-10 (МКБ-10) — диагноз можно искать на узбекском, русском или английском.',
        },
      },
    ],
    relatedFeatures: ['doctor', 'reception', 'queue'],
  },
];

// -----------------------------------------------------------------------------
// SHAHARLAR (regions) — /regions/[slug]
// -----------------------------------------------------------------------------
export interface RegionData {
  slug: string;
  city: Bi;
  /** Shaharning -da/-da shakli ("Toshkentda"). */
  cityIn: Bi;
}

export const REGIONS: RegionData[] = [
  { slug: 'toshkent', city: { uz: 'Toshkent', ru: 'Ташкент' }, cityIn: { uz: 'Toshkentda', ru: 'в Ташкенте' } },
  { slug: 'samarqand', city: { uz: 'Samarqand', ru: 'Самарканд' }, cityIn: { uz: 'Samarqandda', ru: 'в Самарканде' } },
  { slug: 'buxoro', city: { uz: 'Buxoro', ru: 'Бухара' }, cityIn: { uz: 'Buxoroda', ru: 'в Бухаре' } },
  { slug: 'andijon', city: { uz: 'Andijon', ru: 'Андижан' }, cityIn: { uz: 'Andijonda', ru: 'в Андижане' } },
  { slug: 'namangan', city: { uz: 'Namangan', ru: 'Наманган' }, cityIn: { uz: 'Namanganda', ru: 'в Намангане' } },
  { slug: 'fargona', city: { uz: 'Farg‘ona', ru: 'Фергана' }, cityIn: { uz: 'Farg‘onada', ru: 'в Фергане' } },
  { slug: 'nukus', city: { uz: 'Nukus', ru: 'Нукус' }, cityIn: { uz: 'Nukusda', ru: 'в Нукусе' } },
];

// Barcha solutions/industries slug'lari — sitemap va boshqa joylarda ishlatiladi.
export const ALL_SOLUTION_SLUGS = SOLUTIONS.map((s) => s.slug);
export const ALL_INDUSTRY_SLUGS = INDUSTRIES.map((s) => s.slug);
export const ALL_REGION_SLUGS = REGIONS.map((r) => r.slug);

// feature slug -> ko'rinadigan nom (relatedFeatures ichki havolalari uchun).
export const FEATURE_LABEL: Record<string, Bi> = {
  reception: { uz: 'Qabulxona', ru: 'Регистратура' },
  queue: { uz: 'Navbat', ru: 'Очередь' },
  doctor: { uz: 'Shifokor kabineti', ru: 'Кабинет врача' },
  inpatient: { uz: 'Statsionar', ru: 'Стационар' },
  pharmacy: { uz: 'Dorixona', ru: 'Аптека' },
  lab: { uz: 'Laboratoriya', ru: 'Лаборатория' },
  diagnostics: { uz: 'Diagnostika', ru: 'Диагностика' },
  cashier: { uz: 'Kassa', ru: 'Касса' },
  analytics: { uz: 'Analitika', ru: 'Аналитика' },
  marketing: { uz: 'Marketing', ru: 'Маркетинг' },
  staff: { uz: 'Xodimlar', ru: 'Сотрудники' },
  payroll: { uz: 'Maosh', ru: 'Зарплата' },
  dental: { uz: 'Stomatologiya', ru: 'Стоматология' },
  'patient-app': { uz: 'Bemorlar ilovasi', ru: 'Приложение пациента' },
  payments: { uz: 'To‘lovlar', ru: 'Платежи' },
  i18n: { uz: '7 ta til', ru: '7 языков' },
};

/** Astro locale kodi -> til kaliti (ru | uz). */
export function langOf(astroLocale: string | undefined): Lang {
  return astroLocale === 'ru' ? 'ru' : 'uz';
}

/** Til + yo'l -> URL prefiksli havola (ru bo'lsa /ru/...). */
export function localeHref(lang: Lang, path: string): string {
  return lang === 'ru' ? `/ru${path}` : path;
}
