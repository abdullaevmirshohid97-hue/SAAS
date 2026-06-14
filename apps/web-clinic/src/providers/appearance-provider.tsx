import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/**
 * Appearance (ko'rinish) — shaxsiy personalizatsiya, qurilma bo'yicha (localStorage).
 * ThemeProvider namunasida: holatni o'qiydi va `document.documentElement`'ga inline
 * CSS o'zgaruvchilar qo'yadi. Inline style mavzu klassi (.dark/.ice) o'zgaruvchilaridan
 * ustun turadi, shuning uchun fon override har qanday mavzu ustida ishlaydi.
 */

export type FontFamilyKey = 'default' | 'system' | 'serif' | 'mono' | 'rounded';
export type FontWeightKey = 'normal' | 'medium';

export type BackgroundSetting =
  | { kind: 'theme' }
  | { kind: 'preset'; key: string }
  | { kind: 'custom'; h: number; s: number; l: number };

export interface AppearanceSettings {
  fontFamily: FontFamilyKey;
  fontScale: number;
  fontWeight: FontWeightKey;
  background: BackgroundSetting;
  /** Bo'lim kalitlari tartibi (default tartibдан farqli bo'lsa). */
  sidebarGroupOrder: string[];
  /** Har bo'lim ichida `to` yo'llari tartibi. */
  sidebarItemOrder: Record<string, string[]>;
}

// ─── Shrift stacklari (faqat tizim + web-safe, offlayn ishlaydi) ────────────
export const FONT_STACKS: Record<FontFamilyKey, string> = {
  default: "'Geist Sans', system-ui, -apple-system, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Noto Serif', serif",
  mono: "'Geist Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
  rounded: "'Segoe UI', 'SF Pro Rounded', Nunito, system-ui, sans-serif",
};

export const FONT_FAMILY_LABELS: Record<FontFamilyKey, string> = {
  default: 'Standart',
  system: 'Tizim',
  serif: 'Serif',
  mono: 'Monospace',
  rounded: 'Yumaloq',
};

export const FONT_SCALE_OPTIONS: { value: number; label: string }[] = [
  { value: 0.9, label: 'Kichik' },
  { value: 1.0, label: 'Standart' },
  { value: 1.1, label: 'Katta' },
  { value: 1.25, label: 'Juda katta' },
];

// ─── Fon presetlari (kontrast tekshirilgan mini-mavzular) ───────────────────
export interface BackgroundPreset {
  key: string;
  label: string;
  /** Swatch (namuna) uchun ko'rinadigan CSS rang. */
  swatch: string;
  /** CSS o'zgaruvchilar — "H S% L%" formatida (hsl(var(--..)) bilan ishlatiladi). */
  vars: Record<string, string>;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    key: 'cream',
    label: 'Krem',
    swatch: 'hsl(40 38% 96%)',
    vars: {
      '--background': '40 38% 96%',
      '--foreground': '30 14% 15%',
      '--card': '42 45% 99%',
      '--card-foreground': '30 14% 15%',
      '--popover': '42 45% 99%',
      '--popover-foreground': '30 14% 15%',
      '--muted': '40 28% 90%',
      '--muted-foreground': '32 10% 40%',
      '--border': '40 24% 84%',
    },
  },
  {
    key: 'warm-gray',
    label: 'Issiq kulrang',
    swatch: 'hsl(30 6% 94%)',
    vars: {
      '--background': '30 6% 94%',
      '--foreground': '30 8% 14%',
      '--card': '30 8% 98%',
      '--card-foreground': '30 8% 14%',
      '--popover': '30 8% 98%',
      '--popover-foreground': '30 8% 14%',
      '--muted': '30 5% 88%',
      '--muted-foreground': '30 6% 38%',
      '--border': '30 5% 82%',
    },
  },
  {
    key: 'soft-blue',
    label: 'Yumshoq ko‘k',
    swatch: 'hsl(210 50% 95%)',
    vars: {
      '--background': '210 50% 95%',
      '--foreground': '215 40% 14%',
      '--card': '208 55% 98%',
      '--card-foreground': '215 40% 14%',
      '--popover': '208 55% 98%',
      '--popover-foreground': '215 40% 14%',
      '--muted': '210 40% 89%',
      '--muted-foreground': '215 25% 38%',
      '--border': '210 35% 83%',
    },
  },
  {
    key: 'mint',
    label: 'Mayin yashil',
    swatch: 'hsl(150 40% 95%)',
    vars: {
      '--background': '150 40% 95%',
      '--foreground': '155 35% 13%',
      '--card': '150 45% 98%',
      '--card-foreground': '155 35% 13%',
      '--popover': '150 45% 98%',
      '--popover-foreground': '155 35% 13%',
      '--muted': '150 30% 89%',
      '--muted-foreground': '155 20% 36%',
      '--border': '150 28% 82%',
    },
  },
  {
    key: 'slate',
    label: 'To‘q slate',
    swatch: 'hsl(220 16% 16%)',
    vars: {
      '--background': '220 16% 16%',
      '--foreground': '210 20% 96%',
      '--card': '220 15% 20%',
      '--card-foreground': '210 20% 96%',
      '--popover': '220 15% 20%',
      '--popover-foreground': '210 20% 96%',
      '--muted': '220 14% 26%',
      '--muted-foreground': '215 15% 72%',
      '--border': '220 13% 30%',
    },
  },
];

// Fon o'zgaruvchanда almashtiriladigan barcha kalitlar (theme'ga qaytishda tozalanadi).
const OVERRIDE_KEYS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--muted',
  '--muted-foreground',
  '--border',
];

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

/** Erkin tanlangan fon (H/S/L) dan kontrastli to'liq palitra hosil qilish. */
export function deriveCustomVars(h: number, s: number, l: number): Record<string, string> {
  const isLight = l > 58;
  const fg = isLight ? `${h} 16% 12%` : '0 0% 98%';
  const cardL = isLight ? clamp(l + 4) : clamp(l - 4);
  const mutedL = isLight ? clamp(l - 6) : clamp(l + 8);
  const borderL = isLight ? clamp(l - 12) : clamp(l + 14);
  return {
    '--background': `${h} ${clamp(s)}% ${clamp(l)}%`,
    '--foreground': fg,
    '--card': `${h} ${clamp(s - 4)}% ${cardL}%`,
    '--card-foreground': fg,
    '--popover': `${h} ${clamp(s - 4)}% ${cardL}%`,
    '--popover-foreground': fg,
    '--muted': `${h} ${clamp(s - 6)}% ${mutedL}%`,
    '--muted-foreground': isLight ? `${h} 10% 38%` : `${h} 8% 72%`,
    '--border': `${h} ${clamp(s - 8)}% ${borderL}%`,
  };
}

// ─── Rang yordamchilari (hex ↔ HSL, WCAG kontrast) ──────────────────────────
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = lN - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function relLuminance(h: number, s: number, l: number): number {
  const hex = hslToHex(h, s, l);
  const m = hex.replace('#', '');
  const chan = (i: number) => {
    const c = parseInt(m.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

function parseTriplet(t: string): { h: number; s: number; l: number } {
  const parts = t.replace(/%/g, '').split(/\s+/).map(Number);
  return { h: parts[0] ?? 0, s: parts[1] ?? 0, l: parts[2] ?? 0 };
}

/** Erkin fon uchun kontrast past bo'lsa (WCAG AA 4.5:1 dan past) true qaytaradi. */
export function customContrastWarning(h: number, s: number, l: number): boolean {
  const vars = deriveCustomVars(h, s, l);
  const bg = parseTriplet(vars['--background'] ?? '');
  const fg = parseTriplet(vars['--foreground'] ?? '');
  const lb = relLuminance(bg.h, bg.s, bg.l);
  const lf = relLuminance(fg.h, fg.s, fg.l);
  const ratio = (Math.max(lb, lf) + 0.05) / (Math.min(lb, lf) + 0.05);
  return ratio < 4.5;
}

// ─── Qo'llash ───────────────────────────────────────────────────────────────
function applyAppearance(s: AppearanceSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.style.setProperty('--font-app', FONT_STACKS[s.fontFamily] ?? FONT_STACKS.default);
  root.style.setProperty('--font-weight-base', s.fontWeight === 'medium' ? '500' : '400');

  if (s.fontScale && s.fontScale !== 1) root.style.fontSize = `${Math.round(s.fontScale * 100)}%`;
  else root.style.fontSize = '';

  const bg = s.background;
  if (bg.kind === 'theme') {
    OVERRIDE_KEYS.forEach((k) => root.style.removeProperty(k));
    return;
  }
  let vars: Record<string, string> | null = null;
  if (bg.kind === 'preset') {
    const key = bg.key;
    vars = BACKGROUND_PRESETS.find((p) => p.key === key)?.vars ?? null;
  } else {
    vars = deriveCustomVars(bg.h, bg.s, bg.l);
  }
  OVERRIDE_KEYS.forEach((k) => {
    if (vars && vars[k]) root.style.setProperty(k, vars[k]);
    else root.style.removeProperty(k);
  });
}

// ─── Provider ─────────────────────────────────────────────────────────────
const STORAGE_KEY = 'clary-appearance';

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  fontFamily: 'default',
  fontScale: 1,
  fontWeight: 'normal',
  background: { kind: 'theme' },
  sidebarGroupOrder: [],
  sidebarItemOrder: {},
};

function load(): AppearanceSettings {
  if (typeof window === 'undefined') return APPEARANCE_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return APPEARANCE_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      ...APPEARANCE_DEFAULTS,
      ...parsed,
      background: parsed.background ?? APPEARANCE_DEFAULTS.background,
      sidebarGroupOrder: parsed.sidebarGroupOrder ?? [],
      sidebarItemOrder: parsed.sidebarItemOrder ?? {},
    };
  } catch {
    return APPEARANCE_DEFAULTS;
  }
}

interface AppearanceContextValue {
  settings: AppearanceSettings;
  set: (partial: Partial<AppearanceSettings>) => void;
  reset: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(load);

  useEffect(() => {
    applyAppearance(settings);
  }, [settings]);

  const set = useCallback((partial: Partial<AppearanceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setSettings(APPEARANCE_DEFAULTS);
  }, []);

  return (
    <AppearanceContext.Provider value={{ settings, set, reset }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider');
  return ctx;
}
