// =============================================================================
// Blog postlari — YAGONA MANBA (single source of truth).
// CMS (by_kind['post']) bo'sh bo'lganda shu ro'yxat ishlatiladi; CMS to'lsa
// override qiladi. blog.astro (kartalar), blog/[slug].astro (getStaticPaths +
// tana), sitemap.xml.ts (slug'lar) va feed.xml.ts (RSS) shu fayldan oladi —
// shuning uchun yangi post FAQAT shu yerga qo'shiladi.
//
// Tartib: eng yangisi birinchi (kartalar shu tartibda chiqadi).
// "Healthcare ERP" cornerstone postlari /solutions/healthcare-erp pillar
// sahifasini qo'llab-quvvatlaydi va "Clary = Healthcare ERP" entity signalini
// mustahkamlaydi (Google + AI tizimlari uchun).
// =============================================================================

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO yyyy-mm-dd
  author: string;
  category: string;
  bodyHtml: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'healthcare-erp-nima',
    title: "Healthcare ERP nima va klinikangizga nega kerak? (2026 qo'llanma)",
    excerpt:
      "ERP korxonani boshqarsa, Healthcare ERP — klinika, shifoxona va laboratoriyani bitta tizimda boshqaradi. Kontseptsiya, modullar va alohida dasturlardan farqi tushuntirilgan.",
    date: '2026-06-20',
    author: 'Clary Editorial',
    category: 'Healthcare ERP',
    bodyHtml: `
      <p class="lead">SAP yoki Oracle zavod va korxonalarni boshqaradi — ishlab chiqarish, ombor, moliya va kadrlarni bitta tizimda birlashtiradi. <strong>Healthcare ERP</strong> aynan shu g'oyani sog'liqni saqlashga olib keladi: qabulxona, kassa, dorixona, laboratoriya, statsionar va analitikani <em>yagona platformada</em> birlashtiradi. Bu maqolada Healthcare ERP nima, u klinikaga nega kerak va alohida dasturlardan qanday farq qilishini tushuntiramiz.</p>

      <h2>ERP nima — qisqacha</h2>
      <p>ERP (Enterprise Resource Planning) — korxonaning barcha resurslari va jarayonlarini bitta ma'lumotlar bazasi va bitta tizimda boshqarish. Asosiy g'oya: <strong>yagona haqiqat manbai</strong> (single source of truth). Bir bo'lim kiritgan ma'lumot avtomatik tarzda boshqa bo'limlarga ham ko'rinadi — qayta kiritish, mos kelmaslik va "qaysi Excel to'g'ri?" muammosi yo'qoladi.</p>

      <h2>Healthcare ERP — bu nima?</h2>
      <p>Healthcare ERP — klinika, shifoxona, laboratoriya, dorixona va diagnostika markazining <strong>butun ish oqimini</strong> bitta tizimda boshqaradigan platforma. Bemor qabulga yozilganidan to chek chiqarilib, hisobotda aks etgunига qadar — barchasi bir joyda:</p>
      <ul>
        <li><strong>Qabulxona va navbat</strong> — bemorni ro'yxatdan o'tkazish, navbat, jadval</li>
        <li><strong>Kassa va moliya</strong> — to'lov, qarzdorlik, smena, kassa hisoboti</li>
        <li><strong>Shifokor konsoli (EMR/EHR)</strong> — elektron tibbiy karta, retsept, tashxis</li>
        <li><strong>Laboratoriya (LIS)</strong> va diagnostika</li>
        <li><strong>Dorixona</strong> — ombor, sotuv, amal qilish muddati</li>
        <li><strong>Statsionar</strong> — yotoq, xizmatlar, deposit</li>
        <li><strong>Maosh va kadrlar</strong> — xodimlar, komissiya, oylik</li>
        <li><strong>Analitika / BI</strong> — daromad, KPI, prognoz</li>
      </ul>
      <p>Eng muhimi — bularning hammasi <strong>bir-biriga ulangan</strong>. Shifokor xizmat yozsa, u avtomatik kassaga tushadi; kassa to'lovni qabul qilsa, u darhol moliyaviy hisobotda aks etadi; dorixona sotuvini ombor zaxirasidan ayiradi.</p>

      <h2>Klinikaga Healthcare ERP nega kerak?</h2>
      <h3>1. Ma'lumot orollari (data silos) yo'qoladi</h3>
      <p>Ko'p klinikada kassada bitta dastur, dorixonada boshqasi, laboratoriyada uchinchisi ishlaydi. Natijada hech kim aniq daromadni bilmaydi — har bo'lim o'z raqamini aytadi. Healthcare ERP bularni birlashtiradi: <strong>bitta haqiqat, bitta hisobot</strong>.</p>
      <h3>2. Ikki marta kiritish va xatolar kamayadi</h3>
      <p>Bemor ma'lumotini reception bir marta kiritadi — shifokor, kassa, laboratoriya hammasi shu ma'lumotni ko'radi. Qayta yozish yo'q degani — xato kam, vaqt tejaladi.</p>
      <h3>3. Real-time moliyaviy nazorat</h3>
      <p>Rahbar telefonidan bugungi daromad, qarzdorlik, kassa qoldig'i va eng daromadli xizmatlarni real vaqtda ko'radi. "Oy oxirida Excel yig'aman" davri tugaydi.</p>
      <h3>4. Xavfsizlik va muvofiqlik bitta joyda</h3>
      <p>Bitta tizim — bitta kirish nazorati (RBAC), bitta audit izi, bitta ma'lumot himoyasi. O'zbekiston 547-son qonuni (Persdata) talablariga moslashish ham osonlashadi.</p>

      <h2>Healthcare ERP vs alohida dasturlar</h2>
      <p>Alohida dasturlar arzonroq ko'rinadi, lekin <strong>yashirin xarajatlari</strong> bor: integratsiya, ikki marta kiritish, har oy raqamlarni solishtirish, bir nechta yetkazib beruvchi bilan ishlash va kengaygan xavfsizlik yuzasi. Tizimlar o'sgan sari bu xarajat oshib boradi. Batafsil solishtiruvni <a href="/blog/healthcare-erp-vs-alohida-dasturlar">alohida maqolada</a> yozdik.</p>

      <h2>Klinikangizga qachon kerak?</h2>
      <ul>
        <li>2+ bo'lim (kassa + dorixona/laboratoriya) bir vaqtda ishlasa</li>
        <li>Daromad va qarzdorlik ustidan nazorat yo'qolayotgan bo'lsa</li>
        <li>Excel va alohida dasturlar bir-biriga to'g'ri kelmayotgan bo'lsa</li>
        <li>Filiallar ochilayotgan yoki o'sish rejalashtirilayotgan bo'lsa</li>
      </ul>

      <h2>Xulosa</h2>
      <p>Healthcare ERP — bu shunchaki "klinika dasturi" emas, balki klinikaning <strong>raqamli markaziy asabi</strong>. U bo'limlarni birlashtiradi, ma'lumotni bitta haqiqatga aylantiradi va rahbarning qo'liga real nazorat beradi. Clary aynan shu — O'zbekiston va MDH klinikalari uchun yaratilgan Healthcare ERP. <a href="/solutions/healthcare-erp">Healthcare ERP yechimi bilan tanishing</a> yoki <a href="/demo">14 kun bepul demo</a> oling.</p>
    `,
  },
  {
    slug: 'klinika-erp-migratsiya',
    title: "Eski tizimdan Healthcare ERP'ga o'tish: 1C, Excel va Medesk'dan ko'chish rejasi",
    excerpt:
      "Klinikangiz hozir 1C, Excel yoki alohida dasturlarda ishlayaptimi? Healthcare ERP'ga xavfsiz, ma'lumot yo'qotmasdan o'tishning bosqichma-bosqich rejasi.",
    date: '2026-06-18',
    author: 'Clary Onboarding',
    category: 'Migratsiya',
    bodyHtml: `
      <p class="lead">Eski tizimdan yangisiga o'tish qo'rqinchli tuyuladi — "ma'lumot yo'qoladi", "ish to'xtaydi", "xodimlar o'rgana olmaydi". To'g'ri rejada bularning hech biri sodir bo'lmaydi. Quyida 1C, Excel yoki Medesk kabi alohida dasturlardan <strong>Healthcare ERP</strong>'ga xavfsiz ko'chishning amaliy rejasi.</p>

      <h2>Nega umuman ko'chish kerak?</h2>
      <p>Klinika o'sgani sari alohida dasturlar va Excel "qiroq tikilgan ko'rpa"ga aylanadi: kassa raqami dorixonaникiga to'g'ri kelmaydi, laboratoriya alohida yashaydi, rahbar aniq daromadni bilmaydi. <a href="/blog/healthcare-erp-nima">Healthcare ERP</a> bularni bitta tizimga birlashtiradi — lekin o'tish to'g'ri bosqichlarda bo'lishi shart.</p>

      <h2>1-bosqich: Ma'lumot auditi (1-2 kun)</h2>
      <p>Avval nima borligini ro'yxatga oling:</p>
      <ul>
        <li>Bemorlar bazasi (ism, telefon, tug'ilgan kun, tibbiy tarix)</li>
        <li>Xizmatlar va narxlar ro'yxati</li>
        <li>Dorixona ombori (qoldiq, amal qilish muddati)</li>
        <li>Xodimlar va ularning rollari/komissiyalari</li>
        <li>Ochiq qarzdorliklar</li>
      </ul>
      <p>Ularni CSV/Excel ko'rinishida tayyorlang — bu import uchun asos bo'ladi.</p>

      <h2>2-bosqich: Mapping (moslashtirish)</h2>
      <p>Eski tizimdagi har bir maydonni yangi tizimga moslang: masalan 1C'dagi "Контрагент" → Clary'dagi "Bemor". Xizmat kategoriyalari, narx turlari va to'lov usullarini ham moslashtiring. Bu bosqich bir martalik, lekin sifatli bajarilsa keyingi hammasi silliq ketadi.</p>

      <h2>3-bosqich: Bosqichma-bosqich import</h2>
      <p>Hammasini bir kunda emas, modullarni navbatma-navbat ko'chiring:</p>
      <ol>
        <li><strong>Konfiguratsiya</strong> — klinika, bo'limlar, xizmatlar, narxlar</li>
        <li><strong>Xodimlar</strong> — akkaunt, rol, komissiya</li>
        <li><strong>Bemorlar bazasi</strong> — CSV import (onboarding jamoasi yordam beradi)</li>
        <li><strong>Ombor</strong> — dorixona qoldiqlari</li>
        <li><strong>Ochiq qarzlar</strong> — balansga kiritish</li>
      </ol>

      <h2>4-bosqich: Parallel ishlash (1 hafta)</h2>
      <p>Eng muhim xavfsizlik chorasi: birinchi hafta eski tizim ham, Healthcare ERP ham parallel ishlaydi. Har kuni oxirida raqamlarni solishtiring. Mos kelsa — eski tizimni arxivga qo'ying. Bu "ko'prikni yoqib yubormaslik" qoidasi.</p>

      <h2>5-bosqich: Xodimlarni o'qitish</h2>
      <p>Reception 1-2 soatda, shifokor 30 daqiqada o'rganadi. Eng asosiy oqimlar: navbat ochish, qabul boshlash, kassa yopish. Video qo'llanma va jonli demo bilan tezlashadi.</p>

      <h2>6-bosqich: Go-live va monitoring</h2>
      <p>To'liq o'tgach, birinchi oy davomida har hafta analitikani ko'rib chiqing — endi barcha raqamlar bitta joyda. <a href="/case-studies/nur-klinika">NUR Klinika 7 kunda qanday ko'chganini</a> o'qing.</p>

      <h2>Tez-tez beriladigan savollar</h2>
      <p><strong>Ma'lumotlarim yo'qoladimi?</strong> — Yo'q. Eski tizim parallel ishlab turadi, import tekshiriladi.<br/>
      <strong>Ish to'xtaydimi?</strong> — Yo'q. Modullar navbatma-navbat ko'chadi, bemor qabuli to'xtamaydi.<br/>
      <strong>Qancha vaqt oladi?</strong> — Kichik klinika uchun 7 kun, kattaroq tarmoq uchun 2-3 hafta.</p>

      <h2>Boshlash</h2>
      <p>Migratsiyani yolg'iz qilish shart emas — Clary onboarding jamoasi import va sozlashda yordam beradi. <a href="/demo">Bepul demo</a> bilan boshlang yoki <a href="/book-demo">jonli ko'rsatuv</a> so'rang.</p>
    `,
  },
  {
    slug: 'healthcare-erp-vs-alohida-dasturlar',
    title: "Healthcare ERP vs alohida dasturlar: klinika uchun qaysi biri arzon?",
    excerpt:
      "Kassa uchun bitta dastur, dorixona uchun boshqasi, laboratoriya uchun uchinchisi — yoki bitta Healthcare ERP? Xarajat, integratsiya va xavfsizlik bo'yicha halol solishtiruv.",
    date: '2026-06-16',
    author: 'Clary Research',
    category: 'Taqqoslash',
    bodyHtml: `
      <p class="lead">"Har bo'limga alohida dastur olamiz — arzonroq" — bu eng keng tarqalgan, lekin eng qimmatga tushadigan qaror. Quyida <strong>Healthcare ERP</strong> va alohida dasturlar to'plamini xarajat, integratsiya va xavfsizlik bo'yicha halol solishtiramiz.</p>

      <h2>"Qiroq ko'rpa" muammosi</h2>
      <p>Klinika odatda shunday o'sadi: avval kassa dasturi, keyin dorixona uchun boshqasi, laboratoriya uchun uchinchisi, maosh uchun Excel. Har biri alohida yaxshi — lekin ular <strong>bir-biri bilan gaplashmaydi</strong>. Natija: rahbar aniq daromadni bilmaydi, har bo'lim o'z raqamini aytadi.</p>

      <h2>Yashirin xarajatlar</h2>
      <p>Alohida dasturlar narxi past ko'rinadi, lekin haqiqiy egalik qiymati (TCO) quyidagilarni qo'shadi:</p>
      <ul>
        <li><strong>Integratsiya</strong> — dasturlarni ulash uchun dasturchi yoki qo'lda eksport/import</li>
        <li><strong>Ikki marta kiritish</strong> — bir ma'lumot bir necha joyda qayta yoziladi (vaqt + xato)</li>
        <li><strong>Solishtirish (reconcile)</strong> — har oy raqamlarni qo'lda tenglashtirish</li>
        <li><strong>Ko'p yetkazib beruvchi</strong> — har biriga obuna, qo'llab-quvvatlash, yangilanish</li>
        <li><strong>Xavfsizlik yuzasi</strong> — har bir tizim alohida zaiflik nuqtasi</li>
        <li><strong>O'qitish</strong> — xodim bir necha interfeysni o'rganishi kerak</li>
      </ul>
      <p>Tizimlar o'sgan sari bu xarajatlar <strong>chiziqli emas, eksponensial</strong> oshadi.</p>

      <h2>Healthcare ERP qanday yutadi</h2>
      <table>
        <thead><tr><th>Mezon</th><th>Alohida dasturlar</th><th>Healthcare ERP</th></tr></thead>
        <tbody>
          <tr><td>Ma'lumot manbai</td><td>Bir nechta (mos kelmaydi)</td><td>Yagona haqiqat</td></tr>
          <tr><td>Hisobot</td><td>Qo'lda yig'iladi</td><td>Real-time, avtomatik</td></tr>
          <tr><td>Integratsiya</td><td>Alohida ish/xarajat</td><td>Tug'ma (built-in)</td></tr>
          <tr><td>O'qitish</td><td>Har modulга alohida</td><td>Bitta interfeys</td></tr>
          <tr><td>Xavfsizlik/audit</td><td>Tarqoq</td><td>Markazlashgan</td></tr>
          <tr><td>Yetkazib beruvchi</td><td>Bir nechta</td><td>Bitta</td></tr>
        </tbody>
      </table>

      <h2>Alohida dasturlar qachon ma'qul?</h2>
      <p>Halol bo'laylik: agar klinikangiz <strong>juda kichik</strong> bo'lsa (1 shifokor, dorixona/laboratoriya yo'q) va faqat kassa kerak bo'lsa — alohida oddiy dastur yetarli bo'lishi mumkin. ERP'ning afzalligi bo'limlar va hajm o'sgan sari ko'rinadi.</p>

      <h2>Xulosa</h2>
      <p>Agar klinikangizda 2+ bo'lim bo'lsa yoki o'sishni rejalashtirayotgan bo'lsangiz, <strong>Healthcare ERP uzoq muddatda ham arzonroq, ham xavfsizroq</strong>. "Arzon" alohida dasturlar yashirin xarajatlar bilan qimmatga tushadi. <a href="/solutions/healthcare-erp">Healthcare ERP yechimini ko'ring</a> va <a href="/pricing">tariflarni</a> solishtiring.</p>
    `,
  },
  {
    slug: 'klinika-boshqaruv-2026',
    title: "Klinika boshqaruv tizimi 2026: nimaga e'tibor berish kerak",
    excerpt:
      "Excel'dan zamonaviy SaaS'ga o'tayotgan klinika rahbari uchun 7 ta asosiy mezon va tanlov bo'yicha amaliy maslahatlar.",
    date: '2026-05-04',
    author: 'Clary Editorial',
    category: 'Strategiya',
    bodyHtml: `
      <p class="lead">2026 yilda O'zbekistondagi 200+ klinika klassik Excel va qog'oz daftardan zamonaviy SaaS yechimlariga o'tdi. Sizning klinikangiz ham shu yo'lni tanlasa, mana shu 7 ta mezonga e'tibor bering.</p>

      <h2>1. Multi-tenant arxitektura va xavfsizlik</h2>
      <p>Eng muhimi — bemor ma'lumotlari boshqa klinikalarning ma'lumotlari bilan aralashmasligi. Postgres Row-Level Security (RLS) bilan ishlaydigan tizimlar SOC 2 darajasida himoya beradi. Tizim tanlashda <strong>"Kim mening ma'lumotlarimni ko'ra oladi?"</strong> deb so'rang.</p>

      <h2>2. Mahalliy to'lov tizimlari (Click, Payme, Uzcard)</h2>
      <p>Xorijiy SaaS'lar Stripe va PayPal'ga moslashgan, ammo O'zbekistonda asosiy to'lov yo'llari boshqa. Click, Payme, Uzum, Humo, Uzcard <em>native</em> integratsiya bo'lishi shart, BYO API kalitlar bilan — pullar to'g'ri sizning hisobingizga tushishi kerak.</p>

      <h2>3. SMS bildirishnomalari (Eskiz, Playmobile)</h2>
      <p>Bemorga eslatma SMS — qaytish koeffitsientini 25-30% oshiradi. Mahalliy SMS provayderlari (Eskiz.uz, Playmobile) bilan integratsiya muhim, chunki xorijiy SMS'lar Uzbekistondan kelganda spam papkaga tushishi mumkin.</p>

      <h2>4. Uzbekistan 547-son qonuni (Persdata)</h2>
      <p>Bemor shaxsiy ma'lumotlari Uzbekistan hududida saqlanishi yoki kelishilgan EU regionlarda bo'lishi kerak. Tizim tanlashda data residency siyosatini so'rang. DPA (Data Processing Agreement) shabloni mavjud bo'lsa — bu yaxshi belgi.</p>

      <h2>5. Til va lokalizatsiya</h2>
      <p>O'zbekcha (lotin va kirill), rus, qoraqolpoq tillari kerak bo'lishi mumkin. Tizim faqat ingliz tilida bo'lsa, xodimlar tezda ko'cha olmaydi va xato darajasi ortadi.</p>

      <h2>6. AI va analitika</h2>
      <p>Zamonaviy klinika SaaS faqat ma'lumot saqlamaydi, balki uni tahlil qiladi: navbat optimallashtirish, daromad prognozi, bemor segmentatsiyasi. Bu funksiyalar real qiymat keltiradi — ROI 3-5x oshadi.</p>

      <h2>7. Mobile va offline rejim</h2>
      <p>Internet uzilganda klinika ishni to'xtatib bo'lmaydi. Offline rejim bilan local cache, internet kelganda sync — bu must-have. Mobile app yoki PWA klinika rahbarlari uchun ham juda foydali.</p>

      <h2>Xulosa</h2>
      <p>Tizim tanlashda <strong>14 kun bepul demo + onboarding yordami</strong> sifatlarini qidiring. Yo'q bo'lsa — bu yashirin to'lov bor degani. Clary aynan shu mezonlar bo'yicha yaratilgan: <a href="/demo">1 click bilan demo oling</a> va o'zingiz solishtirib ko'ring.</p>
    `,
  },
  {
    slug: 'exceldan-clary-7-kun',
    title: "Excel'dan Clary'ga 7 kunda: amaliy plan",
    excerpt:
      "Klinika ma'lumotlarini Excel'dan zamonaviy SaaS'ga ko'chirishning kun-kun bo'lib taqsimlangan rejasi.",
    date: '2026-05-03',
    author: 'Clary Onboarding',
    category: "Qo'llanma",
    bodyHtml: `
      <p class="lead">Excel va daftardan ko'chish katta o'zgarish ko'rinadi, lekin to'g'ri rejada 7 kun yetarli. Bu plan 12+ klinikada sinab ko'rilgan.</p>

      <h2>1-kun: Tayyorgarlik</h2>
      <ul>
        <li>Klinika hisobini ochish (clary.uz/signup yoki <a href="/demo">demo bilan boshlash</a>)</li>
        <li>Klinika nomi, slug, asosiy rang, logo</li>
        <li>Tashkilot turi va xodim soni</li>
      </ul>

      <h2>2-kun: Xizmatlar va narxlar</h2>
      <p>Excel'da bo'lgan barcha xizmatlar ro'yxatini Settings → Xizmatlar bo'limiga import qiling (CSV import yoki qo'lda). Har xizmat uchun: nomi, narxi (UZS), davomiyligi, kategoriyasi.</p>

      <h2>3-kun: Xodimlar</h2>
      <p>Reception, shifokorlar, hamshiralarga akkaunt yarating. Har bir xodim o'z roli (clinic_admin, doctor, nurse, reception) bilan kiritiladi. Xodimlar email tasdiqlasin va parollarni o'zgartirsin.</p>

      <h2>4-kun: Bemor bazasini import qilish</h2>
      <p>Settings → Eksport/Import → CSV upload. Excel'dagi bemorlar ro'yxati MRN, ism, telefon, tug'ilgan kun ustunlari bilan import qilinadi. Onboarding paytida bizning jamoa bepul yordam beradi (Pro va Enterprise).</p>

      <h2>5-kun: To'lov va SMS integratsiyalari</h2>
      <ul>
        <li>Click/Payme merchant kalitlarini Settings → To'lov tizimlari bo'limiga kiritish</li>
        <li>Eskiz SMS API tokenini Settings → SMS bo'limiga ulash</li>
        <li>Test SMS yuborib tekshirish</li>
      </ul>

      <h2>6-kun: Xodimlarni o'qitish</h2>
      <p>Reception 1-2 soatda, shifokor 30 daqiqada o'rganadi. Bizning video qo'llanma va jonli demo orqali. Eng asosiysi: yangi navbat ochish, qabul boshlash, kassa yopish flow'lari.</p>

      <h2>7-kun: Live launch + parallel ishlash</h2>
      <p>Birinchi hafta Excel ham, Clary ham parallel ishlatiladi (xavfsizlik chorasi). 7-kun oxirida Clary 100% ishlayotganini tasdiqlab, Excel'ni arxivga qo'ying. <a href="/case-studies/nur-klinika">NUR Klinika qanday qilganini</a> o'qing.</p>

      <h2>Keyingi qadam</h2>
      <p>Birinchi oy davomida har hafta dashboard'ni ko'rib chiqing — AI tavsiyalar va metriklar real biznes qarorlariga aylanadi. Savollar bo'lsa Telegram'da bog'laning yoki <a href="/book-demo">jonli demo so'rang</a>.</p>
    `,
  },
  {
    slug: 'bemor-tajribasi-10-maslahat',
    title: 'Bemor tajribasini yaxshilash: 10 amaliy maslahat',
    excerpt:
      "Klinikangiz qaytish koeffitsientini 40% gacha oshirish uchun isbotlangan amaliy maslahatlar to'plami.",
    date: '2026-05-02',
    author: 'Clary Research',
    category: 'Operatsiyalar',
    bodyHtml: `
      <p class="lead">O'zbekistondagi 50+ klinika ma'lumotlari asosida, qaytish koeffitsientini eng ko'p oshirgan 10 ta amaliyot.</p>

      <h2>1. Avtomatik SMS eslatma — 24 soat oldin</h2>
      <p>No-show stavkasi 18% dan 7% ga tushadi. SMS shabloni: "Salom [ism], ertaga [vaqt] da [klinika]da qabul. Tasdiqlash: + Bekor: -"</p>

      <h2>2. Qabuldan keyin 7-kun follow-up</h2>
      <p>"Sog'lig'ingiz qanday? Savol bo'lsa yozing." — bu oddiy SMS qaytish koeffitsientini 12% oshiradi.</p>

      <h2>3. Kutish vaqtini ko'rsatish</h2>
      <p>Reception'da yoki bemor mobile ilovasida real-time navbat raqami va kutilayotgan vaqt — anxiety'ni 60% kamaytiradi.</p>

      <h2>4. Bir click to'lov (Click/Payme QR)</h2>
      <p>Kassada uzoq turish — eng katta shikoyat. QR orqali to'lov o'rtacha 30 sekund, plastik karta esa 2-3 daqiqa.</p>

      <h2>5. Bemor tarixi 360°</h2>
      <p>Shifokor avval "Oldingi qabulda nima topilgan?" deb bemordan so'ramasligi kerak. Hammasi ekranda bo'lishi shart.</p>

      <h2>6. Lab natijalari avto-yuborish</h2>
      <p>Bemorga SMS: "Lab natijalaringiz tayyor — clary.uz/p/[token] orqali ko'ring." Klinikaga qaytish 0% qisqaradi, lekin keyingi qabul booking 25% oshadi.</p>

      <h2>7. Loyalty programma</h2>
      <p>5 ta qabuldan keyin 10% chegirma — bu klassika lekin 90% klinikalar amalga oshirmaydi. Otomatlash bilan oson bo'ladi.</p>

      <h2>8. Tug'ilgan kun SMS</h2>
      <p>"Tug'ilgan kuningiz bilan, [ism]! Sog'lig'ingiz biz uchun muhim." Kichik xarajat, katta his-tuyg'u.</p>

      <h2>9. Xodimlar bilan ism orqali muomala</h2>
      <p>Tizim ekranda bemor ismini ko'rsatadi — reception "Aziza opa, xush kelibsiz!" deb kutib oladi. Bu detal qaytish koeffitsientini 8% oshiradi.</p>

      <h2>10. Sharhlar so'rash (NPS)</h2>
      <p>Qabuldan 24 soat keyin: "Tajribangizni 1-10 ball bilan baholang." Yaxshi sharhlar Google Maps'ga, yomon sharhlar darhol klinika rahbariga keladi.</p>

      <h2>Boshlash</h2>
      <p>Bularning hammasi Clary'da avtomatik sozlangan — alohida programma yozish kerak emas. <a href="/demo">14 kun bepul demo</a> bilan o'zingiz sinab ko'ring.</p>
    `,
  },
];

// Slug bo'yicha tez qidirish (blog/[slug].astro uchun)
export const BLOG_POSTS_BY_SLUG: Record<string, BlogPost> = Object.fromEntries(
  BLOG_POSTS.map((p) => [p.slug, p]),
);

export const ALL_BLOG_SLUGS: string[] = BLOG_POSTS.map((p) => p.slug);
