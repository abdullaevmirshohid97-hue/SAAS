// =============================================================================
// Sidebar tartibi — saqlangan tartibga YANGI elementlarni qo'shish
// =============================================================================
// ⚠️ 2026-08-11 dagi hodisa: yangi "Hisobot quruvchi" sahifasi qo'shildi, lekin
// sidebar tartibini bir marta o'zgartirgan foydalanuvchida u guruhning ENG
// OXIRIDA paydo bo'ldi — chunki eski mantiq tartibда yo'q elementga
// `Number.MAX_SAFE_INTEGER` rank berardi. Tashqaridan bu "sahifa
// qo'shilmabdi"dek ko'rinadi va deploy buzilgan deb o'ylashga olib keladi.
//
// To'g'ri xulq: saqlangan tartib HURMAT QILINADI, lekin yangi element o'zining
// DEFAULT joyida qoladi — ya'ni o'zidan oldingi tanish qo'shnisining ortida.
//
// Sof funksiya (React/i18n importlarisiz) — shuning uchun testlanadi.
// =============================================================================

/**
 * `items` — default (kod) tartibidagi ro'yxat.
 * `saved` — foydalanuvchi saqlagan kalitlar tartibi (bo'sh bo'lsa default qoladi).
 * `keyOf` — elementdan barqaror kalit (guruhda `key`, qatorda `to`).
 */
export function mergeWithSavedOrder<T>(items: T[], saved: string[], keyOf: (it: T) => string): T[] {
  if (saved.length === 0) return items; // tartib saqlanmagan — default qoladi

  const savedRank = new Map(saved.map((k, i) => [k, i]));
  // Kasrli qadam: yangi elementlar ranki qo'shni butun ranklarga urilmaydi.
  const step = 1 / (items.length + 1);

  let anchor = -1; // oxirgi TANISH elementning ranki
  let gap = 0; // undan keyingi nechanchi yangi element
  const ranked = items.map((it, i) => {
    const r = savedRank.get(keyOf(it));
    if (r !== undefined) {
      anchor = r;
      gap = 0;
      return { it, rank: r, i };
    }
    gap += 1;
    return { it, rank: anchor + gap * step, i };
  });

  // Teng ranklarda default tartib saqlanadi (barqaror saralash kafolati).
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.it);
}
