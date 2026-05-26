import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtUZS(n: number) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('uz-UZ', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ShiftDiffCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-recent-closed-shifts'],
    queryFn: () => api.shifts.recentClosed(5),
    refetchInterval: 2 * 60_000,
  });

  const list = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-cyan-600" />
          So'nggi smena farqi
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : list.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Yopilgan smena yo'q
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((s) => {
              const ok = s.diff_uzs === 0;
              const over = s.diff_uzs > 0;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.operator_name ?? 'Operator'}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {fmtTime(s.closed_at)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={cn(
                        'font-mono text-sm font-semibold tabular-nums',
                        ok && 'text-emerald-700',
                        !ok && over && 'text-amber-700',
                        !ok && !over && 'text-rose-700',
                      )}
                    >
                      {ok ? '0' : `${over ? '+' : '−'}${fmtUZS(Math.abs(s.diff_uzs))}`}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {fmtUZS(s.actual_cash_uzs)} / {fmtUZS(s.expected_cash_uzs)}
                    </div>
                  </div>
                  {!ok && (
                    <AlertTriangle
                      className={cn(
                        'h-4 w-4 shrink-0',
                        over ? 'text-amber-600' : 'text-rose-600',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
