// =============================================================================
// Hujjatlar (docs) — YAGONA MANBA / evergreen cornerstone.
// CMS (by_kind['doc']) bilan MERGE qilinadi: CMS slug ustun (override),
// evergreen faqat CMS'da yo'q bo'lsa qo'shiladi. Shu tarzda docs sahifalari
// bo'sh "tez orada to'ldiriladi" placeholder o'rniga har doim real kontentli.
//
// Yangi hujjat FAQAT shu yerga qo'shiladi. docs.astro (ro'yxat),
// docs/[slug].astro (getStaticPaths + tana), sitemap.xml.ts shu fayldan oladi.
//
// MUHIM: bu yerdagi matn HAQIQIY mahsulotga mos. API bo'limi past darajadagi
// endpoint shartnomalarini IXTIRO QILMAYDI — operator darajasidagi halol
// ko'rsatma beradi.
// =============================================================================

export interface DocPage {
  slug: string;
  section: string;
  title: string;
  bodyHtml: string;
}

// Bo'limlar tartibi (docs.astro shu tartibda guruhlaydi).
export const DOC_SECTION_ORDER = ['Boshlash', 'Modullar', 'Integratsiyalar', 'API'];

export const DOC_PAGES: DocPage[] = [
  // ---------------------------------------------------------------- Boshlash
  {
    slug: 'getting-started',
    section: 'Boshlash',
    title: 'Tezkor boshlash (5 daqiqa)',
    bodyHtml: `
      <p>Clary — klinika, shifoxona va laboratoriya uchun Healthcare ERP. Bu qo'llanma sizni 5 daqiqada birinchi qabulgacha olib boradi.</p>
      <h2>1. Hisob ochish</h2>
      <p><a href="/signup">clary.uz/signup</a> orqali ro'yxatdan o'ting yoki <a href="/demo">tayyor demo</a> bilan boshlang. Email tasdiqlangach klinika ustasi (setup wizard) ochiladi.</p>
      <h2>2. Klinikani sozlash</h2>
      <p>Klinika nomi, manzili, asosiy rang va logotipni kiriting. Tashkilot turi (klinika / laboratoriya / dorixona / stomatologiya) modullar to'plamini belgilaydi.</p>
      <h2>3. Xizmatlar va narxlar</h2>
      <p>Sozlamalar → Xizmatlar bo'limida xizmat, narx (UZS) va kategoriyani qo'shing. Bularsiz kassa va qabul ishlamaydi.</p>
      <h2>4. Xodimlarni qo'shish</h2>
      <p>Sozlamalar → Xodimlar: reception, shifokor, hamshira, kassir akkauntlarini yarating va rol bering.</p>
      <h2>5. Birinchi qabul</h2>
      <p>Qabulxona → "Yangi bemor" → navbatga qo'shing → shifokor qabul qiladi → kassa to'lovni oladi → chek chiqadi. Tabriklaymiz, birinchi to'liq oqim tugadi.</p>
      <p>Keyingi: <a href="/docs/create-clinic">klinikani chuqurroq sozlash</a> va <a href="/docs/add-staff">rollarni belgilash</a>.</p>
    `,
  },
  {
    slug: 'create-clinic',
    section: 'Boshlash',
    title: 'Klinika yaratish va sozlash',
    bodyHtml: `
      <p>Klinika — Clary'dagi asosiy "ijara birligi" (tenant). Har bir klinikaning ma'lumotlari boshqalardan to'liq ajratilgan (Postgres RLS izolyatsiyasi).</p>
      <h2>Asosiy ma'lumotlar</h2>
      <ul>
        <li><strong>Nom va slug</strong> — slug bemor havolalarida ishlatiladi</li>
        <li><strong>Brending</strong> — logotip, asosiy rang (chek va interfeysda)</li>
        <li><strong>Aloqa</strong> — manzil, telefon, ish vaqti</li>
      </ul>
      <h2>Bo'limlar (modullar)</h2>
      <p>Sozlamalardan kerakli modullarni yoqing: Qabulxona, Kassa, Dorixona, Laboratoriya, Diagnostika, Statsionar, Stomatologiya. Faqat ishlatadiganlaringizni yoqing — interfeys soddaroq bo'ladi.</p>
      <h2>Soliq va chek</h2>
      <p>Chek shabloni (klinika nomi, manzil, INN) va termal printer kengligini (58mm/80mm) sozlang. Desktop ilova jim (silent) chop etishni qo'llab-quvvatlaydi.</p>
      <h2>Filiallar</h2>
      <p>Bir nechta filial bo'lsa, har biri alohida bo'lim sifatida sozlanadi; analitika ularni birlashtirib ko'rsatadi.</p>
    `,
  },
  {
    slug: 'add-staff',
    section: 'Boshlash',
    title: "Xodimlarni qo'shish va rollarni belgilash",
    bodyHtml: `
      <p>Clary rolga asoslangan kirish nazoratiga (RBAC) ega — har xodim faqat o'z ishiga kerakli ekranlarni ko'radi.</p>
      <h2>Asosiy rollar</h2>
      <ul>
        <li><strong>clinic_admin</strong> — to'liq nazorat, sozlamalar, analitika</li>
        <li><strong>reception</strong> — qabulxona, navbat, bemor ro'yxati</li>
        <li><strong>doctor</strong> — shifokor konsoli, EMR, retsept</li>
        <li><strong>nurse</strong> — hamshira amallari</li>
        <li><strong>cashier</strong> — kassa, to'lov, smena</li>
      </ul>
      <h2>Xodim qo'shish</h2>
      <p>Sozlamalar → Xodimlar → "Qo'shish": ism, email, rol. Xodim emaildagi havola orqali parol o'rnatadi.</p>
      <h2>Komissiya va maosh</h2>
      <p>Shifokorlarga xizmat bo'yicha komissiya foizini belgilash mumkin — u avtomatik <a href="/docs/cashier">kassa</a> va maosh hisobiga tushadi.</p>
      <h2>Xavfsizlik</h2>
      <p>Har bir muhim amal audit izida qoladi. Xodim ishdan bo'shasa, akkauntini darhol o'chiring yoki bloklang.</p>
    `,
  },
  // ---------------------------------------------------------------- Modullar
  {
    slug: 'reception',
    section: 'Modullar',
    title: 'Qabulxona va navbat',
    bodyHtml: `
      <p>Qabulxona — bemor oqimining boshlanish nuqtasi: ro'yxatga olish, navbat va jadval.</p>
      <h2>Bemorni ro'yxatga olish</h2>
      <p>Telefon raqami bo'yicha qidiring — bemor topilsa tarixi ochiladi, topilmasa yangi karta (MRN avtomatik) yaratiladi.</p>
      <h2>Navbatga qo'shish</h2>
      <p>Bemorni shifokor yoki xizmatga biriktiring. Navbat raqami beriladi; bemor ekranda yoki mobil ilovada o'z o'rnini ko'radi.</p>
      <h2>Holatlar</h2>
      <p>Kutyapti → Qabulda → Yakunlangan. Har holat real vaqtda shifokor va kassaga ko'rinadi.</p>
      <h2>Maslahat</h2>
      <p>Avtomatik SMS eslatma (24 soat oldin) no-show'ni ~60% kamaytiradi — <a href="/docs/eskiz-sms">Eskiz SMS</a> ni ulang.</p>
    `,
  },
  {
    slug: 'cashier',
    section: 'Modullar',
    title: 'Kassa va smena',
    bodyHtml: `
      <p>Kassa moduli to'lov, qarzdorlik, smena va kassa hisobotini boshqaradi — barchasi moliyaviy daftarga (patient_ledger) ulangan.</p>
      <h2>To'lov qabul qilish</h2>
      <p>Bemor xizmatlarini tanlang, to'lov usulini belgilang (naqd, plastik, o'tkazma, Humo, Uzcard, Click, Payme) va chek chiqaring. Aralash (split) to'lov ham qo'llab-quvvatlanadi.</p>
      <h2>Qarzdorlik</h2>
      <p>To'liq to'lanmagan summa bemor balansida qarz bo'lib qoladi. Qarzdorlar alohida sahifada; qarz to'langanda alohida chek chiqadi.</p>
      <h2>Smena (kassa ochish/yopish)</h2>
      <p>Smena boshida boshlang'ich qoldiq kiritiladi, oxirida tizim kutilgan va haqiqiy summani solishtiradi — kamomad/ortiqcha aniqlanadi.</p>
      <h2>Naqd va seyf</h2>
      <p>Naqd pul kassa yashigida (cash_drawer) yig'iladi; inkassatsiya orqali seyfga o'tkaziladi. Inkassatsiya foydani kamaytirmaydi — bu shunchaki pul harakati.</p>
    `,
  },
  {
    slug: 'pharmacy',
    section: 'Modullar',
    title: 'Dorixona POS va ombor',
    bodyHtml: `
      <p>Dorixona moduli sotuv (POS) va ombor (zaxira, amal qilish muddati) ni birlashtiradi.</p>
      <h2>Sotuv</h2>
      <p>Dori tanlanadi, miqdor kiritiladi, to'lov olinadi. Amal qilish muddati o'tgan dori sotuvga bloklanadi.</p>
      <h2>Ombor</h2>
      <p>Har sotuv zaxiradan avtomatik ayiriladi. Partiya (batch), kelgan narx va amal qilish muddati kuzatiladi.</p>
      <h2>Chegirma va foyda</h2>
      <p>Chegirma berilsa, foyda real vaqtda qayta hisoblanadi — chegirma foydadan ayiriladi, sotuvni zararga aylantirmaydi.</p>
      <h2>Qaytarish va inventarizatsiya</h2>
      <p>Sotuvni qaytarish zaxirani tiklaydi. Davriy reconcile (solishtirish) haqiqiy qoldiqni tizim bilan tenglashtiradi.</p>
    `,
  },
  {
    slug: 'lab',
    section: 'Modullar',
    title: 'Laboratoriya (LIS)',
    bodyHtml: `
      <p>Laboratoriya axborot tizimi (LIS) — tahlil buyurtmasidan natijagacha bo'lgan oqim.</p>
      <h2>Buyurtma</h2>
      <p>Shifokor yoki reception tahlil buyuradi; namuna identifikatori (barcode) beriladi.</p>
      <h2>Natija kiritish</h2>
      <p>Laborant natijalarni kiritadi; referens qiymatlardan chetga chiqqanlari ajratib ko'rsatiladi.</p>
      <h2>Natijani yuborish</h2>
      <p>Tayyor natija bemorga SMS havola orqali yuboriladi yoki PDF/A4 sifatida chop etiladi — klinikaga qaytish shart emas.</p>
      <h2>Integratsiya</h2>
      <p>Natijalar bemor 360° tarixiga tushadi va keyingi qabulda shifokorga darhol ko'rinadi.</p>
    `,
  },
  {
    slug: 'diagnostics',
    section: 'Modullar',
    title: 'Diagnostika',
    bodyHtml: `
      <p>Diagnostika moduli UZI, EKG, rentgen va boshqa instrumental tekshiruvlarni boshqaradi.</p>
      <h2>Buyurtma va navbat</h2>
      <p>Tekshiruv buyuriladi, bemor diagnostika navbatiga qo'shiladi.</p>
      <h2>Xulosa</h2>
      <p>Shifokor xulosa va tasvirlarni biriktiradi; natija bemor tarixiga ulanadi.</p>
      <h2>To'lov</h2>
      <p>Diagnostika xizmati ham kassaga ulangan — to'lov va komissiya avtomatik hisoblanadi.</p>
    `,
  },
  {
    slug: 'inpatient',
    section: 'Modullar',
    title: 'Statsionar',
    bodyHtml: `
      <p>Statsionar moduli yotoq bemorlarini, xizmatlarni, depozit va to'lovlarni boshqaradi.</p>
      <h2>Yotqizish</h2>
      <p>Bemor palata/yotoqqa biriktiriladi; qarovchi (caretaker) ma'lumoti qo'shiladi.</p>
      <h2>Xizmat qo'shish</h2>
      <p>Har xizmat alohida shifokor va komissiya bilan qo'shiladi — kunlik xarajatlar yig'iladi.</p>
      <h2>Depozit va to'lov</h2>
      <p>Bemor oldindan depozit qoldiradi; xizmatlar undan ayiriladi. Yakunda chek yoki A4 PDF hisob chiqadi.</p>
      <h2>Jurnal</h2>
      <p>Barcha amallar statsionar jurnalida; xato yozuvni savatchaga (trash) o'tkazib qaytarish mumkin.</p>
    `,
  },
  // ---------------------------------------------------------- Integratsiyalar
  {
    slug: 'click-payme',
    section: 'Integratsiyalar',
    title: "Click va Payme to'lov tizimlari",
    bodyHtml: `
      <p>Clary mahalliy to'lov tizimlarini "o'zingni kalitingni keltir" (BYO) modeli bilan qo'llaydi — pullar to'g'ridan-to'g'ri sizning merchant hisobingizga tushadi.</p>
      <h2>Sozlash</h2>
      <ol>
        <li>Click yoki Payme merchant kabinetidan kalitlarni oling</li>
        <li>Sozlamalar → To'lov tizimlari bo'limiga kiriting</li>
        <li>Test to'lov bilan tekshiring</li>
      </ol>
      <h2>Nega BYO?</h2>
      <p>Clary pulni o'rtada ushlamaydi — komissiya va hisob-kitob to'liq sizniki. Bu shaffof va xavfsiz.</p>
      <p>Qo'llab-quvvatlanadigan boshqalar: Uzum, Humo, Uzcard, Apelsin.</p>
    `,
  },
  {
    slug: 'eskiz-sms',
    section: 'Integratsiyalar',
    title: 'Eskiz SMS',
    bodyHtml: `
      <p>SMS bildirishnomalari — qabul eslatmasi, natija havolasi, follow-up. Mahalliy provayder (Eskiz.uz) yetkazib berishni kafolatlaydi.</p>
      <h2>Ulash</h2>
      <ol>
        <li>Eskiz.uz kabinetidan API token oling</li>
        <li>Sozlamalar → SMS bo'limiga kiriting</li>
        <li>Jo'natuvchi nomini (nick) tasdiqlang</li>
        <li>Test SMS yuboring</li>
      </ol>
      <h2>Shablonlar</h2>
      <p>Eslatma, tasdiqlash, natija va follow-up uchun tayyor shablonlar — bemor ismi va vaqt avtomatik qo'yiladi.</p>
      <p>Playmobile ham muqobil provayder sifatida qo'llab-quvvatlanadi.</p>
    `,
  },
  {
    slug: 'mbank',
    section: 'Integratsiyalar',
    title: "QR orqali to'lov",
    bodyHtml: `
      <p>QR to'lov kassada turishni tezlashtiradi — bemor telefon ilovasi orqali skanerlaydi va to'laydi.</p>
      <h2>Qanday ishlaydi</h2>
      <p>Kassada to'lov summasiga QR generatsiya qilinadi; bemor o'z bank/to'lov ilovasi bilan to'laydi. To'lov tasdiqlangach chek chiqadi.</p>
      <h2>Sozlash</h2>
      <p>Mos to'lov provayderingiz merchant kalitlarini Sozlamalar → To'lov tizimlari bo'limiga kiriting. Aniq provayder qo'llab-quvvatlashini bilish uchun <a href="/contact">biz bilan bog'laning</a>.</p>
    `,
  },
  {
    slug: 'webhooks',
    section: 'Integratsiyalar',
    title: 'Webhooks',
    bodyHtml: `
      <p>Webhook'lar Clary'dagi hodisalarni (masalan to'lov yoki yangi qabul) tashqi tizimingizga real vaqtda yetkazadi.</p>
      <h2>Foydalanish holatlari</h2>
      <ul>
        <li>To'lov amalga oshganda buxgalteriya tizimini xabardor qilish</li>
        <li>Yangi bemorni tashqi CRM bilan sinxronlash</li>
        <li>Telegram hisobot botiga voqea yuborish</li>
      </ul>
      <h2>Xavfsizlik</h2>
      <p>Har bir webhook imzo (signature) bilan keladi — qabul qiluvchi tomonda tekshiring. Endpoint faqat HTTPS bo'lishi shart.</p>
      <p>Webhook sozlash uchun Enterprise tarif kerak — <a href="/contact">murojaat qiling</a>.</p>
    `,
  },
  // --------------------------------------------------------------------- API
  {
    slug: 'rest-api',
    section: 'API',
    title: "REST API umumiy ma'lumot",
    bodyHtml: `
      <p>Clary REST API tashqi integratsiyalar uchun. Bu sahifa umumiy tamoyillarni beradi; to'liq endpoint havolasi API kirish so'rovidan keyin beriladi.</p>
      <h2>Asoslar</h2>
      <ul>
        <li><strong>Asosiy URL:</strong> <code>https://api.clary.uz/api/v1</code></li>
        <li><strong>Format:</strong> JSON (so'rov va javob)</li>
        <li><strong>Protokol:</strong> faqat HTTPS</li>
      </ul>
      <h2>Versiyalash</h2>
      <p>API versiyasi yo'l prefiksida (<code>/api/v1</code>). Buzuvchi o'zgarishlar yangi versiyada chiqadi.</p>
      <h2>Kirish so'rash</h2>
      <p>API integratsiyasi Enterprise tarifda mavjud. <a href="/contact">Biz bilan bog'laning</a> — sizga kalit va to'liq hujjat beramiz.</p>
      <p>Keyingi: <a href="/docs/auth">Authentication</a> va <a href="/docs/rate-limits">Rate limits</a>.</p>
    `,
  },
  {
    slug: 'auth',
    section: 'API',
    title: 'Authentication',
    bodyHtml: `
      <p>Clary API token asosida autentifikatsiya qiladi. So'rovlaringizni token bilan imzolang.</p>
      <h2>Token</h2>
      <p>Har bir so'rovda <code>Authorization: Bearer &lt;token&gt;</code> sarlavhasini yuboring. Token Enterprise integratsiya sozlamasida beriladi.</p>
      <h2>Xavfsizlik qoidalari</h2>
      <ul>
        <li>Tokenni hech qachon klient (brauzer/mobil) kodida saqlamang</li>
        <li>Tokenni faqat server-to-server so'rovlarda ishlating</li>
        <li>Shubha bo'lsa tokenni darhol qayta generatsiya qiling</li>
      </ul>
      <h2>Izolyatsiya</h2>
      <p>Har token bitta klinikaga bog'langan — boshqa klinika ma'lumotiga kira olmaysiz (RLS bilan kafolatlangan).</p>
    `,
  },
  {
    slug: 'rate-limits',
    section: 'API',
    title: 'Rate limits',
    bodyHtml: `
      <p>API barqarorligini ta'minlash uchun so'rovlar soni cheklanadi (rate limiting).</p>
      <h2>Tamoyil</h2>
      <p>Cheklov token bo'yicha qo'llanadi. Limitdan oshsangiz <code>429 Too Many Requests</code> javobi qaytadi.</p>
      <h2>Tavsiyalar</h2>
      <ul>
        <li><code>429</code> kelganda eksponensial kutib qayta urinish (exponential backoff)</li>
        <li>Ko'p ma'lumotni sahifalab (pagination) oling</li>
        <li>Webhook'lardan foydalanib polling'ni kamaytiring</li>
      </ul>
      <h2>Aniq limitlar</h2>
      <p>Sizning integratsiyangizga mos aniq limitlar kirish kaliti bilan birga beriladi. Yuqori hajm kerak bo'lsa <a href="/contact">murojaat qiling</a>.</p>
    `,
  },
];

export const DOC_PAGES_BY_SLUG: Record<string, DocPage> = Object.fromEntries(
  DOC_PAGES.map((d) => [d.slug, d]),
);

export const ALL_DOC_SLUGS: string[] = DOC_PAGES.map((d) => d.slug);
