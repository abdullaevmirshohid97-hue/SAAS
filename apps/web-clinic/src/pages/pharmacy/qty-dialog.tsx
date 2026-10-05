import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
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
import {
  allowedUnitKinds,
  formatStock,
  unitLabel,
  unitPrice,
  type ParsedScan,
  type UnitKind,
} from '@clary/utils';
import { toast } from 'sonner';

import {
  discountAmount,
  lineBaseQty,
  maxQtyFor,
  roomFor,
  type CartLine,
  type CartMed,
  type DiscountKind,
} from '@/lib/pharmacy/cart';
import { useScanner } from '@/lib/scanner/use-scanner';
import { fmt } from './shared';

// =============================================================================
// Miqdor oynasi: dori tanlanganda (qidiruv, tezkor tugma) yoki savatdagi qator
// bosilganda. Qoldiq, sotuv narxi, son va chegirma — bitta joyda.
// Qoldiqdan ortiq son kiritib bo'lmaydi (savatdagi boshqa qatorlar hisobga
// olinadi); server baribir yana tekshiradi.
// Klaviatura: son yoziladi → Enter. ↑/↓ yoki +/− — son. Esc — bekor.
// =============================================================================

export interface QtyRequest {
  med: CartMed & { manufacturer?: string | null };
  /** Savatdagi qatorni o'zgartirish (bo'lmasa — yangi qo'shish). */
  lineKey?: string | null;
  unit_kind: UnitKind;
  qty: number;
  disc_kind?: DiscountKind;
  disc_value?: number;
  /** Qidiruvdan qayta tanlanganda: savatda avval nechta edi. */
  wasQty?: number;
}

export interface QtyResult {
  qty: number;
  unit_kind: UnitKind;
  disc_kind: DiscountKind;
  disc_value: number;
}

const QUICK_QTY = [1, 2, 3, 5, 10];

const toNum = (v: string) => Number(v.replace(/\s+/g, '').replace(',', '.')) || 0;

export function QtyDialog({
  req,
  lines,
  canDiscount,
  isSameMed,
  onClose,
  onConfirm,
  onRemove,
}: {
  req: QtyRequest;
  lines: CartLine[];
  canDiscount: boolean;
  /** Oyna ochiqligida skanerlangan kod shu dorimi (bo'lsa — son +1). */
  isSameMed: (scan: ParsedScan) => boolean;
  onClose: () => void;
  onConfirm: (r: QtyResult) => void;
  onRemove?: () => void;
}) {
  const med = req.med;
  const kinds = allowedUnitKinds(med);
  const [kind, setKind] = useState<UnitKind>(req.unit_kind);
  const [qtyStr, setQtyStr] = useState(String(req.qty));
  const [discStr, setDiscStr] = useState(req.disc_value ? String(req.disc_value) : '');
  const [discPct, setDiscPct] = useState(req.disc_kind === 'pct');
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 30);
    return () => clearTimeout(t);
  }, []);

  const editing = req.lineKey ? (lines.find((l) => l.key === req.lineKey) ?? null) : null;

  // Shu birlikda qo'yish mumkin bo'lgan eng ko'p son
  const { max, existing } = useMemo(() => {
    if (editing) return { max: maxQtyFor(lines, { ...editing, unit_kind: kind }), existing: null };
    const r = roomFor(lines, med, kind);
    return { max: r.room, existing: r.existing };
  }, [editing, lines, med, kind]);

  // Savatdagi boshqa qatorlar band qilgan donalar
  const reserved = useMemo(
    () =>
      lines
        .filter((l) => l.med.medication_id === med.medication_id && l.key !== req.lineKey)
        .reduce((a, l) => a + lineBaseQty(l), 0),
    [lines, med.medication_id, req.lineKey],
  );

  const qty = Math.floor(toNum(qtyStr));
  const price = unitPrice(med, kind);
  const gross = price * Math.max(0, qty);
  const discValue = canDiscount ? Math.max(0, toNum(discStr)) : 0;
  const discount = discountAmount(gross, discPct ? 'pct' : 'sum', discValue);
  const net = gross - discount;
  const uLabel = unitLabel(kind, med);

  let error: string | null = null;
  if (max <= 0) {
    error = existing
      ? `Qoldiq tugadi — savatda allaqachon ${existing.qty} ${uLabel} bor`
      : `Bu birlikda (${uLabel}) sotiladigan qoldiq yo'q`;
  } else if (qty < 1) {
    error = 'Sonini kiriting';
  } else if (qty > max) {
    error = `Qoldiqda faqat ${max} ${uLabel} bor`;
  } else if (discPct && discValue > 100) {
    error = 'Chegirma 100% dan oshmaydi';
  } else if (!discPct && discValue > gross) {
    error = 'Chegirma summadan katta';
  }

  const setQty = (n: number) => setQtyStr(String(Math.max(1, Math.floor(n))));

  const confirm = () => {
    if (error) {
      qtyRef.current?.focus();
      return;
    }
    onConfirm({
      qty,
      unit_kind: kind,
      disc_kind: discPct ? 'pct' : 'sum',
      disc_value: discValue,
    });
  };

  // Oyna ochiqligida skaner: shu dori bo'lsa +1, boshqasi — avval oynani yopish
  useScanner(
    (e) => {
      if (isSameMed(e.parsed)) setQtyStr((s) => String(Math.max(0, Math.floor(toNum(s))) + 1));
      else toast.info('Oyna ochiq — avval Enter (qo‘shish) yoki Esc bosing');
    },
    { priority: 10 },
  );

  const exp = med.earliest_sellable_expiry;
  const expDays = exp
    ? Math.floor((new Date(exp + 'T00:00:00').getTime() - Date.now()) / 86_400_000)
    : null;
  const free = Math.max(0, med.qty_sellable - reserved);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            confirm();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <span className="truncate">{med.name}</span>
            {med.requires_prescription && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                Rx
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="truncate">
            {[med.strength, med.form, med.manufacturer].filter(Boolean).join(' · ') ||
              (editing ? 'Savatdagi qatorni o‘zgartirish' : 'Savatga qo‘shish')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Qoldiq */}
          <div className="bg-muted/40 grid grid-cols-2 gap-2 rounded-md px-3 py-2 text-sm">
            <div>
              <div className="text-muted-foreground text-[11px]">Qoldiqda</div>
              <div
                className={cn('font-semibold', free <= 0 ? 'text-rose-600' : 'text-emerald-700')}
              >
                {formatStock(free, med)}
              </div>
              {reserved > 0 && (
                <div className="text-muted-foreground text-[11px]">
                  + savatda band: {formatStock(reserved, med)}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground text-[11px]">Muddati</div>
              <div
                className={cn('font-medium', expDays != null && expDays <= 90 && 'text-amber-600')}
              >
                {exp ?? '—'}
              </div>
            </div>
          </div>

          {/* Birlik */}
          {kinds.length > 1 && (
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${kinds.length}, 1fr)` }}
            >
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    qtyRef.current?.focus();
                  }}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-center text-xs transition-colors',
                    kind === k
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'hover:bg-muted',
                  )}
                >
                  <div className="capitalize">{unitLabel(k, med)}</div>
                  <div className="tabular-nums">{fmt(unitPrice(med, k))}</div>
                </button>
              ))}
            </div>
          )}

          {/* Soni */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-medium">Soni ({uLabel})</label>
              <span className="text-muted-foreground text-[11px]">
                eng ko'pi: <b>{Math.max(0, max)}</b>
                {existing && ` · savatda ${existing.qty} bor — ustiga qo'shiladi`}
                {req.wasQty != null && editing && ` · savatda ${req.wasQty} edi`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => setQty(qty - 1)}
                disabled={qty <= 1}
              >
                <Minus className="h-5 w-5" />
              </Button>
              <Input
                ref={qtyRef}
                inputMode="numeric"
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === '+') {
                    e.preventDefault();
                    setQty(qty + 1);
                  } else if (e.key === 'ArrowDown' || e.key === '-') {
                    e.preventDefault();
                    setQty(qty - 1);
                  }
                }}
                className={cn(
                  'h-12 text-center text-2xl font-bold tabular-nums',
                  qty > max && 'border-rose-400 text-rose-700',
                )}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => setQty(qty + 1)}
                disabled={qty >= max}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex gap-1.5">
              {QUICK_QTY.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={n > max}
                  onClick={() => {
                    setQty(n);
                    qtyRef.current?.focus();
                  }}
                  className={cn(
                    'flex-1 rounded-md border py-1 text-sm tabular-nums transition-colors disabled:opacity-40',
                    qty === n ? 'border-primary bg-primary/10 font-semibold' : 'hover:bg-muted',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Narx va chegirma */}
          <div className="divide-y rounded-md border text-sm">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground">Sotuv narxi (1 {uLabel})</span>
              <span className="font-semibold tabular-nums">{fmt(price)} so'm</span>
            </div>
            {canDiscount && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-muted-foreground">Chegirma</span>
                <div className="flex items-center gap-1.5">
                  {discount > 0 && (
                    <span className="text-xs tabular-nums text-emerald-700">−{fmt(discount)}</span>
                  )}
                  <Input
                    inputMode="numeric"
                    value={discStr}
                    onChange={(e) =>
                      setDiscStr(e.target.value.replace(/[^\d.,]/g, '').slice(0, 12))
                    }
                    placeholder="0"
                    className="h-8 w-24 text-right tabular-nums"
                  />
                  <div className="flex overflow-hidden rounded-md border text-xs">
                    <button
                      type="button"
                      className={cn(
                        'px-2 py-1.5',
                        !discPct && 'bg-primary text-primary-foreground',
                      )}
                      onClick={() => setDiscPct(false)}
                    >
                      so'm
                    </button>
                    <button
                      type="button"
                      className={cn('px-2 py-1.5', discPct && 'bg-primary text-primary-foreground')}
                      onClick={() => setDiscPct(true)}
                    >
                      %
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="font-medium">Jami</span>
              <span className="text-right">
                {discount > 0 && (
                  <span className="text-muted-foreground mr-2 text-xs tabular-nums line-through">
                    {fmt(gross)}
                  </span>
                )}
                <span className="text-primary text-2xl font-bold tabular-nums">{fmt(net)}</span>
                <span className="text-muted-foreground ml-1 text-xs">so'm</span>
              </span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {editing && onRemove ? (
            <Button type="button" variant="ghost" className="text-rose-600" onClick={onRemove}>
              <Trash2 className="mr-1 h-4 w-4" /> Savatdan olish
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Bekor (Esc)
            </Button>
            <Button type="button" className="min-w-[150px]" disabled={!!error} onClick={confirm}>
              {editing ? 'Saqlash' : "Qo'shish"} (Enter)
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
