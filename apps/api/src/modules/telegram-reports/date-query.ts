// =============================================================================
// BOTDAGI SANA QIDIRUVI — foydalanuvchi yozgan matnni kun oralig'iga aylantirish
// =============================================================================
// Telefonda yozish qiyin, shuning uchun bir nechta ko'rinish qabul qilinadi:
//   07.08.2026            → o'sha kun
//   7.8.26 / 7.8          → o'sha kun (yil tushirilsa — joriy yil)
//   2026-08-07            → o'sha kun
//   01.08.2026-07.08.2026 → oraliq
//   bugun / kecha         → nisbiy
// Sof funksiya — testlanadi (noto'g'ri sana bo'yicha qidiruv jimgina bo'sh
// ro'yxat qaytarishi eng yomon xato bo'lardi).
// =============================================================================

export type DayRange = { from: string; to: string };

/** Oraliq eng ko'pi bilan shuncha kun — bot ro'yxati cheksiz cho'zilmasin. */
export const MAX_RANGE_DAYS = 92;

const TZ = 'Asia/Tashkent';

/** Bugungi kun (Asia/Tashkent) — YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** N kun oldingi kun (Asia/Tashkent) — YYYY-MM-DD. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** `dd.mm.yyyy` yoki `yyyy-mm-dd` → `yyyy-mm-dd`. Noto'g'ri bo'lsa null. */
function parseOneDay(raw: string, now: Date): string | null {
  const s = raw.trim();
  if (!s) return null;

  // yyyy-mm-dd
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // dd.mm.yyyy | dd.mm.yy | dd.mm  (nuqta, chiziqcha yoki slash)
  const dmy = /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2}|\d{4}))?$/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const yRaw = dmy[3];
    let year: number;
    if (!yRaw) {
      year = Number(todayIso(now).slice(0, 4));
    } else if (yRaw.length === 2) {
      year = 2000 + Number(yRaw);
    } else {
      year = Number(yRaw);
    }
    return buildIso(year, month, day);
  }
  return null;
}

/** Haqiqiy sana ekanini tekshirib (31.02 kabi emas), ISO qaytaradi. */
function buildIso(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // 31.02 → 03.03 ga siljiydi; siljigan bo'lsa sana yo'q.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}

function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * Matndan kun oralig'ini ajratadi. Tushunilmasa null — chaqiruvchi
 * foydalanuvchiga namuna ko'rsatadi (jimgina bo'sh ro'yxat BERMAYDI).
 */
export function parseDayRange(input: string, now: Date = new Date()): DayRange | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  if (s === 'bugun' || s === 'сегодня') {
    const d = todayIso(now);
    return { from: d, to: d };
  }
  if (s === 'kecha' || s === 'вчера') {
    const d = daysAgoIso(1, now);
    return { from: d, to: d };
  }
  if (s === 'hafta' || s === '7 kun' || s === 'неделя') {
    return { from: daysAgoIso(6, now), to: todayIso(now) };
  }
  if (s === 'oy' || s === '30 kun' || s === 'месяц') {
    return { from: daysAgoIso(29, now), to: todayIso(now) };
  }

  // Oraliq: "01.08.2026 - 07.08.2026" (yoki tire atrofida bo'shliqsiz).
  // dd.mm.yyyy ichida ham tire bo'lishi mumkin, shuning uchun bo'luvchi
  // sifatida faqat bo'shliq bilan o'ralgan tire yoki "..." qabul qilinadi.
  const rangeSep = /\s+[-—]\s+|\.\.\.|\s+dan\s+|\s+to\s+/;
  if (rangeSep.test(s)) {
    const [a, b] = s.split(rangeSep);
    const from = parseOneDay(a ?? '', now);
    const to = parseOneDay(b ?? '', now);
    if (!from || !to) return null;
    return normalizeRange(from, to);
  }

  // Nuqtali sanalar orasida bo'shliqsiz tire: 01.08.2026-07.08.2026
  const tight =
    /^(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)-(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?)$/.exec(s);
  if (tight) {
    const from = parseOneDay(tight[1] ?? '', now);
    const to = parseOneDay(tight[2] ?? '', now);
    if (!from || !to) return null;
    return normalizeRange(from, to);
  }

  const one = parseOneDay(s, now);
  return one ? { from: one, to: one } : null;
}

/** Teskari kiritilgan oraliqni to'g'rilaydi va uzunligini cheklaydi. */
function normalizeRange(from: string, to: string): DayRange {
  const [a, b] = from <= to ? [from, to] : [to, from];
  if (diffDays(a!, b!) > MAX_RANGE_DAYS) {
    // Oxiridan MAX_RANGE_DAYS kun — odam odatda yaqin davrni qidiradi.
    const start = new Date(Date.parse(`${b}T00:00:00Z`) - MAX_RANGE_DAYS * 86400000);
    return { from: start.toISOString().slice(0, 10), to: b! };
  }
  return { from: a!, to: b! };
}

/** Ko'rsatish uchun: 2026-08-07 → 07.08.2026 */
export function fmtDayHuman(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}
