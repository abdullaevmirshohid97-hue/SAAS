import { toast } from 'sonner';

import { isTauri } from './platform';

// =============================================================================
// Desktop: chek printerini bir marta tanlash
// =============================================================================
// Silent chek uchun printer nomi localStorage'da (`clary.desktop.printer`).
// Desktop 0.2.0 interfeysni app.clary.uz'dan yuklaydi — localStorage yangi
// (eski tanlov yo'q), shuning uchun avval printer tanlanmagan bo'lsa chek
// brauzer dialogiga tushib qolardi. Endi: birinchi chekda chek printeri
// avtomatik topiladi (bitta bo'lsa) yoki bir marta so'raladi va eslab qolinadi.
// =============================================================================

export const DESKTOP_PRINTER_KEY = 'clary.desktop.printer';

export interface DesktopPrinterInfo {
  name: string;
  is_default: boolean;
  online: boolean;
  state: string;
}

/** Virtual (qog'ozsiz) printerlar — chek uchun hech qachon taklif qilinmaydi. */
const VIRTUAL_RE = /pdf|xps|onenote|fax|send to|anydesk|snagit|document writer|cutepdf/i;
/** Chek (termal) printerga o'xshash nomlar. */
const THERMAL_RE =
  /\bpos\b|pos-?\d|receipt|thermal|xprinter|\bxp-|tm-?[tmu]\d|rongta|\brp\d|bixolon|srp-|gprinter|hprt|sunmi|citizen ct|star tsp|\b(58|80)\s?mm\b|chek|kassa/i;

export function isThermalName(name: string): boolean {
  return THERMAL_RE.test(name) && !VIRTUAL_RE.test(name);
}

function readSaved(): string {
  try {
    return localStorage.getItem(DESKTOP_PRINTER_KEY) ?? '';
  } catch {
    return '';
  }
}

function save(name: string) {
  try {
    localStorage.setItem(DESKTOP_PRINTER_KEY, name);
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

let pending: Promise<string | null> | null = null;

/**
 * Desktop chek printeri: saqlangan bo'lsa — o'sha; aks holda yagona chek
 * printerini avtomatik tanlaydi yoki bir marta so'raydi. Brauzerda, printer
 * yo'q yoki bekor qilinsa — null (chaqiruvchi brauzer dialogiga tushadi).
 */
export function ensureDesktopReceiptPrinter(): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(null);
  const saved = readSaved();
  if (saved) return Promise.resolve(saved);
  // Bir vaqtda ikkita chek bo'lsa ham oyna bitta chiqadi
  pending ??= resolvePrinter().finally(() => {
    pending = null;
  });
  return pending;
}

async function resolvePrinter(): Promise<string | null> {
  let printers: DesktopPrinterInfo[];
  try {
    printers = (await listDesktopPrinters()).filter((p) => !VIRTUAL_RE.test(p.name));
  } catch (e) {
    console.warn('[print] printerlar ro‘yxati olinmadi', e);
    toast.error('Desktop printerlar ro‘yxatini olib bo‘lmadi — brauzer orqali chop etiladi');
    return null;
  }
  if (printers.length === 0) {
    toast.warning('Kompyuterda printer topilmadi — brauzer orqali chop etiladi');
    return null;
  }
  const thermal = printers.filter((p) => isThermalName(p.name));
  if (thermal.length === 1) {
    const name = thermal[0]!.name;
    save(name);
    toast.success(`Chek printeri: ${name}`, {
      description: 'Endi cheklar dialogsiz chiqadi. O‘zgartirish: Sozlamalar → Termal printerlar.',
    });
    return name;
  }
  const chosen = await askPrinter(printers, thermal);
  if (chosen) {
    save(chosen);
    toast.success(`Chek printeri: ${chosen}`, {
      description: 'Eslab qolindi — keyingi cheklar dialogsiz chiqadi.',
    });
  }
  return chosen;
}

/** Oddiy DOM oynasi (React daraxtidan tashqarida ham ishlaydi). */
function askPrinter(
  printers: DesktopPrinterInfo[],
  thermal: DesktopPrinterInfo[],
): Promise<string | null> {
  return new Promise((resolve) => {
    const dark = document.documentElement.classList.contains('dark');
    const bg = dark ? '#0f172a' : '#ffffff';
    const fg = dark ? '#e2e8f0' : '#0f172a';
    const muted = dark ? '#94a3b8' : '#64748b';
    const border = dark ? '#334155' : '#e2e8f0';

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;pointer-events:auto;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit';
    const box = document.createElement('div');
    box.style.cssText = `width:100%;max-width:440px;max-height:85vh;overflow:auto;background:${bg};color:${fg};border-radius:14px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.35)`;
    box.innerHTML =
      `<div style="font-size:16px;font-weight:600">Chek qaysi printerdan chiqsin?</div>` +
      `<div style="font-size:13px;color:${muted};margin:6px 0 14px">Bir marta tanlaysiz — eslab qolinadi, keyin cheklar dialogsiz chiqadi.</div>`;

    const finish = (v: string | null) => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };

    const sorted = [...printers].sort(
      (a, b) =>
        Number(isThermalName(b.name)) - Number(isThermalName(a.name)) ||
        Number(b.is_default) - Number(a.is_default),
    );
    for (const p of sorted) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isTh = thermal.includes(p);
      btn.style.cssText = `display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;text-align:left;margin-bottom:8px;padding:10px 12px;border-radius:10px;border:2px solid ${isTh ? '#2563eb' : border};background:transparent;color:${fg};font-size:14px;cursor:pointer`;
      const tags = [
        isTh ? 'chek printeri' : '',
        p.is_default ? 'standart' : '',
        p.online ? '' : 'o‘chiq',
      ]
        .filter(Boolean)
        .join(' · ');
      const nameEl = document.createElement('span');
      nameEl.textContent = p.name;
      nameEl.style.cssText = 'font-weight:500;word-break:break-word';
      const tagEl = document.createElement('span');
      tagEl.textContent = tags;
      tagEl.style.cssText = `font-size:11px;color:${muted};white-space:nowrap`;
      btn.append(nameEl, tagEl);
      btn.onclick = () => finish(p.name);
      box.appendChild(btn);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Bekor (bu safar brauzer orqali)';
    cancel.style.cssText = `margin-top:6px;width:100%;padding:9px;border-radius:10px;border:1px solid ${border};background:transparent;color:${muted};font-size:13px;cursor:pointer`;
    cancel.onclick = () => finish(null);
    box.appendChild(cancel);

    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) finish(null);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    (box.querySelector('button') as HTMLButtonElement | null)?.focus();
  });
}
