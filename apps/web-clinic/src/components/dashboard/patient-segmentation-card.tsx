import { useQuery } from '@tanstack/react-query';
import { Users, Phone, AlertTriangle, Crown } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmt(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const LTV_COLORS: Record<string, string> = {
  VIP: '#a855f7',
  Doimiy: '#10b981',
  'Vaqti-vaqti': '#3b82f6',
  Yangi: '#94a3b8',
};

const CHURN_COLORS: Record<string, string> = {
  Faol: '#10b981',
  'Xavfli (30+)': '#f59e0b',
  "Yo'qolgan (90+)": '#f43f5e',
  'Hech kelmagan': '#94a3b8',
};

export function PatientSegmentationCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'patient-segments'],
    queryFn: () => api.analytics.patientSegments(),
    refetchInterval: 10 * 60_000,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-violet-600" />
            Bemor segmentatsiyasi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        </CardContent>
      </Card>
    );
  }

  const ltvData = [
    { name: 'VIP', value: data.summary.by_ltv.vip },
    { name: 'Doimiy', value: data.summary.by_ltv.regular },
    { name: 'Vaqti-vaqti', value: data.summary.by_ltv.occasional },
    { name: 'Yangi', value: data.summary.by_ltv.new },
  ].filter((d) => d.value > 0);

  const churnData = [
    { name: 'Faol', value: data.summary.by_churn.active },
    { name: 'Xavfli (30+)', value: data.summary.by_churn.at_risk },
    { name: "Yo'qolgan (90+)", value: data.summary.by_churn.churned },
    { name: 'Hech kelmagan', value: data.summary.by_churn.never_visited },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-violet-600" />
          Bemor segmentatsiyasi
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          Jami: <b>{data.summary.total}</b> · LTV: {fmt(data.summary.total_ltv_uzs)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 2 ta donut chart yon-ma-yon */}
        <div className="grid grid-cols-2 gap-3">
          {/* LTV */}
          <div>
            <div className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Qiymat (LTV)
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ltvData} dataKey="value" innerRadius={28} outerRadius={50} paddingAngle={2}>
                    {ltvData.map((d) => (
                      <Cell key={d.name} fill={LTV_COLORS[d.name] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => `${Number(v)} bemor`}
                    contentStyle={{ fontSize: '11px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '9px' }} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Churn */}
          <div>
            <div className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Faollik (Churn)
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={churnData} dataKey="value" innerRadius={28} outerRadius={50} paddingAngle={2}>
                    {churnData.map((d) => (
                      <Cell key={d.name} fill={CHURN_COLORS[d.name] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => `${Number(v)} bemor`}
                    contentStyle={{ fontSize: '11px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '9px' }} iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Yo'qolish xavfida bemor — top 3 */}
        {data.at_risk_top.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50/50 p-2">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              Yo'qolish xavfida (eng qimmatlilari)
            </div>
            <ul className="space-y-1">
              {data.at_risk_top.slice(0, 3).map((p) => (
                <li key={p.id} className="flex items-center justify-between text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.full_name ?? '—'}</div>
                    {p.phone && (
                      <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary">
                        <Phone className="h-2.5 w-2.5" /> {p.phone}
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-semibold">{fmt(p.ltv_uzs)} so'm</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.days_since_last_activity} kun
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* VIP top 3 */}
        {data.vip_top.length > 0 && (
          <div className="rounded-md border border-violet-300 bg-violet-50/40 p-2">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-violet-800">
              <Crown className="h-3 w-3" />
              VIP bemorlar (LTV)
            </div>
            <ul className="space-y-1">
              {data.vip_top.slice(0, 3).map((p) => (
                <li key={p.id} className="flex items-center justify-between text-xs">
                  <div className="min-w-0 flex-1 truncate font-medium">{p.full_name ?? '—'}</div>
                  <div
                    className={cn(
                      'text-right font-mono font-semibold',
                      'text-violet-700',
                    )}
                  >
                    {fmt(p.ltv_uzs)} so'm
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
