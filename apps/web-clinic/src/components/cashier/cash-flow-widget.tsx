import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, ArrowDown, ArrowUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

type Preset = 'today' | 'week' | 'month';

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString('uz-UZ');
}

function rangeFor(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (preset === 'today') start.setHours(0, 0, 0, 0);
  else if (preset === 'week') {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
  humo: 'Humo',
  uzcard: 'Uzcard',
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  kaspi: 'Kaspi',
  debt: 'Qarz',
};

export function CashFlowWidget() {
  const [preset, setPreset] = useState<Preset>('today');
  const range = rangeFor(preset);
  const { data, isLoading } = useQuery({
    queryKey: ['cashier', 'cash-flow', preset],
    queryFn: () => api.cashier.cashFlow(range),
    refetchInterval: 60_000,
  });

  const rows = data ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      in: acc.in + r.in_uzs,
      out: acc.out + r.out_uzs,
      net: acc.net + r.net_uzs,
    }),
    { in: 0, out: 0, net: 0 },
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          Pul harakati (cash flow)
        </CardTitle>
        <div className="flex gap-1">
          {(['today', 'week', 'month'] as Preset[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant="ghost"
              className={cn('h-7 px-2 text-xs', preset === p && 'bg-accent')}
              onClick={() => setPreset(p)}
            >
              {p === 'today' ? 'Bugun' : p === 'week' ? 'Bu hafta' : 'Bu oy'}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Ushbu davr uchun pul harakati yo'q
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Usul</th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    <ArrowDown className="ml-auto h-3 w-3 text-emerald-600" />
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    <ArrowUp className="ml-auto h-3 w-3 text-rose-600" />
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.method}>
                    <td className="px-2 py-2 font-medium">
                      {METHOD_LABEL[r.method] ?? r.method}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-emerald-700">
                      {fmt(r.in_uzs)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-rose-700">
                      {r.out_uzs > 0 ? `-${fmt(r.out_uzs)}` : '—'}
                    </td>
                    <td
                      className={cn(
                        'px-2 py-2 text-right font-mono font-semibold tabular-nums',
                        r.net_uzs >= 0 ? 'text-emerald-700' : 'text-rose-700',
                      )}
                    >
                      {fmt(r.net_uzs)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-muted/30">
                  <td className="px-2 py-2 font-semibold">JAMI</td>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-emerald-700">
                    {fmt(totals.in)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-rose-700">
                    {totals.out > 0 ? `-${fmt(totals.out)}` : '—'}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-2 text-right font-mono font-bold tabular-nums',
                      totals.net >= 0 ? 'text-emerald-700' : 'text-rose-700',
                    )}
                  >
                    {fmt(totals.net)} so'm
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
