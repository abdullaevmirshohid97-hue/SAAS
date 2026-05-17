// =============================================================================
// Comparison sahifalari ma'lumoti — "Clary vs X" (STAGE 9)
// =============================================================================
// Halol, faktik taqqoslash — raqobatchini yomonlamasdan. uz + ru.

import type { Bi } from './seo-pages';

export interface ComparisonRow {
  /** Taqqoslash mezoni. */
  criterion: Bi;
  /** Clary ustuni. */
  clary: Bi;
  /** Raqobatchi ustuni. */
  rival: Bi;
  /** Clary ushbu qatorda yutuqdami (yashil belgi). */
  claryWins: boolean;
}

export interface ComparisonData {
  slug: string;
  /** Raqobatchi nomi. */
  rivalName: string;
  keyword: Bi;
  metaTitle: Bi;
  metaDescription: Bi;
  intro: Bi;
  /** Taqqoslash jadvali. */
  rows: ComparisonRow[];
  /** "Nega Clary" bandlari. */
  whyClary: Bi[];
  faq: Array<{ q: Bi; a: Bi }>;
}

export const COMPARISONS: ComparisonData[] = [
  {
    slug: 'vs-excel',
    rivalName: 'Excel',
    keyword: { uz: 'Clary yoki Excel — klinika uchun qaysi biri?', ru: 'Clary или Excel — что выбрать для клиники?' },
    metaTitle: {
      uz: 'Clary vs Excel — klinika boshqaruvi uchun taqqoslash',
      ru: 'Clary vs Excel — сравнение для управления клиникой',
    },
    metaDescription: {
      uz: 'Klinikani Excel’da yuritish va Clary boshqaruv dasturi — halol taqqoslash: xavfsizlik, navbat, kassa, hisobot va xatolar.',
      ru: 'Ведение клиники в Excel и программа Clary — честное сравнение: безопасность, очередь, касса, отчётность и ошибки.',
    },
    intro: {
      uz: 'Ko‘p klinikalar Excel’dan boshlaydi — bepul va tanish. Lekin klinika o‘sgan sari Excel cheklovlari sezila boshlaydi: bir vaqtda bir necha xodim ishlay olmaydi, navbat yo‘q, xatolar yo‘qoladi, zaxira yo‘q. Quyida halol taqqoslash.',
      ru: 'Многие клиники начинают с Excel — бесплатно и привычно. Но по мере роста клиники ограничения Excel становятся ощутимыми: несколько сотрудников не могут работать одновременно, нет очереди, ошибки теряются, нет резервных копий. Ниже честное сравнение.',
    },
    rows: [
      {
        criterion: { uz: 'Bir vaqtda ko‘p xodim', ru: 'Несколько сотрудников одновременно' },
        clary: { uz: 'Ha — har xodim o‘z oynasida', ru: 'Да — каждый сотрудник в своём окне' },
        rival: { uz: 'Fayl bloklanadi yoki konflikt', ru: 'Файл блокируется или конфликт' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Elektron navbat', ru: 'Электронная очередь' },
        clary: { uz: 'QR-kiosk, ekran, online booking', ru: 'QR-киоск, экран, онлайн-запись' },
        rival: { uz: 'Yo‘q', ru: 'Нет' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Ma’lumot xavfsizligi', ru: 'Безопасность данных' },
        clary: { uz: 'Shifrlangan, rollar, kunlik zaxira', ru: 'Шифрование, роли, ежедневный бэкап' },
        rival: { uz: 'Fayl o‘chsa — yo‘qoladi', ru: 'Удалён файл — данные потеряны' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Kassa va moliyaviy hisobot', ru: 'Касса и финансовый отчёт' },
        clary: { uz: 'Avtomatik, real vaqtda', ru: 'Автоматически, в реальном времени' },
        rival: { uz: 'Qo‘lda formulalar, xato xavfi', ru: 'Ручные формулы, риск ошибок' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Narx', ru: 'Цена' },
        clary: { uz: '$25–120/oy', ru: '$25–120/мес' },
        rival: { uz: 'Bepul (litsenziya bilan)', ru: 'Бесплатно (с лицензией)' },
        claryWins: false,
      },
      {
        criterion: { uz: 'Audit — kim nima o‘zgartirdi', ru: 'Аудит — кто что изменил' },
        clary: { uz: 'Har amal log’da', ru: 'Каждое действие в логе' },
        rival: { uz: 'Yo‘q', ru: 'Нет' },
        claryWins: true,
      },
    ],
    whyClary: [
      { uz: 'Bemor ma’lumoti hech qachon yo‘qolmaydi — bulutda, kunlik zaxira', ru: 'Данные пациентов никогда не теряются — облако, ежедневный бэкап' },
      { uz: 'Klinika o‘sganda tizim ham o‘sadi — Excel cheklov qo‘yadi', ru: 'Система растёт вместе с клиникой — Excel ставит ограничения' },
      { uz: 'Demo 3 kun bepul — xavfsiz sinab ko‘ring', ru: 'Демо 3 дня бесплатно — попробуйте без риска' },
    ],
    faq: [
      {
        q: { uz: 'Excel’dagi ma’lumotni Clary’ga ko‘chirish mumkinmi?', ru: 'Можно ли перенести данные из Excel в Clary?' },
        a: {
          uz: 'Ha. Onboarding bosqichida bemorlar, xodimlar va xizmatlar ro‘yxati Excel’dan ko‘chiriladi.',
          ru: 'Да. На этапе онбординга список пациентов, сотрудников и услуг переносится из Excel.',
        },
      },
    ],
  },
  {
    slug: 'vs-qogoz',
    rivalName: 'qog‘oz daftar',
    keyword: { uz: 'Clary yoki qog‘oz daftar — klinika uchun', ru: 'Clary или бумажный журнал — для клиники' },
    metaTitle: {
      uz: 'Clary vs qog‘oz daftar — klinika boshqaruvi taqqoslash',
      ru: 'Clary vs бумажный журнал — сравнение управления клиникой',
    },
    metaDescription: {
      uz: 'Qog‘oz daftar va Clary boshqaruv dasturi — halol taqqoslash: tezlik, xavfsizlik, qidiruv va hisobot.',
      ru: 'Бумажный журнал и программа Clary — честное сравнение: скорость, безопасность, поиск и отчётность.',
    },
    intro: {
      uz: 'Qog‘oz daftar — eng eski usul. Lekin bemor tarixini topish uchun papkalarni varaqlash, hisobotni qo‘lda yig‘ish va daftar yo‘qolishi xavfi — bularning hammasi vaqt va xato. Quyida taqqoslash.',
      ru: 'Бумажный журнал — самый старый способ. Но перелистывание папок для поиска истории пациента, ручной сбор отчётов и риск потери журнала — всё это время и ошибки. Ниже сравнение.',
    },
    rows: [
      {
        criterion: { uz: 'Bemor tarixini topish', ru: 'Поиск истории пациента' },
        clary: { uz: 'Soniyalarda qidiruv', ru: 'Поиск за секунды' },
        rival: { uz: 'Papkalarni varaqlash', ru: 'Перелистывание папок' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Hisobot tayyorlash', ru: 'Подготовка отчёта' },
        clary: { uz: 'Avtomatik, bir tugma', ru: 'Автоматически, одна кнопка' },
        rival: { uz: 'Qo‘lda, bir necha kun', ru: 'Вручную, несколько дней' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Yo‘qolish/yong‘in xavfi', ru: 'Риск потери/пожара' },
        clary: { uz: 'Bulutda — xavfsiz', ru: 'В облаке — безопасно' },
        rival: { uz: 'Yuqori', ru: 'Высокий' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Bir vaqtda foydalanish', ru: 'Одновременное использование' },
        clary: { uz: 'Cheksiz xodim', ru: 'Неограниченно сотрудников' },
        rival: { uz: 'Bitta daftar — bitta qo‘l', ru: 'Один журнал — одни руки' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Boshlang‘ich narx', ru: 'Начальная цена' },
        clary: { uz: '$25/oy dan', ru: 'от $25/мес' },
        rival: { uz: 'Arzon (daftar narxi)', ru: 'Дёшево (цена журнала)' },
        claryWins: false,
      },
    ],
    whyClary: [
      { uz: 'Bemor tarixi bir soniyada — qidiruv bilan', ru: 'История пациента за секунду — через поиск' },
      { uz: 'Oylik hisobot qo‘lda emas — avtomatik', ru: 'Месячный отчёт не вручную — автоматически' },
      { uz: 'Daftar yo‘qolmaydi, yonmaydi — bulut', ru: 'Журнал не теряется и не горит — облако' },
    ],
    faq: [
      {
        q: { uz: 'Qog‘oz daftardan o‘tish uchun kompyuter bilimi kerakmi?', ru: 'Нужны ли навыки работы с компьютером для перехода?' },
        a: {
          uz: 'Maxsus bilim shart emas. Clary interfeysi sodda, onboarding davomida xodimlar o‘rgatiladi.',
          ru: 'Специальные навыки не нужны. Интерфейс Clary простой, во время онбординга сотрудники обучаются.',
        },
      },
    ],
  },
  {
    slug: 'vs-medesk',
    rivalName: 'Medesk',
    keyword: { uz: 'Clary yoki Medesk — klinika dasturi taqqoslash', ru: 'Clary или Medesk — сравнение программ для клиник' },
    metaTitle: {
      uz: 'Clary vs Medesk — klinika boshqaruv dasturi taqqoslash',
      ru: 'Clary vs Medesk — сравнение программ управления клиникой',
    },
    metaDescription: {
      uz: 'Clary va Medesk klinika dasturlari — O‘zbekiston bozori uchun taqqoslash: mahalliy to‘lov, tillar, narx va modullar.',
      ru: 'Программы для клиник Clary и Medesk — сравнение для рынка Узбекистана: локальные платежи, языки, цена и модули.',
    },
    intro: {
      uz: 'Medesk — taniqli klinika SaaS. Clary esa O‘zbekiston va CIS bozori realiyalariga moslab qurilgan: mahalliy to‘lov tizimlari (Click, Payme), 7 til va mahalliy SMS provayderlar. Quyida faktik taqqoslash.',
      ru: 'Medesk — известная клиническая SaaS. Clary же построена с учётом реалий рынка Узбекистана и СНГ: локальные платёжные системы (Click, Payme), 7 языков и местные SMS-провайдеры. Ниже фактическое сравнение.',
    },
    rows: [
      {
        criterion: { uz: 'Mahalliy to‘lov (Click, Payme)', ru: 'Локальные платежи (Click, Payme)' },
        clary: { uz: 'O‘rnatilgan', ru: 'Встроено' },
        rival: { uz: 'Cheklangan / yo‘q', ru: 'Ограничено / нет' },
        claryWins: true,
      },
      {
        criterion: { uz: 'O‘zbek tili (lotin + kirill)', ru: 'Узбекский язык (латиница + кириллица)' },
        clary: { uz: 'To‘liq, 7 til', ru: 'Полностью, 7 языков' },
        rival: { uz: 'Cheklangan', ru: 'Ограничено' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Mahalliy SMS provayder (Eskiz)', ru: 'Местный SMS-провайдер (Eskiz)' },
        clary: { uz: 'BYO — o‘z provayderingiz', ru: 'BYO — свой провайдер' },
        rival: { uz: 'Cheklangan', ru: 'Ограничено' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Dorixona / ombor moduli', ru: 'Модуль аптеки / склада' },
        clary: { uz: 'Bor — POS + FIFO', ru: 'Есть — POS + FIFO' },
        rival: { uz: 'Mavjud', ru: 'Имеется' },
        claryWins: false,
      },
      {
        criterion: { uz: 'Statsionar moduli', ru: 'Модуль стационара' },
        clary: { uz: 'Bor — palatalar, vitals', ru: 'Есть — палаты, витальные показатели' },
        rival: { uz: 'Cheklangan', ru: 'Ограничено' },
        claryWins: true,
      },
    ],
    whyClary: [
      { uz: 'O‘zbekiston to‘lov va SMS tizimlari bilan to‘g‘ridan-to‘g‘ri ishlaydi', ru: 'Работает напрямую с платёжными и SMS-системами Узбекистана' },
      { uz: 'O‘zbek tilida to‘liq — xodimlaringizga tanish', ru: 'Полностью на узбекском — привычно вашим сотрудникам' },
      { uz: 'Mahalliy narx — dollarda, mahalliy bozorga mos', ru: 'Локальная цена — в долларах, под местный рынок' },
    ],
    faq: [
      {
        q: { uz: 'Clary Medesk’dan arzonroqmi?', ru: 'Clary дешевле Medesk?' },
        a: {
          uz: 'Clary tariflari $25–120/oy. Aniq narx solishtirish uchun ikkala tizim narxini o‘z klinikangiz hajmiga ko‘ra hisoblang.',
          ru: 'Тарифы Clary $25–120/мес. Для точного сравнения рассчитайте цену обеих систем по размеру вашей клиники.',
        },
      },
    ],
  },
  {
    slug: 'vs-1c-medicina',
    rivalName: '1C:Меdicina',
    keyword: { uz: 'Clary yoki 1C:Меdicina — taqqoslash', ru: 'Clary или 1С:Медицина — сравнение' },
    metaTitle: {
      uz: 'Clary vs 1C:Меdicina — klinika dasturi taqqoslash',
      ru: 'Clary vs 1С:Медицина — сравнение программ для клиник',
    },
    metaDescription: {
      uz: 'Clary va 1C:Меdicina — bulutli va o‘rnatiladigan klinika dasturlari taqqoslash: o‘rnatish, yangilanish, narx va qulaylik.',
      ru: 'Clary и 1С:Медицина — сравнение облачной и устанавливаемой программ для клиник: установка, обновления, цена и удобство.',
    },
    intro: {
      uz: '1C:Меdicina — kuchli, lekin server o‘rnatish, litsenziya va IT-mutaxassis talab qiladi. Clary esa to‘liq bulutli — o‘rnatish yo‘q, yangilanish avtomatik. Quyida taqqoslash.',
      ru: '1С:Медицина — мощная, но требует установки сервера, лицензии и IT-специалиста. Clary же полностью облачная — без установки, обновления автоматические. Ниже сравнение.',
    },
    rows: [
      {
        criterion: { uz: 'O‘rnatish', ru: 'Установка' },
        clary: { uz: 'Yo‘q — bulutda, darhol', ru: 'Нет — облако, сразу' },
        rival: { uz: 'Server + sozlash kerak', ru: 'Нужен сервер + настройка' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Yangilanish', ru: 'Обновления' },
        clary: { uz: 'Avtomatik, bepul', ru: 'Автоматически, бесплатно' },
        rival: { uz: 'Qo‘lda, ko‘pincha pullik', ru: 'Вручную, часто платно' },
        claryWins: true,
      },
      {
        criterion: { uz: 'IT-mutaxassis zarurati', ru: 'Нужен IT-специалист' },
        clary: { uz: 'Kerak emas', ru: 'Не нужен' },
        rival: { uz: 'Odatda kerak', ru: 'Обычно нужен' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Istalgan qurilmadan kirish', ru: 'Доступ с любого устройства' },
        clary: { uz: 'Brauzer orqali — har joydan', ru: 'Через браузер — откуда угодно' },
        rival: { uz: 'Odatda lokal tarmoq', ru: 'Обычно локальная сеть' },
        claryWins: true,
      },
      {
        criterion: { uz: 'Murakkab buxgalteriya', ru: 'Сложная бухгалтерия' },
        clary: { uz: 'Klinika moliyasi — yetarli', ru: 'Финансы клиники — достаточно' },
        rival: { uz: '1C ekotizimi — kuchli', ru: 'Экосистема 1С — мощная' },
        claryWins: false,
      },
    ],
    whyClary: [
      { uz: 'O‘rnatish, server va IT-xizmat xarajati yo‘q', ru: 'Нет затрат на установку, сервер и IT-обслуживание' },
      { uz: 'Yangilanishlar avtomatik — har doim eng yangi versiya', ru: 'Обновления автоматические — всегда последняя версия' },
      { uz: 'Uydan, telefondan, istalgan joydan ishlaydi', ru: 'Работает из дома, с телефона, откуда угодно' },
    ],
    faq: [
      {
        q: { uz: 'Clary internetsiz ishlaydimi?', ru: 'Работает ли Clary без интернета?' },
        a: {
          uz: 'Clary bulutli — internet kerak. Lekin qisqa uzilishlarga chidamli rejim mavjud, ulanish tiklanganda ma’lumot sinxronlanadi.',
          ru: 'Clary облачная — нужен интернет. Но есть устойчивый к коротким перебоям режим, при восстановлении связи данные синхронизируются.',
        },
      },
    ],
  },
];

export const ALL_COMPARISON_SLUGS = COMPARISONS.map((c) => c.slug);
