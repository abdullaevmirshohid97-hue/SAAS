// =============================================================================
// Toshkent vaqti bo'yicha sana va davr (UTC+5, yozgi vaqt yo'q).
// Server TZ (UTC yoki Asia/Tashkent) va `toISOString()` ning UTC'ga siljishi
// "Bugun" ni kechagi kun qilib yuborardi (00:00–05:00 oralig'ida yoki server
// Toshkent vaqtida bo'lsa har doim). Hamma davr hisoblari shu yerdan o'tadi.
// =============================================================================

const OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Berilgan lahzaning Toshkentdagi sanasi: YYYY-MM-DD */
export function tashkentDate(at: Date = new Date()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Timestamp (ISO) Toshkentda qaysi kunga tushadi */
export function tashkentDayOf(iso: string): string {
  return tashkentDate(new Date(iso));
}

/** Toshkent bo'yicha hafta kuni (0 = yakshanba) va soat */
export function tashkentDowHour(iso: string): { dow: number; hour: number } {
  const local = new Date(new Date(iso).getTime() + OFFSET_MS);
  return { dow: local.getUTCDay(), hour: local.getUTCHours() };
}

export function isIsoDay(s: string | undefined | null): s is string {
  return !!s && ISO_DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Kalendar kun qo'shish (TZ'siz, UTC peshin orqali) */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Toshkentdagi kun boshlanishi (00:00) — UTC ISO ko'rinishida */
export function tashkentDayStartIso(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS).toISOString();
}

/** [from 00:00, to+1 00:00) — Toshkent kunlari bo'yicha timestamp chegaralari */
export function tashkentBounds(from: string, to: string): { startIso: string; endIso: string } {
  return { startIso: tashkentDayStartIso(from), endIso: tashkentDayStartIso(addDays(to, 1)) };
}

export type RangePreset = 'today' | 'week' | '7d' | '30d' | '90d' | 'month' | 'year' | 'all';

/**
 * Preset yoki aniq sanalar → Toshkent kunlari oralig'i.
 * Noto'g'ri sana e'tiborsiz (preset ishlatiladi); from > to bo'lsa almashtiriladi.
 */
export function presetRange(
  preset: string | undefined,
  fromArg?: string,
  toArg?: string,
  fallback: RangePreset = 'today',
  now: Date = new Date(),
): { from: string; to: string } {
  if (isIsoDay(fromArg) && isIsoDay(toArg)) {
    return fromArg <= toArg ? { from: fromArg, to: toArg } : { from: toArg, to: fromArg };
  }
  const today = tashkentDate(now);
  const p = (preset ?? fallback) as RangePreset;
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'week':
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'year':
      return { from: `${today.slice(0, 5)}01-01`, to: today };
    case 'all':
      return { from: '2000-01-01', to: today };
    default:
      return presetRange(fallback, undefined, undefined, 'today', now);
  }
}
