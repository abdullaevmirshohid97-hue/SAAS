import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileClock, Plus, Trash2 } from 'lucide-react';
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
import type { PharmacyCatalogItem } from '@clary/api-client';
import { formatStock } from '@clary/utils';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { searchCatalog, type CatalogIndex } from '@/lib/pharmacy/catalog-search';
import { fmt } from './shared';

// =============================================================================
// Prixod yordamchi oynalari: dori tanlash (bog'lash) va qoralamalar
// =============================================================================

export function MedPickerDialog({
  title,
  description,
  index,
  initialQuery,
  candidates,
  onPick,
  onCreateNew,
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
  onPick: (med: PharmacyCatalogItem) => void;
  /** Bazada yo'q dori — qo'lda kiritish (qidiruvdagi matn nom sifatida beriladi). */
  onCreateNew?: (query: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery ?? '');
  const [hl, setHl] = useState(0);
  const results = useMemo(() => searchCatalog(index, q, 30), [index, q]);
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
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHl(0);
          }}
          placeholder="Nomini yozing (kirill/lotin farqsiz)…"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHl((h) => Math.min(results.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHl((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter' && results[hl]) {
              e.preventDefault();
              onPick(results[hl]!);
            } else if (e.key === 'Enter' && q.trim() && onCreateNew) {
              // Topilmadi — Enter yangi dori sifatida qo'shadi
              e.preventDefault();
              onCreateNew(q.trim());
            }
          }}
        />
        <div className="max-h-[45vh] divide-y overflow-y-auto rounded border">
          {results.length === 0 ? (
            <div className="space-y-3 p-4 text-center text-sm">
              <div className="text-muted-foreground">
                {q ? `"${q}" bazada topilmadi` : 'Nomini yozing'}
              </div>
              {onCreateNew && q.trim() && (
                <Button onClick={() => onCreateNew(q.trim())}>
                  <Plus className="mr-1 h-4 w-4" /> "{q.trim()}" — yangi dori sifatida kiritish
                  (Enter)
                </Button>
              )}
            </div>
          ) : (
            results.map((m, i) => (
              <button
                key={m.medication_id}
                onMouseEnter={() => setHl(i)}
                onClick={() => onPick(m)}
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
            ))
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
