import { BookOpenCheck, Loader2 } from 'lucide-react';
import { cn } from '@clary/ui-web';
import type { DrugReferenceHit } from '@clary/api-client';

import { KIND_LABEL, refSubtitle } from '@/lib/pharmacy/reference';

// =============================================================================
// Davlat katalogi (MXIK) natijasi — dori tanlash ro'yxatlarida bir xil ko'rinish
// =============================================================================

export function RefBadges({ hit }: { hit: DrugReferenceHit }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {hit.kind !== 'drug' && (
        <span className="rounded bg-slate-100 px-1 text-slate-700">{KIND_LABEL[hit.kind]}</span>
      )}
      {hit.rx_required && <span className="rounded bg-rose-50 px-1 text-rose-700">retsept</span>}
      {hit.reg_active === true && (
        <span className="rounded bg-emerald-50 px-1 text-emerald-700">reestr ✓</span>
      )}
      {hit.reg_active === false && (
        <span className="rounded bg-amber-100 px-1 text-amber-800">reestr muddati o‘tgan</span>
      )}
    </span>
  );
}

export function RefHitRow({
  hit,
  active,
  onClick,
  onHover,
}: {
  hit: DrugReferenceHit;
  active?: boolean;
  onClick: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
        active ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {hit.name}{' '}
          {hit.strength && (
            <span className="text-muted-foreground font-normal">{hit.strength}</span>
          )}
        </span>
        <span className="text-muted-foreground block truncate text-[11px]">
          {refSubtitle(hit) || hit.subposition_name}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-[10px]">
        <RefBadges hit={hit} />
        <span className="text-muted-foreground font-mono">MXIK {hit.mxik_code}</span>
      </span>
    </button>
  );
}

export function RefSectionHeader({ loading, count }: { loading: boolean; count: number }) {
  return (
    <div className="bg-muted/60 text-muted-foreground sticky top-0 z-[1] flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium backdrop-blur">
      <BookOpenCheck className="h-3.5 w-3.5 text-indigo-600" />
      Davlat katalogi (MXIK){count > 0 ? ` · ${count}` : ''} — tanlansa bazaga o‘zi qo‘shiladi
      {loading && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />}
    </div>
  );
}
