import { useQuery } from '@tanstack/react-query';
import { Activity, TrendingDown, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmt(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const FLAG_META: Record<string, { label: string; color: string; icon: 'down' | 'up' | 'ok' }> = {
  below_expected: { label: 'Past', color: 'text-rose-700 bg-rose-50 border-rose-300', icon: 'down' },
  above_expected: { label: 'Yuqori', color: 'text-emerald-700 bg-emerald-50 border-emerald-300', icon: 'up' },
  normal: { label: 'Normal', color: 'text-slate-600 bg-slate-50 border-slate-200', icon: 'ok' },
  insufficient_data: { label: '—', color: 'text-muted-foreground', icon: 'ok' },
};

export function DoctorPerformanceCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'doctor-anomalies'],
    queryFn: () => api.analytics.doctorAnomalies(),
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-indigo-600" />
            Shifokor produktivlik (30 kun)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        </CardContent>
      </Card>
    );
  }

  const doctors = data.doctors;
  const hasInsufficient = doctors.length < 3;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-indigo-600" />
          Shifokor produktivlik (30 kun)
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {data.summary.below_expected > 0 && (
            <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
              {data.summary.below_expected} past
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {doctors.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            30 kun ichida shifokor faolligi yo'q
          </div>
        ) : (
          <div className="space-y-2">
            {hasInsufficient && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
                Anomaliya aniqlash uchun kamida 3 ta shifokor kerak (hozir {doctors.length} ta).
                Statistik tahlil bekor.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Shifokor</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qabul</th>
                    <th className="px-2 py-1.5 text-right font-medium">O'rtacha chek</th>
                    <th className="px-2 py-1.5 text-right font-medium">Tushum</th>
                    <th className="px-2 py-1.5 text-center font-medium">Holat</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {doctors.slice(0, 10).map((d) => {
                    const meta = FLAG_META[d.performance_flag] ?? FLAG_META.normal!;
                    const Icon = meta.icon === 'down' ? TrendingDown : meta.icon === 'up' ? TrendingUp : CheckCircle2;
                    return (
                      <tr key={d.doctor_id} className="hover:bg-muted/30">
                        <td className="px-2 py-2 max-w-[180px] truncate font-medium">{d.doctor_name}</td>
                        <td className="px-2 py-2 text-right font-mono">{d.total_visits}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(d.avg_check_uzs)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold">{fmt(d.total_revenue)}</td>
                        <td className="px-2 py-2 text-center">
                          {d.performance_flag !== 'normal' && d.performance_flag !== 'insufficient_data' && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                meta.color,
                              )}
                            >
                              <Icon className="h-3 w-3" />
                              {meta.label}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
