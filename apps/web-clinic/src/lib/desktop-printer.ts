import { toast } from 'sonner';

import { isTauri } from './platform';

// =============================================================================
// Desktop: printerlarni SO'ROVSIZ avtomatik tanlash
// =============================================================================
// Silent chop etish uchun printer nomlari localStorage'da saqlanadi
// (Sozlamalar → Termal printerlar'da o'zgartiriladi). Tanlanmagan bo'lsa,
// endi hech narsa so'ralmaydi — kompyuterdagi printerlardan avtomatik topiladi
// va eslab qolinadi:
//   • chek   — nomidan termal printer (XP-80, POS-58, TM-T20 …);
//   • A4     — Windows standart printeri (virtual/termal bo'lmasa), aks holda
//              birinchi oddiy printer;
//   • label  — nomidan label printer, bo'lmasa A4 printer.
// Termal printer topilmasa chek A4/standart printerdan chiqadi (chaqiruvchi hal qiladi).
// =============================================================================

export const DESKTOP_PRINTER_KEY = 'clary.desktop.printer';
export const DESKTOP_A4_PRINTER_KEY = 'clary.desktop.printer.a4';
export const DESKTOP_LABEL_PRINTER_KEY = 'clary.desktop.printer.label';

export interface DesktopPrinterInfo {
  name: string;
  is_default: boolean;
  online: boolean;
  state: string;
}

/** Virtual (qog'ozsiz) printerlar — hech qachon avtomatik tanlanmaydi. */
const VIRTUAL_RE = /pdf|xps|onenote|fax|send to|anydesk|snagit|document writer|cutepdf/i;
/**
 * Chek (termal) printerga o'xshash nomlar. "Generic / Text Only" — termal
 * printerni Windows'ga o'rnatishning eng keng tarqalgan usuli: u faqat xom
 * (ESC/POS) baytlarni chiqaradi, PDF/rasmni drayver orqali chop eta olmaydi.
 */
const THERMAL_RE =
  /\bpos\b|pos-?\d|receipt|thermal|xprinter|\bxp-|tm-?[tmu]\d|rongta|\brp\d|bixolon|srp-|gprinter|\bgp-?[a-z]?\d|hprt|sunmi|citizen ct|star tsp|sprt|sp-pos|posiflex|sewoo|winpos|text only|\b(58|80)\s?(mm|series)\b|printer[\s_-]?(58|80)\b|chek|kassa|чек|касс/i;
/** Label (yorliq) printerlar. */
const LABEL_RE = /label|zebra|\btsc\b|godex|\btlp|\bzd\d|\bgk4|xp-3\d\d|xp-4\d\d|dymo|brother ql/i;

export function isThermalName(name: string): boolean {
  return THERMAL_RE.test(name) && !VIRTUAL_RE.test(name) && !LABEL_RE.test(name);
}

export function isVirtualName(name: string): boolean {
  return VIRTUAL_RE.test(name);
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function save(key: string, name: string) {
  try {
    localStorage.setItem(key, name);
  } catch {
    /* ignore */
  }
}

export async function listDesktopPrinters(): Promise<DesktopPrinterInfo[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const detailed = await invoke<DesktopPrinterInfo[]>('list_printers_detailed');
    if (Array.isArray(detailed)) return detailed;
  } catch {
    // eski build — oddiy ro'yxat
  }
  const names = await invoke<string[]>('list_printers');
  return (names ?? []).map((name) => ({ name, is_default: false, online: true, state: 'unknown' }));
}

// Ro'yxat qisqa muddat keshlanadi — har chekda spooler so'ralmasin.
let listCache: { at: number; list: Promise<DesktopPrinterInfo[]> } | null = null;
function cachedPrinters(): Promise<DesktopPrinterInfo[]> {
  const now = Date.now();
  if (!listCache || now - listCache.at > 60_000) {
    const list = listDesktopPrinters().catch((e) => {
      listCache = null;
      throw e;
    });
    listCache = { at: now, list };
  }
  return listCache.list;
}

/** Saqlangan nom hali ham kompyuterda bormi (ro'yxat olinmasa — ishonamiz). */
async function stillExists(name: string): Promise<boolean> {
  try {
    const list = await cachedPrinters();
    return list.length === 0 || list.some((p) => p.name === name);
  } catch {
    return true;
  }
}

/** Onlayn printerlar oldinda, keyin standart printer. */
function rank(list: DesktopPrinterInfo[]): DesktopPrinterInfo[] {
  return [...list].sort(
    (a, b) => Number(b.online) - Number(a.online) || Number(b.is_default) - Number(a.is_default),
  );
}

async function resolve(
  key: string,
  pick: (list: DesktopPrinterInfo[]) => DesktopPrinterInfo | undefined,
  label: string,
): Promise<string | null> {
  const saved = read(key);
  if (saved && (await stillExists(saved))) return saved;
  let list: DesktopPrinterInfo[];
  try {
    list = (await cachedPrinters()).filter((p) => !isVirtualName(p.name));
  } catch (e) {
    console.warn('[print] printerlar ro‘yxati olinmadi', e);
    return null;
  }
  const chosen = pick(list);
  if (!chosen) return null;
  save(key, chosen.name);
  toast.success(`${label}: ${chosen.name}`, {
    description: 'Avtomatik tanlandi. O‘zgartirish: Sozlamalar → Termal printerlar.',
  });
  return chosen.name;
}

const pending = new Map<string, Promise<string | null>>();
function once(key: string, run: () => Promise<string | null>): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(null);
  let p = pending.get(key);
  if (!p) {
    p = run().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** Chek (termal) printeri. Termal printer bo'lmasa — null (hech narsa so'ralmaydi). */
export function ensureDesktopReceiptPrinter(): Promise<string | null> {
  return once(DESKTOP_PRINTER_KEY, () =>
    resolve(
      DESKTOP_PRINTER_KEY,
      (list) => rank(list.filter((p) => isThermalName(p.name)))[0],
      'Chek printeri',
    ),
  );
}

/** A4 hujjat printeri: Windows standart (oddiy) printeri yoki birinchi oddiy printer. */
export function ensureDesktopA4Printer(): Promise<string | null> {
  return once(DESKTOP_A4_PRINTER_KEY, () =>
    resolve(
      DESKTOP_A4_PRINTER_KEY,
      (list) => {
        const office = list.filter((p) => !isThermalName(p.name) && !LABEL_RE.test(p.name));
        return (
          office.find((p) => p.is_default) ??
          rank(office)[0] ??
          // Kompyuterda faqat termal printer bo'lsa — hujjat o'shandan chiqadi.
          list.find((p) => p.is_default) ??
          rank(list)[0]
        );
      },
      'A4 printer',
    ),
  );
}

/** Label printer: nomidan label printer, bo'lmasa A4 printer. */
export async function ensureDesktopLabelPrinter(): Promise<string | null> {
  const label = await once(DESKTOP_LABEL_PRINTER_KEY, () =>
    resolve(
      DESKTOP_LABEL_PRINTER_KEY,
      (list) => rank(list.filter((p) => LABEL_RE.test(p.name)))[0],
      'Label printer',
    ),
  );
  return label ?? (await ensureDesktopA4Printer());
}

/** Termal chek printeri qog'oz kengligi (Sozlamalar → Chek). */
export function receiptPaperWidth(): '58mm' | '80mm' {
  return read('clary_receipt_width') === '58mm' ? '58mm' : '80mm';
}

// -----------------------------------------------------------------------------
// Chek printeri KALIBRLASH profili (har printer nomi uchun alohida)
// -----------------------------------------------------------------------------
// Qog'oz kengligi sozlamasi (58/80mm) printerning haqiqiy bosish kengligini
// aytmaydi: 80mm printerlar 576 yoki 512 nuqta (48 yoki 42 belgi) bo'ladi,
// 58mm — 384 nuqta (32 belgi). Noto'g'ri kenglik → rasm sig'maydi va chek
// "axlat"/kesilgan chiqadi, matnda esa qatorlar o'ralib ustun buziladi.
// Sozlamalar → Termal printerlar → "Kalibrlash": sinov chizig'ini bosib,
// to'liq chiqqan variant tanlanadi va shu yerda saqlanadi.

export type ReceiptCols = 32 | 42 | 48;
export type ReceiptDots = 384 | 512 | 576;
export interface ReceiptPrinterProfile {
  /** Matnli chekda bir qatordagi belgilar (oddiy shrift). */
  cols?: ReceiptCols;
  /** Rasmli chek kengligi (nuqta, 203 dpi). */
  dots?: ReceiptDots;
}

const PROFILE_PREFIX = 'clary.desktop.printer.profile:';
const COLS: ReadonlySet<number> = new Set([32, 42, 48]);
const DOTS: ReadonlySet<number> = new Set([384, 512, 576]);

/** Saqlangan profil (berilmasa — joriy chek printeri). Noto'g'ri qiymatlar tashlanadi. */
export function receiptPrinterProfile(printerName?: string | null): ReceiptPrinterProfile {
  const name = printerName ?? read(DESKTOP_PRINTER_KEY);
  if (!name) return {};
  try {
    const raw = JSON.parse(read(PROFILE_PREFIX + name) || '{}') as Record<string, unknown>;
    const out: ReceiptPrinterProfile = {};
    if (COLS.has(Number(raw.cols))) out.cols = Number(raw.cols) as ReceiptCols;
    if (DOTS.has(Number(raw.dots))) out.dots = Number(raw.dots) as ReceiptDots;
    return out;
  } catch {
    return {};
  }
}

export function setReceiptPrinterProfile(
  printerName: string,
  profile: ReceiptPrinterProfile,
): void {
  if (!printerName) return;
  try {
    localStorage.setItem(PROFILE_PREFIX + printerName, JSON.stringify(profile));
  } catch {
    /* localStorage yo'q — profil saqlanmaydi, standart kenglik ishlatiladi */
  }
}

/** Qog'oz kengligiga mos standart qiymatlar (profil bo'lmasa). */
export function defaultReceiptGeometry(paper: '58mm' | '80mm'): Required<ReceiptPrinterProfile> {
  return paper === '58mm' ? { cols: 32, dots: 384 } : { cols: 48, dots: 576 };
}
