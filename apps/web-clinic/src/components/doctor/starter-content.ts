// =============================================================================
// Shifokor ish stoli — tayyor shablonlar va tez iboralar
// =============================================================================
// Nega: prod'da shifokorlarning shablonlari 0 ta edi — bo'sh varaqdan har safar
// yozish sekin. Bu yerdagi matnlar — BOSHLANG'ICH qoralama: "___" joylari
// shifokor to'ldiradi, dori nomi/dozasi atayin yozilmagan (shifokor o'zi
// belgilaydi). Shablon serverga yozilmaydi — "Kabinet"da nusxa olib, o'ziga
// moslashtirsa shaxsiy shablonga aylanadi.

export type StarterTemplate = {
  key: string;
  name: string;
  /** Kartochka rangi (Tailwind rang nomi — statik klasslar STARTER_TONE'da) */
  tone: 'sky' | 'rose' | 'amber' | 'violet' | 'emerald' | 'teal' | 'orange' | 'indigo';
  diagnosis_code: string;
  diagnosis_text: string;
  soap_subjective: string;
  soap_objective: string;
  soap_plan: string;
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'orvi',
    name: 'ORVI (shamollash)',
    tone: 'sky',
    diagnosis_code: 'J06.9',
    diagnosis_text: 'O‘tkir respirator virusli infeksiya',
    soap_subjective:
      'Burun bitishi, tomoq og‘rig‘i, yo‘tal, harorat ko‘tarilishi (___ °C), holsizlik. ___ kundan beri kasal.',
    soap_objective:
      'Umumiy ahvoli qoniqarli. Tomoq shilliq qavati giperemiyalangan. O‘pkada vezikulyar nafas, xirillash yo‘q. Yurak tonlari aniq, ritmik.',
    soap_plan:
      'Yotoq rejimi, ko‘p iliq suyuqlik ichish.\nSimptomatik davolash: ___\nHarorat 38,5 °C dan oshsa — isitma tushiruvchi vosita.\nAhvoli yomonlashsa yoki 3 kunda yaxshilanmasa — qayta murojaat.',
  },
  {
    key: 'gipertoniya',
    name: 'Arterial gipertoniya',
    tone: 'rose',
    diagnosis_code: 'I10',
    diagnosis_text: 'Essensial (birlamchi) gipertenziya',
    soap_subjective:
      'Bosh og‘rig‘i (ensa sohasida), bosh aylanishi, qon bosimi ko‘tarilishi. Kasallik davomiyligi: ___. Doimiy qabul qiladigan dorilar: ___.',
    soap_objective:
      'Umumiy ahvoli qoniqarli. Yurak tonlari aniq, ritmik, aortada II ton aksenti. Periferik shish yo‘q.',
    soap_plan:
      'Tuzni cheklash, vaznni nazorat qilish, muntazam jismoniy faollik.\nQon bosimini kuniga 2 marta o‘lchab, kundalik yuritish.\nAntigipertenziv terapiya: ___\nEKG, qon bioximiyasi (lipidlar, kreatinin, glyukoza).\nQayta ko‘rik: 2 haftadan keyin.',
  },
  {
    key: 'gastrit',
    name: 'Gastrit',
    tone: 'amber',
    diagnosis_code: 'K29.7',
    diagnosis_text: 'Gastrit, aniqlanmagan',
    soap_subjective:
      'Epigastriyda og‘riq (ovqatdan keyin / och qoringa), jig‘ildon qaynashi, ko‘ngil aynishi, qorin dam bo‘lishi.',
    soap_objective:
      'Til oq karash bilan qoplangan. Qorin yumshoq, epigastriyda palpatsiyada og‘riqli. Peritoneal belgilar manfiy.',
    soap_plan:
      'Parhez: achchiq, yog‘li, qovurilgan taomlarni cheklash, oz-ozdan tez-tez ovqatlanish.\nFGDS, H. pylori tekshiruvi.\nDavolash: ___\nQayta ko‘rik: 2 haftadan keyin.',
  },
  {
    key: 'tonzillit',
    name: 'O‘tkir tonzillit (angina)',
    tone: 'orange',
    diagnosis_code: 'J03.9',
    diagnosis_text: 'O‘tkir tonzillit, aniqlanmagan',
    soap_subjective: 'Tomoq og‘rig‘i (yutinganda kuchayadi), harorat ko‘tarilishi, holsizlik.',
    soap_objective:
      'Bodomsimon bezlar kattalashgan, giperemiyalangan, karash: ___. Jag‘ osti limfa tugunlari kattalashgan, og‘riqli.',
    soap_plan:
      'Yotoq rejimi, iliq suyuqlik, tomoqni chayish.\nUmumiy qon tahlili, tomoqdan surtma.\nDavolash: ___\nQayta ko‘rik: 3 kundan keyin.',
  },
  {
    key: 'bronxit',
    name: 'O‘tkir bronxit',
    tone: 'teal',
    diagnosis_code: 'J20.9',
    diagnosis_text: 'O‘tkir bronxit, aniqlanmagan',
    soap_subjective:
      'Yo‘tal (quruq / balg‘amli), harorat ko‘tarilishi, ko‘krak qafasida noxushlik.',
    soap_objective: 'O‘pkada dag‘al nafas, tarqoq quruq xirillashlar. Nafas soni ___ /daq.',
    soap_plan:
      'Ko‘p iliq suyuqlik, xonani shamollatish.\nDavolash: ___\nKo‘rsatma bo‘lsa — ko‘krak qafasi rentgenogrammasi.\nQayta ko‘rik: 5–7 kundan keyin.',
  },
  {
    key: 'sistit',
    name: 'O‘tkir sistit',
    tone: 'violet',
    diagnosis_code: 'N30.0',
    diagnosis_text: 'O‘tkir sistit',
    soap_subjective: 'Tez-tez va og‘riqli siyish, qov ustida og‘riq. Davomiyligi: ___.',
    soap_objective:
      'Qorin yumshoq, qov ustida palpatsiyada og‘riq. Pasternatskiy simptomi ikki tomonda manfiy.',
    soap_plan:
      'Ko‘p suyuqlik ichish.\nUmumiy siydik tahlili, siydik ekmasi.\nDavolash: ___\nQayta ko‘rik: tahlil natijasi bilan.',
  },
  {
    key: 'osteoxondroz',
    name: 'Umurtqa osteoxondrozi',
    tone: 'indigo',
    diagnosis_code: 'M42.9',
    diagnosis_text: 'Umurtqa pog‘onasi osteoxondrozi',
    soap_subjective:
      'Bel (bo‘yin) sohasida og‘riq, harakatda kuchayadi, ___ ga tarqaladi. Davomiyligi: ___.',
    soap_objective:
      'Paravertebral mushaklar tarang, palpatsiyada og‘riq. Harakat chegaralangan. Lasseg simptomi: ___.',
    soap_plan:
      'Og‘ir yuk ko‘tarmaslik, davolovchi jismoniy tarbiya.\nKo‘rsatma bo‘yicha MRT / rentgen.\nDavolash: ___\nFizioterapiya.\nQayta ko‘rik: 10 kundan keyin.',
  },
  {
    key: 'diabet2',
    name: 'Qandli diabet, 2-tip',
    tone: 'emerald',
    diagnosis_code: 'E11.9',
    diagnosis_text: 'Qandli diabet 2-tip, asoratlarsiz',
    soap_subjective:
      'Chanqash, og‘iz qurishi, tez-tez siyish, holsizlik. Kasallik davomiyligi: ___. Qabul qilayotgan dorilar: ___.',
    soap_objective:
      'Umumiy ahvoli qoniqarli. Oyoqlarda pulsatsiya saqlangan, teri: ___. Glyukoza (glyukometr): ___ mmol/l.',
    soap_plan:
      'Parhez (tez hazm bo‘ladigan uglevodlarni cheklash), jismoniy faollik.\nGlyukozani muntazam nazorat qilish.\nHbA1c, qon bioximiyasi, siydik tahlili.\nEndokrinolog nazorati.\nQayta ko‘rik: 1 oydan keyin.',
  },
  {
    key: 'rinit',
    name: 'Allergik rinit',
    tone: 'sky',
    diagnosis_code: 'J30.4',
    diagnosis_text: 'Allergik rinit, aniqlanmagan',
    soap_subjective:
      'Burun bitishi, aksirish, burundan suvsimon ajralma, ko‘z qichishi. Mavsumiyligi: ___.',
    soap_objective: 'Burun shilliq qavati oqargan, shishgan. Ko‘z kon’yunktivasi giperemiyalangan.',
    soap_plan: 'Allergen bilan aloqani kamaytirish.\nDavolash: ___\nAllergolog konsultatsiyasi.',
  },
  {
    key: 'anemiya',
    name: 'Temir tanqisligi anemiyasi',
    tone: 'rose',
    diagnosis_code: 'D50.9',
    diagnosis_text: 'Temir tanqisligi anemiyasi, aniqlanmagan',
    soap_subjective: 'Holsizlik, tez charchash, bosh aylanishi, soch to‘kilishi.',
    soap_objective: 'Teri va shilliq qavatlar oqargan. Yurak cho‘qqisida sistolik shovqin: ___.',
    soap_plan:
      'Temirga boy ovqatlanish.\nUmumiy qon tahlili, ferritin, zardob temiri.\nDavolash: ___\nQayta ko‘rik: 1 oydan keyin (qon tahlili bilan).',
  },
];

export const STARTER_TONE: Record<StarterTemplate['tone'], string> = {
  sky: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100',
  rose: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100',
  amber:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100',
  violet:
    'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100',
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100',
  teal: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-100',
  orange:
    'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-100',
  indigo:
    'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-100',
};

export const findStarter = (key: string | null | undefined) =>
  key ? (STARTER_TEMPLATES.find((t) => t.key === key) ?? null) : null;

// ── Tez iboralar (har bo'lim uchun) ─────────────────────────────────────────
// Bosilganda matn oxiriga qo'shiladi. Shikoyat — vergul bilan ro'yxat,
// ko'rik — gap, tavsiya — har biri yangi qatordan.
export type PhraseMode = 'list' | 'sentence' | 'line';

export const COMPLAINT_PHRASES = [
  'Bosh og‘rig‘i',
  'Isitma',
  'Yo‘tal',
  'Tomoq og‘rig‘i',
  'Burun bitishi',
  'Holsizlik',
  'Bosh aylanishi',
  'Ko‘ngil aynishi',
  'Qorin og‘rig‘i',
  'Bel og‘rig‘i',
  'Nafas qisishi',
  'Yurak urishi',
  'Qon bosimi ko‘tarilishi',
  'Uyqusizlik',
  '___ kundan beri',
  'Avval davolanmagan',
];

export const EXAM_PHRASES = [
  'Umumiy ahvoli qoniqarli',
  'Hushi aniq',
  'Teri qoplami toza, odatiy rangda',
  'Tomoq giperemiyalangan',
  'O‘pkada vezikulyar nafas, xirillash yo‘q',
  'Yurak tonlari aniq, ritmik',
  'Qorin yumshoq, og‘riqsiz',
  'Jigar kattalashmagan',
  'Periferik shish yo‘q',
  'Pasternatskiy simptomi manfiy',
];

export const PLAN_PHRASES = [
  'Yotoq rejimi',
  'Ko‘p iliq suyuqlik ichish',
  'Parhez: ___',
  'Simptomatik davolash',
  'Umumiy qon tahlili',
  'Umumiy siydik tahlili',
  'Qon bioximiyasi',
  'EKG',
  'UTT: ___',
  'Ahvoli yomonlashsa — qayta murojaat',
];

/** "Qayta ko'rik" tugmalari — sana avtomatik hisoblanadi. */
export const FOLLOW_UPS: Array<{ label: string; days: number }> = [
  { label: '3 kun', days: 3 },
  { label: '1 hafta', days: 7 },
  { label: '2 hafta', days: 14 },
  { label: '1 oy', days: 30 },
];

export function followUpLine(days: number): string {
  const d = new Date(Date.now() + days * 864e5);
  return `Qayta ko‘rik: ${d.toLocaleDateString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })}`;
}

/** Iborani matnga qo'shish (bo'lim turiga qarab ajratuvchi tanlanadi). */
export function appendPhrase(text: string, phrase: string, mode: PhraseMode): string {
  const t = text.replace(/\s+$/, '');
  if (!t) return mode === 'sentence' ? `${phrase}.` : phrase;
  if (mode === 'line') return `${t}\n${phrase}`;
  if (mode === 'sentence') return /[.!?:]$/.test(t) ? `${t} ${phrase}.` : `${t}. ${phrase}.`;
  // list: "Bosh og'rig'i, isitma" — qisqartma (EKG, UTT) katta harfda qoladi
  const keepCase = /^[A-ZА-Я]{2}/.test(phrase) || phrase.startsWith('___');
  const p = keepCase ? phrase : phrase.charAt(0).toLowerCase() + phrase.slice(1);
  return /[.!?:]$/.test(t) ? `${t} ${phrase}` : `${t}, ${p}`;
}

/** Ibora matnda allaqachon bormi (chip "ishlatilgan" ko'rinadi). */
export const hasPhrase = (text: string, phrase: string) =>
  !phrase.includes('___') && text.toLowerCase().includes(phrase.toLowerCase());
