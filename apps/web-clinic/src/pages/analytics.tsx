import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  BadgePercent,
  CalendarDays,
  Download,
  PieChart as PieIcon,
  Sparkles,
  Stethoscope,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  AreaChartView,
  BarChartView,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const rangeParams = rangeParamsFor(preset, customFrom, customTo);
  // Drill-down sahifalariga davrn URL orqali uzatish
  const periodQuery = new URLSearchParams(rangeParams as Record<string, string>).toString();

  const overview = useQuery({
    queryKey: ['analytics', 'overview', preset, customFrom, customTo],
    queryFn: () => api.analytics.overview(rangeParams),
    refetchInterval: 60_000,
  });
  const doctors = useQuery({
    queryKey: ['analytics', 'doctors', preset, customFrom, customTo],
    queryFn: () => api.analytics.doctors(rangeParams),
  });
  const topServices = useQuery({
    queryKey: ['analytics', 'top-services', preset, customFrom, customTo],
    queryFn: () => api.analytics.topServices(rangeParams),
  });
  const heatmap = useQuery({
    queryKey: ['analytics', 'heatmap', preset, customFrom, customTo],
    queryFn: () => api.analytics.heatmap(rangeParams),
  });
  const inpatient = useQuery({
    queryKey: ['analytics', 'inpatient-share', preset, customFrom, customTo],
    queryFn: () => api.analytics.inpatientShare(rangeParams),
  });

  const totals = overview.data?.totals;

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/5 via-background to-info/5 p-5">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-primary/10 to-info/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">Analitika</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Klinika ish samaradorligi va daromad dinamikasi · real-vaqt
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PresetBar
              value={preset}
              onChange={setPreset}
              customFrom={customFrom}
              customTo={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportAnalyticsCsv(
                  overview.data,
                  doctors.data,
                  topServices.data,
                  preset === 'custom' && customFrom && customTo
                    ? `${customFrom}–${customTo}`
                    : preset,
                )
              }
            >
              <Download className="mr-1.5 h-4 w-4" /> Export
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label="Tushum"
          value={`${fmt(totals?.revenue_uzs ?? 0)}`}
          hint="UZS"
          icon={<Wallet className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Rasxot"
          value={`${fmt(totals?.expenses_uzs ?? 0)}`}
          hint="UZS"
          tone="warning"
        />
        <StatCard
          label="Sof foyda"
          value={`${fmt(totals?.profit_uzs ?? 0)}`}
          hint="UZS"
          tone={(totals?.profit_uzs ?? 0) >= 0 ? 'success' : 'danger'}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="O‘rtacha chek"
          value={`${fmt(totals?.avg_check_uzs ?? 0)}`}
          hint="UZS"
          icon={<BadgePercent className="h-4 w-4" />}
        />
        <StatCard
          label="Qabullar"
          value={String(totals?.appointments ?? 0)}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <StatCard
          label="Yangi bemorlar"
          value={String(totals?.new_patients ?? 0)}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Dorixona"
          value={`${fmt(totals?.pharmacy_revenue_uzs ?? 0)}`}
          hint="UZS"
          tone="info"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daromad / rasxot / dorixona</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart rows={overview.data?.daily ?? []} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-4 w-4" /> Shifokorlar ulushi
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-primary"
              onClick={() => navigate(`/analytics/doctors?${periodQuery}`)}
            >
              Batafsil <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <DoctorTable rows={doctors.data ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <PieIcon className="h-4 w-4" /> Eng ko‘p bajariladigan xizmatlar
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-primary"
              onClick={() => navigate(`/analytics/services?${periodQuery}`)}
            >
              Batafsil <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ServiceBars rows={topServices.data ?? []} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Soat × Hafta kuni Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <Heatmap grid={heatmap.data?.grid ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Statsionar ulushi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <InpatientShareTable data={inpatient.data} />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI building blocks
// ---------------------------------------------------------------------------

function TrendChart({
  rows,
}: {
  rows: Array<{ day: string; revenue: number; expenses: number; pharmacy: number }>;
}) {
  if (rows.length === 0) {
    return <div className="py-6 text-sm text-muted-foreground">Ma'lumot yo'q</div>;
  }
  return (
    <AreaChartView
      data={rows}
      xKey="day"
      height={240}
      valueFormat={(v) => Number(v).toLocaleString('uz-UZ')}
      series={[
        { key: 'revenue', label: 'Tushum', tone: 'success' },
        { key: 'expenses', label: 'Rasxot', tone: 'danger' },
        { key: 'pharmacy', label: 'Dorixona', tone: 'info' },
      ]}
    />
  );
}

function exportAnalyticsCsv(
  overview: { totals: Record<string, number>; daily: Array<{ day: string; revenue: number; expenses: number; pharmacy: number }> } | undefined,
  doctors: Array<{ doctor_name: string; visits: number; patients: number; revenue: number }> | undefined,
  topServices: Array<{ service_name: string; count: number; revenue: number }> | undefined,
  periodLabel: string,
) {
  if (!overview) return;
  const rows: string[][] = [
    [`Analitika eksporti — ${periodLabel}`],
    [],
    ['Umumiy ko\'rsatkichlar'],
    ...Object.entries(overview.totals ?? {}).map(([k, v]) => [k, String(v)]),
    [],
    ['Kunlik dinamika'],
    ['Sana', 'Tushum', 'Rasxot', 'Dorixona'],
    ...(overview.daily ?? []).map((d) => [d.day, String(d.revenue), String(d.expenses), String(d.pharmacy)]),
  ];
  if (doctors?.length) {
    rows.push([], ['Shifokorlar'], ['Ism', 'Qabullar', 'Bemorlar', 'Tushum']);
    for (const d of doctors) rows.push([d.doctor_name, String(d.visits), String(d.patients), String(d.revenue)]);
  }
  if (topServices?.length) {
    rows.push([], ['Top xizmatlar'], ['Xizmat', 'Soni', 'Tushum']);
    for (const s of topServices) rows.push([s.service_name, String(s.count), String(s.revenue)]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analitika-${periodLabel.replace(/[^\w-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DoctorTable({
  rows,
}: {
  rows: Array<{ doctor_id: string | null; doctor_name: string; visits: number; patients: number; revenue: number }>;
}) {
  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Ma‘lumot yo‘q</div>;
  }
  const maxRev = Math.max(1, ...rows.map((r) => r.revenue));
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1;
  return (
    <div className="divide-y">
      {rows.map((r) => (
        <div key={r.doctor_id ?? r.doctor_name} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
          <div>
            <div className="font-medium">{r.doctor_name}</div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${(r.revenue / maxRev) * 100}%` }}
              />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {r.visits} qabul · {r.patients} bemor
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold">{fmt(r.revenue)} UZS</div>
            <div className="text-xs text-muted-foreground">
              {((r.revenue / total) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ServiceBars({ rows }: { rows: Array<{ service_name: string; count: number; revenue: number }> }) {
  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Ma‘lumot yo‘q</div>;
  }
  // Eng ko'p 8 ta xizmat — uzun nom qisqartiriladi.
  const data = rows.slice(0, 8).map((r) => ({
    name: r.service_name.length > 16 ? `${r.service_name.slice(0, 15)}…` : r.service_name,
    count: r.count,
  }));
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0) || 1;
  return (
    <div className="p-4">
      <BarChartView
        data={data}
        xKey="name"
        height={240}
        series={[{ key: 'count', label: 'Soni', tone: 'primary' }]}
      />
      {/* To'liq top-10 jadval — summa + ulush% bilan */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Xizmat</th>
              <th className="px-2 py-1.5 text-right font-medium">Soni</th>
              <th className="px-2 py-1.5 text-right font-medium">Summa</th>
              <th className="px-2 py-1.5 text-right font-medium">Ulush</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, 10).map((r) => (
              <tr key={r.service_name} className="hover:bg-muted/30">
                <td className="px-2 py-1.5">{r.service_name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt(r.revenue)}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">
                  {((r.revenue / totalRev) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const dow = ['Yak', 'Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sh'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const max = Math.max(1, ...grid.flat());
  if (grid.length === 0) {
    return <div className="py-4 text-sm text-muted-foreground">Ma‘lumot yo‘q</div>;
  }
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[60px_repeat(24,1fr)] gap-0.5 text-[10px]">
        <div />
        {hours.map((h) => (
          <div key={h} className="text-center text-muted-foreground">
            {h}
          </div>
        ))}
        {grid.map((row, dIx) => (
          <Fragment key={`row-${dIx}`}>
            <div className="pr-1 text-right text-xs font-medium text-muted-foreground">
              {dow[dIx]}
            </div>
            {row.map((v, hIx) => {
              const intensity = v / max;
              return (
                <div
                  key={`c-${dIx}-${hIx}`}
                  title={`${dow[dIx]} ${hIx}:00 — ${v}`}
                  className="h-6 rounded"
                  style={{
                    background:
                      intensity === 0
                        ? 'hsl(var(--muted))'
                        : `hsl(var(--primary) / ${0.15 + intensity * 0.85})`,
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function InpatientShareTable({
  data,
}: {
  data?: {
    rooms: Array<{
      room_id: string;
      room_number: string;
      room_type: string | null;
      current_stays: number;
      revenue_uzs: number;
    }>;
    period: { total_uzs: number; count: number };
  };
}) {
  const rooms = data?.rooms ?? [];
  const period = data?.period ?? { total_uzs: 0, count: 0 };
  return (
    <div>
      {/* Davr statsionar tushumi — tanlangan oraliq bo'yicha */}
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="text-xs text-muted-foreground">Davr statsionar tushumi</div>
        <div className="text-lg font-semibold">
          {fmt(period.total_uzs)} UZS{' '}
          <span className="text-xs font-normal text-muted-foreground">
            ({period.count} amal)
          </span>
        </div>
      </div>
      {/* Joriy joylashuv — xonalar (davrsiz, hozirgi holat) */}
      <div className="px-4 pb-1 pt-3 text-xs font-medium uppercase text-muted-foreground">
        Joriy joylashuv
      </div>
      {rooms.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">Joylashgan bemor yo‘q</div>
      ) : (
        <div className="divide-y">
          {rooms.map((r) => (
            <div key={r.room_id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Xona #{r.room_number}</div>
                <div className="text-xs text-muted-foreground">{r.room_type ?? '—'}</div>
              </div>
              <Badge variant="secondary">{r.current_stays} joylashgan</Badge>
              <div className="text-right font-semibold">{fmt(r.revenue_uzs)} UZS</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
