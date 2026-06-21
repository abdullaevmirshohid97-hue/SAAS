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
  /** AI SEO — qisqa xulosa (ChatGPT/Claude iqtibos oladi). Ixtiyoriy. */
  tldr?: Bi;
  /** AI SEO — "X nima?" ta'rif bloki. Ixtiyoriy. */
  definition?: Bi;
  benefits: Bi[];
  faq: SeoFaq[];
  /** Ichki havola — /features/* slug'lari. */
  relatedFeatures: string[];
}

// -----------------------------------------------------------------------------
// SOLUTIONS — mahsulot kalit so'z sahifalari (/solutions/[slug])
// -----------------------------------------------------------------------------
export const SOLUTIONS: SeoLandingData[] = [
  // ── PILLAR: Healthcare ERP (kategoriyani belgilovchi cornerstone sahifa) ──
  {
    slug: 'healthcare-erp',
    keyword: {
      uz: 'Healthcare ERP — klinika boshqaruv tizimi',
      ru: 'Медицинская ERP — система управления клиникой',
    },
    metaTitle: {
      uz: 'Healthcare ERP — Clary | Klinika va shifoxona boshqaruv tizimi',
      ru: 'Медицинская ERP — Clary | Система управления клиникой и больницей',
    },
    metaDescription: {
      uz: 'Clary — klinikalar, shifoxonalar, laboratoriya va dorixonalar uchun Healthcare ERP. Reception, kassa, lab (LIS), dorixona, statsionar, maosh va analitika bitta platformada.',
      ru: 'Clary — медицинская ERP для клиник, больниц, лабораторий и аптек. Регистратура, касса, лаборатория (LIS), аптека, стационар, зарплата и аналитика в одной платформе.',
    },
    intro: {
      uz: 'Healthcare ERP — klinikaning barcha jarayonlarini (bemor, navbat, kassa, laboratoriya, dorixona, statsionar, maosh, hisobot) bitta tizimga birlashtiruvchi platforma. Clary buni bulutda, O‘zbekiston uchun moslab beradi — alohida dasturlar va Excel kerak emas.',
      ru: 'Медицинская ERP — это платформа, объединяющая все процессы клиники (пациенты, очередь, касса, лаборатория, аптека, стационар, зарплата, отчёты) в одну систему. Clary делает это в облаке, адаптировано под Узбекистан — без отдельных программ и Excel.',
    },
    tldr: {
      uz: 'Healthcare ERP = klinikaning yagona boshqaruv tizimi. Clary reception, kassa, lab, dorixona, statsionar, maosh va analitikani birlashtiradi. Demo 3 kun bepul.',
      ru: 'Медицинская ERP = единая система управления клиникой. Clary объединяет регистратуру, кассу, лабораторию, аптеку, стационар, зарплату и аналитику. Демо 3 дня бесплатно.',
    },
    definition: {
      uz: 'Healthcare ERP (Enterprise Resource Planning) — sog‘liqni saqlash muassasasining moliyaviy, klinik va boshqaruv jarayonlarini bitta integratsiyalashgan tizimda birlashtiruvchi dastur. ERP biznesda SAP yoki Oracle qilgan ishni, Clary klinika uchun qiladi: bemor qabuli, kassa, ombor (dorixona), laboratoriya, statsionar, maosh va analitika yagona ma‘lumotlar bazasida ishlaydi.',
      ru: 'Медицинская ERP (Enterprise Resource Planning) — система, объединяющая финансовые, клинические и управленческие процессы медучреждения в одну интегрированную платформу. То, что SAP или Oracle делают для бизнеса, Clary делает для клиники: приём, касса, склад (аптека), лаборатория, стационар, зарплата и аналитика работают в единой базе данных.',
    },
    benefits: [
      { uz: 'Yagona ma‘lumotlar bazasi — bemor, moliya, ombor, kadrlar bir joyda', ru: 'Единая база данных — пациенты, финансы, склад, кадры в одном месте' },
      { uz: 'Modulli: faqat kerakli bo‘limlarni yoqing (kassa, lab, dorixona, statsionar)', ru: 'Модульность: включайте только нужные разделы (касса, лаборатория, аптека, стационар)' },
      { uz: 'Real vaqtli moliya va KPI — kassa yaxlitligi, foyda, qarzdorlar', ru: 'Финансы и KPI в реальном времени — целостность кассы, прибыль, должники' },
      { uz: 'Rollar va audit — har xodim faqat o‘z modulini ko‘radi', ru: 'Роли и аудит — каждый сотрудник видит только свой модуль' },
      { uz: 'Bulutli + desktop ilova (silent print) — istalgan qurilmadan', ru: 'Облако + десктоп-приложение (тихая печать) — с любого устройства' },
    ],
    faq: [
      { q: { uz: 'Healthcare ERP va oddiy klinika dasturi farqi nima?', ru: 'Чем медицинская ERP отличается от обычной программы для клиники?' },
        a: { uz: 'Oddiy dastur ko‘pincha bitta vazifani (masalan navbat yoki kassa) bajaradi. Healthcare ERP esa barcha modullarni (kassa, lab, dorixona, statsionar, maosh, analitika) yagona bazada birlashtiradi — ma‘lumot takrorlanmaydi, hisobot to‘liq bo‘ladi.', ru: 'Обычная программа часто решает одну задачу (например очередь или касса). Медицинская ERP объединяет все модули (касса, лаборатория, аптека, стационар, зарплата, аналитика) в единой базе — данные не дублируются, отчётность полная.' } },
      { q: { uz: 'Clary kichik klinikaga ham mosmi?', ru: 'Подходит ли Clary маленькой клинике?' },
        a: { uz: 'Ha. Modulli bo‘lgani uchun kichik klinika faqat reception + kassa bilan boshlaydi, keyin lab/dorixona/statsionarni qo‘shadi. Demo 3 kun bepul.', ru: 'Да. Благодаря модульности маленькая клиника начинает только с регистратуры + кассы, затем добавляет лабораторию/аптеку/стационар. Демо 3 дня бесплатно.' } },
    ],
    relatedFeatures: ['cashier', 'lab', 'pharmacy', 'inpatient', 'analytics'],
  },
  // ── Modul sahifalari ──
  {
    slug: 'kassa-dasturi',
    keyword: { uz: 'Klinika kassa dasturi', ru: 'Программа кассы для клиники' },
    metaTitle: { uz: 'Klinika kassa dasturi — Clary | Smena, qarzdorlar, chek', ru: 'Программа кассы для клиники — Clary | Смена, должники, чек' },
    metaDescription: { uz: 'Clary kassa moduli — to‘lovlar, smena, naqd/plastik/o‘tkazma, qarzdorlar, chek va A4 hisobot. Kassa yaxlitligi va real vaqtli moliya nazorati.', ru: 'Кассовый модуль Clary — платежи, смена, наличные/карта/перевод, должники, чек и A4-отчёт. Целостность кассы и финансовый контроль в реальном времени.' },
    intro: { uz: 'Clary kassa moduli klinika moliyasini real vaqtda boshqaradi: to‘lovlar, smena ochish/yopish, naqd va plastik, qarzdorlar, depozit, vozvrat hamda chek chop etish — hammasi auditda qayd etiladi.', ru: 'Кассовый модуль Clary управляет финансами клиники в реальном времени: платежи, открытие/закрытие смены, наличные и карта, должники, депозит, возврат и печать чека — всё фиксируется в аудите.' },
    definition: { uz: 'Klinika kassa dasturi — bemor to‘lovlari, smena va moliyaviy hisobotlarni boshqaruvchi modul. Clary kassasida har bir tranzaksiya seyf/kassa manbasi, to‘lov turi va smena bo‘yicha kuzatiladi.', ru: 'Программа кассы для клиники — модуль для управления платежами пациентов, сменой и финансовой отчётностью. В кассе Clary каждая транзакция отслеживается по источнику (сейф/касса), типу оплаты и смене.' },
    benefits: [
      { uz: 'Smena ochish/yopish + farq sababi — kassa yaxlitligi', ru: 'Открытие/закрытие смены + причина расхождения — целостность кассы' },
      { uz: 'Naqd, plastik, o‘tkazma, mixed to‘lov — split bilan', ru: 'Наличные, карта, перевод, смешанная оплата — со сплитом' },
      { uz: 'Qarzdorlar va qarz to‘lash — chek bilan', ru: 'Должники и погашение долга — с чеком' },
      { uz: 'Termal chek (silent print) + A4 PDF hisobot', ru: 'Термочек (тихая печать) + A4 PDF-отчёт' },
    ],
    faq: [
      { q: { uz: 'Kassada qarzdorlarni kuzatish mumkinmi?', ru: 'Можно ли отслеживать должников в кассе?' }, a: { uz: 'Ha. Qarzdorlar alohida sahifada — qarz to‘lash (to‘liq yoki qisman) chek bilan, to‘langanlar tarixi rep-chek bilan.', ru: 'Да. Должники на отдельной странице — погашение долга (полностью или частично) с чеком, история оплат с повторным чеком.' } },
      { q: { uz: 'Termal printerga dialogsiz chiqaradimi?', ru: 'Печатает ли на термопринтер без диалога?' }, a: { uz: 'Ha — desktop ilovada USB/tarmoq printerga to‘g‘ridan-to‘g‘ri (silent print), brauzerda LAN printer orqali.', ru: 'Да — в десктоп-приложении напрямую на USB/сетевой принтер (тихая печать), в браузере через LAN-принтер.' } },
    ],
    relatedFeatures: ['cashier', 'analytics'],
  },
  {
    slug: 'dorixona-dasturi',
    keyword: { uz: 'Dorixona dasturi', ru: 'Программа для аптеки' },
    metaTitle: { uz: 'Dorixona dasturi — Clary | Ombor, savdo, partiya, muddat', ru: 'Программа для аптеки — Clary | Склад, продажи, партии, сроки' },
    metaDescription: { uz: 'Clary dorixona moduli — ombor, partiyalar, yaroqlilik muddati, savdo, qarz, chegirma-foyda va qaytarish. Klinika ichidagi dorixona uchun.', ru: 'Аптечный модуль Clary — склад, партии, сроки годности, продажи, долг, скидка-прибыль и возврат. Для аптеки внутри клиники.' },
    intro: { uz: 'Clary dorixona moduli ombor va savdoni bitta tizimda boshqaradi: partiyalar, yaroqlilik muddati bloki, naqd/qarz savdo, chegirma-foyda hisobi va qaytarish — kassa bilan to‘liq integratsiya.', ru: 'Аптечный модуль Clary управляет складом и продажами в одной системе: партии, блок по сроку годности, продажа за наличные/в долг, расчёт скидки-прибыли и возврат — полная интеграция с кассой.' },
    definition: { uz: 'Dorixona dasturi — dori ombori, partiyalar va savdoni boshqaruvchi modul. Clary yaroqlilik muddati o‘tgan dorini sotishni bloklaydi va har savdoni kassaga ulaydi.', ru: 'Программа для аптеки — модуль управления складом лекарств, партиями и продажами. Clary блокирует продажу просроченных лекарств и связывает каждую продажу с кассой.' },
    benefits: [
      { uz: 'Partiya va yaroqlilik muddati — muddat o‘tgan dori bloklanadi', ru: 'Партии и срок годности — просроченное блокируется' },
      { uz: 'Naqd va qarz savdo — klinikasiz qarz taqiqi bilan', ru: 'Продажа за наличные и в долг — с запретом долга без клиники' },
      { uz: 'Chegirma-foyda hisobi + qaytarish (reconcile)', ru: 'Расчёт скидки-прибыли + возврат (сверка)' },
      { uz: 'Kassa va analitika bilan to‘liq integratsiya', ru: 'Полная интеграция с кассой и аналитикой' },
    ],
    faq: [
      { q: { uz: 'Yaroqlilik muddati nazorati bormi?', ru: 'Есть ли контроль срока годности?' }, a: { uz: 'Ha. Muddati o‘tgan partiyani sotish bloklanadi, tugayotgan partiyalar ogohlantiriladi.', ru: 'Да. Продажа просроченной партии блокируется, по заканчивающимся партиям выводится предупреждение.' } },
    ],
    relatedFeatures: ['pharmacy', 'cashier'],
  },
  {
    slug: 'statsionar-dasturi',
    keyword: { uz: 'Statsionar boshqaruv dasturi', ru: 'Программа управления стационаром' },
    metaTitle: { uz: 'Statsionar dasturi — Clary | Yotqizish, deposit, xizmat, chek', ru: 'Программа стационара — Clary | Госпитализация, депозит, услуги, чек' },
    metaDescription: { uz: 'Clary statsionar moduli — yotqizish, xona/krovat, kunlik xizmat, qarovchi, deposit/to‘lov, qarzdorlik va chek/A4 PDF. Statsionar moliyasini to‘liq nazorat qiling.', ru: 'Стационарный модуль Clary — госпитализация, палата/койка, ежедневные услуги, сопровождающий, депозит/оплата, задолженность и чек/A4 PDF. Полный контроль финансов стационара.' },
    intro: { uz: 'Clary statsionar moduli yotqizilgan bemorni boshqaradi: xona/krovat, kunlik xizmatlar (alohida shifokor + komissiya), qarovchi, deposit va to‘lov, qarzdorlik hamda chek/A4 PDF — alohida moliyaviy registr bilan.', ru: 'Стационарный модуль Clary управляет госпитализированным пациентом: палата/койка, ежедневные услуги (отдельный врач + комиссия), сопровождающий, депозит и оплата, задолженность и чек/A4 PDF — с отдельным финансовым регистром.' },
    benefits: [
      { uz: 'Yotqizish, xona/krovat va kunlik xizmatlar', ru: 'Госпитализация, палата/койка и ежедневные услуги' },
      { uz: 'Deposit va to‘lov, qarzdorlik nazorati', ru: 'Депозит и оплата, контроль задолженности' },
      { uz: 'Alohida registr — qabulxona moliyasidan ajratilgan', ru: 'Отдельный регистр — отделён от финансов регистратуры' },
      { uz: 'Chek va A4 PDF chiqarish, jurnal amallari', ru: 'Печать чека и A4 PDF, операции журнала' },
    ],
    faq: [
      { q: { uz: 'Statsionar moliyasi qabulxonadan ajratilganmi?', ru: 'Отделены ли финансы стационара от регистратуры?' }, a: { uz: 'Ha. Clary‘da alohida registr (reception/inpatient) — kassa, KPI va hisobotlar ikkalasini ajratib ko‘rsatadi.', ru: 'Да. В Clary отдельный регистр (регистратура/стационар) — касса, KPI и отчёты показывают их раздельно.' } },
    ],
    relatedFeatures: ['inpatient', 'cashier'],
  },
  {
    slug: 'analitika-dasturi',
    keyword: { uz: 'Klinika analitika dasturi', ru: 'Программа аналитики для клиники' },
    metaTitle: { uz: 'Klinika analitikasi — Clary | KPI, daromad, shifokor hisoboti', ru: 'Аналитика клиники — Clary | KPI, доход, отчёт по врачам' },
    metaDescription: { uz: 'Clary analitika moduli — daromad, foyda, shifokor va xizmat bo‘yicha KPI, qarzdorlar, drill-down hisobotlar. Klinika raqamlarini real vaqtda ko‘ring.', ru: 'Модуль аналитики Clary — доход, прибыль, KPI по врачам и услугам, должники, детализированные отчёты. Смотрите цифры клиники в реальном времени.' },
    intro: { uz: 'Clary analitika moduli klinika ko‘rsatkichlarini real vaqtda ko‘rsatadi: daromad va foyda, shifokor/xizmat bo‘yicha KPI, qarzdorlar, kassa drill-down va davr taqqoslash — qaror qabul qilish uchun aniq raqamlar.', ru: 'Модуль аналитики Clary показывает показатели клиники в реальном времени: доход и прибыль, KPI по врачам/услугам, должники, детализация кассы и сравнение периодов — точные цифры для решений.' },
    benefits: [
      { uz: 'Daromad, foyda va commission — accrual model', ru: 'Доход, прибыль и комиссия — accrual-модель' },
      { uz: 'Shifokor va xizmat bo‘yicha KPI + drill-down', ru: 'KPI по врачам и услугам + детализация' },
      { uz: 'Qarzdorlar va super-analitika', ru: 'Должники и супер-аналитика' },
      { uz: 'Telegram kunlik digest + CSV backup', ru: 'Ежедневный Telegram-дайджест + CSV-бэкап' },
    ],
    faq: [
      { q: { uz: 'Hisobotlarni eksport qilish mumkinmi?', ru: 'Можно ли экспортировать отчёты?' }, a: { uz: 'Ha — CSV/Excel eksport, A4 PDF va Telegram bot orqali kunlik digest.', ru: 'Да — экспорт CSV/Excel, A4 PDF и ежедневный дайджест через Telegram-бота.' } },
    ],
    relatedFeatures: ['analytics', 'cashier'],
  },
  {
    slug: 'maosh-dasturi',
    keyword: { uz: 'Klinika maosh va hisob-kitob dasturi', ru: 'Программа зарплаты для клиники' },
    metaTitle: { uz: 'Maosh dasturi — Clary | Aqlli oylik, komissiya, avans, chek', ru: 'Программа зарплаты — Clary | Умная зарплата, комиссия, аванс, чек' },
    metaDescription: { uz: 'Clary maosh moduli — barcha xodimlar, oylik turlari (stavka, komissiya, soatbay), payday, avans/oldi, aqlli davr va avto-chek. Har xodim profil sahifasi bilan.', ru: 'Модуль зарплаты Clary — все сотрудники, типы оплаты (ставка, комиссия, почасовая), payday, аванс, умный период и авто-чек. С профилем по каждому сотруднику.' },
    intro: { uz: 'Clary maosh moduli xodimlar hisob-kitobini aqlli boshqaradi: stavka/komissiya/soatbay oylik, payday, avans va oldi, har xodimning profil sahifasi (kunlik daromad), aqlli davr va avtomatik chek.', ru: 'Модуль зарплаты Clary умно управляет расчётами с сотрудниками: оклад/комиссия/почасовая, payday, аванс, страница профиля каждого сотрудника (дневной доход), умный период и авто-чек.' },
    definition: { uz: 'Maosh dasturi — klinika xodimlari oyligini, komissiya va avanslarni hisoblovchi modul. Clary oylikni xizmatlardagi komissiya va soat/smena bo‘yicha avtomatik hisoblaydi.', ru: 'Программа зарплаты — модуль расчёта зарплаты, комиссии и авансов сотрудников клиники. Clary автоматически считает зарплату по комиссии с услуг и часам/сменам.' },
    benefits: [
      { uz: 'Oylik turlari: stavka, komissiya, soatbay', ru: 'Типы оплаты: ставка, комиссия, почасовая' },
      { uz: 'Avans/oldi + eslatma, payday', ru: 'Аванс + напоминание, payday' },
      { uz: 'Har xodim profil sahifasi — kunlik daromad', ru: 'Страница профиля сотрудника — дневной доход' },
      { uz: 'Avtomatik maosh cheki', ru: 'Автоматический зарплатный чек' },
    ],
    faq: [
      { q: { uz: 'Komissiya avtomatik hisoblanadimi?', ru: 'Считается ли комиссия автоматически?' }, a: { uz: 'Ha. Shifokor xizmatdan olgan komissiya avtomatik to‘planadi va oylikка qo‘shiladi.', ru: 'Да. Комиссия врача за услугу накапливается автоматически и добавляется к зарплате.' } },
    ],
    relatedFeatures: ['payroll', 'staff'],
  },
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
    tldr: {
      uz: 'Clary — O‘zbekiston klinikalari uchun bulutli boshqaruv dasturi. Demo 3 kun bepul, tariflar $25–120/oy. Bemorlar, navbat, kassa, diagnostika va dorixona bitta tizimda.',
      ru: 'Clary — облачная программа управления клиникой для Узбекистана. Демо 3 дня бесплатно, тарифы $25–120/мес. Пациенты, очередь, касса, диагностика и аптека в одной системе.',
    },
    definition: {
      uz: 'Klinika boshqaruv dasturi — bu klinikaning bemor qabuli, navbat, tibbiy yozuvlar, kassa va hisobotlarini bitta raqamli tizimga birlashtiruvchi dastur. Clary buni bulutda, o‘rnatishsiz amalga oshiradi.',
      ru: 'Программа управления клиникой — это программа, объединяющая приём пациентов, очередь, медицинские записи, кассу и отчёты в одну цифровую систему. Clary делает это в облаке, без установки.',
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
    tldr: {
      uz: 'Clary Hospital CRM — shifoxona va ko‘p filialli klinikalar uchun. Bemor yo‘li, statsionar, ko‘p filial va audit bitta tizimda. Enterprise tarifda cheksiz filial.',
      ru: 'Clary Hospital CRM — для больниц и сетевых клиник. Путь пациента, стационар, мультифилиал и аудит в одной системе. В тарифе Enterprise — неограниченно филиалов.',
    },
    definition: {
      uz: 'Hospital CRM — bu shifoxonaning bemorlar, jarayonlar va moliyaviy oqimini boshqaruvchi tizim. Oddiy CRM’dan farqi — tibbiy yo‘l (qabul → davolash → statsionar) va ko‘p filialni qo‘llab-quvvatlaydi.',
      ru: 'Hospital CRM — это система управления пациентами, процессами и финансовым потоком больницы. Отличие от обычной CRM — поддержка медицинского пути (приём → лечение → стационар) и мультифилиальности.',
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
    tldr: {
      uz: 'Clary is a multi-tenant clinic management software for Uzbekistan & CIS. Local payments (Click, Payme), 7 languages, cloud-based. Demo 3 days free, $25–120/mo.',
      ru: 'Clary — мультитенантная clinic management software для Узбекистана и СНГ. Локальные платежи (Click, Payme), 7 языков, облако. Демо 3 дня бесплатно, $25–120/мес.',
    },
    definition: {
      uz: 'Clinic management software is a platform that digitizes patient intake, scheduling, billing, diagnostics and reporting. Clary delivers this in the cloud, tuned for the CIS market.',
      ru: 'Clinic management software — платформа, которая оцифровывает приём пациентов, расписание, биллинг, диагностику и отчётность. Clary предоставляет это в облаке, под рынок СНГ.',
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
    tldr: {
      uz: 'Clary laboratoriya dasturi — tahlil buyurtmasidan natijagacha to‘liq oqim. QR-probirka, LOINC standart, ko‘p bosqichli validatsiya va bemorga avtomatik xabar.',
      ru: 'Лабораторная программа Clary — полный поток от заказа анализа до результата. QR-пробирка, стандарт LOINC, многоэтапная валидация и автоуведомление пациента.',
    },
    definition: {
      uz: 'Laboratoriya boshqaruv dasturi (LIS) — bu tahlil buyurtmasi, namuna kuzatuvi, natija kiritish va validatsiyasini boshqaruvchi tizim. Clary LOINC xalqaro standartini qo‘llaydi.',
      ru: 'Программа управления лабораторией (LIS) — это система управления заказом анализа, отслеживанием образцов, вводом и валидацией результатов. Clary использует международный стандарт LOINC.',
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
    tldr: {
      uz: 'Clary stomatologiya dasturi — tish kartasi, davolash rejasi, qabul jadvali va kassa bitta tizimda. Demo 3 kun bepul.',
      ru: 'Программа для стоматологии Clary — зубная карта, план лечения, расписание приёмов и касса в одной системе. Демо 3 дня бесплатно.',
    },
    definition: {
      uz: 'Stomatologiya klinika dasturi — bu tish kartasi, davolash rejasi va qabul jadvalini boshqaruvchi tizim. Clary buni stomatolog ish oqimiga moslab beradi.',
      ru: 'Программа для стоматологической клиники — это система управления зубной картой, планом лечения и расписанием приёмов. Clary адаптирует это под рабочий процесс стоматолога.',
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
    tldr: {
      uz: 'Clary diagnostika markazi dasturi — tekshiruv buyurtmasi, apparat jadvali, xulosa va bemor hisoboti. X-Ray, MRI, CT, USG, ECG.',
      ru: 'Программа для диагностического центра Clary — заказ исследований, расписание оборудования, заключение и отчёт пациента. Рентген, МРТ, КТ, УЗИ, ЭКГ.',
    },
    definition: {
      uz: 'Diagnostika markazi dasturi — bu tekshiruv buyurtmasi, apparat bandligi va shifokor xulosasini boshqaruvchi tizim. Clary X-Ray, MRI, CT, USG va ECG’ni qo‘llab-quvvatlaydi.',
      ru: 'Программа для диагностического центра — это система управления заказом исследований, занятостью оборудования и заключением врача. Clary поддерживает рентген, МРТ, КТ, УЗИ и ЭКГ.',
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
    tldr: {
      uz: 'Clary elektron navbat tizimi — QR-kiosk, online booking, real-time ekran va shifokor chaqiruvi. Navbat tartibsizligini yo‘qotadi.',
      ru: 'Система электронной очереди Clary — QR-киоск, онлайн-запись, экран в реальном времени и вызов врача. Устраняет беспорядок в очереди.',
    },
    definition: {
      uz: 'Elektron navbat tizimi — bu bemorlar navbatini raqamli boshqaruvchi tizim: QR-kiosk orqali navbat olish, ekranda raqam va shifokor chaqiruvi. Clary buni online booking bilan birga beradi.',
      ru: 'Система электронной очереди — это система цифрового управления очередью пациентов: получение очереди через QR-киоск, номер на экране и вызов врача. Clary предоставляет это вместе с онлайн-записью.',
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
    tldr: {
      uz: 'Clary — xususiy, ko‘p filialli yoki oilaviy klinikalar uchun bulutli boshqaruv platformasi. Base tarifi kichik klinika uchun, Enterprise — tarmoq uchun.',
      ru: 'Clary — облачная платформа управления для частных, сетевых и семейных клиник. Тариф Base для небольшой клиники, Enterprise — для сети.',
    },
    definition: {
      uz: 'Klinikalar uchun dastur — bu klinikaning bemor, jarayon va moliyasini boshqaruvchi tizim. Clary xususiy klinikadan ko‘p filialli tarmoqgacha moslashadi.',
      ru: 'Программа для клиник — это система управления пациентами, процессами и финансами клиники. Clary масштабируется от частной клиники до сети филиалов.',
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
    tldr: {
      uz: 'Clary laboratoriyalar uchun — tahlil oqimi, QR-probirka, LOINC standart va ko‘p bosqichli validatsiya. Mustaqil laboratoriya uchun ham ishlaydi.',
      ru: 'Clary для лабораторий — поток анализов, QR-пробирка, стандарт LOINC и многоэтапная валидация. Работает и для независимой лаборатории.',
    },
    definition: {
      uz: 'Laboratoriyalar uchun dastur (LIS) — bu tahlil buyurtmasi, namuna kuzatuvi va natija validatsiyasini boshqaruvchi tizim. Clary LOINC xalqaro standartini qo‘llaydi.',
      ru: 'Программа для лабораторий (LIS) — это система управления заказом анализа, отслеживанием образцов и валидацией результатов. Clary использует международный стандарт LOINC.',
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
    tldr: {
      uz: 'Clary stomatologiya klinikalari uchun — tish kartasi, davolash rejasi, qabul jadvali va kassa. Stomatologiya moduli barcha tariflarga kiradi.',
      ru: 'Clary для стоматологических клиник — зубная карта, план лечения, расписание приёмов и касса. Модуль стоматологии входит во все тарифы.',
    },
    definition: {
      uz: 'Stomatologiya uchun dastur — bu tish klinikasining tish kartasi, davolash rejasi va qabul jadvalini boshqaruvchi tizim. Clary buni stomatolog amaliyotiga moslab beradi.',
      ru: 'Программа для стоматологии — это система управления зубной картой, планом лечения и расписанием приёмов стоматологической клиники. Clary адаптирует это под практику стоматолога.',
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
    tldr: {
      uz: 'Clary diagnostika markazlari uchun — apparat jadvali, tekshiruv buyurtmasi va shifokor xulosasi bitta tizimda. X-Ray, MRI, CT, USG.',
      ru: 'Clary для диагностических центров — расписание оборудования, заказ исследования и заключение врача в одной системе. Рентген, МРТ, КТ, УЗИ.',
    },
    definition: {
      uz: 'Diagnostika markazlari uchun dastur — bu apparat bandligi, tekshiruv buyurtmasi va xulosani boshqaruvchi tizim. Clary qo‘shaloq buyurtma oldini oladi.',
      ru: 'Программа для диагностических центров — это система управления занятостью оборудования, заказом исследования и заключением. Clary предотвращает двойные заказы.',
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
    tldr: {
      uz: 'Clary shifokorlar uchun — bemor kartasi, SOAP ko‘rik, ICD-10 tashxis, retsept va vital belgilar. Klaviatura bilan optimallashtirilgan, tezkor.',
      ru: 'Clary для врачей — карта пациента, осмотр SOAP, диагноз ICD-10, рецепт и витальные показатели. Оптимизировано под клавиатуру, быстро.',
    },
    definition: {
      uz: 'Shifokorlar uchun dastur — bu bemor kartasi, ko‘rik, tashxis va retseptni boshqaruvchi ish oynasi. Clary ICD-10 tasniflagichi va SOAP ko‘rik bilan ishlaydi.',
      ru: 'Программа для врачей — это рабочее окно управления картой пациента, осмотром, диагнозом и рецептом. Clary работает с классификатором ICD-10 и осмотром SOAP.',
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
