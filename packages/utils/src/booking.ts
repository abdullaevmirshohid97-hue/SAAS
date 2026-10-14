// =============================================================================
// Navbat (booking) — sof hisob-kitob, bazasiz
// =============================================================================
// AI qabulxona (telefon), Telegram bot va web-clinic BIR XIL mantiqni ishlatadi:
//   - computeFreeSlots   — shifokor jadvali → bo'sh vaqtlar (band/ta'til/bayram
//                          chiqarib tashlanadi)
//   - specialtyKey       — "Кардиолог" / "kardiolog" / "yurak shifokori" → 'cardiology'
//   - doctorCredentials  — "oliy toifali, PhD, dotsent, 12 yil tajriba"
//   - uz* so'z funksiyalari — telefon ovozi uchun raqam/sana/vaqtni so'z bilan
//                          ("10:30" → "o'n o'ttiz"), TTS raqamni noto'g'ri o'qimasin
//
// Vaqt: Toshkent UTC+5, yozgi vaqt yo'q — hisob qat'iy ofset bilan (testlanadi).
// =============================================================================

import { searchNorm } from './search-norm';

/** Toshkent: UTC+5, yozgi vaqt yo'q (1992-yildan beri). */
export const TASHKENT_OFFSET_MIN = 300;

const MIN_MS = 60_000;

// ---------------------------------------------------------------------------
// Sana yordamchilari (mahalliy sana = 'YYYY-MM-DD')
// ---------------------------------------------------------------------------

/** 'HH:MM' yoki 'HH:MM:SS' → kun boshidan daqiqa. Noto'g'ri bo'lsa NaN. */
export function parseHm(s: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(s ?? '').trim());
  if (!m) return Number.NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return Number.NaN;
  return h * 60 + min;
}

/** Daqiqa → 'HH:MM'. */
export function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Mahalliy kun boshining UTC ms qiymati. */
export function localMidnightUtcMs(date: string, tzOffsetMin = TASHKENT_OFFSET_MIN): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - tzOffsetMin * MIN_MS;
}

/** UTC vaqt → mahalliy sana 'YYYY-MM-DD'. */
export function localDateOf(at: Date | string | number, tzOffsetMin = TASHKENT_OFFSET_MIN): string {
  const ms = new Date(at).getTime() + tzOffsetMin * MIN_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC vaqt → mahalliy 'HH:MM'. */
export function localTimeOf(at: Date | string | number, tzOffsetMin = TASHKENT_OFFSET_MIN): string {
  const ms = new Date(at).getTime() + tzOffsetMin * MIN_MS;
  return new Date(ms).toISOString().slice(11, 16);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** 0 = yakshanba ... 6 = shanba (JS getDay, `working_hours` bilan bir xil). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

// ---------------------------------------------------------------------------
// Bo'sh vaqtlar
// ---------------------------------------------------------------------------

export interface ScheduleRule {
  /** 0 = yakshanba ... 6 = shanba */
  weekday: number;
  start_time: string;
  end_time: string;
  /** Bir vaqtga necha bemor (jonli navbatli klinikalar uchun > 1). */
  capacity?: number | null;
}

export interface TimeRange {
  starts_at: string;
  ends_at: string;
}

export interface BusyAppointment {
  scheduled_at: string;
  duration_min: number;
}

export interface FreeSlot {
  /** ISO (UTC) */
  start: string;
  end: string;
  /** Mahalliy sana 'YYYY-MM-DD' */
  date: string;
  /** Mahalliy vaqt 'HH:MM' */
  time: string;
  capacity: number;
  taken: number;
}

export interface SlotQuery {
  rules: ScheduleRule[];
  slotMinutes: number;
  /** Mahalliy sana 'YYYY-MM-DD' — shu kundan boshlab */
  fromDate: string;
  days: number;
  now: Date;
  /** Hozirdan kamida necha daqiqa keyin (default 0). */
  minLeadMinutes?: number;
  timeOff?: TimeRange[];
  busy?: BusyAppointment[];
  /** Yopiq kunlar (bayram) — mahalliy 'YYYY-MM-DD'. */
  closedDates?: string[];
  tzOffsetMin?: number;
  /** Ko'pi bilan nechta slot qaytarilsin (default cheksiz). */
  limit?: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Shifokor haftalik jadvali bo'yicha bo'sh vaqtlar. Band qabullar (capacity'gacha),
 * ta'til/kasallik oraliqlari, yopiq kunlar va "hozirdan kamida N daqiqa" chegarasi
 * hisobga olinadi. Natija vaqt bo'yicha saralangan, bir xil boshlanish vaqti
 * takrorlanmaydi (ustma-ust qoidalar bo'lsa katta capacity olinadi).
 */
export function computeFreeSlots(q: SlotQuery): FreeSlot[] {
  const tz = q.tzOffsetMin ?? TASHKENT_OFFSET_MIN;
  const slot = Math.max(5, Math.round(q.slotMinutes || 30));
  const earliest = q.now.getTime() + Math.max(0, q.minLeadMinutes ?? 0) * MIN_MS;
  const closed = new Set(q.closedDates ?? []);
  const off = (q.timeOff ?? [])
    .map((t) => [Date.parse(t.starts_at), Date.parse(t.ends_at)] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  const busy = (q.busy ?? [])
    .map((b) => {
      const s = Date.parse(b.scheduled_at);
      return [s, s + Math.max(1, b.duration_min || slot) * MIN_MS] as const;
    })
    .filter(([a]) => Number.isFinite(a));

  const byStart = new Map<number, FreeSlot>();
  const days = Math.max(0, Math.min(366, Math.floor(q.days)));
  for (let i = 0; i < days; i++) {
    const date = addDays(q.fromDate, i);
    if (closed.has(date)) continue;
    const wd = weekdayOf(date);
    const midnight = localMidnightUtcMs(date, tz);
    for (const rule of q.rules) {
      if (rule.weekday !== wd) continue;
      const from = parseHm(rule.start_time);
      const to = parseHm(rule.end_time);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      const capacity = Math.max(1, Math.floor(rule.capacity ?? 1));
      for (let t = from; t + slot <= to; t += slot) {
        const startMs = midnight + t * MIN_MS;
        const endMs = startMs + slot * MIN_MS;
        if (startMs < earliest) continue;
        if (off.some(([a, b]) => overlaps(startMs, endMs, a, b))) continue;
        const taken = busy.filter(([a, b]) => overlaps(startMs, endMs, a, b)).length;
        const prev = byStart.get(startMs);
        if (prev) {
          prev.capacity = Math.max(prev.capacity, capacity);
          continue;
        }
        byStart.set(startMs, {
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          date,
          time: formatHm(t),
          capacity,
          taken,
        });
      }
    }
  }
  const out = [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => s)
    .filter((s) => s.taken < s.capacity);
  return q.limit ? out.slice(0, q.limit) : out;
}

/** Berilgan vaqt jadvalga mos keladimi (qoida ichida va slot chegarasida). */
export function isWithinSchedule(
  rules: ScheduleRule[],
  slotMinutes: number,
  startIso: string,
  tzOffsetMin = TASHKENT_OFFSET_MIN,
): boolean {
  const ms = Date.parse(startIso);
  if (!Number.isFinite(ms)) return false;
  const date = localDateOf(ms, tzOffsetMin);
  const minute = Math.round((ms - localMidnightUtcMs(date, tzOffsetMin)) / MIN_MS);
  const wd = weekdayOf(date);
  const slot = Math.max(5, Math.round(slotMinutes || 30));
  return rules.some((r) => {
    if (r.weekday !== wd) return false;
    const from = parseHm(r.start_time);
    const to = parseHm(r.end_time);
    return minute >= from && minute + slot <= to && (minute - from) % slot === 0;
  });
}

/** Haftalik jadvalning qisqa matni: "Du, Ch, Ju 09:00–14:00; Sh 09:00–12:00". */
export function scheduleSummary(rules: ScheduleRule[]): string {
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const byRange = new Map<string, number[]>();
  for (const r of rules) {
    const key = `${formatHm(parseHm(r.start_time))}–${formatHm(parseHm(r.end_time))}`;
    const arr = byRange.get(key) ?? [];
    if (!arr.includes(r.weekday)) arr.push(r.weekday);
    byRange.set(key, arr);
  }
  return [...byRange.entries()]
    .map(([range, days]) => ({
      range,
      days: days.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)),
    }))
    .sort((a, b) => ORDER.indexOf(a.days[0] ?? 0) - ORDER.indexOf(b.days[0] ?? 0))
    .map(({ range, days }) => `${days.map((d) => UZ_WEEKDAYS_SHORT[d]).join(', ')} ${range}`)
    .join('; ');
}

// ---------------------------------------------------------------------------
// Mutaxassisliklar lug'ati
// ---------------------------------------------------------------------------

export interface SpecialtyDef {
  key: string;
  label: string;
  ru: string;
  synonyms: string[];
}

/**
 * Lotin/kirill, o'zbek/rus, xalq tilidagi nomlar ("ko'z doktori", "yurak") —
 * hammasi bitta kalitga. Bemor gapidagi shikoyatdan taxminiy mutaxassislikni
 * topishda ham ishlatiladi (yakuniy tanlovni baribir AI/odam qiladi).
 */
export const SPECIALTIES: SpecialtyDef[] = [
  {
    key: 'therapy',
    label: 'Terapevt',
    ru: 'Терапевт',
    synonyms: [
      'terapevt',
      'терапевт',
      'umumiy amaliyot',
      'oilaviy shifokor',
      'семейный врач',
      'vop',
    ],
  },
  {
    key: 'pediatrics',
    label: 'Pediatr (bolalar shifokori)',
    ru: 'Педиатр',
    synonyms: [
      'pediatr',
      'педиатр',
      'bolalar shifokori',
      'bolalar vrachi',
      'детский врач',
      'neonatolog',
      'неонатолог',
    ],
  },
  {
    key: 'cardiology',
    label: 'Kardiolog',
    ru: 'Кардиолог',
    synonyms: [
      'kardiolog',
      'кардиолог',
      'yurak',
      'yurag',
      'сердц',
      'qon bosim',
      'давлени',
      'aritmolog',
    ],
  },
  {
    key: 'neurology',
    label: 'Nevrolog',
    ru: 'Невролог',
    synonyms: ['nevrolog', 'nevropatolog', 'невролог', 'невропатолог', 'asab', 'нерв'],
  },
  {
    key: 'ent',
    label: 'LOR (quloq-burun-tomoq)',
    ru: 'ЛОР',
    synonyms: [
      'lor',
      'лор',
      'otorinolaringolog',
      'оториноларинголог',
      'quloq',
      'qulog',
      'burun',
      'tomoq',
      'tomog',
      'ухо',
      'горло',
      'сурдолог',
    ],
  },
  {
    key: 'ophthalmology',
    label: "Oftalmolog (ko'z)",
    ru: 'Офтальмолог',
    synonyms: ['oftalmolog', 'офтальмолог', 'okulist', 'окулист', "ko'z", 'глаз'],
  },
  {
    key: 'dentistry',
    label: 'Stomatolog',
    ru: 'Стоматолог',
    synonyms: ['stomatolog', 'стоматолог', 'tish', 'зуб', 'dantist', 'ortodont', 'ортодонт'],
  },
  {
    key: 'gynecology',
    label: 'Ginekolog',
    ru: 'Гинеколог',
    synonyms: [
      'ginekolog',
      'гинеколог',
      'akusher',
      'акушер',
      'ayollar shifokori',
      'homilador',
      'беремен',
    ],
  },
  {
    key: 'urology',
    label: 'Urolog',
    ru: 'Уролог',
    synonyms: ['urolog', 'уролог', 'androlog', 'андролог'],
  },
  {
    key: 'endocrinology',
    label: 'Endokrinolog',
    ru: 'Эндокринолог',
    synonyms: [
      'endokrinolog',
      'эндокринолог',
      'qalqonsimon',
      'щитовид',
      'qand kasal',
      'диабет',
      'diabet',
    ],
  },
  {
    key: 'gastroenterology',
    label: 'Gastroenterolog',
    ru: 'Гастроэнтеролог',
    synonyms: [
      'gastroenterolog',
      'гастроэнтеролог',
      'oshqozon',
      'желуд',
      'ichak',
      'кишечн',
      'gepatolog',
    ],
  },
  {
    key: 'dermatology',
    label: 'Dermatolog',
    ru: 'Дерматолог',
    synonyms: ['dermatolog', 'дерматолог', 'dermatovenerolog', 'дерматовенеролог', 'teri', 'кожн'],
  },
  {
    key: 'traumatology',
    label: 'Travmatolog-ortoped',
    ru: 'Травматолог-ортопед',
    synonyms: [
      'travmatolog',
      'травматолог',
      'ortoped',
      'ортопед',
      'suyak',
      'suyag',
      'перелом',
      'sinish',
    ],
  },
  {
    key: 'surgery',
    label: 'Xirurg',
    ru: 'Хирург',
    synonyms: ['xirurg', 'хирург', 'jarroh', 'операци'],
  },
  {
    key: 'pulmonology',
    label: 'Pulmonolog',
    ru: 'Пульмонолог',
    synonyms: ['pulmonolog', 'пульмонолог', "o'pka", 'легк', "yo'tal", 'кашел', 'ftiziatr'],
  },
  {
    key: 'allergology',
    label: 'Allergolog',
    ru: 'Аллерголог',
    synonyms: ['allergolog', 'аллерголог', 'allergiya', 'аллерги', 'immunolog', 'иммунолог'],
  },
  {
    key: 'rheumatology',
    label: 'Revmatolog',
    ru: 'Ревматолог',
    synonyms: ['revmatolog', 'ревматолог', "bo'g'im", 'сустав'],
  },
  {
    key: 'nephrology',
    label: 'Nefrolog',
    ru: 'Нефролог',
    synonyms: ['nefrolog', 'нефролог', 'buyrak', 'buyrag', 'почк'],
  },
  {
    key: 'oncology',
    label: 'Onkolog',
    ru: 'Онколог',
    synonyms: ['onkolog', 'онколог', 'mammolog', 'маммолог'],
  },
  {
    key: 'psychiatry',
    label: 'Psixiatr / psixoterapevt',
    ru: 'Психиатр',
    synonyms: [
      'psixiatr',
      'психиатр',
      'psixoterapevt',
      'психотерапевт',
      'psixolog',
      'психолог',
      'narkolog',
    ],
  },
  {
    key: 'infectious',
    label: 'Infeksionist',
    ru: 'Инфекционист',
    synonyms: ['infeksionist', 'инфекционист', 'yuqumli'],
  },
  {
    key: 'hematology',
    label: 'Gematolog',
    ru: 'Гематолог',
    synonyms: ['gematolog', 'гематолог'],
  },
  {
    key: 'proctology',
    label: 'Proktolog',
    ru: 'Проктолог',
    synonyms: ['proktolog', 'проктолог', 'koloproktolog', 'колопроктолог'],
  },
  {
    key: 'vascular',
    label: 'Angiolog / flebolog',
    ru: 'Ангиолог',
    synonyms: ['angiolog', 'ангиолог', 'flebolog', 'флеболог', 'tomir', 'варикоз', 'varikoz'],
  },
  {
    key: 'ultrasound',
    label: 'UZI (ultratovush)',
    ru: 'УЗИ',
    synonyms: ['uzi', 'узи', 'ultratovush', 'ультразвук', 'sonolog', 'узд', 'dopler', 'допплер'],
  },
  {
    key: 'radiology',
    label: 'Rentgen / MRT / MSKT',
    ru: 'Рентген / МРТ',
    synonyms: [
      'rentgen',
      'рентген',
      'mrt',
      'мрт',
      'mskt',
      'мскт',
      'radiolog',
      'радиолог',
      'tomograf',
    ],
  },
  {
    key: 'functional',
    label: 'Funksional diagnostika (EKG, EEG)',
    ru: 'Функциональная диагностика',
    synonyms: ['ekg', 'экг', 'eeg', 'ээг', 'exokg', 'эхокг', 'funksional diagnost', 'функциональн'],
  },
  {
    key: 'lab',
    label: 'Laboratoriya (tahlillar)',
    ru: 'Лаборатория',
    synonyms: ['laborator', 'лаборатор', 'tahlil', 'анализ', 'qon topshir'],
  },
  {
    key: 'physiotherapy',
    label: 'Fizioterapiya / massaj',
    ru: 'Физиотерапия',
    synonyms: [
      'fizioterapevt',
      'физиотерапевт',
      'massaj',
      'массаж',
      'reabilitolog',
      'реабилитолог',
      'lfk',
      'лфк',
    ],
  },
  {
    key: 'speech',
    label: 'Logoped / defektolog',
    ru: 'Логопед',
    synonyms: ['logoped', 'логопед', 'defektolog', 'дефектолог'],
  },
  {
    key: 'nutrition',
    label: 'Dietolog',
    ru: 'Диетолог',
    synonyms: ['dietolog', 'диетолог', 'nutritsiolog', 'нутрициолог'],
  },
  {
    key: 'cosmetology',
    label: 'Kosmetolog',
    ru: 'Косметолог',
    synonyms: ['kosmetolog', 'косметолог', 'trixolog', 'трихолог'],
  },
];

const SPECIALTY_BY_KEY = new Map(SPECIALTIES.map((s) => [s.key, s]));

/** Normallashtirilgan sinonimlar (bir marta hisoblanadi). */
const SPECIALTY_INDEX: Array<{ key: string; syn: string }> = SPECIALTIES.flatMap((s) =>
  [...s.synonyms, s.label, s.ru].map((x) => ({ key: s.key, syn: searchNorm(x) })),
).filter((x) => x.syn.length > 0);

function containsTerm(normText: string, syn: string): boolean {
  if (!normText || !syn) return false;
  // Qisqa so'zlar (lor, uzi, mrt...) faqat butun so'z sifatida — "kolor" ichidagi
  // "lor" mos kelmasin.
  if (syn.length <= 3) return normText.split(' ').includes(syn);
  return (' ' + normText).includes(' ' + syn);
}

/** Anketadagi mutaxassislik matni → kalit (topilmasa null). */
export function specialtyKey(text: string | null | undefined): string | null {
  const n = searchNorm(text);
  if (!n) return null;
  // Avval aniqroq (uzunroq) sinonim — "dermatovenerolog" "dermatolog"dan oldin.
  let best: { key: string; len: number } | null = null;
  for (const { key, syn } of SPECIALTY_INDEX) {
    if (containsTerm(n, syn) && (!best || syn.length > best.len)) best = { key, len: syn.length };
  }
  return best?.key ?? null;
}

/** Bemor gapidan ehtimoliy mutaxassisliklar (tartib: lug'atdagi tartib). */
export function matchSpecialtyQuery(query: string | null | undefined): string[] {
  const n = searchNorm(query);
  if (!n) return [];
  const keys = new Set<string>();
  for (const { key, syn } of SPECIALTY_INDEX) if (containsTerm(n, syn)) keys.add(key);
  return SPECIALTIES.map((s) => s.key).filter((k) => keys.has(k));
}

export function specialtyLabel(key: string | null | undefined, locale: 'uz' | 'ru' = 'uz'): string {
  const s = key ? SPECIALTY_BY_KEY.get(key) : undefined;
  if (!s) return '';
  return locale === 'ru' ? s.ru : s.label;
}

/**
 * Guruhlash kaliti: lug'atda bo'lsa uning kaliti, bo'lmasa matnning o'zidan
 * qisqa barqaror kalit ('x' + xesh) — Telegram tugmasi (64 bayt) uchun.
 */
export function specialtyGroupKey(text: string | null | undefined): string {
  const k = specialtyKey(text);
  if (k) return k;
  const n = searchNorm(text);
  if (!n) return 'other';
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return 'x' + h.toString(36);
}

// ---------------------------------------------------------------------------
// Shifokor unvonlari
// ---------------------------------------------------------------------------

export type MedicalCategory = 'highest' | 'first' | 'second' | 'none';
export type AcademicDegree = 'phd' | 'dsc';
export type AcademicTitle = 'docent' | 'professor';

export const MEDICAL_CATEGORY_LABELS: Record<MedicalCategory, string> = {
  highest: 'oliy toifali',
  first: 'birinchi toifali',
  second: 'ikkinchi toifali',
  none: 'toifasiz',
};

export const ACADEMIC_DEGREE_LABELS: Record<AcademicDegree, string> = {
  phd: "PhD (tibbiyot fanlari bo'yicha falsafa doktori)",
  dsc: 'DSc (tibbiyot fanlari doktori)',
};

export const ACADEMIC_DEGREE_SHORT: Record<AcademicDegree, string> = {
  phd: 'PhD',
  dsc: 'DSc',
};

export const ACADEMIC_TITLE_LABELS: Record<AcademicTitle, string> = {
  docent: 'dotsent',
  professor: 'professor',
};

export interface DoctorCredentialsInput {
  medical_category?: string | null;
  academic_degree?: string | null;
  academic_title?: string | null;
  experience_years?: number | null;
}

/** "oliy toifali, PhD, dotsent, 12 yil tajriba" (bo'sh maydonlar tushib qoladi). */
export function doctorCredentials(d: DoctorCredentialsInput): string {
  const parts: string[] = [];
  const cat = d.medical_category as MedicalCategory | null | undefined;
  if (cat && cat !== 'none' && MEDICAL_CATEGORY_LABELS[cat])
    parts.push(MEDICAL_CATEGORY_LABELS[cat]);
  const deg = d.academic_degree as AcademicDegree | null | undefined;
  if (deg && ACADEMIC_DEGREE_SHORT[deg]) parts.push(ACADEMIC_DEGREE_SHORT[deg]);
  const title = d.academic_title as AcademicTitle | null | undefined;
  if (title && ACADEMIC_TITLE_LABELS[title]) parts.push(ACADEMIC_TITLE_LABELS[title]);
  if (d.experience_years && d.experience_years > 0) parts.push(`${d.experience_years} yil tajriba`);
  return parts.join(', ');
}

/** Saralash bali: professor/DSc/oliy toifa yuqoriroq (ro'yxatda oldinda). */
export function doctorRank(d: DoctorCredentialsInput): number {
  const cat: Record<string, number> = { highest: 30, first: 20, second: 10, none: 0 };
  const deg: Record<string, number> = { dsc: 25, phd: 15 };
  const title: Record<string, number> = { professor: 25, docent: 15 };
  return (
    (cat[d.medical_category ?? ''] ?? 0) +
    (deg[d.academic_degree ?? ''] ?? 0) +
    (title[d.academic_title ?? ''] ?? 0) +
    Math.min(40, d.experience_years ?? 0) / 4
  );
}

// ---------------------------------------------------------------------------
// O'zbekcha raqam, sana, vaqt — so'z bilan (telefon ovozi uchun)
// ---------------------------------------------------------------------------

// TTS uchun oddiy apostrof (') — ovoz modellari shu yozuvda o'qitilgan.
const ONES = ['nol', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const TENS = [
  '',
  "o'n",
  'yigirma',
  "o'ttiz",
  'qirq',
  'ellik',
  'oltmish',
  'yetmish',
  'sakson',
  "to'qson",
];

export const UZ_MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

export const UZ_WEEKDAYS = [
  'yakshanba',
  'dushanba',
  'seshanba',
  'chorshanba',
  'payshanba',
  'juma',
  'shanba',
];

export const UZ_WEEKDAYS_SHORT = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const t = Math.floor(rest / 10);
  const o = rest % 10;
  const parts: string[] = [];
  if (h > 0) parts.push(h === 1 ? 'yuz' : `${ONES[h]} yuz`);
  if (t > 0) parts.push(TENS[t] as string);
  if (o > 0) parts.push(ONES[o] as string);
  return parts.join(' ');
}

/** 0..999 999 999 → so'z bilan ("yuz ellik ming"). */
export function uzNumber(n: number): string {
  const v = Math.floor(Math.abs(n));
  if (v === 0) return ONES[0] as string;
  const parts: string[] = [];
  const millions = Math.floor(v / 1_000_000);
  const thousands = Math.floor((v % 1_000_000) / 1000);
  const rest = v % 1000;
  if (millions > 0) parts.push(`${under1000(millions)} million`);
  if (thousands > 0) parts.push(thousands === 1 ? 'ming' : `${under1000(thousands)} ming`);
  if (rest > 0) parts.push(under1000(rest));
  return (n < 0 ? 'minus ' : '') + parts.join(' ');
}

/** Tartib son: 1 → "birinchi", 20 → "yigirmanchi", 15 → "o'n beshinchi". */
export function uzOrdinal(n: number): string {
  const w = uzNumber(n);
  return /[aeiou]$/.test(w) ? `${w}nchi` : `${w}inchi`;
}

/** So'z oxiriga qo'shimcha (o'nda, ikkida, o'n beshda). */
function withSuffix(words: string, suffix: string): string {
  return suffix ? `${words}${suffix}` : words;
}

/** 10:30 → "o'n o'ttiz"; 9:00 → "to'qqiz". `suffix` — "da", "gacha"... */
export function uzClock(h: number, m: number, suffix = ''): string {
  const words =
    m > 0 ? `${uzNumber(h)} ${m < 10 ? `nol ${uzNumber(m)}` : uzNumber(m)}` : uzNumber(h);
  return withSuffix(words, suffix);
}

/** "soat o'n o'ttizda" */
export function uzTimeAt(hm: string): string {
  const mins = parseHm(hm);
  if (!Number.isFinite(mins)) return hm;
  return `soat ${uzClock(Math.floor(mins / 60), mins % 60, 'da')}`;
}

/** 'YYYY-MM-DD' → "o'n beshinchi oktabr, chorshanba" */
export function uzDateWords(date: string, withWeekday = true): string {
  const [, m, d] = date.split('-').map(Number);
  const base = `${uzOrdinal(d ?? 1)} ${UZ_MONTHS[(m ?? 1) - 1] ?? ''}`.trim();
  return withWeekday ? `${base}, ${UZ_WEEKDAYS[weekdayOf(date)]}` : base;
}

/** 'YYYY-MM-DD' → "15-oktabr, chorshanba" (yozma ko'rinish). */
export function uzDateShort(date: string, withWeekday = true): string {
  const [, m, d] = date.split('-').map(Number);
  const base = `${d}-${UZ_MONTHS[(m ?? 1) - 1] ?? ''}`;
  return withWeekday ? `${base}, ${UZ_WEEKDAYS[weekdayOf(date)]}` : base;
}

/** Bugunga nisbatan: "bugun" / "ertaga" / "indinga" / null. */
export function uzRelativeDay(date: string, today: string): string | null {
  if (date === today) return 'bugun';
  if (date === addDays(today, 1)) return 'ertaga';
  if (date === addDays(today, 2)) return 'indinga';
  return null;
}

const MONTH_ALT = UZ_MONTHS.join('|');

/**
 * AI javobini TTS uchun tayyorlaydi: raqamlar, vaqt (10:30), sana (15-oktabr),
 * narx va telefon raqamlari so'z bilan yoziladi. Faqat lotin o'zbekcha matn
 * uchun — rus tilidagi javobga ishlatilmaydi (u yerda TTS raqamni o'zi o'qiydi).
 */
export function speakableUz(text: string): string {
  let s = text;
  // Telefon raqamlari: +998 90 123 45 67 / 901234567 → guruhlab o'qiladi
  s = s.replace(/\+?998[\s-]?(\d{2})[\s-]?(\d{3})[\s-]?(\d{2})[\s-]?(\d{2})/g, (_m, a, b, c, d) =>
    [a, b, c, d].map((g: string) => uzNumber(Number(g))).join(', '),
  );
  s = s.replace(/\b(\d{2})[\s-]?(\d{3})[\s-]?(\d{2})[\s-]?(\d{2})\b/g, (_m, a, b, c, d) =>
    [a, b, c, d].map((g: string) => uzNumber(Number(g))).join(', '),
  );
  // Vaqt: 10:30, 9.00, 14:00da / 14:00 da / 14:00-da
  s = s.replace(
    /\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*-?\s*(da|ga|gacha|dan)\b)?/g,
    (_m, h: string, mm: string, suf?: string) => uzClock(Number(h), Number(mm), suf ?? ''),
  );
  // Sana: 15-oktabr / 15 oktabr
  s = s.replace(
    new RegExp(`\\b(\\d{1,2})(?:-|\\s)(${MONTH_ALT})`, 'gi'),
    (_m, d: string, mon: string) => `${uzOrdinal(Number(d))} ${mon.toLowerCase()}`,
  );
  // Narx: 150 000 so'm / 150,000 so'm / 150000 so'm
  s = s.replace(/(\d{1,3}(?:[\s ,.]\d{3})+|\d+)(\s*)(so['‘’`]?m|сум|sum)/gi, (_m, num: string) => {
    const v = Number(num.replace(/[\s ,.]/g, ''));
    return `${uzNumber(v)} so'm`;
  });
  // Tartib son: 3-qavat, 2-xona
  s = s.replace(/\b(\d{1,3})-(?=[a-z‘’'])/gi, (_m, n: string) => `${uzOrdinal(Number(n))} `);
  // Qolgan butun sonlar
  s = s.replace(/\b\d{1,9}\b/g, (m) => uzNumber(Number(m)));
  return s.replace(/[ \t]{2,}/g, ' ');
}

// ---------------------------------------------------------------------------
// Ism
// ---------------------------------------------------------------------------

/** "Abdullayev Mirshohid Akramovich" → { last, first, patronymic }. */
export function splitFullName(full: string | null | undefined): {
  last_name: string;
  first_name: string;
  patronymic: string | null;
} {
  const parts = String(full ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    last_name: parts[0] ?? '',
    first_name: parts[1] ?? '',
    patronymic: parts.length > 2 ? parts.slice(2).join(' ') : null,
  };
}

/** "Karimova Dilnoza Akramovna" → "Karimova D. A." */
export function shortDoctorName(full: string | null | undefined): string {
  const p = splitFullName(full);
  const initials = [p.first_name, p.patronymic]
    .filter((x): x is string => !!x)
    .map((x) => `${x.charAt(0).toUpperCase()}.`)
    .join(' ');
  return [p.last_name, initials].filter(Boolean).join(' ');
}
