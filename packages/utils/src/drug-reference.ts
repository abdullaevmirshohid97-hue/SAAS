// =============================================================================
// Davlat dori katalogi (MXIK / tasnif.soliq.uz) — yozuvni Clary ko'rinishiga
// =============================================================================
// Manba: Soliq qo'mitasining MXIK elektron katalogi. Har bir MXIK kodi — aniq
// mahsulot (brend + shakl/qadoq), ko'pida shtrix-kod (GTIN), MNN, ATX va qadoq
// kodlari bor. Bu modul ikki xil API javobini (web-katalog va elasticsearch)
// bitta `DrugReferenceRow` ga keltiradi:
//   * brend → savdo nomi + ishlab chiqaruvchi ("ТЕРАФЛЮ (Glaxo Smith Kline)")
//   * atribut → dozasi, shakli, qadoqdagi dona soni ("… 250мг блистеры №20(2x10)")
//   * MNN, ATX, QQS imtiyozi (243-modda), shtrix-kodlar
// API, sinxronlash va testlar shu koddan foydalanadi — qoida bitta joyda.
// =============================================================================

import { toGtin14 } from './barcode';
import { searchNorm } from './search-norm';

export type DrugRefKind = 'drug' | 'bad' | 'device' | 'other';

export interface MxikHarvestTarget {
  classCode: string;
  /** Faqat shu subpozitsiya (masalan, 02106 ichida faqat BAD). */
  subPositionCode?: string;
  kind: DrugRefKind;
  label: string;
}

/**
 * Katalogga yig'iladigan MXIK sinflari. Dorixonada sotiladigan hamma narsa
 * emas — dori, BAD va tibbiy buyumlar. Qolganlari (gigiena, kosmetika) shtrix-kod
 * skanerlanganda jonli so'rov bilan qo'shiladi (`kind = 'other'`).
 */
export const MXIK_HARVEST_TARGETS: MxikHarvestTarget[] = [
  { classCode: '03004', kind: 'drug', label: 'Dori vositalari (qadoqlangan)' },
  { classCode: '03003', kind: 'drug', label: 'Dori vositalari (qadoqlanmagan)' },
  { classCode: '03002', kind: 'drug', label: 'Vaksina, zardob, qon preparatlari' },
  { classCode: '03001', kind: 'drug', label: 'Organ ekstraktlari' },
  {
    classCode: '02106',
    subPositionCode: '02106999028',
    kind: 'bad',
    label: 'Biologik faol qo‘shimchalar (BAD)',
  },
  { classCode: '09018', kind: 'device', label: 'Tibbiy asbob va uskunalar' },
  { classCode: '09019', kind: 'device', label: 'Massaj, kislorod va nafas apparatlari' },
  { classCode: '09020', kind: 'device', label: 'Nafas olish uskunalari' },
  { classCode: '09021', kind: 'device', label: 'Ortopedik buyumlar, eshitish apparatlari' },
  { classCode: '09022', kind: 'device', label: 'Rentgen va nurlanish uskunalari' },
  { classCode: '09025', kind: 'device', label: 'Termometrlar' },
  { classCode: '03005', kind: 'device', label: 'Paxta, bint, doka' },
  { classCode: '03006', kind: 'device', label: 'Boshqa farmatsevtika mahsulotlari' },
  { classCode: '03822', kind: 'device', label: 'Diagnostika reagentlari va testlar' },
];

/** MXIK kodi qaysi turga kiradi (jonli so'rovda ham). */
export function kindForMxik(mxikCode: string): DrugRefKind {
  for (const t of MXIK_HARVEST_TARGETS) {
    if (
      t.subPositionCode ? mxikCode.startsWith(t.subPositionCode) : mxikCode.startsWith(t.classCode)
    ) {
      return t.kind;
    }
  }
  return 'other';
}

/** Ikki xil API javobining umumiy ko'rinishi. */
export interface MxikRawRow {
  mxikCode: string;
  classCode: string;
  brand: string;
  attribute: string;
  subPosition: string;
  position: string;
  units: string;
  packageName: string;
  mnn: string;
  lgotaName: string;
  gtin: string;
}

/** Clary katalogidagi yozuv (drug_reference jadvali ustunlari). */
export interface DrugReferenceRow {
  mxik_code: string;
  kind: DrugRefKind;
  name: string;
  manufacturer: string | null;
  attribute: string | null;
  form: string | null;
  strength: string | null;
  pack_qty: number;
  blister_qty: number | null;
  unit_name: string | null;
  generic_name: string | null;
  atc_code: string | null;
  class_code: string;
  subposition_name: string | null;
  vat_exempt: boolean;
  gtins: string[];
}

export interface MxikPackage {
  code: string;
  name: string;
  /** Qadoqdagi dona soni (1 = dona). */
  qty: number;
}

// -----------------------------------------------------------------------------
// Matn yordamchilari
// -----------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function clean(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '')
    .trim();
}

/** "---" va bo'sh qiymatlar — ma'lumot yo'q. */
function isBlank(s: string): boolean {
  return clean(s).replace(/-/g, '') === '';
}

function cut(s: string | null, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trim() : s;
}

/**
 * Kod prefiksini olib tashlaydi: "03004002005-Метронидазол" → "Метронидазол".
 * Faqat 11+ xonali kod (subpozitsiya/brend) — "911 (Твинс Тэк)" kabi nom tegilmaydi.
 */
function stripCode(s: string): string {
  return s.replace(/^\s*\d{11,17}\s*(?:---|-)?\s*/, '');
}

// -----------------------------------------------------------------------------
// Bo'laklar
// -----------------------------------------------------------------------------

/**
 * Brend → savdo nomi + ishlab chiqaruvchi. Ishlab chiqaruvchi — oxirgi qavs
 * ichida: "ВИТАМИН В1 (ТИАМИН) (Jurabek Laboratories)" → "ВИТАМИН В1 (ТИАМИН)".
 */
export function splitBrand(brand: string): { name: string; manufacturer: string | null } {
  const s = clean(stripCode(brand));
  if (isBlank(s)) return { name: '', manufacturer: null };
  if (s.endsWith(')')) {
    let depth = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i];
      if (ch === ')') depth++;
      else if (ch === '(') {
        depth--;
        if (depth === 0) {
          const name = clean(s.slice(0, i));
          const mfr = clean(s.slice(i + 1, -1));
          if (name && mfr) return { name, manufacturer: mfr };
          break;
        }
      }
    }
  }
  return { name: s, manufacturer: null };
}

/** ATX kodi: subpozitsiya ("… - A01AB17") yoki pozitsiya ("…-N02BE"). */
export function parseAtc(subPosition: string, position = ''): string | null {
  const full = /(?:^|[\s\-–:])([A-Z]\d{2}[A-Z]{2}\d{2})\s*$/i.exec(clean(subPosition));
  if (full) return full[1]!.toUpperCase();
  const group = /(?:^|[\s\-–:])([A-Z]\d{2}[A-Z]{2})\s*$/i.exec(clean(position));
  return group ? group[1]!.toUpperCase() : null;
}

/** Subpozitsiya nomi: kod va ATX'siz ("Метронидазол", "Вата медицинская"). */
export function subPositionName(subPosition: string): string | null {
  const s = clean(stripCode(subPosition).replace(/[\s\-–]*[A-Z]\d{2}[A-Z]{2}(?:\d{2})?\s*$/i, ''));
  return s || null;
}

const STRENGTH_RE =
  /(\d+(?:[.,]\d+)?\s*(?:мкг|мг|гр|г|мл|ме|ед|%|mcg|mg|g|ml|iu|me)(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:мл|мг|г|доза|ml|mg|g))?)(?![а-яёa-z])/i;

/** Dozasi: birinchi miqdor ("250мг", "2 мг/мл", "6 %", "1000 МЕ"). */
export function parseStrength(attribute: string): string | null {
  const m = STRENGTH_RE.exec(attribute);
  return m ? clean(m[1]!).replace(/\s+/g, ' ') : null;
}

/**
 * Qadoqdagi dona soni. Avval qadoq nomi ("упаковка * 5 блистер * 10 дона"),
 * bo'lmasa atribut ("№20(2x10)", "N5"). Blister — faqat bir nechta blister bo'lsa.
 */
export function parsePack(
  attribute: string,
  packageName = '',
): { pack_qty: number; blister_qty: number | null } {
  const bound = (n: number) => Math.min(10_000, Math.max(1, Math.round(n)));
  const pn = packageName.toLowerCase();
  const units = /(\d+)\s*(?:дона|шт)/.exec(pn);
  if (units) {
    const u = Number(units[1]);
    const bl = /(\d+)\s*блистер/.exec(pn);
    if (bl && Number(bl[1]) > 1 && u > 1) {
      const pack = bound(Number(bl[1]) * u);
      return { pack_qty: pack, blister_qty: u <= pack ? u : null };
    }
    if (bl && Number(bl[1]) >= 1 && u >= 1)
      return { pack_qty: bound(Number(bl[1]) * u), blister_qty: null };
    if (u >= 1) return { pack_qty: bound(u), blister_qty: null };
  }
  const m = /(?:^|[\s,(])[№N]\s?(\d{1,4})(?:\s*\(\s*(\d{1,4})\s*[xх×*]\s*(\d{1,4})\s*\))?/.exec(
    attribute,
  );
  if (!m) return { pack_qty: 1, blister_qty: null };
  const pack = bound(Number(m[1]));
  const a = m[2] ? Number(m[2]) : 0;
  const b = m[3] ? Number(m[3]) : 0;
  const blister = a > 1 && b > 1 && a * b === pack ? b : null;
  return { pack_qty: pack, blister_qty: blister };
}

/** Shakli: atributdan dozasi va "№…" qismi olib tashlanadi. */
export function cleanForm(attribute: string, strength: string | null): string | null {
  let s = attribute;
  if (strength) s = s.replace(strength, ' ');
  s = s.replace(/(?:^|\s)[№N]\s?\d.*$/, '');
  s = clean(s.replace(/\s+[,.]/g, ','));
  return s ? cut(s, 100) : null;
}

const UNIT_MAP: Array<[RegExp, string]> = [
  [/^таблет/, 'tabletka'],
  [/^капсул/, 'kapsula'],
  [/^ампул/, 'ampula'],
  [/^флакон/, 'flakon'],
  [/^пакет/, 'paket'],
  [/^саше/, 'paket'],
  [/^туб/, 'tuba'],
  [/^(суппозитор|свеч)/, 'sham'],
];

/** Eng kichik birlik ("шт (таблетка (250 мг))" → "tabletka") — Clary ro'yxatidan. */
export function unitNameFromUnits(units: string): string | null {
  const m = /\(\s*([а-яёa-z]+)/i.exec(units);
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  for (const [re, name] of UNIT_MAP) if (re.test(w)) return name;
  return null;
}

/** Barcha to'g'ri GTIN'lar (14 xona). */
export function parseGtins(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(/[^0-9]+/)) {
    const g = part ? toGtin14(part) : null;
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * GTIN-14 → MXIK qidiruvi uchun ko'rinishlar. MXIK kodni yozilgan holida
 * saqlaydi (EAN-13, UPC-A 12 xona, EAN-8 8 xona), qidiruv esa nol bilan
 * to'ldirilgan shaklni topmaydi — ko'rinishlar navbatma-navbat so'raladi.
 */
export function gtinSearchTerms(gtin14: string): string[] {
  if (!/^\d{14}$/.test(gtin14)) return [gtin14];
  const out: string[] = [];
  if (gtin14.startsWith('000000')) out.push(gtin14.slice(6));
  if (gtin14.startsWith('0')) out.push(gtin14.slice(1));
  if (gtin14.startsWith('00')) out.push(gtin14.slice(2));
  if (!gtin14.startsWith('0')) out.push(gtin14);
  return [...new Set(out)];
}

/** MXIK ochiq API manzili (server ham, brauzer ham shu manzilga murojaat qiladi). */
export const MXIK_API_BASE = 'https://tasnif.soliq.uz/api/cls-api';

/** Sinf sahifasi URL (web-katalog, ruscha). */
export function mxikClassPageUrl(
  target: Pick<MxikHarvestTarget, 'classCode' | 'subPositionCode'>,
  pageNo: number,
  pageSize = 1000,
  base = MXIK_API_BASE,
): string {
  const qs = new URLSearchParams({
    classCode: target.classCode,
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    lang: 'ru',
  });
  if (target.subPositionCode) qs.set('subPositionCode', target.subPositionCode);
  return `${base}/attribute/web-katalog?${qs.toString()}`;
}

// -----------------------------------------------------------------------------
// API javoblari → MxikRawRow
// -----------------------------------------------------------------------------

/** /attribute/web-katalog qatori. */
export function fromWebKatalog(r: Record<string, unknown>): MxikRawRow {
  const mxik = str(r['mxikCode']);
  return {
    mxikCode: mxik,
    classCode: mxik.slice(0, 5),
    brand: str(r['brand']),
    attribute: str(r['attribute']),
    subPosition: str(r['subPosition']),
    position: str(r['position']),
    units: str(r['units']),
    packageName: str(r['packageName']),
    mnn: str(r['mnnName']),
    lgotaName: str(r['lgotaName']),
    gtin: str(r['internationalCode']),
  };
}

/** /elasticsearch/search qatori (shtrix-kod bo'yicha jonli so'rov). */
export function fromElastic(r: Record<string, unknown>): MxikRawRow {
  const mxik = str(r['mxikCode']);
  return {
    mxikCode: mxik,
    classCode: str(r['classCode']) || mxik.slice(0, 5),
    brand: str(r['brandName']),
    attribute: str(r['attributeName']),
    subPosition: str(r['subPositionName']),
    position: str(r['positionName']),
    units: str(r['unitsName']),
    packageName: str(r['packageName']),
    mnn: str(r['mnnName']),
    lgotaName: str(r['lgotaName']),
    gtin: str(r['internationalCode']),
  };
}

// -----------------------------------------------------------------------------
// Asosiy: MxikRawRow → DrugReferenceRow
// -----------------------------------------------------------------------------

/**
 * Bitta MXIK yozuvi. `null` — mahsulot emas (sinf/subpozitsiya "---" kodi)
 * yoki kod noto'g'ri.
 */
export function mapMxikRow(raw: MxikRawRow, kind?: DrugRefKind): DrugReferenceRow | null {
  const mxik = raw.mxikCode.replace(/\D/g, '');
  if (mxik.length !== 17) return null;
  const k = kind ?? kindForMxik(mxik);
  const brand = splitBrand(raw.brand);
  const attribute = isBlank(raw.attribute) ? '' : clean(raw.attribute);
  const strength = attribute ? parseStrength(attribute) : null;

  let name: string;
  let form: string | null = null;
  if (k === 'drug') {
    // Dori: brend — savdo nomi, atribut — shakli va qadog'i
    name = brand.name || attribute;
    form = brand.name && attribute ? cleanForm(attribute, strength) : null;
  } else {
    // BAD / tibbiy buyum: brend ko'pincha savdo belgisi, mahsulot nomi atributda
    name = clean([brand.name, attribute].filter(Boolean).join(' '));
  }
  if (!name) return null;

  const pack = parsePack(attribute, raw.packageName);
  const mnn = clean(raw.mnn);
  return {
    mxik_code: mxik,
    kind: k,
    name: cut(name, 300)!,
    manufacturer: cut(brand.manufacturer, 200),
    attribute: cut(attribute || null, 500),
    form,
    strength: cut(strength, 100),
    pack_qty: pack.pack_qty,
    blister_qty: pack.blister_qty,
    unit_name: pack.pack_qty > 1 ? unitNameFromUnits(raw.units) : null,
    generic_name: mnn && !/отсутств|утвержд|mavjud emas/i.test(mnn) ? cut(mnn, 200) : null,
    atc_code: parseAtc(raw.subPosition, raw.position),
    class_code: raw.classCode || mxik.slice(0, 5),
    subposition_name: cut(subPositionName(raw.subPosition), 300),
    // QQS imtiyozi — Soliq kodeksi 243-moddasi (dorilar, tibbiy buyumlar)
    vat_exempt: /243/.test(raw.lgotaName),
    gtins: parseGtins(raw.gtin),
  };
}

// -----------------------------------------------------------------------------
// Qadoq kodlari (fiskal chek uchun)
// -----------------------------------------------------------------------------

/** /integration-mxik/get/history/{mxik} → packageNames. */
export function parsePackages(list: unknown): MxikPackage[] {
  if (!Array.isArray(list)) return [];
  const out: MxikPackage[] = [];
  for (const p of list as Array<Record<string, unknown>>) {
    const code = str(p['code']);
    const name = clean(str(p['nameRu']) || str(p['nameLat']) || str(p['nameUz']));
    if (!code) continue;
    out.push({ code, name, qty: packageQty(name) });
  }
  return out;
}

/**
 * Qadoq nomidagi dona soni: "упаковка=5 шт" → 5, "блистер=10 шт" → 10,
 * "упаковка=2 блистер (10 шт (капсула (20 мг))" → 2 × 10 = 20, "шт (…)" → 1.
 */
export function packageQty(name: string): number {
  const m = /=\s*(\d+)\s*([^\d(]*)/.exec(name);
  if (!m) return 1;
  let qty = Math.max(1, Number(m[1]));
  if (/бл[иі]ст|blist/i.test(m[2] ?? '')) {
    const inner = /(\d+)\s*(?:шт|дона|dona)/i.exec(name.slice(m.index + m[0].length));
    if (inner) qty *= Math.max(1, Number(inner[1]));
  }
  return Math.min(qty, 10_000);
}

/** Sotiladigan birlikka mos qadoq kodi: donalab — dona; aks holda — qadoq. */
export function pickPackageCode(
  packages: MxikPackage[],
  packQty: number,
  sellByUnit: boolean,
): string | null {
  if (packages.length === 0) return null;
  const byQty = (q: number) => packages.find((p) => p.qty === q)?.code ?? null;
  if (sellByUnit || packQty <= 1) return byQty(1) ?? packages[0]!.code;
  return byQty(packQty) ?? byQty(1) ?? packages[0]!.code;
}

// -----------------------------------------------------------------------------
// Dorixonaning o'z bazasidagi dori ↔ katalog yozuvi (MXIK'siz eski yozuvlar)
// -----------------------------------------------------------------------------
// Dorixonalarda nomlar odatda "Конкор 5 мг№1", "Актовегин 5 мл №1", "Сербан таб"
// ko'rinishida: doza, hajm, qadoqdagi son va shakl qisqartmasi nom ichida.
// Katalogda esa "КОНКОР®" + "5 мг". Moslash: savdo nomi (doza/№/shakl so'zlarisiz)
// bir xil bo'lsin, doza ma'lum bo'lsa — u ham mos kelsin.

/** Nomdan olib tashlanadigan shakl qisqartmalari (normallashgan ko'rinishda). */
const FORM_WORDS = new Set([
  'tab',
  'tabl',
  'tabletka',
  'tabletki',
  'kaps',
  'kapsula',
  'kapsuli',
  'amp',
  'ampula',
  'ampuli',
  'maz',
  'mazi',
  'gel',
  'krem',
  'sirop',
  'r',
  'rastvor',
  'fl',
  'flakon',
  'sht',
  'up',
  'upak',
  'sprei',
  'kapli',
  'poroshok',
  'svechi',
  'suppozitorii',
  'dona',
  'shisha',
]);

const STRENGTH_ALL_RE = new RegExp(STRENGTH_RE.source, 'gi');

/** "10.0 мл" → "10 мл", "1,50 г" → "1,5 г" (keraksiz nollar). */
function trimZeros(s: string): string {
  return (
    s
      .replace(/(\d+)[.,]0+(?!\d)/g, '$1')
      .replace(/(\d+[.,]\d*?)0+(?!\d)/g, '$1')
      // birliklar bir xil yozilsin: "1,5 гр" = "1,5 г", "5 миллилитр" = "5 мл"
      .replace(/(\d)\s*(?:грамм|гр)(?![а-яё])/gi, '$1 г')
      .replace(/(\d)\s*миллилитр(?![а-яё])/gi, '$1 мл')
  );
}

export interface OwnNameKey {
  /** Savdo nomi — normallashgan, doza/№/shakl so'zlarisiz ("konkor"). */
  brand: string;
  /** Doza/hajm — normallashgan ("5 mg"), noma'lum bo'lsa null. */
  strength: string | null;
  /** Nomdagi "№N" (qadoqdagi son), bo'lmasa null. */
  pack: number | null;
}

export function ownNameKey(name: string, strength?: string | null): OwnNameKey {
  let s = ` ${trimZeros(name ?? '')} `;
  const pm = /[№N]\s?(\d{1,4})/.exec(s);
  const pack = pm ? Number(pm[1]) : null;
  s = s.replace(/№\s*\S*/g, ' ').replace(/\sN\s?\d+(?=\s|$)/g, ' ');
  // "50/5 мг", "20\10" — kombinatsiyalangan doza: butunligicha olib tashlanadi
  s = s.replace(
    /\d+(?:[.,]\d+)?(?:\s*[/\\]\s*\d+(?:[.,]\d+)?)+\s*(?:мкг|мг|гр|г|мл|%|mg|ml|g)?/gi,
    ' ',
  );
  const st = (strength && trimZeros(strength).trim()) || parseStrength(s);
  s = s.replace(STRENGTH_ALL_RE, ' ');
  const tokens = searchNorm(s)
    .split(' ')
    .filter((t) => t && !FORM_WORDS.has(t));
  return { brand: tokens.join(' '), strength: st ? searchNorm(st) : null, pack };
}

export type OwnRefMatch = 'exact' | 'brand' | 'prefix';

/**
 * Bazadagi dori katalog yozuviga mosmi:
 *   'exact'  — nomi va dozasi bir xil;
 *   'brand'  — nomi bir xil (bazada doza ko'rsatilmagan);
 *   'prefix' — katalog nomi davomi bor ("Канефрон" ↔ "КАНЕФРОН® Н") — faqat taklif;
 *   null     — mos emas (nom boshqa yoki doza farq qiladi).
 */
export function matchOwnToRef(
  key: OwnNameKey,
  hit: { name: string; strength?: string | null; attribute?: string | null },
): OwnRefMatch | null {
  if (!key.brand) return null;
  const hb = ownNameKey(hit.name).brand;
  const same = hb === key.brand;
  if (!same && !hb.startsWith(`${key.brand} `)) return null;
  if (key.strength) {
    const hs = ` ${searchNorm(trimZeros(`${hit.strength ?? ''} ${hit.attribute ?? ''}`))} `;
    if (!hs.includes(` ${key.strength} `)) return null;
    return same ? 'exact' : 'prefix';
  }
  return same ? 'brand' : 'prefix';
}

/**
 * Katalog natijalaridan bazadagi doriga mos keladiganlari va eng yaxshisi.
 * `confident` — avtomatik biriktirish mumkin: bitta variant, yoki hammasi bir xil
 * ishlab chiqaruvchi/doza/shaklda (faqat qadoqdagi soni farq qiladi). 'prefix'
 * moslik hech qachon avtomatik emas.
 */
export function pickOwnMatch<
  T extends {
    name: string;
    strength?: string | null;
    attribute?: string | null;
    form?: string | null;
    manufacturer?: string | null;
    pack_qty: number;
  },
>(key: OwnNameKey, hits: T[]): { best: T | null; candidates: T[]; confident: boolean } {
  const by: Record<OwnRefMatch, T[]> = { exact: [], brand: [], prefix: [] };
  for (const h of hits) {
    const m = matchOwnToRef(key, h);
    if (m) by[m].push(h);
  }
  const level: OwnRefMatch | null = by.exact.length
    ? 'exact'
    : by.brand.length
      ? 'brand'
      : by.prefix.length
        ? 'prefix'
        : null;
  if (!level) return { best: null, candidates: [], confident: false };
  let pool = by[level];
  if (key.pack && key.pack > 1 && pool.some((h) => h.pack_qty === key.pack)) {
    pool = pool.filter((h) => h.pack_qty === key.pack);
  }
  const sorted = [...pool].sort(
    (a, b) =>
      Number(b.pack_qty === (key.pack ?? 1)) - Number(a.pack_qty === (key.pack ?? 1)) ||
      a.pack_qty - b.pack_qty,
  );
  const sig = (h: T) =>
    `${searchNorm(h.manufacturer)}|${searchNorm(h.strength)}|${searchNorm(h.form)}`;
  const oneProduct = new Set(sorted.map(sig)).size === 1;
  return {
    best: sorted[0] ?? null,
    candidates: sorted,
    confident: level !== 'prefix' && (sorted.length === 1 || oneProduct),
  };
}
