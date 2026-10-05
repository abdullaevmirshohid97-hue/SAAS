import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Search, Trash2, Zap } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, cn } from '@clary/ui-web';
import type {
  PharmacyCatalogItem,
  PharmacyQuickButton,
  PharmacyQuickButtonColor,
  PharmacyQuickButtons,
} from '@clary/api-client';
import {
  allowedUnitKinds,
  defaultUnitKind,
  formatStock,
  unitLabel,
  unitPrice,
  type MedUnitInfo,
  type UnitKind,
} from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { buildCatalogIndex, searchCatalog } from '@/lib/pharmacy/catalog-search';
import { errText, fmt } from './shared';

// =============================================================================
// Sotuv oynasining tezkor tugmalari: tez-tez sotiladigan dorilar plitkalari.
// Admin Sozlamalar → "Tezkor tugmalar" da qo'shadi; barcha kassalarda bir xil
// (clinics.settings.pharmacy_quick_buttons). Birinchi 9 tasi — Alt+1…9.
// =============================================================================

export const QUICK_BUTTONS_KEY = ['pharmacy', 'quick-buttons'] as const;
export const QUICK_HOTKEYS = 9;
const MAX_BUTTONS = 30;

export const QUICK_COLORS: Record<
  PharmacyQuickButtonColor,
  { tile: string; swatch: string; label: string }
> = {
  emerald: {
    tile: 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100',
    swatch: 'bg-emerald-500',
    label: 'Yashil',
  },
  sky: {
    tile: 'border-sky-300 bg-sky-50 text-sky-950 hover:bg-sky-100',
    swatch: 'bg-sky-500',
    label: 'Moviy',
  },
  violet: {
    tile: 'border-violet-300 bg-violet-50 text-violet-950 hover:bg-violet-100',
    swatch: 'bg-violet-500',
    label: 'Binafsha',
  },
  amber: {
    tile: 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100',
    swatch: 'bg-amber-500',
    label: 'Sariq',
  },
  rose: {
    tile: 'border-rose-300 bg-rose-50 text-rose-950 hover:bg-rose-100',
    swatch: 'bg-rose-500',
    label: 'Qizil',
  },
  slate: {
    tile: 'border-slate-300 bg-slate-50 text-slate-950 hover:bg-slate-100',
    swatch: 'bg-slate-500',
    label: 'Kulrang',
  },
};
const COLOR_ORDER = Object.keys(QUICK_COLORS) as PharmacyQuickButtonColor[];

export function useQuickButtons() {
  return useQuery({
    queryKey: QUICK_BUTTONS_KEY,
    queryFn: () => api.pharmacy.quickButtons(),
    staleTime: 60_000,
  });
}

/** Tugma birligi: dorida ruxsat etilgan bo'lsa — o'zi, aks holda dorining standarti. */
export function buttonUnit(b: PharmacyQuickButton, med: MedUnitInfo): UnitKind {
  const kinds = allowedUnitKinds(med);
  return b.unit_kind && kinds.includes(b.unit_kind) ? b.unit_kind : defaultUnitKind(med);
}

// -----------------------------------------------------------------------------
// Plitkalar to'ri (sotuv oynasi va sozlamalardagi namuna)
// -----------------------------------------------------------------------------
export function QuickGrid({
  buttons,
  byId,
  onPress,
  preview = false,
}: {
  buttons: PharmacyQuickButton[];
  byId: Map<string, PharmacyCatalogItem>;
  onPress?: (b: PharmacyQuickButton, med: PharmacyCatalogItem) => void;
  /** Sozlamalardagi namuna — bosilmaydi. */
  preview?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
      {buttons.map((b, i) => {
        const med = byId.get(b.medication_id);
        const kind = med ? buttonUnit(b, med) : 'unit';
        const out = !med || med.qty_sellable <= 0;
        const c = QUICK_COLORS[b.color] ?? QUICK_COLORS.emerald;
        return (
          <button
            key={`${b.medication_id}-${i}`}
            type="button"
            disabled={out && !preview}
            onClick={() => !preview && med && onPress?.(b, med)}
            title={med ? med.name : 'Dori katalogda topilmadi'}
            className={cn(
              'relative flex h-[92px] flex-col justify-between rounded-lg border-2 p-2.5 text-left transition',
              c.tile,
              out && 'opacity-45',
              preview ? 'cursor-default' : !out && 'active:scale-[0.98]',
            )}
          >
            <span className="absolute right-1.5 top-1.5 flex gap-1 text-[10px]">
              {b.qty > 1 && (
                <span className="rounded bg-black/10 px-1 font-semibold">×{b.qty}</span>
              )}
              {i < QUICK_HOTKEYS && (
                <span className="rounded bg-black/10 px-1 font-mono">Alt+{i + 1}</span>
              )}
            </span>
            <span className="line-clamp-2 pr-14 text-sm font-semibold leading-tight">
              {b.label?.trim() || med?.name || 'Topilmadi'}
            </span>
            <span className="flex items-end justify-between gap-1 text-xs">
              <span className="font-bold tabular-nums">
                {med ? fmt(unitPrice(med, kind)) : '—'}
                {med && <span className="font-normal opacity-70"> / {unitLabel(kind, med)}</span>}
              </span>
              <span
                className={cn(
                  'truncate text-[11px]',
                  out ? 'font-medium text-rose-700' : 'opacity-70',
                )}
              >
                {!med ? '' : out ? 'Tugagan' : formatStock(med.qty_sellable, med)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sozlamalar → Tezkor tugmalar (admin)
// -----------------------------------------------------------------------------
export function QuickButtonsSettings() {
  const qc = useQueryClient();
  const catalogQ = useQuery({
    queryKey: ['pharmacy', 'pos-catalog'],
    queryFn: () => api.pharmacy.posCatalog(),
    staleTime: 20_000,
  });
  const index = useMemo(() => buildCatalogIndex(catalogQ.data?.items ?? []), [catalogQ.data]);
  const savedQ = useQuickButtons();
  const [draft, setDraft] = useState<PharmacyQuickButtons | null>(null);
  useEffect(() => {
    if (savedQ.data && draft === null) setDraft(savedQ.data);
  }, [savedQ.data, draft]);

  const [search, setSearch] = useState('');
  const results = useMemo(() => searchCatalog(index, search, 8), [index, search]);

  const save = useMutation({
    mutationFn: (body: PharmacyQuickButtons) => api.pharmacy.saveQuickButtons(body),
    onSuccess: (r) => {
      qc.setQueryData(QUICK_BUTTONS_KEY, r);
      setDraft(r);
      toast.success('Tezkor tugmalar saqlandi — barcha kassalarda yangilanadi');
    },
    onError: (e) => toast.error(errText(e)),
  });

  if (savedQ.isError) {
    return <div className="p-4 text-sm text-rose-600">Xato: {errText(savedQ.error)}</div>;
  }
  if (!draft) {
    return <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>;
  }

  const buttons = draft.buttons;
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedQ.data);
  const setButtons = (next: PharmacyQuickButton[]) => setDraft({ ...draft, buttons: next });
  const patch = (i: number, p: Partial<PharmacyQuickButton>) =>
    setButtons(buttons.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= buttons.length) return;
    const next = [...buttons];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setButtons(next);
  };
  const add = (m: PharmacyCatalogItem) => {
    if (buttons.length >= MAX_BUTTONS) {
      toast.error(`Ko'pi bilan ${MAX_BUTTONS} ta tugma`);
      return;
    }
    setButtons([
      ...buttons,
      {
        medication_id: m.medication_id,
        label: null,
        color: COLOR_ORDER[buttons.length % COLOR_ORDER.length]!,
        unit_kind: null,
        qty: 1,
      },
    ]);
    setSearch('');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-amber-500" /> Tezkor tugmalar
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Tez-tez sotiladigan dorilar sotuv oynasida katta tugma bo'lib turadi. Birinchi{' '}
            {QUICK_HOTKEYS} tasini klaviaturadan Alt+1…{QUICK_HOTKEYS} bilan bosish mumkin. Barcha
            kassalarda bir xil.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Bosilganda */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs">Tugma bosilganda:</span>
            <div className="flex overflow-hidden rounded-md border text-xs">
              {[
                { v: false, l: 'Miqdor oynasi ochilsin' },
                { v: true, l: 'Darhol savatga tushsin' },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setDraft({ ...draft, instant: o.v })}
                  className={cn(
                    'px-3 py-1.5',
                    draft.instant === o.v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          {/* Qo'shish */}
          <div className="relative">
            <Search className="text-muted-foreground absolute left-3 top-2.5 h-4 w-4" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Dori qo'shish — nomini yozing…"
              className="pl-9"
            />
            {search.trim() && (
              <div className="bg-popover absolute left-0 right-0 top-11 z-20 max-h-72 divide-y overflow-y-auto rounded-md border shadow-lg">
                {results.length === 0 ? (
                  <div className="text-muted-foreground p-3 text-center text-xs">Topilmadi</div>
                ) : (
                  results.map((m) => (
                    <button
                      key={m.medication_id}
                      type="button"
                      onClick={() => add(m)}
                      className="hover:bg-muted flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{m.name}</span>
                        <span className="text-muted-foreground block truncate text-[11px]">
                          {[m.strength, m.form, m.manufacturer].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                        {formatStock(m.qty_sellable, m)} <Plus className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Ro'yxat */}
          {buttons.length === 0 ? (
            <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
              Hali tugma yo'q — yuqoridan dori qo'shing.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {buttons.map((b, i) => {
                const med = index.byId.get(b.medication_id);
                const kinds = med ? allowedUnitKinds(med) : [];
                return (
                  <div
                    key={`${b.medication_id}-${i}`}
                    className="flex flex-wrap items-center gap-2 px-3 py-2"
                  >
                    <span className="text-muted-foreground w-12 shrink-0 text-xs tabular-nums">
                      {i + 1}.{i < QUICK_HOTKEYS ? ` Alt+${i + 1}` : ''}
                    </span>
                    <div className="min-w-[160px] flex-1">
                      <div className="truncate text-sm font-medium">
                        {med?.name ?? 'Dori katalogda topilmadi'}
                      </div>
                      {med && (
                        <div className="text-muted-foreground text-[11px]">
                          {fmt(unitPrice(med, buttonUnit(b, med)))} so'm ·{' '}
                          {formatStock(med.qty_sellable, med)}
                        </div>
                      )}
                    </div>
                    <Input
                      value={b.label ?? ''}
                      maxLength={40}
                      onChange={(e) => patch(i, { label: e.target.value || null })}
                      placeholder="Tugmadagi nom"
                      className="h-8 w-40 text-xs"
                    />
                    {kinds.length > 1 && med && (
                      <select
                        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                        value={buttonUnit(b, med)}
                        onChange={(e) => patch(i, { unit_kind: e.target.value as UnitKind })}
                      >
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {unitLabel(k, med)}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                      son
                      <Input
                        inputMode="numeric"
                        value={String(b.qty)}
                        onChange={(e) =>
                          patch(i, {
                            qty: Math.min(
                              1000,
                              Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1),
                            ),
                          })
                        }
                        className="h-8 w-14 text-center text-xs"
                      />
                    </label>
                    <div className="flex gap-1">
                      {COLOR_ORDER.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={QUICK_COLORS[c].label}
                          onClick={() => patch(i, { color: c })}
                          className={cn(
                            'h-5 w-5 rounded-full',
                            QUICK_COLORS[c].swatch,
                            b.color === c ? 'ring-foreground ring-2 ring-offset-1' : 'opacity-60',
                          )}
                        />
                      ))}
                    </div>
                    <div className="ml-auto flex">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label="Yuqoriga"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={i === buttons.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="Pastga"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-rose-600"
                        onClick={() => setButtons(buttons.filter((_, j) => j !== i))}
                        aria-label="O'chirish"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(savedQ.data ?? null)}>
                Bekor qilish
              </Button>
            )}
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
              {save.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Saqlash
            </Button>
          </div>
        </CardContent>
      </Card>

      {buttons.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sotuv oynasida shunday ko'rinadi</CardTitle>
          </CardHeader>
          <CardContent>
            <QuickGrid buttons={buttons} byId={index.byId} preview />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
