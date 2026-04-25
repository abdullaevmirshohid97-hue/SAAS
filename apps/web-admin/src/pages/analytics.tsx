import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@clary/ui-web';

import { api } from '@/lib/api';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

const RANGES: Array<{ id: 7 | 30 | 90 | 180; label: string }> = [
  { id: 7, label: '7 kun' },
  { id: 30, label: '30 kun' },
  { id: 90, label: '90 kun' },
  { id: 180, label: '6 oy' },
];

export function AnalyticsPage() {
  const [days, setDays] = useState<7 | 30 | 90 | 180>(30);
  const { data } = useQuery({
    queryKey: ['admin', 'analytics', days],
    queryFn: () => api.admin.platformAnalytics(days),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platforma analitikasi</h1>
          <p className="text-sm text-muted-foreground">
            Barcha klinikalar bo‘yicha umumiy tushum, xarajat va samaradorlik
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setDays(r.id)}
              className={
                'rounded-sm px-3 py-1.5 text-sm transition-colors ' +
                (days === r.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" /> Tushum va xarajatlar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DualBar rows={data?.series ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Klinikalar reytingi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(data?.leaderboard ?? []).length === 0 ? (
            <EmptyState title="Ma'lumot yo‘q" description="Tanlangan davr uchun tushum topilmadi" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5 text-right">Tushum</th>
                    <th className="px-4 py-2.5 text-right">Xarajat</th>
                    <th className="px-4 py-2.5 text-right">Sof foyda</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.leaderboard ?? []).map((r, idx) => (
                    <tr key={r.clinic_id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <Link to={`/tenants/${r.clinic_id}`} className="font-medium text-primary hover:underline">
                          {r.clinic_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(r.revenue)}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(r.expenses)}</td>
                      <td className={'px-4 py-2.5 text-right font-semibold ' + (r.profit < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {fmt(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DualBar({ rows }: { rows: Array<{ day: string; revenue: number; expenses: number }> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Tanlangan davr uchun yozuvlar yo‘q</p>;
  }
  const max = Math.max(...rows.map((r) => Math.max(r.revenue, r.expenses)));
  const w = 760;
  const h = 220;
  const barW = Math.max(4, w / rows.length / 3);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full">
        {rows.map((r, i) => {
          const cx = (w / rows.length) * i + w / rows.length / 2;
          const hRev = max === 0 ? 0 : (r.revenue / max) * (h - 30);
          const hExp = max === 0 ? 0 : (r.expenses / max) * (h - 30);
          return (
            <g key={r.day}>
              <rect
                x={cx - barW - 1}
                y={h - 20 - hRev}
                width={barW}
                height={hRev}
                rx={2}
                className="fill-emerald-500/70"
              />
              <rect
                x={cx + 1}
                y={h - 20 - hExp}
                width={barW}
                height={hExp}
                rx={2}
                className="fill-red-400/70"
              />
            </g>
          );
        })}
        <line x1={0} x2={w} y1={h - 20} y2={h - 20} className="stroke-border" />
      </svg>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/70" /> Tushum
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-400/70" /> Xarajat
        </span>
        <span className="ml-auto">{rows[0]?.day} → {rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}
