// =============================================================================
// YOPISH DAVRI (moliyaviy sikl) — veb va API uchun YAGONA matematika
// =============================================================================
// Klinika oyni kalendar bo'yicha emas, masalan har oyning 10-sanasida yopadi.
// Unda davr = o'tgan oyning 11-sanasidan shu oyning 10-sanasigacha.
//
// NEGA `Date` EMAS, SATR: API Asia/Tashkent bo'yicha "bugun" ni satr sifatida
// hisoblaydi, brauzer esa mahalliy vaqt zonasida ishlaydi. `Date` obyektini
// ikki tomonga uzatsak, server yarim kechadan keyin boshqa kunni ko'rsatib,
// veb va Telegram bot BIR XIL tugma uchun turli davr chiqarardi. Shuning
// uchun kirish ham, chiqish ham YYYY-MM-DD satri va hisob sof butun sonlarda.
// =============================================================================

/** Yopish kuni 1..28 oralig'ida bo'ladi — 29/30/31 har oyda mavjud emas. */
export const MIN_CLOSING_DAY = 1;
export const MAX_CLOSING_DAY = 28;
export const DEFAULT_CLOSING_DAY = 10;

export function clampClosingDay(day: unknown): number {
  const n = Math.trunc(Number(day));
  if (!Number.isFinite(n)) return DEFAULT_CLOSING_DAY;
  return Math.min(MAX_CLOSING_DAY, Math.max(MIN_CLOSING_DAY, n));
}

/** (yil, oy-indeksi, kun) → YYYY-MM-DD. Oy indeksi manfiy yoki >11 bo'lsa normallashadi. */
function ymd(year: number, monthIndex: number, day: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Oydagi kunlar soni (kabisa yili hisobga olinadi). */
function daysInMonth(year: number, monthIndex: number): number {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Davr oxiri: yopish kuni, lekin oy qisqa bo'lsa — oyning oxirgi kuni. */
function periodEnd(year: number, monthIndex: number, d: number): string {
  return ymd(year, monthIndex, Math.min(d, daysInMonth(year, monthIndex)));
}

/** YYYY-MM-DD dan keyingi kun. */
function nextDay(iso: string): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/**
 * Yopish kuni `d` bo'lgan, `endMonth` oyida tugaydigan sikl.
 *
 * ⚠️ `from` ATAYLAB "oldingi davr oxiri + 1 kun" sifatida hisoblanadi, "d+1"
 * emas. Yopish kuni 28 bo'lsa "d+1" fevral uchun 29-sanani berardi — 2026 da
 * bunday sana YO'Q. U sana regex tekshiruvidan (`^\d{4}-\d{2}-\d{2}$`) bemalol
 * o'tib ketardi va bazaga yaroqsiz qiymat bo'lib tushardi. Fevral 28 da
 * tugagan bo'lsa, keyingi davr 1-martdan boshlanadi.
 */
function cycleForEndMonth(year: number, endMonth: number, d: number): { from: string; to: string } {
  return {
    from: nextDay(periodEnd(year, endMonth - 1, d)),
    to: periodEnd(year, endMonth, d),
  };
}

/**
 * Sikl qaysi oyda tugashini aniqlaydi (0-indeks, yil `year` ga nisbatan).
 * Bugun yopish kunidan KEYIN bo'lsa sikl shu oyda tugagan; aks holda (yopish
 * kunining o'zida ham) hali oldingi sikl davom etyapti.
 */
function endMonthFor(refIso: string, d: number): { year: number; endMonth: number } {
  const year = Number(refIso.slice(0, 4));
  const month = Number(refIso.slice(5, 7)) - 1; // 0-indeks
  const day = Number(refIso.slice(8, 10));
  return { year, endMonth: day > d ? month : month - 1 };
}

/**
 * Berilgan sanani o'z ichiga olgan yopish davri.
 *
 * Misol (closingDay = 10):
 *   2026-09-18 → 2026-08-11 … 2026-09-10   (10-sana o'tgan, joriy sikl shu)
 *   2026-09-05 → 2026-07-11 … 2026-08-10   (10-sana hali kelmagan)
 */
export function cycleRange(closingDay: number, refIso: string): { from: string; to: string } {
  const d = clampClosingDay(closingDay);
  const { year, endMonth } = endMonthFor(refIso, d);
  return cycleForEndMonth(year, endMonth, d);
}

/**
 * Joriy sikldan bir davr oldingisi.
 *
 * Oy indeksi to'g'ridan-to'g'ri bittaga siljitiladi. "Joriy sikl boshidan bir
 * kun oldingi sanani olib, `cycleRange` ni qayta chaqirish" yo'li NOTO'G'RI
 * bo'lardi: o'sha sana aynan yopish kuniga tushadi va yuqoridagi qoida
 * bo'yicha yana bir davr orqaga sirg'alib ketardi.
 */
export function prevCycleRange(closingDay: number, refIso: string): { from: string; to: string } {
  const d = clampClosingDay(closingDay);
  const { year, endMonth } = endMonthFor(refIso, d);
  return cycleForEndMonth(year, endMonth - 1, d);
}
