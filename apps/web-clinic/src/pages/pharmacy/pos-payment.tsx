import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CreditCard,
  HandCoins,
  Loader2,
  Smartphone,
  SplitSquareHorizontal,
} from 'lucide-react';
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

import { changeFor, quickCashAmounts, type PayMethod, type PaymentLeg } from '@/lib/pharmacy/cart';
import { fmt } from './shared';

// =============================================================================
// To'lov oynasi (F9): naqd (qaytim bilan), karta/Click/Payme, aralash, qarz.
// Klaviatura: summa yoziladi → Enter. Bo'sh qoldirilsa — aniq summa.
// =============================================================================

export type PayMode = PayMethod | 'split' | 'debt';

export interface PaymentResult {
  discount: number;
  debt: number;
  legs: PaymentLeg[];
  receivedCash?: number;
  change?: number;
  notes?: string;
  mode: PayMode;
}

const MODES: Array<{ id: PayMode; label: string; icon: typeof Banknote }> = [
  { id: 'cash', label: 'Naqd', icon: Banknote },
  { id: 'card', label: 'Plastik', icon: CreditCard },
  { id: 'click', label: 'Click', icon: Smartphone },
  { id: 'payme', label: 'Payme', icon: Smartphone },
  { id: 'uzum', label: 'Uzum', icon: Smartphone },
  { id: 'transfer', label: "O'tkazma", icon: CreditCard },
  { id: 'split', label: 'Aralash', icon: SplitSquareHorizontal },
  { id: 'debt', label: 'Qarzga', icon: HandCoins },
];

const NON_CASH: Array<{ v: PayMethod; l: string }> = [
  { v: 'card', l: 'Plastik' },
  { v: 'click', l: 'Click' },
  { v: 'payme', l: 'Payme' },
  { v: 'uzum', l: 'Uzum' },
  { v: 'transfer', l: "O'tkazma" },
];

const LAST_MODE_KEY = 'clary.pharmacy.lastPayMode';

function readLastMode(): PayMode {
  try {
    const v = localStorage.getItem(LAST_MODE_KEY) as PayMode | null;
    return v && v !== 'debt' && MODES.some((m) => m.id === v) ? v : 'cash';
  } catch {
    return 'cash';
  }
}

const toInt = (v: string) =>
  Math.max(0, Math.round(Number(v.replace(/\s+/g, '').replace(',', '.')) || 0));

export function PaymentDialog({
  open,
  subtotal,
  canDiscount,
  b2bClinicName,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  subtotal: number;
  canDiscount: boolean;
  /** Mijoz-klinika tanlangan bo'lsa — qarzga berish mumkin. */
  b2bClinicName: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (r: PaymentResult) => void;
}) {
  const [mode, setMode] = useState<PayMode>('cash');
  const [received, setReceived] = useState('');
  const [discountStr, setDiscountStr] = useState('');
  const [discountPct, setDiscountPct] = useState(false);
  const [splitCash, setSplitCash] = useState('');
  const [splitMethod, setSplitMethod] = useState<PayMethod>('card');
  const [debtStr, setDebtStr] = useState('');
  const [notes, setNotes] = useState('');
  const receivedRef = useRef<HTMLInputElement>(null);

  // Har ochilishda tozalanadi; usul — oxirgi ishlatilgani
  useEffect(() => {
    if (!open) return;
    setMode(readLastMode());
    setReceived('');
    setDiscountStr('');
    setDiscountPct(false);
    setSplitCash('');
    setSplitMethod('card');
    setDebtStr('');
    setNotes('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => receivedRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, mode]);

  const discount = useMemo(() => {
    if (!canDiscount) return 0;
    const n = toInt(discountStr);
    const d = discountPct ? Math.round((subtotal * Math.min(100, n)) / 100) : n;
    return Math.min(subtotal, d);
  }, [canDiscount, discountStr, discountPct, subtotal]);
  const total = subtotal - discount;

  const calc = useMemo(() => {
    let legs: PaymentLeg[] = [];
    let debt = 0;
    let cashDue = 0;
    let error: string | null = null;
    if (mode === 'debt') {
      if (!b2bClinicName) error = 'Qarzga berish uchun mijoz klinikani tanlang';
      debt = debtStr.trim() === '' ? total : Math.min(total, toInt(debtStr));
      const rest = total - debt;
      if (rest > 0) legs = [{ method: 'cash', amount: rest }];
      cashDue = rest;
    } else if (mode === 'split') {
      const cash = Math.min(total, toInt(splitCash));
      const other = total - cash;
      legs = [
        ...(cash > 0 ? [{ method: 'cash' as PayMethod, amount: cash }] : []),
        ...(other > 0 ? [{ method: splitMethod, amount: other }] : []),
      ];
      cashDue = cash;
      if (cash <= 0 || other <= 0) error = "Aralash to'lovda ikkala qism ham bo'lsin";
    } else {
      legs = total > 0 ? [{ method: mode, amount: total }] : [];
      cashDue = mode === 'cash' ? total : 0;
    }
    const rec = received.trim() === '' ? null : toInt(received);
    if (cashDue > 0 && rec != null && rec < cashDue && !error) {
      error = `Olingan naqd yetarli emas (${fmt(cashDue - rec)} so'm kam)`;
    }
    const change = rec != null && cashDue > 0 ? changeFor(cashDue, rec) : 0;
    return { legs, debt, cashDue, received: rec, change, error };
  }, [mode, total, debtStr, b2bClinicName, splitCash, splitMethod, received]);

  const confirm = () => {
    if (calc.error || busy) return;
    try {
      if (mode !== 'debt') localStorage.setItem(LAST_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    onConfirm({
      discount,
      debt: calc.debt,
      legs: calc.legs,
      receivedCash: calc.cashDue > 0 ? (calc.received ?? calc.cashDue) : undefined,
      change: calc.cashDue > 0 ? calc.change : undefined,
      notes: notes.trim() || undefined,
      mode,
    });
  };

  const quick = quickCashAmounts(calc.cashDue);
  const showCashInput = calc.cashDue > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="sm:max-w-xl"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            confirm();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-baseline justify-between gap-3">
            <span>To'lov</span>
            <span className="text-primary text-3xl font-bold tabular-nums">{fmt(total)} so'm</span>
          </DialogTitle>
          <DialogDescription>
            {discount > 0
              ? `Jami ${fmt(subtotal)} − chegirma ${fmt(discount)}`
              : 'Enter — tasdiqlash, Esc — orqaga'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-1.5">
          {MODES.filter((m) => m.id !== 'debt' || b2bClinicName).map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors',
                  mode === m.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {mode === 'debt' && (
            <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="text-xs text-amber-900">
                Qarz <b>{b2bClinicName}</b> hisobiga yoziladi. Qolgani naqd olinadi.
              </div>
              <label className="block text-xs font-medium">Qarz summasi</label>
              <Input
                inputMode="numeric"
                value={debtStr}
                onChange={(e) => setDebtStr(e.target.value)}
                placeholder={fmt(total)}
              />
            </div>
          )}

          {mode === 'split' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Naqd qism</label>
                <Input
                  inputMode="numeric"
                  value={splitCash}
                  onChange={(e) => setSplitCash(e.target.value)}
                  autoFocus
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Qolgani ({fmt(total - Math.min(total, toInt(splitCash)))})
                </label>
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                  value={splitMethod}
                  onChange={(e) => setSplitMethod(e.target.value as PayMethod)}
                >
                  {NON_CASH.map((m) => (
                    <option key={m.v} value={m.v}>
                      {m.l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {showCashInput && (
            <div className="space-y-2">
              <label className="text-muted-foreground block text-xs">
                Mijozdan olingan naqd (to'lanadi: {fmt(calc.cashDue)})
              </label>
              <Input
                ref={receivedRef}
                inputMode="numeric"
                className="h-12 text-2xl font-semibold tabular-nums"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={fmt(calc.cashDue)}
              />
              <div className="flex flex-wrap gap-1.5">
                {quick.map((a) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setReceived(String(a))}
                  >
                    {fmt(a)}
                  </Button>
                ))}
              </div>
              <div
                className={cn(
                  'flex items-center justify-between rounded-md px-3 py-2',
                  calc.change > 0
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-muted/40 text-muted-foreground',
                )}
              >
                <span className="text-sm">Qaytim</span>
                <span className="text-2xl font-bold tabular-nums">{fmt(calc.change)} so'm</span>
              </div>
            </div>
          )}

          {canDiscount && (
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">Chegirma</label>
                <Input
                  inputMode="numeric"
                  value={discountStr}
                  onChange={(e) => setDiscountStr(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex overflow-hidden rounded-md border text-xs">
                <button
                  type="button"
                  className={cn('px-3 py-2', !discountPct && 'bg-primary text-primary-foreground')}
                  onClick={() => setDiscountPct(false)}
                >
                  so'm
                </button>
                <button
                  type="button"
                  className={cn('px-3 py-2', discountPct && 'bg-primary text-primary-foreground')}
                  onClick={() => setDiscountPct(true)}
                >
                  %
                </button>
              </div>
            </div>
          )}

          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Izoh (shart emas)"
          />

          {calc.error && (
            <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {calc.error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Orqaga (Esc)
          </Button>
          <Button className="min-w-[180px]" disabled={!!calc.error || busy} onClick={confirm}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Tasdiqlash (Enter)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
