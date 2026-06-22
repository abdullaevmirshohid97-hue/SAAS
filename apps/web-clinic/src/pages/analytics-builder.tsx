import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Hammer } from 'lucide-react';

import {
  AreaChartView,
  BarChartView,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { PresetBar, type Preset } from '@/components/analytics/preset-bar';

const ADMIN_ROLES = new Set(['clinic_admin', 'clinic_owner', 'super_admin']);

type Dimension = 'time' | 'payment_method' | 'register' | 'source' | 'cashier';
type Grain = 'day' | 'week' | 'month';
type Metric = 'revenue_uzs' | 'tx_count' | 'avg_check_uzs';

const DIMENSIONS: Array<{ id: Dimension; label: string }> = [
  { id: 'time', label: 'Vaqt (trend)' },
  { id: 'payment_method', label: "To'lov usuli" },
  { id: 'register', label: 'Registr (qabulxona/statsionar)' },
  { id: 'source', label: 'Manba (kassa/seyf)' },
  { id: 'cashier', label: 'Kassir' },
];

const METRICS: Array<{ id: Metric; label: string; money: boolean }> = [
  { id: 'revenue_uzs', label: 'Tushum', money: true },
  { id: 'tx_count', label: 'Tranzaksiya soni', money: false },
  { id: 'avg_check_uzs', label: "O'rtacha chek", money: true },
];

const GRAINS: Array<{ id: Grain; label: string }> = [
  { id: 'day', label: 'Kun' },
  { id: 'week', label: 'Hafta' },
  { id: 'month', label: 'Oy' },
];

const fmtMoney = (v: number) => `${Math.round(v).toLocaleString('uz-UZ')} so'm`;
const fmtNum = (v: number) => Math.round(v).toLocaleString('uz-UZ');

// Preset/custom -> aniq sana oralig'i (server rangeFor bilan bir xil mantiq).
function presetToRange(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
  const now = new Date();
  const to = iso(now);
  const start = new Date(now);
  switch (preset) {
    case 'today':
      break;
    case 'week':
      start.setDate(start.getDate() - 6);
      break;
    case 'year':
      start.setMonth(0, 1);
      break;
    case 'month':
    default:
      start.setDate(1);
      break;
  }
  return { from: iso(start), to };
}

export function AnalyticsBuilderPage() {
  const { role } = useAuth();
  const [dimension, setDimension] = useState<Dimension>('time');
  const [grain, setGrain] = useState<Grain>('day');
  const [metric, setMetric] = useState<Metric>('revenue_uzs');
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(
    () => presetToRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const isAdmin = ADMIN_ROLES.has(role);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analytics-query', dimension, grain, range.from, range.to],
    queryFn: () => api.analytics.query({ dimension, grain, from: range.from, to: range.to }),
    enabled: isAdmin && !!range.from && !!range.to,
  });

  const rows = data?.rows ?? [];
  const metricMeta = METRICS.find((m) => m.id === metric)!;
  const valueFormat = metricMeta.money ? fmtMoney : fmtNum;

  function exportCsv() {
    const header = ['Bo\'lim', 'Tushum (so\'m)', 'Tranzaksiya', "O'rtacha chek (so'm)"];
    const lines = rows.map((r) =>
      [r.bucket, r.revenue_uzs, r.tx_count, r.avg_check_uzs].join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hisobot-${dimension}-${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-10 text-center text-sm text-muted-foreground">
        Bu sahifa faqat klinika administratori uchun.
      </div>
    );
  }

  const chartData = rows.map((r) => ({ bucket: r.bucket, [metric]: r[metric] }));
  const series = [{ key: metric, label: metricMeta.label, tone: 'primary' as const }];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Hammer className="h-6 w-6 text-primary" /> Hisobot quruvchi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Metrika, o'lcham va davrni tanlab o'z hisobotingizni yarating.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="mr-2 h-4 w-4" /> CSV
        </Button>
      </div>

      {/* Boshqaruv paneli */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            O'lcham
            <select
              value={dimension}
              onChange={(e) => setDimension(e.target.value as Dimension)}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              {DIMENSIONS.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>

          {dimension === 'time' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Davriylik
              <select
                value={grain}
                onChange={(e) => setGrain(e.target.value as Grain)}
                className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
              >
                {GRAINS.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Metrika
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            >
              {METRICS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Davr
            <PresetBar
              value={preset}
              onChange={setPreset}
              customFrom={customFrom}
              customTo={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
            />
          </div>
        </CardContent>
      </Card>

      {/* Natija */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {metricMeta.label} — {DIMENSIONS.find((d) => d.id === dimension)?.label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="py-10 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>}
          {isError && (
            <div className="py-10 text-center text-sm text-destructive">
              Xatolik: {(error as Error)?.message ?? 'noma\'lum'}
            </div>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Tanlangan davr uchun ma'lumot yo'q.
            </div>
          )}
          {!isLoading && !isError && rows.length > 0 && (
            <>
              {dimension === 'time' ? (
                <AreaChartView data={chartData} xKey="bucket" series={series} valueFormat={valueFormat} />
              ) : (
                <BarChartView data={chartData} xKey="bucket" series={series} valueFormat={valueFormat} />
              )}

              {/* Jadval */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4">Bo'lim</th>
                      <th className="py-2 pr-4 text-right">Tushum</th>
                      <th className="py-2 pr-4 text-right">Tranzaksiya</th>
                      <th className="py-2 text-right">O'rtacha chek</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.bucket} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-medium">{r.bucket}</td>
                        <td className="py-2 pr-4 text-right">{fmtMoney(r.revenue_uzs)}</td>
                        <td className="py-2 pr-4 text-right">{fmtNum(r.tx_count)}</td>
                        <td className="py-2 text-right">{fmtMoney(r.avg_check_uzs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
