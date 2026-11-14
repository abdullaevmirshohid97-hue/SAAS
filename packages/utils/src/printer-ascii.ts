// =============================================================================
// Termal printer uchun matn (ESC/POS matn rejimi)
// =============================================================================
// Termal printerlar UTF-8 kirillni bilmaydi: "УЗИ общий" → "Ð£Ð—Ð˜ Ð¾Ð±...".
// Matnli chek yuborishdan oldin kirill lotinga o'giriladi va printer
// tushunmaydigan belgilar ASCII'ga almashtiriladi. (Desktop 0.2.1+ cheklarni
// rasm qilib yuboradi — u yerda bu kerak emas.)
// =============================================================================

const CYR: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: "o'",
  қ: 'q',
  ғ: "g'",
  ҳ: 'h',
  і: 'i',
  є: 'e',
  ї: 'i',
};

/** Kirill → lotin, tipografik belgilar → ASCII, qolgan ASCII bo'lmaganlar olib tashlanadi. */
export function toPrinterAscii(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const t = CYR[lower];
    if (t !== undefined) {
      out += ch !== lower && t ? t[0]!.toUpperCase() + t.slice(1) : t;
      continue;
    }
    out += ch;
  }
  return out
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/№/g, 'N')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x20-\x7e\n]/g, '');
}
