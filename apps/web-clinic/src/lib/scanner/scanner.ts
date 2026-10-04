import { parseScan, type ParsedScan } from '@clary/utils';

import { charFromKey, type KeyLike } from './keymap';

// =============================================================================
// Universal skaner — har qanday 1D/2D skaner (EAN, Code128, QR, DataMatrix)
// =============================================================================
// USB va Bluetooth skanerlar "klaviatura" sifatida ishlaydi: belgilar juda tez
// (1–30 ms oraliqda) keladi va oxirida Enter/Tab bo'ladi. Odam esa 80–200 ms
// oraliqda yozadi. Shu farq bo'yicha skanerni ajratamiz:
//   * kursor qayerda bo'lishidan qat'i nazar ishlaydi (input'ga tushgan birinchi
//     belgi ham qaytarib olinadi);
//   * raskladka (kirill/lotin) ta'sir qilmaydi — keymap.ts;
//   * kod parseScan() dan o'tadi: GTIN, muddat, seriya, seriya raqami.
// Sozlamalar har kompyuterda alohida (Sozlamalar → Skaner).
// =============================================================================

export interface ScannerConfig {
  enabled: boolean;
  /** Skaner belgilari orasidagi maksimal oraliq (ms). */
  maxGapMs: number;
  /** Eng qisqa kod uzunligi. */
  minLength: number;
  /** Kod oxiri: Enter, Tab yoki avtomatik (pauza bo'yicha). */
  suffix: 'auto' | 'enter' | 'tab';
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  enabled: true,
  maxGapMs: 35,
  minLength: 4,
  suffix: 'auto',
};

const CONFIG_KEY = 'clary.scanner.config';

export function loadScannerConfig(): ScannerConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_SCANNER_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ScannerConfig>;
    return { ...DEFAULT_SCANNER_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_SCANNER_CONFIG };
  }
}

export function saveScannerConfig(cfg: ScannerConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* saqlanmasa standart qoladi */
  }
  scannerHub.setConfig(cfg);
}

export interface ScanEvent {
  raw: string;
  parsed: ParsedScan;
  /** Birinchi va oxirgi belgi orasidagi vaqt (ms). */
  durationMs: number;
  /** O'rtacha belgi oralig'i (ms) — diagnostika uchun. */
  avgGapMs: number;
  at: number;
}

// -----------------------------------------------------------------------------
// Sof yig'uvchi (testlanadi)
// -----------------------------------------------------------------------------
export class ScanAssembler {
  private buf = '';
  private first = 0;
  private last = 0;
  private maxGapSeen = 0;

  constructor(private cfg: Pick<ScannerConfig, 'maxGapMs' | 'minLength'>) {}

  setConfig(cfg: Pick<ScannerConfig, 'maxGapMs' | 'minLength'>) {
    this.cfg = cfg;
  }

  get length(): number {
    return this.buf.length;
  }

  get value(): string {
    return this.buf;
  }

  /** Belgi qo'shadi. Oraliq katta bo'lsa — yangi ketma-ketlik boshlanadi. */
  push(ch: string, t: number): { restarted: boolean } {
    let restarted = false;
    if (this.buf && t - this.last > this.cfg.maxGapMs) {
      this.reset();
      restarted = true;
    }
    if (!this.buf) {
      this.first = t;
      this.maxGapSeen = 0;
    } else {
      this.maxGapSeen = Math.max(this.maxGapSeen, t - this.last);
    }
    this.buf += ch;
    this.last = t;
    return { restarted };
  }

  /** Hozirgi ketma-ketlik skanerga o'xshaydimi (kamida 2 ta tez belgi). */
  isBurst(): boolean {
    return this.buf.length >= 2 && this.maxGapSeen <= this.cfg.maxGapMs;
  }

  /** Enter/Tab/pauza — skaner kodi bo'lsa qaytaradi va tozalaydi. */
  complete(t: number): Omit<ScanEvent, 'parsed' | 'at'> | null {
    const ok =
      this.buf.length >= this.cfg.minLength &&
      this.isBurst() &&
      t - this.last <= Math.max(this.cfg.maxGapMs * 4, 120);
    const result = ok
      ? {
          raw: this.buf,
          durationMs: Math.round(this.last - this.first),
          avgGapMs:
            this.buf.length > 1
              ? Math.round(((this.last - this.first) / (this.buf.length - 1)) * 10) / 10
              : 0,
        }
      : null;
    this.reset();
    return result;
  }

  reset() {
    this.buf = '';
    this.first = 0;
    this.last = 0;
    this.maxGapSeen = 0;
  }
}

// -----------------------------------------------------------------------------
// Global hub (brauzer)
// -----------------------------------------------------------------------------
type Handler = (e: ScanEvent) => void;
type Sub = { id: number; priority: number; fn: { current: Handler } };

type Snapshot = {
  el: HTMLInputElement | HTMLTextAreaElement;
  value: string;
  start: number | null;
  end: number | null;
};

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return ['text', 'search', 'number', 'tel', 'email', 'url', ''].includes(el.type);
  }
  return false;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

class ScannerHub {
  private cfg: ScannerConfig = DEFAULT_SCANNER_CONFIG;
  private readonly asm = new ScanAssembler(DEFAULT_SCANNER_CONFIG);
  private subs: Sub[] = [];
  private seq = 0;
  private started = false;
  private snapshot: Snapshot | null = null;
  private burst = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(e: ScanEvent) => void>();

  setConfig(cfg: ScannerConfig) {
    this.cfg = cfg;
    this.asm.setConfig(cfg);
  }

  get config(): ScannerConfig {
    return this.cfg;
  }

  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.setConfig(loadScannerConfig());
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  /** Eng yuqori ustuvorlikdagi (teng bo'lsa — oxirgi) obunachi kodni oladi. */
  subscribe(fn: { current: Handler }, priority = 0): () => void {
    const id = ++this.seq;
    this.subs.push({ id, priority, fn });
    return () => {
      this.subs = this.subs.filter((s) => s.id !== id);
    };
  }

  /** Diagnostika: har bir skanerni ko'rish (Sozlamalar → Skaner). */
  onAnyScan(fn: (e: ScanEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Qo'lda kiritilgan kodni ham shu yo'ldan o'tkazish (masalan, qidiruvga yopishtirilgan). */
  emit(raw: string) {
    this.dispatch({ raw, durationMs: 0, avgGapMs: 0 });
  }

  private dispatch(base: Omit<ScanEvent, 'parsed' | 'at'>) {
    const ev: ScanEvent = { ...base, parsed: parseScan(base.raw), at: Date.now() };
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        /* diagnostika xatosi oqimni to'xtatmaydi */
      }
    }
    const target = [...this.subs].sort((a, b) => b.priority - a.priority || b.id - a.id)[0];
    target?.fn.current(ev);
  }

  private restoreSnapshot() {
    const s = this.snapshot;
    this.snapshot = null;
    if (!s || !document.contains(s.el)) return;
    if (s.el.value !== s.value) {
      setNativeValue(s.el, s.value);
      try {
        if (s.start != null && s.end != null) s.el.setSelectionRange(s.start, s.end);
      } catch {
        /* number input selection qo'llab-quvvatlamaydi */
      }
    }
  }

  private finish(viaKey: boolean) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const res = this.asm.complete(performance.now());
    const wasBurst = this.burst;
    this.burst = false;
    if (res && (viaKey || wasBurst)) {
      this.restoreSnapshot();
      this.dispatch(res);
      return true;
    }
    this.snapshot = null;
    return false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.cfg.enabled || e.isComposing) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-scanner="ignore"]')) return;
    if (active instanceof HTMLInputElement && active.type === 'password') return;

    const isEnd =
      (e.key === 'Enter' && this.cfg.suffix !== 'tab') ||
      (e.key === 'Tab' && this.cfg.suffix !== 'enter');
    if (isEnd) {
      if (this.asm.length > 0 && this.finish(true)) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        this.asm.reset();
        this.burst = false;
        this.snapshot = null;
      }
      return;
    }

    const ch = charFromKey(e as KeyLike);
    if (ch == null) {
      // Shift/Alt kabi modifikatorlar ketma-ketlikni buzmaydi
      if (!['Shift', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Meta'].includes(e.key)) {
        this.asm.reset();
        this.burst = false;
        this.snapshot = null;
      }
      return;
    }

    const now = performance.now();
    const { restarted } = this.asm.push(ch, now);
    if (restarted || this.asm.length === 1) {
      // Yangi ketma-ketlik: birinchi belgi odatdagidek yoziladi, lekin input
      // holatini eslab qolamiz — skaner bo'lib chiqsa qaytaramiz.
      this.burst = false;
      this.snapshot = isTextInput(active)
        ? {
            el: active,
            value: active.value,
            start: (() => {
              try {
                return active.selectionStart;
              } catch {
                return null;
              }
            })(),
            end: (() => {
              try {
                return active.selectionEnd;
              } catch {
                return null;
              }
            })(),
          }
        : null;
    } else if (this.asm.isBurst()) {
      this.burst = true;
    }

    if (this.burst) {
      // Skaner ekani aniq — qolgan belgilar inputga yozilmaydi
      e.preventDefault();
      e.stopPropagation();
      if (this.timer) clearTimeout(this.timer);
      if (this.cfg.suffix === 'auto') {
        // Suffikssiz skanerlar: pauza bo'yicha yakunlaymiz
        this.timer = setTimeout(() => this.finish(false), Math.max(this.cfg.maxGapMs * 3, 90));
      }
    }
  };
}

export const scannerHub = new ScannerHub();
