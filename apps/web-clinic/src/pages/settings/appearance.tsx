import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Languages, Palette, PanelLeft, RotateCcw, Type } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from '@clary/ui-web';
import { LOCALE_LABELS, type SupportedLocale } from '@clary/i18n';

import {
  useAppearance,
  FONT_STACKS,
  FONT_FAMILY_LABELS,
  FONT_SCALE_OPTIONS,
  BACKGROUND_PRESETS,
  hexToHsl,
  hslToHex,
  customContrastWarning,
  type FontFamilyKey,
} from '@/providers/appearance-provider';
import { useNavGroups, orderNavGroups } from '@/hooks/use-nav-groups';

const FONT_KEYS: FontFamilyKey[] = ['default', 'system', 'serif', 'mono', 'rounded'];

// Interfeys tili — mavjud tarjimalar to'liq bo'lgan asosiy tillar.
const LANG_CODES: SupportedLocale[] = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'];

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  const a = copy[i] as T;
  const b = copy[j] as T;
  copy[i] = b;
  copy[j] = a;
  return copy;
}

export function SettingsAppearancePage() {
  const { settings, set, reset } = useAppearance();
  const navGroups = useNavGroups();
  const { i18n } = useTranslation();

  const changeLang = (code: SupportedLocale) => {
    void i18n.changeLanguage(code);
    try {
      // Reload'dan keyin ham saqlanadi (main.tsx boshlanishida o'qiladi).
      localStorage.setItem('clary.lang', code);
    } catch {
      /* localStorage yo'q bo'lsa e'tiborsiz */
    }
  };

  const orderedGroups = useMemo(
    () => orderNavGroups(navGroups, settings.sidebarGroupOrder, settings.sidebarItemOrder),
    [navGroups, settings.sidebarGroupOrder, settings.sidebarItemOrder],
  );

  const moveGroup = (i: number, dir: -1 | 1) => {
    const keys = orderedGroups.map((g) => g.key);
    const next = move(keys, i, dir);
    if (next !== keys) set({ sidebarGroupOrder: next });
  };

  const moveItem = (groupKey: string, i: number, dir: -1 | 1) => {
    const group = orderedGroups.find((g) => g.key === groupKey);
    if (!group) return;
    const tos = group.items.map((it) => it.to);
    const next = move(tos, i, dir);
    if (next !== tos) {
      set({ sidebarItemOrder: { ...settings.sidebarItemOrder, [groupKey]: next } });
    }
  };

  const bg = settings.background;
  const customHex = bg.kind === 'custom' ? hslToHex(bg.h, bg.s, bg.l) : '#eef2ff';
  const customWarn = bg.kind === 'custom' && customContrastWarning(bg.h, bg.s, bg.l);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Ko‘rinish</h1>
          <p className="text-sm text-muted-foreground">
            Shrift, yozuv hajmi, fon rangi va yon menyu tartibini o‘zingizga moslang. Sozlamalar
            shu qurilmada (brauzerda) saqlanadi.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reset} className="shrink-0">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Tiklash
        </Button>
      </div>

      {/* ── Til ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-4 w-4 text-primary" />
            Til
          </CardTitle>
          <CardDescription>Interfeys tili. Tanlov shu qurilmada saqlanadi.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {LANG_CODES.map((code) => {
              const active = i18n.language === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => changeLang(code)}
                  className={cn(
                    'rounded-lg border px-4 py-2 text-sm transition',
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-accent/60',
                  )}
                >
                  {LOCALE_LABELS[code]}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Shrift ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Type className="h-4 w-4 text-primary" />
            Shrift
          </CardTitle>
          <CardDescription>Yozuv turi, hajmi va qalinligi.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium">Yozuv turi</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FONT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => set({ fontFamily: key })}
                  style={{ fontFamily: FONT_STACKS[key] }}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-sm transition',
                    settings.fontFamily === key
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-accent/60',
                  )}
                >
                  <div className="font-medium">{FONT_FAMILY_LABELS[key]}</div>
                  <div className="text-xs text-muted-foreground">Aa Bb Cc 123</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Yozuv hajmi</div>
            <div className="flex flex-wrap gap-2">
              {FONT_SCALE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set({ fontScale: opt.value })}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm transition',
                    settings.fontScale === opt.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-accent/60',
                  )}
                >
                  {opt.label} · {Math.round(opt.value * 100)}%
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Yozuv stili</div>
            <div className="flex gap-2">
              {([
                { v: 'normal', label: 'Oddiy', w: 400 },
                { v: 'medium', label: 'Qalinroq', w: 500 },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => set({ fontWeight: opt.v })}
                  style={{ fontWeight: opt.w }}
                  className={cn(
                    'rounded-lg border px-4 py-1.5 text-sm transition',
                    settings.fontWeight === opt.v
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-accent/60',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Fon rangi ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4 text-primary" />
            Fon rangi
          </CardTitle>
          <CardDescription>
            Tayyor variantlardan tanlang yoki o‘zingiz rang belgilang. Matn doim o‘qiladigan
            bo‘lib qoladi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => set({ background: { kind: 'theme' } })}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm transition',
                bg.kind === 'theme'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'hover:bg-accent/60',
              )}
            >
              Mavzu bo‘yicha
            </button>
            {BACKGROUND_PRESETS.map((p) => {
              const selected = bg.kind === 'preset' && bg.key === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => set({ background: { kind: 'preset', key: p.key } })}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
                    selected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-accent/60',
                  )}
                >
                  <span
                    className="h-4 w-4 rounded-full border"
                    style={{ background: p.swatch }}
                  />
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <label
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
                bg.kind === 'custom'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'hover:bg-accent/60',
              )}
            >
              <input
                type="color"
                value={customHex}
                onChange={(e) => {
                  const { h, s, l } = hexToHsl(e.target.value);
                  set({ background: { kind: 'custom', h, s, l } });
                }}
                className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              Erkin rang
            </label>
            {customWarn && (
              <span className="text-xs font-medium text-amber-600">
                ⚠ Bu rangda kontrast pastroq — matn yaxshi ko‘rinmasligi mumkin.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Sidebar tartibi ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PanelLeft className="h-4 w-4 text-primary" />
            Yon menyu tartibi
          </CardTitle>
          <CardDescription>
            Bo‘limlar va ular ichidagi qatorlarni ↑/↓ tugmalari bilan qayta tartiblang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orderedGroups.map((g, gi) => (
            <div key={g.key} className="rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.title}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={gi === 0}
                    onClick={() => moveGroup(gi, -1)}
                    aria-label="Bo‘limni yuqoriga"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={gi === orderedGroups.length - 1}
                    onClick={() => moveGroup(gi, 1)}
                    aria-label="Bo‘limni pastga"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <ul className="divide-y">
                {g.items.map((it, ii) => (
                  <li key={it.to} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="flex items-center gap-2 text-sm">
                      <it.icon className="h-4 w-4 text-muted-foreground" />
                      {it.label}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={ii === 0}
                        onClick={() => moveItem(g.key, ii, -1)}
                        aria-label="Qatorni yuqoriga"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={ii === g.items.length - 1}
                        onClick={() => moveItem(g.key, ii, 1)}
                        aria-label="Qatorni pastga"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
