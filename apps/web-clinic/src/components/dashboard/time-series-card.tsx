import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, Button, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

type Preset = '7d' | '30d';

function fmtUZS(n: number) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
}

export function TimeSeriesCard() {
  const [preset, setPreset] = useState<Preset>('7d');
  const { data, isLoading } = useQuery({
    queryKey: ['dash-time-series', preset],
    queryFn: () => api.analytics.overview({ preset }),
    refetchInterval: 5 * 60_000,
  });

  // Faza 1C: 7 kun rejimida bashorat ko'rsatamiz
  const { data: forecast } = useQuery({
    queryKey: ['analytics', 'cash-forecast'],
    queryFn: () => api.analytics.cashForecast(),
    enabled: preset === '7d',
    refetchInterval: 30 * 60_000,
  });

  const history = (data?.daily ?? []).map((d) => ({
    day: fmtDate(d.day),
    Tushum: d.revenue,
    Xarajat: d.expenses,
    Foyda: d.revenue - d.expenses,
    Bashorat: null as number | null,
  }));
  const forecastRows =
    preset === '7d' && forecast
      ? forecast.forecast.map((f) => ({
          day: fmtDate(f.day),
          Tushum: null as number | null,
          Xarajat: null as number | null,
          Foyda: null as number | null,
          Bashorat: f.predicted_uzs,
        }))
      : [];
  const chartData = [...history, ...forecastRows];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          Vaqt bo'yicha taqqoslash
        </CardTitle>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className={cn('h-7 px-2 text-xs', preset === '7d' && 'bg-accent')}
            onClick={() => setPreset('7d')}
          >
            7 kun
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn('h-7 px-2 text-xs', preset === '30d' && 'bg-accent')}
            onClick={() => setPreset('30d')}
          >
            30 kun
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || chartData.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {isLoading ? 'Yuklanmoqda…' : 'Ma\'lumot yo\'q'}
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtUZS} tick={{ fontSize: 11 }} width={40} />
                <Tooltip
                  formatter={(v) => `${fmtUZS(Number(v))} so'm`}
                  contentStyle={{ fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line type="monotone" dataKey="Tushum" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="Xarajat" stroke="#f43f5e" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="Foyda" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={false} />
                <Line
                  type="monotone"
                  dataKey="Bashorat"
                  stroke="#a855f7"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
            {preset === '7d' && forecast && (
              <div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
                <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-purple-500"></span>
                Kelasi 7 kun bashorat (trend ×{forecast.trend_factor})
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
