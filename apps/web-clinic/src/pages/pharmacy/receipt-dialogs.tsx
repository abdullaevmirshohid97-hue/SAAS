import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, FileClock, Plus, Square, Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';
import type { DrugReferenceHit, PharmacyCatalogItem } from '@clary/api-client';
import { formatStock } from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { searchCatalog, type CatalogIndex } from '@/lib/pharmacy/catalog-search';
import { useReferenceSearch } from '@/lib/pharmacy/reference';
import { RefHitRow, RefSectionHeader } from './reference-hit';
import { fmt } from './shared';

// =============================================================================
// Prixod yordamchi oynalari: dori tanlash (bog'lash) va qoralamalar
// =============================================================================

type PickEntry = { t: 'med'; m: PharmacyCatalogItem } | { t: 'ref'; h: DrugReferenceHit };

// -----------------------------------------------------------------------------
// Dori manbasi: umumiy baza (davlat katalogi) va/yoki mustaqil (qo'lda kiritish)
// -----------------------------------------------------------------------------
export type SourceMode = 'catalog' | 'manual' | 'both';

export const sourceFlags = (m: SourceMode) => ({
  catalog: m !== 'manual',
  manual: m !== 'catalog',
});

const modeOf = (catalog: boolean, manual: boolean): SourceMode | null =>
  catalog && manual ? 'both' : catalog ? 'catalog' : manual ? 'manual' : null;

/** Ikki belgi: "Umumiy baza" va "Mustaqil" — kamida bittasi yoqiq. */
export function SourceToggle({
  mode,
  onChange,
  className,
}: {
  mode: SourceMode;
  onChange: (m: SourceMode) => void;
  className?: string;
}) {
  const f = sourceFlags(mode);
  const set = (catalog: boolean, manual: boolean) => {
    const next = modeOf(catalog, manual);
    if (!next) {
      toast.info('Kamida bittasi yoqilgan bo‘lishi kerak');
      return;
    }
    onChange(next);
  };
  const chip = (on: boolean, label: string, title: string, toggle: () => void) => (
    <button
      type="button"
      title={title}
      onClick={toggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition',
        on
          ? 'border-primary bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted border-dashed',
      )}
    >
      {on ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-muted-foreground text-[11px]">Manba:</span>
      {chip(
        f.catalog,
        'Umumiy baza',
        'Davlat katalogi (MXIK): nomi, ishlab chiqaruvchi, MXIK, qadoq bazadan olinadi',
        () => set(!f.catalog, f.manual),
      )}
      {chip(f.manual, 'Mustaqil', "Bazada yo'q dorini o'zingiz kiritib prixod qilasiz", () =>
        set(f.catalog, !f.manual),
      )}
    </div>
  );
}

/** Birinchi marta: dorixona qanday ishlashini tanlaydi (keyin "Manba" belgilarida o'zgartiriladi). */
export function SourceModeDialog({
  onChoose,
  onClose,
}: {
  onChoose: (m: SourceMode) => void;
  onClose?: () => void;
}) {
  const options: Array<{ m: SourceMode; title: string; text: string; badge?: string }> = [
    {
      m: 'both',
      title: 'Umumiy baza + mustaqil',
      badge: 'tavsiya',
      text: "Dori bazada bo'lsa — nomi, ishlab chiqaruvchi, MXIK, qadoq soni bazadan olinadi. Bo'lmasa — ma'lumotlarni o'zingiz kiritib, prixodni davom ettirasiz.",
    },
    {
      m: 'catalog',
      title: 'Faqat umumiy baza',
      text: "Faqat davlat katalogi va o'z bazangizdan tanlanadi. Bazada yo'q dori prixod qilinmaydi — ma'lumotlar har doim to'g'ri va bir xil.",
    },
    {
      m: 'manual',
      title: 'Mustaqil',
      text: "Umumiy baza ishlatilmaydi — dorilarni o'zingiz kiritasiz (avvalgidek).",
    },
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prixodda dorilarni qanday kiritasiz?</DialogTitle>
          <DialogDescription>
            Tanlov shu kompyuterda eslab qolinadi. Keyin prixod oynasidagi “Manba” belgilarida
            o‘zgartirish mumkin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map((o, i) => (
            <button
              key={o.m}
              type="button"
              autoFocus={i === 0}
              onClick={() => onChoose(o.m)}
              className="hover:border-primary hover:bg-primary/5 focus:border-primary block w-full rounded-lg border p-3 text-left outline-none transition"
            >
              <div className="flex items-center gap-2 font-medium">
                {o.title}
                {o.badge && (
                  <span className="rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">
                    {o.badge}
                  </span>
                )}
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">{o.text}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MedPickerDialog({
  title,
  description,
  index,
  initialQuery,
  candidates,
  referenceHint,
  onPick,
  onPickReference: onPickReferenceProp,
  onCreateNew: onCreateNewProp,
  sourceMode,
  onSourceModeChange,
  onClose,
}: {
  title: string;
  description?: string;
  index: CatalogIndex;
  initialQuery?: string;
  /** Server taklif qilgan o'xshash dorilar (fakturadagi nom bo'yicha). */
  candidates?: Array<{
    id: string;
    name: string;
    strength: string | null;
    manufacturer: string | null;
    score: number;
  }>;
  /** Skanerlangan kod bo'yicha katalog taklifi (masalan, boshqa dorixonalar tasdiqlagan). */
  referenceHint?: { hit: DrugReferenceHit; note: string } | null;
  onPick: (med: PharmacyCatalogItem) => void;
  /**
   * Davlat katalogidan (MXIK) tanlash. Berilsa — bazadagi natijalar ostida
   * katalog ham qidiriladi (1 harfdan); tanlangan dori bazaga o'zi qo'shiladi.
   */
  onPickReference?: (hit: DrugReferenceHit) => void;
  /** Bazada yo'q dori — qo'lda kiritish (qidiruvdagi matn nom sifatida beriladi). */
  onCreateNew?: (query: string) => void;
  /** "Umumiy baza" / "Mustaqil" belgilari (berilsa — oyna tepasida ko'rinadi). */
  sourceMode?: SourceMode;
  onSourceModeChange?: (m: SourceMode) => void;
  onClose: () => void;
}) {
  // Manba: "Umumiy baza" o'chiq — katalog yo'q; "Mustaqil" o'chiq — yangi dori yo'q
  const flags = sourceMode ? sourceFlags(sourceMode) : { catalog: true, manual: true };
  const onPickReference = flags.catalog ? onPickReferenceProp : undefined;
  const onCreateNew = flags.manual ? onCreateNewProp : undefined;
  const [q, setQ] = useState(initialQuery ?? '');
  const [hl, setHl] = useState(0);
  const local = useMemo(() => searchCatalog(index, q, 30), [index, q]);
  const ref = useReferenceSearch(q, { enabled: !!onPickReference, limit: 30 });
  // Katalog natijasi klinikada bor bo'lsa — bazadagi dori sifatida (takror qo'shilmaydi)
  const entries = useMemo<PickEntry[]>(() => {
    const out: PickEntry[] = local.map((m) => ({ t: 'med', m }));
    const seen = new Set(local.map((m) => m.medication_id));
    const refs: PickEntry[] = [];
    for (const h of ref.hits) {
      const own = h.medication_id ? index.byId.get(h.medication_id) : undefined;
      if (own) {
        if (!seen.has(own.medication_id)) {
          seen.add(own.medication_id);
          out.push({ t: 'med', m: own });
        }
      } else refs.push({ t: 'ref', h });
    }
    return [...out, ...refs];
  }, [local, ref.hits, index]);
  const medCount = entries.filter((e) => e.t === 'med').length;
  const refCount = entries.length - medCount;
  const choose = (e: PickEntry | undefined) => {
    if (!e) return;
    if (e.t === 'med') onPick(e.m);
    else onPickReference?.(e.h);
  };
  const cands = (candidates ?? [])
    .map((c) => ({ c, item: index.byId.get(c.id) }))
    .filter((x): x is { c: (typeof x)['c']; item: PharmacyCatalogItem } => !!x.item);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {cands.length > 0 && (
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs font-medium">O'xshash dorilar</div>
            <div className="flex flex-wrap gap-1.5">
              {cands.map(({ c, item }) => (
                <button
                  key={c.id}
                  onClick={() => onPick(item)}
                  className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100"
                >
                  {c.name}
                  {c.strength ? ` ${c.strength}` : ''} · {Math.round(c.score * 100)}%
                </button>
              ))}
            </div>
          </div>
        )}
        {sourceMode && onSourceModeChange && (
          <SourceToggle mode={sourceMode} onChange={onSourceModeChange} />
        )}
        {referenceHint && onPickReference && (
          <div className="space-y-1 rounded-md border border-indigo-200 bg-indigo-50/60 p-2">
            <div className="text-[11px] font-medium text-indigo-900">{referenceHint.note}</div>
            <div className="overflow-hidden rounded border bg-white">
              <RefHitRow
                hit={referenceHint.hit}
                onClick={() => onPickReference(referenceHint.hit)}
              />
            </div>
          </div>
        )}
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHl(0);
          }}
          placeholder={
            onPickReference
              ? 'Nomini yozing — 1–2 harf yetarli (bazadan va davlat katalogidan)…'
              : 'Nomini yozing (kirill/lotin farqsiz)…'
          }
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHl((h) => Math.min(entries.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHl((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter' && entries[hl]) {
              e.preventDefault();
              choose(entries[hl]);
            } else if (e.key === 'Enter' && q.trim() && onCreateNew && !ref.loading) {
              // Topilmadi — Enter yangi dori sifatida qo'shadi
              e.preventDefault();
              onCreateNew(q.trim());
            }
          }}
        />
        <div className="max-h-[50vh] overflow-y-auto rounded border">
          {entries.length === 0 ? (
            <div className="space-y-3 p-4 text-center text-sm">
              <div className="text-muted-foreground">
                {!q
                  ? 'Nomini yozing'
                  : ref.loading
                    ? 'Davlat katalogidan qidirilmoqda…'
                    : onPickReference
                      ? `"${q}" bazada ham, davlat katalogida ham topilmadi`
                      : `"${q}" bazada topilmadi`}
              </div>
              {!onCreateNew && q.trim() && !ref.loading && sourceMode === 'catalog' && (
                <div className="text-muted-foreground text-xs">
                  Faqat umumiy baza tanlangan — bazada yo‘q dorini kiritish uchun “Mustaqil”ni
                  yoqing.
                </div>
              )}
              {onCreateNew && q.trim() && !ref.loading && (
                <Button onClick={() => onCreateNew(q.trim())}>
                  <Plus className="mr-1 h-4 w-4" /> "{q.trim()}" — yangi dori sifatida kiritish
                  (Enter)
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {entries.map((e, i) => {
                if (e.t === 'ref') {
                  return (
                    <div key={`r:${e.h.mxik_code}`}>
                      {i === medCount && (
                        <RefSectionHeader loading={ref.loading} count={refCount} />
                      )}
                      <RefHitRow
                        hit={e.h}
                        active={i === hl}
                        onHover={() => setHl(i)}
                        onClick={() => choose(e)}
                      />
                    </div>
                  );
                }
                const m = e.m;
                return (
                  <button
                    key={m.medication_id}
                    onMouseEnter={() => setHl(i)}
                    onClick={() => choose(e)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                      i === hl ? 'bg-primary/10' : 'hover:bg-muted',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {m.name}{' '}
                        {m.strength && (
                          <span className="text-muted-foreground font-normal">{m.strength}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {[m.form, m.manufacturer].filter(Boolean).join(' · ')}
                        {m.pack_qty > 1 ? ` · 1 qadoq = ${m.pack_qty}` : ''}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-right text-[11px]">
                      {fmt(m.price_uzs)}
                      <br />
                      {formatStock(m.qty_in_stock, m)}
                    </span>
                  </button>
                );
              })}
              {onPickReference && refCount === 0 && ref.loading && q.trim() && (
                <RefSectionHeader loading count={0} />
              )}
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {onCreateNew ? (
            <Button variant="outline" onClick={() => onCreateNew(q.trim())}>
              <Plus className="mr-1 h-4 w-4" /> Yangi dori (qo'lda kiritish)
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DraftsDialog({
  currentId,
  onLoad,
  onClose,
}: {
  currentId: string | null;
  onLoad: (d: { id: string; payload: Record<string, unknown> }) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'receipt-drafts'],
    queryFn: () => api.pharmacy.listDrafts(),
  });
  const load = useMutation({
    mutationFn: (id: string) => api.pharmacy.getDraft(id),
    onSuccess: (d) => onLoad({ id: d.id, payload: d.payload }),
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.pharmacy.deleteDraft(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pharmacy', 'receipt-drafts'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Saqlangan qoralamalar</DialogTitle>
          <DialogDescription>
            Boshqa kompyuterda boshlangan prixodni shu yerda davom ettiring.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] divide-y overflow-y-auto rounded border">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">Qoralama yo'q</div>
          ) : (
            rows.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <button
                  className="flex min-w-0 items-center gap-2 text-left"
                  onClick={() => load.mutate(d.id)}
                >
                  <FileClock className="text-muted-foreground h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {d.title || 'Nomsiz qoralama'}
                      {d.id === currentId && (
                        <span className="text-primary ml-1 text-xs">(ochiq)</span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {d.lines_count} qator · {new Date(d.updated_at).toLocaleString('uz-UZ')}
                    </span>
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    if (window.confirm("Qoralama o'chirilsinmi?")) del.mutate(d.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
