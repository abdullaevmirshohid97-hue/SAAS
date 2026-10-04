// =============================================================================
// Shtrix-kod / QR / DataMatrix (GS1) — YAGONA tahlil qiluvchi
// =============================================================================
// Skaner modeli muhim emas: USB va Bluetooth skanerlar klaviatura sifatida
// ishlaydi (HID), natija matn bo'lib keladi va shu funksiyalardan o'tadi.
// Veb (POS, prihod), API (lookup) va testlar bir xil koddan foydalanadi —
// shuning uchun "skanerda boshqa, serverda boshqa" degan farq bo'lmaydi.
//
// Qo'llab-quvvatlanadi:
//   * EAN-13 / EAN-8 / UPC-A / GTIN-14 (1D)       → GTIN-14 ga normallanadi
//   * GS1 DataMatrix / GS1-128 / GS1 QR (2D)      → GTIN, muddat, seriya, seriya №
//   * Code128 / Code39 / ichki kodlar              → katta harf matn
//   * Clary dorixona chekidagi QR (PHS:<uuid>)     → sotuvni topish (qaytarish)
//   * URL QR                                       → url
// =============================================================================

/** GS1 guruh ajratgichi (FNC1 / ASCII 29). */
export const GS = '\u001d';

/** Clary dorixona chekidagi ichki QR prefiksi. */
export const CLARY_SALE_QR_PREFIX = 'PHS:';

export type ScanKind = 'gs1' | 'gtin' | 'url' | 'clary-sale' | 'text';

export interface ParsedScan {
  /** Tozalangan xom matn (boshqaruv belgilarsiz, GS saqlanadi). */
  raw: string;
  /** Qidiruv kaliti: GTIN-14 yoki katta harfli matn. */
  code: string;
  kind: ScanKind;
  gtin?: string;
  /** Yaroqlilik muddati, YYYY-MM-DD. */
  expiry?: string;
  /** Partiya / seriya (AI 10). */
  batch?: string;
  /** Qutining individual seriya raqami (AI 21). */
  serial?: string;
  /** Ishlab chiqarilgan sana, YYYY-MM-DD (AI 11). */
  prodDate?: string;
  /** GS ajratgichsiz kelgan va taxminiy ajratilgan (tekshirib ko'rish kerak). */
  ambiguous?: boolean;
  /** Clary chek QR'idagi sotuv ID. */
  saleId?: string;
  url?: string;
}

// -----------------------------------------------------------------------------
// GTIN
// -----------------------------------------------------------------------------

/** GS1 mod-10 nazorat raqami (o'ngdan 3/1 vazn). `body` — nazorat raqamisiz. */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** EAN-8 / UPC-A / EAN-13 / GTIN-14 — uzunlik va nazorat raqami to'g'rimi. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/**
 * Har qanday to'g'ri GTIN'ni 14 xonaga keltiradi. EAN-13 "4780000001234" va
 * DataMatrix'dagi (01)04780000001234 bitta mahsulot — ikkalasi bir kalitga
 * tushishi shart. Nazorat raqami chapdan nol qo'shilganda o'zgarmaydi.
 */
export function toGtin14(code: string): string | null {
  return isValidGtin(code) ? code.padStart(14, '0') : null;
}

/**
 * Bazada saqlash va qidirish uchun yagona ko'rinish:
 * to'g'ri GTIN → 14 xona; boshqa kodlar → bo'sh joysiz, katta harf.
 */
export function normalizeBarcode(input: string): string {
  const cleaned = stripAim(stripControl(input)).replace(/\s+/g, '');
  if (!cleaned) return '';
  const gtin = toGtin14(cleaned);
  return gtin ?? cleaned.toUpperCase();
}

/**
 * Ichki (do'kon ichidagi) EAN-13: GS1 bo'yicha "2" bilan boshlanadigan
 * prefikslar cheklangan muomala uchun ajratilgan — tashqi mahsulot bilan
 * to'qnashmaydi. `seq` — klinika ichida unikal tartib raqami.
 */
export function internalEan13(seq: number): string {
  const body = '2' + String(Math.max(0, Math.floor(seq)) % 1e11).padStart(11, '0');
  return body + String(gtinCheckDigit(body));
}

// -----------------------------------------------------------------------------
// Tozalash
// -----------------------------------------------------------------------------

/** GS dan boshqa boshqaruv belgilarini olib tashlaydi, GS ko'rinishlarini birlashtiradi. */
function stripControl(s: string): string {
  return (
    s
      // Skaner/terminal GS'ni turlicha yuboradi — hammasini haqiqiy GS ga keltiramiz.
      .replace(/<GS>|\{GS\}|\[GS\]|␝|\^\]/gi, GS)
      // \r \n \t va boshqa boshqaruv belgilari (GS=0x1d bundan mustasno)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001c\u001e\u001f\u007f]/g, '')
      .trim()
  );
}

/** AIM simvologiya identifikatori: ]d2 (GS1 DataMatrix), ]C1 (GS1-128), ]Q3, ]E0 ... */
function stripAim(s: string): string {
  return /^\][A-Za-z][0-9A-Za-z]/.test(s) ? s.slice(3) : s;
}

// -----------------------------------------------------------------------------
// GS1 Application Identifier jadvali
// -----------------------------------------------------------------------------

interface AiSpec {
  /** Belgilangan uzunlik (fixed) yoki maksimal uzunlik (variable). */
  len: number;
  fixed: boolean;
}

const AI_2: Record<string, AiSpec> = {
  '00': { len: 18, fixed: true },
  '01': { len: 14, fixed: true },
  '02': { len: 14, fixed: true },
  '10': { len: 20, fixed: false },
  '11': { len: 6, fixed: true },
  '12': { len: 6, fixed: true },
  '13': { len: 6, fixed: true },
  '15': { len: 6, fixed: true },
  '16': { len: 6, fixed: true },
  '17': { len: 6, fixed: true },
  '20': { len: 2, fixed: true },
  '21': { len: 20, fixed: false },
  '22': { len: 20, fixed: false },
  '30': { len: 8, fixed: false },
  '37': { len: 8, fixed: false },
  '90': { len: 30, fixed: false },
  '91': { len: 90, fixed: false },
  '92': { len: 90, fixed: false },
  '93': { len: 90, fixed: false },
  '94': { len: 90, fixed: false },
  '95': { len: 90, fixed: false },
  '96': { len: 90, fixed: false },
  '97': { len: 90, fixed: false },
  '98': { len: 90, fixed: false },
  '99': { len: 90, fixed: false },
};

const AI_3: Record<string, AiSpec> = {
  '240': { len: 30, fixed: false },
  '241': { len: 30, fixed: false },
  '242': { len: 6, fixed: false },
  '250': { len: 30, fixed: false },
  '251': { len: 30, fixed: false },
  '253': { len: 30, fixed: false },
  '254': { len: 20, fixed: false },
  '400': { len: 30, fixed: false },
  '401': { len: 30, fixed: false },
  '410': { len: 13, fixed: true },
  '414': { len: 13, fixed: true },
  '422': { len: 3, fixed: true },
  '714': { len: 20, fixed: false },
};

const AI_4: Record<string, AiSpec> = {
  '7003': { len: 10, fixed: true },
  '8005': { len: 6, fixed: true },
  '8008': { len: 12, fixed: false },
};

function lookupAi(s: string, pos: number): { ai: string; spec: AiSpec } | null {
  const two = s.substr(pos, 2);
  // 310n..369n — o'lchov qiymatlari: 4 xonali AI + 6 xonali qiymat
  if (/^3[1-6]$/.test(two) && /^\d{4}$/.test(s.substr(pos, 4))) {
    return { ai: s.substr(pos, 4), spec: { len: 6, fixed: true } };
  }
  if (AI_2[two]) return { ai: two, spec: AI_2[two]! };
  const three = s.substr(pos, 3);
  if (AI_3[three]) return { ai: three, spec: AI_3[three]! };
  const four = s.substr(pos, 4);
  if (AI_4[four]) return { ai: four, spec: AI_4[four]! };
  return null;
}

/** YYMMDD → YYYY-MM-DD. DD=00 → oyning oxirgi kuni (GS1 qoidasi). */
export function gs1Date(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return undefined;
  const year = 2000 + yy;
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0) dd = lastDay;
  if (dd < 1 || dd > lastDay) return undefined;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Inson o'qiydigan ko'rinish: (01)04780069000130(17)271231(10)AB12 */
function parseParenthesized(s: string): Record<string, string> | null {
  if (!/^\(\d{2,4}\)/.test(s)) return null;
  const out: Record<string, string> = {};
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]!] = (m[2] ?? '').trim();
  return Object.keys(out).length ? out : null;
}

/**
 * GS ajratgichsiz kelgan o'zgaruvchan maydonning oxirini taxmin qiladi.
 * Dori markirovkasi formatlari (CRPT uslubi): 01{14} 21{13} 91{4} 92{44} yoki
 * 01{14} 21{13} 93{4}. Partiya (10) uchun esa keyingi "17YYMMDD" yoki "21"ni
 * qidiramiz.
 */
function guessVariableEnd(s: string, start: number, ai: string, maxLen: number): number {
  const rest = s.slice(start);
  if (ai === '21') {
    // 13 belgili seriya + 91/93 kripto qismi — eng keng tarqalgan dori formati
    if (rest.length >= 15 && /^(91|93)/.test(rest.slice(13))) return start + 13;
    if (rest.length >= 9 && /^(91|93)/.test(rest.slice(7))) return start + 7;
  }
  if (ai === '10') {
    for (let p = 1; p <= Math.min(maxLen, rest.length - 2); p++) {
      const tail = rest.slice(p);
      if (/^17\d{6}/.test(tail) && gs1Date(tail.slice(2, 8))) return start + p;
      if (/^21[0-9A-Za-z]/.test(tail) && tail.length >= 8) return start + p;
      if (/^11\d{6}/.test(tail) && gs1Date(tail.slice(2, 8))) return start + p;
    }
  }
  if (ai === '91' && /^.{4}9[23]/.test(rest)) return start + 4;
  return start + Math.min(maxLen, rest.length);
}

/**
 * GS1 element satrini maydonlarga ajratadi. Belgisiz/noma'lum AI uchrasa
 * o'sha joyda to'xtaydi (ungacha olinganlar qaytadi).
 */
export function parseGs1(input: string): {
  fields: Record<string, string>;
  ambiguous: boolean;
} {
  const s0 = stripAim(stripControl(input));
  const paren = parseParenthesized(s0);
  if (paren) return { fields: paren, ambiguous: false };

  const s = s0.startsWith(GS) ? s0.slice(1) : s0;
  const hasGs = s.includes(GS);
  const fields: Record<string, string> = {};
  let ambiguous = false;
  let pos = 0;
  let guard = 0;
  while (pos < s.length && guard++ < 40) {
    if (s[pos] === GS) {
      pos++;
      continue;
    }
    const hit = lookupAi(s, pos);
    if (!hit) break;
    const { ai, spec } = hit;
    const valueStart = pos + ai.length;
    let end: number;
    if (spec.fixed) {
      end = valueStart + spec.len;
      if (end > s.length) break;
    } else {
      const gsAt = s.indexOf(GS, valueStart);
      if (gsAt >= 0) {
        end = Math.min(gsAt, valueStart + spec.len);
      } else if (!hasGs) {
        // GS umuman yo'q — maydon qayerda tugashini taxmin qilamiz. Oxirigacha
        // borsa (oxirgi maydon) taxmin emas; o'rtada kesilsa — "taxminiy".
        end = guessVariableEnd(s, valueStart, ai, spec.len);
        if (end < s.length) ambiguous = true;
      } else {
        end = Math.min(s.length, valueStart + spec.len);
      }
    }
    fields[ai] = s.slice(valueStart, end);
    pos = end;
  }
  return { fields, ambiguous };
}

function looksLikeGs1(s: string): boolean {
  if (s.includes(GS)) return true;
  if (/^\(\d{2,4}\)/.test(s)) return true;
  // 01 + 14 raqamli GTIN va undan keyin yana nimadir (17/10/21...)
  return /^01\d{14}./.test(s) && isValidGtin(s.slice(2, 16));
}

// -----------------------------------------------------------------------------
// Asosiy kirish nuqtasi
// -----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Skanerdan kelgan har qanday matnni tahlil qiladi. */
export function parseScan(input: string): ParsedScan {
  const raw = stripAim(stripControl(input));
  const compact = raw.replace(/\s+/g, '');

  if (compact.toUpperCase().startsWith(CLARY_SALE_QR_PREFIX)) {
    const id = compact.slice(CLARY_SALE_QR_PREFIX.length);
    if (UUID_RE.test(id)) {
      return { raw, code: compact.toUpperCase(), kind: 'clary-sale', saleId: id.toLowerCase() };
    }
  }

  if (/^https?:\/\//i.test(raw)) {
    return { raw, code: raw, kind: 'url', url: raw };
  }

  if (looksLikeGs1(compact)) {
    const { fields, ambiguous } = parseGs1(compact);
    const gtinRaw = fields['01'] ?? fields['02'];
    const gtin = gtinRaw && isValidGtin(gtinRaw) ? gtinRaw.padStart(14, '0') : undefined;
    if (gtin || fields['10'] || fields['21']) {
      return {
        raw,
        code: gtin ?? compact.toUpperCase(),
        kind: 'gs1',
        gtin,
        expiry: fields['17'] ? gs1Date(fields['17']) : undefined,
        batch: fields['10'] || undefined,
        serial: fields['21'] || undefined,
        prodDate: fields['11'] ? gs1Date(fields['11']) : undefined,
        ambiguous: ambiguous || undefined,
      };
    }
  }

  const gtin = toGtin14(compact);
  if (gtin) return { raw, code: gtin, kind: 'gtin', gtin };

  return { raw, code: compact.toUpperCase(), kind: 'text' };
}

/** Qidiruv uchun nomzod kalitlar: GTIN-14 va (bo'lsa) qisqa EAN shakli. */
export function barcodeLookupKeys(input: string): string[] {
  const parsed = parseScan(input);
  const keys = new Set<string>();
  if (parsed.code) keys.add(parsed.code);
  if (parsed.gtin) {
    keys.add(parsed.gtin);
    // Eski yozuvlar EAN-13 ko'rinishida saqlangan bo'lishi mumkin
    const ean13 = parsed.gtin.replace(/^0/, '');
    if (ean13.length === 13) keys.add(ean13);
    const ean8 = parsed.gtin.replace(/^0{6}/, '');
    if (ean8.length === 8) keys.add(ean8);
  }
  return [...keys];
}

// -----------------------------------------------------------------------------
// Klaviatura raskladkasi muammosi
// -----------------------------------------------------------------------------
// Skaner tugmalarni "bosadi". Kompyuterda rus/kirill raskladka yoqilgan
// bo'lsa, "ABC123" o'rniga "ФИС123" keladi. Bu funksiya joylashuv bo'yicha
// lotinga qaytaradi (ЙЦУКЕН → QWERTY). Skaner xizmatining o'zi
// `KeyboardEvent.code` dan foydalanadi va raskladkaga bog'liq emas —
// bu funksiya qo'lda joylangan (paste) matnlar uchun zaxira.

const RU_TO_EN: Record<string, string> = {
  й: 'q',
  ц: 'w',
  у: 'e',
  к: 'r',
  е: 't',
  н: 'y',
  г: 'u',
  ш: 'i',
  щ: 'o',
  з: 'p',
  х: '[',
  ъ: ']',
  ф: 'a',
  ы: 's',
  в: 'd',
  а: 'f',
  п: 'g',
  р: 'h',
  о: 'j',
  л: 'k',
  д: 'l',
  ж: ';',
  э: "'",
  я: 'z',
  ч: 'x',
  с: 'c',
  м: 'v',
  и: 'b',
  т: 'n',
  ь: 'm',
  б: ',',
  ю: '.',
  ё: '`',
};

/** Kirill harflarni klaviatura joylashuvi bo'yicha lotinga o'giradi. */
export function cyrillicLayoutToLatin(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const mapped = RU_TO_EN[lower];
    if (mapped === undefined) {
      out += ch;
    } else {
      out += ch === lower ? mapped : mapped.toUpperCase();
    }
  }
  return out;
}

/** Matnda kirill harf bormi (skaner raskladka muammosini aniqlash uchun). */
export function hasCyrillic(s: string): boolean {
  return /[Ѐ-ӿ]/.test(s);
}
