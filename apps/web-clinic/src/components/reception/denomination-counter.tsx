import { useEffect, useState } from 'react';
import { Input } from '@clary/ui-web';

// O'zbekiston so'm kupuralari (eng katta birinchi).
// Kassir har nominal sonini kiritadi, jami avtomatik hisoblanadi.
const DENOMINATIONS = [
  { value: 200_000, label: '200 000' },
  { value: 100_000, label: '100 000' },
  { value: 50_000, label: '50 000' },
  { value: 20_000, label: '20 000' },
  { value: 10_000, label: '10 000' },
  { value: 5_000, label: '5 000' },
  { value: 2_000, label: '2 000' },
  { value: 1_000, label: '1 000' },
];

function fmt(n: number) {
  return n.toLocaleString('uz-UZ');
}

export function DenominationCounter({
  onChange,
}: {
  onChange: (totalUzs: number) => void;
}) {
  const [counts, setCounts] = useState<Record<number, string>>({});

  const total = DENOMINATIONS.reduce(
    (s, d) => s + d.value * (Number.parseInt(counts[d.value] ?? '0', 10) || 0),
    0,
  );

  useEffect(() => {
    onChange(total);
  }, [total, onChange]);

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-12 gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <div className="col-span-4">Kupura</div>
        <div className="col-span-3 text-right">Soni</div>
        <div className="col-span-5 text-right">Jami</div>
      </div>
      {DENOMINATIONS.map((d) => {
        const cnt = Number.parseInt(counts[d.value] ?? '0', 10) || 0;
        const sum = d.value * cnt;
        return (
          <div key={d.value} className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-4 font-mono text-sm">{d.label}</div>
            <div className="col-span-3">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={counts[d.value] ?? ''}
                onChange={(e) =>
                  setCounts((prev) => ({ ...prev, [d.value]: e.target.value }))
                }
                className="h-8 text-right text-sm"
                placeholder="0"
              />
            </div>
            <div className="col-span-5 text-right font-mono text-sm tabular-nums">
              {sum > 0 ? fmt(sum) : '—'}
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-12 items-center gap-2 border-t pt-2">
        <div className="col-span-7 text-sm font-semibold">JAMI</div>
        <div className="col-span-5 text-right font-mono text-lg font-bold tabular-nums text-emerald-700">
          {fmt(total)} so'm
        </div>
      </div>
    </div>
  );
}
