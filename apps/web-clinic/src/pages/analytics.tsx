import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
} from '@clary/ui-web';

import { api } from '@/lib/api';

type Preset = 'today' | 'week' | 'month' | 'year';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>('month');

  const overview = useQuery({
    queryKey: ['analytics', 'overview', preset],
    queryFn: () => api.analytics.overview({ preset }),
    refetchInterval: 60_000,
  });
  const doctors = useQuery({
    queryKey: ['analytics', 'doctors', preset],
    queryFn: () => api.analytics.doctors({ preset }),
  });
  const topServices = useQuery({
    queryKey: ['analytics', 'top-services', preset],
    queryFn: () => api.analytics.topServices({ preset }),
  });
  const heatmap = useQuery({
    queryKey: ['analytics', 'heatmap', preset],
    queryFn: () => api.analytics.heatmap({ preset }),
  });
  const inpatient = useQuery({
    queryKey: ['analytics', 'inpatient-share'],
    queryFn: () => api.analytics.inpatientShare(),
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
            <PresetBar value={preset} onChange={setPreset} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportAnalyticsCsv(overview.data, doctors.data, topServices.data, preset)}
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-4 w-4" /> Shifokorlar ulushi
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DoctorTable rows={doctors.data ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieIcon className="h-4 w-4" /> Eng ko‘p bajariladigan xizmatlar
            </CardTitle>
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
          <InpatientShareTable rows={inpatient.data ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI building blocks
// ---------------------------------------------------------------------------
function PresetBar({ value, onChange }: { value: Preset; onChange: (p: Preset) => void }) {
  const items: Array<{ id: Preset; label: string }> = [
    { id: 'today', label: 'Bugun' },
    { id: 'week', label: 'Hafta' },
    { id: 'month', label: 'Oy' },
    { id: 'year', label: 'Yil' },
  ];
  return (
    <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
      {items.map((i) => (
        <button
          key={i.id}
          onClick={() => onChange(i.id)}
          className={
            'rounded px-3 py-1.5 text-xs font-medium transition ' +
            (value === i.id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground')
          }
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

function TrendChart({
  rows,
}: {
  rows: Array<{ day: string; revenue: number; expenses: number; pharmacy: number }>;
}) {
  const width = 800;
  const height = 240;
  const padX = 40;
  const padY = 20;

  const max = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => [r.revenue, r.expenses, r.pharmacy])),
    [rows],
  );

  if (rows.length === 0) {
    return <div className="py-6 text-sm text-muted-foreground">Ma‘lumot yo‘q</div>;
  }

  const xFor = (i: number) =>
    padX + (i / Math.max(1, rows.length - 1)) * (width - padX * 2);
  const yFor = (v: number) => height - padY - (v / max) * (height - padY * 2);

  const buildLine = (key: 'revenue' | 'expenses' | 'pharmacy') =>
    rows
      .map((r, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(r[key]).toFixed(1)}`)
      .join(' ');

  const buildArea = (key: 'revenue' | 'expenses' | 'pharmacy') => {
    if (rows.length === 0) return '';
    const top = rows
      .map((r, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(r[key]).toFixed(1)}`)
      .join(' ');
    return `${top} L ${xFor(rows.length - 1).toFixed(1)} ${(height - padY).toFixed(1)} L ${xFor(0).toFixed(1)} ${(height - padY).toFixed(1)} Z`;
  };

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="grad-revenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="grad-expenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="grad-pharmacy" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--info))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(var(--info))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line
            key={i}
            x1={padX}
            x2={width - padX}
            y1={padY + t * (height - padY * 2)}
            y2={padY + t * (height - padY * 2)}
            stroke="hsl(var(--border))"
            strokeDasharray="2 3"
            strokeOpacity={0.5}
          />
        ))}
        <path d={buildArea('revenue')} fill="url(#grad-revenue)" />
        <path d={buildArea('expenses')} fill="url(#grad-expenses)" />
        <path d={buildArea('pharmacy')} fill="url(#grad-pharmacy)" />
        <path d={buildLine('revenue')} fill="none" stroke="hsl(var(--success))" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d={buildLine('expenses')} fill="none" stroke="hsl(var(--destructive))" strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" />
        <path d={buildLine('pharmacy')} fill="none" stroke="hsl(var(--info))" strokeWidth={2} strokeLinecap="round" />
        {rows.map((r, i) => (
          <circle
            key={i}
            cx={xFor(i)}
            cy={yFor(r.revenue)}
            r="3"
            fill="hsl(var(--background))"
            stroke="hsl(var(--success))"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="mt-3 flex gap-4 text-xs">
        <Legend color="var(--success)" label="Tushum" />
        <Legend color="var(--destructive)" label="Rasxot" />
        <Legend color="var(--info)" label="Dorixona" />
      </div>
    </div>
  );
}

function exportAnalyticsCsv(
  overview: { totals: Record<string, number>; daily: Array<{ day: string; revenue: number; expenses: number; pharmacy: number }> } | undefined,
  doctors: Array<{ doctor_name: string; visits: number; patients: number; revenue: number }> | undefined,
  topServices: Array<{ service_name: string; count: number; revenue: number }> | undefined,
  preset: Preset,
) {
  if (!overview) return;
  const rows: string[][] = [
    [`Analitika eksporti — ${preset}`],
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
  a.download = `analitika-${preset}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-4 rounded-sm"
        style={{ background: `hsl(${color})` }}
      />
      {label}
    </span>
  );
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
          <div className="text-right font-semibold">{fmt(r.revenue)} UZS</div>
        </div>
      ))}
    </div>
  );
}

function ServiceBars({ rows }: { rows: Array<{ service_name: string; count: number; revenue: number }> }) {
  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Ma‘lumot yo‘q</div>;
  }
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="divide-y">
      {rows.map((r) => (
        <div key={r.service_name} className="px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate font-medium">{r.service_name}</span>
            <span className="ml-2 text-muted-foreground">{r.count}x</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-primary to-primary/60"
              style={{ width: `${(r.count / maxCount) * 100}%` }}
            />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{fmt(r.revenue)} UZS</div>
        </div>
      ))}
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
  rows,
}: {
  rows: Array<{
    room_id: string;
    room_number: string;
    room_type: string | null;
    current_stays: number;
    revenue_uzs: number;
  }>;
}) {
  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Xonalar yo‘q</div>;
  }
  return (
    <div className="divide-y">
      {rows.map((r) => (
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
  );
}
