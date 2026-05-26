import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtDay(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
}

export function NewPatientsTrendCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dash-new-patients-trend'],
    queryFn: () => api.analytics.newPatientsTrend(),
    refetchInterval: 5 * 60_000,
  });

  const chartData = (data ?? []).map((d) => ({ day: fmtDay(d.day), bemor: d.count }));
  const total = (data ?? []).reduce((s, d) => s + d.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4 text-emerald-600" />
          Yangi bemorlar (7 kun)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : total === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            7 kun ichida yangi bemor yo'q
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">{total}</span>
              <span className="text-xs text-muted-foreground">jami bemor</span>
            </div>
            <div className="h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v) => `${v} bemor`}
                    contentStyle={{ fontSize: '12px' }}
                  />
                  <Bar dataKey="bemor" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
