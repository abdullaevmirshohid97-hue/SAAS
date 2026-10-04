// =============================================================================
// Qidiruv uchun matn normallashtirish (kirill ⇄ lotin, imlo variantlari)
// =============================================================================
// O'zbekistonda dori nomlari ikki alifboda va bir necha imloda yoziladi:
//   "Амоксициллин 500мг №20" · "Amoksitsillin 500 mg" · "Amoxicillin 500mg N20"
// Uchalasi ham bitta kalitga tushishi kerak: "amoksisilin 500 mg n 20".
//
// ⚠️ Bu funksiya bazadagi `public.clary_search_norm(text)` bilan QADAMMA-QADAM
// bir xil bo'lishi SHART (medications.search_text shu bilan hisoblanadi, POS
// esa brauzerda shu funksiya bilan qidiradi). Bittasini o'zgartirsangiz,
// ikkinchisini ham o'zgartiring va testni yangilang.
// =============================================================================

const CYR_MULTI: Array<[string, string]> = [
  ['ё', 'yo'],
  ['ж', 'j'],
  ['ц', 'ts'],
  ['ч', 'ch'],
  ['ш', 'sh'],
  ['щ', 'sh'],
  ['ю', 'yu'],
  ['я', 'ya'],
  ['х', 'x'],
];

const CYR_FROM = 'абвгдезийклмнопрстуфыэўқғҳ';
const CYR_TO = 'abvgdeziyklmnoprstufieoqgh';

function replaceAll(s: string, from: string, to: string): string {
  return s.split(from).join(to);
}

/** Qidiruv kaliti. Bo'sh/undefined → ''. */
export function searchNorm(input: string | null | undefined): string {
  let s = (input ?? '').toLowerCase();
  for (const [a, b] of CYR_MULTI) s = replaceAll(s, a, b);

  let t = '';
  for (const ch of s) {
    const i = CYR_FROM.indexOf(ch);
    t += i >= 0 ? CYR_TO[i] : ch;
  }
  s = t;

  // Qattiq/yumshoq belgi va apostroflar (o‘ → o, g' → g)
  s = s.replace(/[ъь'`ʻʼ‘’´]/g, '');
  s = replaceAll(s, '№', ' n ');

  // Imlo variantlari: c/ts → s, ph → f, x → ks, w → v, y → i ("ch" saqlanadi)
  s = replaceAll(s, 'ch', '#');
  s = replaceAll(s, 'ph', 'f');
  s = replaceAll(s, 'ts', 's');
  s = replaceAll(s, 'c', 's');
  s = replaceAll(s, '#', 'ch');
  s = replaceAll(s, 'x', 'ks');
  s = replaceAll(s, 'w', 'v');
  s = replaceAll(s, 'y', 'i');

  // "500mg" → "500 mg"
  s = s.replace(/([0-9])([a-z])/g, '$1 $2');
  s = s.replace(/([a-z])([0-9])/g, '$1 $2');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  // Qo'sh harflar: "amoksisillin" → "amoksisilin"
  s = s.replace(/([a-z])\1+/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * So'rov matnini qidiruv so'zlariga ajratadi. Har bir so'z topilgan matnda
 * (prefiks yoki ichida) bo'lishi kerak.
 */
export function searchTokens(query: string): string[] {
  const n = searchNorm(query);
  return n ? n.split(' ') : [];
}

/**
 * Oddiy, tez reyting: hamma so'z bo'lishi shart. Nom boshidan mos kelsa
 * yuqori ball, so'z boshidan — o'rta, ichida — past. Mos kelmasa -1.
 */
export function searchScore(haystackNorm: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const tok of tokens) {
    const at = haystackNorm.indexOf(tok);
    if (at < 0) return -1;
    if (at === 0) score += 30;
    else if (haystackNorm[at - 1] === ' ') score += 15;
    else score += 5;
  }
  // Qisqa nomlar (aniqroq moslik) biroz yuqorida
  return score - Math.min(10, Math.floor(haystackNorm.length / 20));
}
