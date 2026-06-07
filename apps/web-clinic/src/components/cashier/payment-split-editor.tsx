import { Plus, X } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';

export type PaymentLeg = { method: string; amount_uzs: number };

export const PAYMENT_METHODS: Array<{ v: string; label: string }> = [
  { v: 'cash', label: 'Naqd' },
  { v: 'card', label: 'Plastik' },
  { v: 'transfer', label: "O'tkazma" },
  { v: 'humo', label: 'Humo' },
  { v: 'uzcard', label: 'Uzcard' },
  { v: 'click', label: 'Click' },
  { v: 'payme', label: 'Payme' },
];

export function methodLabel(m: string): string {
  return PAYMENT_METHODS.find((x) => x.v === m)?.label ?? m;
}

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

/**
 * Aralash (split) to'lov muharriri — bir nechta usul + summa qatorlari.
 * Controlled: legs + onChange. `target` berilsa "qoldi" ko'rsatiladi.
 */
export function PaymentSplitEditor({
  legs,
  onChange,
  target,
}: {
  legs: PaymentLeg[];
  onChange: (legs: PaymentLeg[]) => void;
  target?: number;
}) {
  const sum = legs.reduce((s, l) => s + (Number(l.amount_uzs) || 0), 0);
  const remaining = target != null ? target - sum : null;

  const setLeg = (i: number, patch: Partial<PaymentLeg>) =>
    onChange(legs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLeg = () =>
    onChange([
      ...legs,
      { method: 'card', amount_uzs: Math.max(0, remaining ?? 0) },
    ]);
  const removeLeg = (i: number) => onChange(legs.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {legs.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select value={l.method} onValueChange={(v) => setLeg(i, { method: v })}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m.v} value={m.v}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            inputMode="numeric"
            value={l.amount_uzs ? String(l.amount_uzs) : ''}
            onChange={(e) => setLeg(i, { amount_uzs: Number(e.target.value) || 0 })}
            placeholder="0"
            className="w-36 font-mono"
          />
          {legs.length > 1 && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeLeg(i)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={addLeg} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> To'lov turi qo'shish
        </Button>
        <div className="text-xs text-muted-foreground">
          Jami: <strong>{fmt(sum)}</strong>
          {target != null && (
            <>
              {' '}/ {fmt(target)}
              {remaining !== 0 && (
                <span className={remaining! > 0 ? ' text-amber-600' : ' text-red-600'}>
                  {' '}({remaining! > 0 ? 'qoldi' : 'ortiqcha'} {fmt(Math.abs(remaining!))})
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
