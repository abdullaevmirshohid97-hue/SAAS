// =============================================================================
// ROZILIK SHABLONLARI — boshlang'ich (default) matnlar
// =============================================================================
// Klinika birinchi marta rozilik sahifasini ochganda shu matnlar bazaga
// nusxalanadi (lazy seed) va shundan keyin klinika ularni O'ZI tahrirlaydi.
//
// ⚠️ HUQUQIY OGOHLANTIRISH: bu matnlar LOYIHA (draft) sifatida beriladi.
// Ishga tushirishdan oldin klinika yuristi ko'rib chiqishi va tasdiqlashi SHART.
// Asos: "Fuqarolar sog'lig'ini saqlash to'g'risida"gi qonun (265-I, 29.08.1996).
//
// Placeholder'lar chop etishda haqiqiy qiymatga almashtiriladi — ro'yxat
// PLACEHOLDERS'da (UI ham shu ro'yxatni ko'rsatadi).
// =============================================================================

export const CONSENT_CODES = ['general', 'inpatient', 'dental', 'personal_data'] as const;
export type ConsentCode = (typeof CONSENT_CODES)[number];

export const CONSENT_LANGS = ['uz', 'ru'] as const;
export type ConsentLang = (typeof CONSENT_LANGS)[number];

/** Shablon matnida ishlatiladigan o'rin egallovchilar (UI yordamchisi shuni ko'rsatadi). */
export const PLACEHOLDERS = [
  { key: 'bemor_fio', desc: 'Bemorning F.I.O.' },
  { key: 'tugilgan_sana', desc: "Tug'ilgan sana" },
  { key: 'bemor_manzil', desc: 'Bemor manzili' },
  { key: 'bemor_telefon', desc: 'Bemor telefoni' },
  { key: 'bemor_hujjat', desc: 'Pasport / ID raqami' },
  { key: 'klinika', desc: 'Klinika nomi' },
  { key: 'klinika_manzil', desc: 'Klinika manzili' },
  { key: 'klinika_telefon', desc: 'Klinika telefoni' },
  { key: 'shifokor', desc: 'Shifokor F.I.O.' },
  { key: 'muolaja', desc: 'Muolaja / xizmat nomi' },
  { key: 'sana', desc: 'Bugungi sana' },
  { key: 'imzolovchi', desc: 'Imzolovchi (bemor yoki vasiy)' },
] as const;

type Tpl = { code: ConsentCode; lang: ConsentLang; title: string; body: string };

const UZ_FOOTER = `
Men ushbu hujjatni to'liq o'qidim, mazmuni menga tushunarli va men unga to'liq roziman.
Men istalgan vaqtda ushbu rozilikni yozma ravishda qaytarib olish huquqiga ega ekanligimni bilaman.

Sana: {{sana}}

Bemor (yoki qonuniy vakili): {{imzolovchi}} _________________________ (imzo)

Tibbiyot xodimi: {{shifokor}} _________________________ (imzo)`;

const RU_FOOTER = `
Я полностью прочитал(а) настоящий документ, его содержание мне понятно, и я с ним согласен(на).
Мне известно, что я вправе отозвать настоящее согласие в любое время в письменной форме.

Дата: {{sana}}

Пациент (или законный представитель): {{imzolovchi}} _________________________ (подпись)

Медицинский работник: {{shifokor}} _________________________ (подпись)`;

export const DEFAULT_TEMPLATES: Tpl[] = [
  // ---------------------------------------------------------------- general
  {
    code: 'general',
    lang: 'uz',
    title: 'Tibbiy aralashuvga ixtiyoriy rozilik',
    body: `Men, {{bemor_fio}}, tug'ilgan sana: {{tugilgan_sana}}, manzil: {{bemor_manzil}},
hujjat: {{bemor_hujjat}}, telefon: {{bemor_telefon}} —

"{{klinika}}" tibbiyot muassasasida menga ko'rsatiladigan tibbiy xizmatlarga
(ko'rik, tekshiruv, tashxis qo'yish va davolash muolajalari) ixtiyoriy ravishda
va ongli holda ROZILIK bildiraman.

Menga tushunarli tilda quyidagilar tushuntirildi:
1. Sog'lig'im holati va qo'yilgan dastlabki tashxis;
2. Taklif etilayotgan tibbiy aralashuvning mohiyati va bosqichlari;
3. Aralashuvdan kutilayotgan natija;
4. Yuzaga kelishi mumkin bo'lgan asoratlar va nojo'ya ta'sirlar;
5. Muqobil davolash usullari hamda davolanishdan voz kechish oqibatlari;
6. Ko'rsatiladigan xizmatning narxi va to'lov tartibi.

Men savollar berish imkoniyatiga ega bo'ldim, olgan javoblarim meni qanoatlantirdi.

Men o'zim haqimda bergan ma'lumotlar (kasallik tarixi, allergiya, doimiy qabul
qilayotgan dorilar, surunkali kasalliklar) to'liq va haqiqiy ekanligini
tasdiqlayman. Noto'g'ri yoki to'liq bo'lmagan ma'lumot oqibatlari uchun
javobgarlik menda ekanligini tushunaman.${UZ_FOOTER}`,
  },
  {
    code: 'general',
    lang: 'ru',
    title: 'Добровольное информированное согласие на медицинское вмешательство',
    body: `Я, {{bemor_fio}}, дата рождения: {{tugilgan_sana}}, адрес: {{bemor_manzil}},
документ: {{bemor_hujjat}}, телефон: {{bemor_telefon}} —

даю добровольное и осознанное СОГЛАСИЕ на оказание мне медицинских услуг
(осмотр, обследование, постановка диагноза и лечебные процедуры) в медицинском
учреждении «{{klinika}}».

Мне в доступной форме разъяснено:
1. Состояние моего здоровья и предварительный диагноз;
2. Суть и этапы предлагаемого медицинского вмешательства;
3. Ожидаемый результат вмешательства;
4. Возможные осложнения и побочные эффекты;
5. Альтернативные методы лечения и последствия отказа от лечения;
6. Стоимость услуг и порядок оплаты.

Я имел(а) возможность задать вопросы и получил(а) удовлетворяющие меня ответы.

Подтверждаю, что сообщённые мною сведения (анамнез, аллергии, постоянно
принимаемые препараты, хронические заболевания) являются полными и достоверными,
и понимаю, что ответственность за последствия сообщения неверных или неполных
сведений лежит на мне.${RU_FOOTER}`,
  },

  // -------------------------------------------------------------- inpatient
  {
    code: 'inpatient',
    lang: 'uz',
    title: 'Statsionar davolanishga rozilik',
    body: `Men, {{bemor_fio}}, tug'ilgan sana: {{tugilgan_sana}}, manzil: {{bemor_manzil}},
hujjat: {{bemor_hujjat}} —

"{{klinika}}" muassasasining statsionar bo'limida davolanishga va shu davrda
zarur bo'lgan tibbiy aralashuvlarga ROZILIK bildiraman.

Davolovchi shifokor: {{shifokor}}
Rejalashtirilgan davolash: {{muolaja}}

Menga tushuntirildi:
1. Statsionar davolanishning zarurati va taxminiy muddati;
2. Rejalashtirilgan muolajalar, in'ektsiyalar va infuziyalar tartibi;
3. Zarur bo'lganda qo'shimcha tekshiruv va muolajalar tayinlanishi mumkinligi;
4. Yuzaga kelishi mumkin bo'lgan asoratlar (allergik reaktsiya, infeksiya,
   qon ketishi va boshqalar);
5. Statsionar ichki tartib-qoidalari va ularga rioya qilish majburiyati;
6. Davolanishning narxi, oldindan to'lov (depozit) va yakuniy hisob-kitob tartibi.

Men shifokor tavsiyalariga rioya qilish, ruxsatsiz bo'limni tark etmaslik va
o'z holatimdagi o'zgarishlar haqida tibbiyot xodimlarini darhol xabardor qilish
majburiyatini olaman.

Shifokor tavsiyalariga rioya qilmaslik oqibatida kelib chiqadigan holatlar uchun
javobgarlik menda ekanligini tushunaman.${UZ_FOOTER}`,
  },
  {
    code: 'inpatient',
    lang: 'ru',
    title: 'Согласие на стационарное лечение',
    body: `Я, {{bemor_fio}}, дата рождения: {{tugilgan_sana}}, адрес: {{bemor_manzil}},
документ: {{bemor_hujjat}} —

даю СОГЛАСИЕ на лечение в условиях стационара медицинского учреждения
«{{klinika}}» и на необходимые в этот период медицинские вмешательства.

Лечащий врач: {{shifokor}}
Планируемое лечение: {{muolaja}}

Мне разъяснено:
1. Необходимость стационарного лечения и его предполагаемая длительность;
2. Порядок планируемых процедур, инъекций и инфузий;
3. Возможность назначения дополнительных обследований и процедур при необходимости;
4. Возможные осложнения (аллергическая реакция, инфекция, кровотечение и др.);
5. Правила внутреннего распорядка стационара и обязанность их соблюдения;
6. Стоимость лечения, порядок внесения депозита и окончательного расчёта.

Обязуюсь соблюдать назначения врача, не покидать отделение без разрешения и
незамедлительно сообщать медицинскому персоналу об изменениях своего состояния.

Понимаю, что ответственность за последствия несоблюдения назначений врача
лежит на мне.${RU_FOOTER}`,
  },

  // ----------------------------------------------------------------- dental
  {
    code: 'dental',
    lang: 'uz',
    title: 'Stomatologik davolashga rozilik',
    body: `Men, {{bemor_fio}}, tug'ilgan sana: {{tugilgan_sana}}, manzil: {{bemor_manzil}} —

"{{klinika}}" muassasasida stomatologik davolashga ROZILIK bildiraman.

Davolovchi shifokor: {{shifokor}}
Davolash rejasi: {{muolaja}}

Menga tushuntirildi:
1. Og'iz bo'shlig'i holati va qo'yilgan tashxis;
2. Davolash rejasi, bosqichlari va taxminiy muddati;
3. Og'riqsizlantirish (anesteziya) qo'llanilishi va uning ta'siri;
4. Mumkin bo'lgan asoratlar: anestetikka allergik reaktsiya, shish, og'riq,
   qon ketishi, tish nervining shikastlanishi, plomba yoki protez muddatidan
   oldin ishdan chiqishi;
5. Davolashdan voz kechish oqibatlari (jarayonning kuchayishi, tishni yo'qotish);
6. Muqobil davolash usullari va ularning narxi;
7. Davolash narxi bosqichlar bo'yicha o'zgarishi mumkinligi — har bir
   o'zgarish men bilan oldindan kelishiladi.

Men davolash muvaffaqiyati o'z gigienam va shifokor tavsiyalariga rioya
qilishimga bog'liqligini, nazorat ko'riklariga o'z vaqtida kelishim
zarurligini tushunaman.${UZ_FOOTER}`,
  },
  {
    code: 'dental',
    lang: 'ru',
    title: 'Согласие на стоматологическое лечение',
    body: `Я, {{bemor_fio}}, дата рождения: {{tugilgan_sana}}, адрес: {{bemor_manzil}} —

даю СОГЛАСИЕ на стоматологическое лечение в медицинском учреждении «{{klinika}}».

Лечащий врач: {{shifokor}}
План лечения: {{muolaja}}

Мне разъяснено:
1. Состояние полости рта и поставленный диагноз;
2. План лечения, его этапы и предполагаемая длительность;
3. Применение обезболивания (анестезии) и его действие;
4. Возможные осложнения: аллергическая реакция на анестетик, отёк, боль,
   кровотечение, повреждение нерва зуба, преждевременный выход из строя
   пломбы или протеза;
5. Последствия отказа от лечения (прогрессирование процесса, потеря зуба);
6. Альтернативные методы лечения и их стоимость;
7. Возможность изменения стоимости по этапам — каждое изменение
   согласовывается со мной заранее.

Понимаю, что успех лечения зависит от соблюдения мной гигиены и рекомендаций
врача, а также от своевременного посещения контрольных осмотров.${RU_FOOTER}`,
  },

  // ---------------------------------------------------------- personal_data
  {
    code: 'personal_data',
    lang: 'uz',
    title: "Shaxsiy ma'lumotlarga ishlov berishga rozilik",
    body: `Men, {{bemor_fio}}, tug'ilgan sana: {{tugilgan_sana}}, telefon: {{bemor_telefon}} —

"{{klinika}}" muassasasiga (manzil: {{klinika_manzil}}) o'zimning shaxsiy
ma'lumotlarimga ishlov berishga ROZILIK bildiraman.

Ishlov beriladigan ma'lumotlar: familiya, ism, otasining ismi, tug'ilgan sana,
jinsi, manzil, aloqa telefoni, shaxsni tasdiqlovchi hujjat ma'lumotlari,
sog'liq holatiga oid ma'lumotlar (tashxis, tekshiruv natijalari, davolash
tarixi), to'lovlarga oid ma'lumotlar.

Ishlov berish maqsadi:
1. Tibbiy yordam ko'rsatish va uning sifatini ta'minlash;
2. Tibbiy hujjatlarni yuritish va saqlash;
3. Xizmatlar uchun hisob-kitob qilish;
4. Qabul, tahlil natijalari va eslatmalar bo'yicha men bilan bog'lanish
   (SMS, telefon qo'ng'irog'i, messenjer orqali).

Ma'lumotlarim qonun hujjatlarida belgilangan hollardan tashqari uchinchi
shaxslarga oshkor qilinmasligi menga tushuntirildi.

Men ushbu rozilikni istalgan vaqtda klinikaga yozma ariza berish orqali
qaytarib olish huquqiga ega ekanligimni, bunda tibbiy hujjatlar qonunda
belgilangan muddat davomida saqlanib qolishini bilaman.${UZ_FOOTER}`,
  },
  {
    code: 'personal_data',
    lang: 'ru',
    title: 'Согласие на обработку персональных данных',
    body: `Я, {{bemor_fio}}, дата рождения: {{tugilgan_sana}}, телефон: {{bemor_telefon}} —

даю СОГЛАСИЕ медицинскому учреждению «{{klinika}}» (адрес: {{klinika_manzil}})
на обработку моих персональных данных.

Обрабатываемые данные: фамилия, имя, отчество, дата рождения, пол, адрес,
контактный телефон, данные документа, удостоверяющего личность, сведения о
состоянии здоровья (диагноз, результаты обследований, история лечения),
сведения об оплатах.

Цели обработки:
1. Оказание медицинской помощи и обеспечение её качества;
2. Ведение и хранение медицинской документации;
3. Осуществление расчётов за услуги;
4. Связь со мной по вопросам приёма, результатов анализов и напоминаний
   (SMS, телефонный звонок, мессенджер).

Мне разъяснено, что мои данные не подлежат разглашению третьим лицам, за
исключением случаев, установленных законодательством.

Мне известно, что я вправе отозвать настоящее согласие в любое время путём
подачи письменного заявления в клинику, при этом медицинская документация
хранится в течение срока, установленного законодательством.${RU_FOOTER}`,
  },
];
