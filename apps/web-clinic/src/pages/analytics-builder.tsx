import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Download, FileText, Hammer, Play, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  AreaChartView,
  BarChartView,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { PresetBar, type Preset } from '@/components/analytics/preset-bar';
import { printA4, downloadA4Pdf, escapeHtml, captureElementPng } from '@/lib/report-export';

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

const CADENCE_OPTIONS: Array<{ id: 'daily' | 'weekly' | 'monthly'; label: string }> = [
  { id: 'daily', label: 'Kunlik' },
  { id: 'weekly', label: 'Haftalik (dushanba)' },
  { id: 'monthly', label: "Oylik (1-kun)" },
];

// Joriy hisobotni avtomatik (Telegram CSV) yuborish jadvali — yaratish + ro'yxat.
function ScheduleDialog({ dimension, grain }: { dimension: Dimension; grain: Grain }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [hour, setHour] = useState(7);

  const { data } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => api.reportSchedules.list(),
    enabled: open,
  });
  const schedules = data?.schedules ?? [];
  const tgConnected = data?.telegram_connected ?? true;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['report-schedules'] });
  const createMut = useMutation({
    mutationFn: () =>
      api.reportSchedules.create({
        name: name.trim() || 'Hisobot',
        dimension,
        grain,
        cadence,
        send_hour: hour,
      }),
    onSuccess: () => {
      toast.success('Jadval saqlandi');
      setName('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => api.reportSchedules.toggle(v.id, v.active),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => api.reportSchedules.remove(id),
    onSuccess: () => {
      toast.success("O'chirildi");
      invalidate();
    },
  });
  const runMut = useMutation({
    mutationFn: (id: string) => api.reportSchedules.runNow(id),
    onSuccess: (r) =>
      r.ok
        ? toast.success('Telegram\'ga yuborildi ✓')
        : toast.error(r.reason === 'no_bot' ? 'Telegram hisobot boti ulanmagan' : 'Yuborilmadi'),
    onError: (e: Error) => toast.error(e.message),
  });

  const dimLabel = DIMENSIONS.find((d) => d.id === dimension)?.label ?? dimension;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Clock className="mr-2 h-4 w-4" /> Jadvallashtirish
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Avtomatik hisobot</DialogTitle>
          <DialogDescription>
            Joriy hisobot (<b>{dimLabel}</b>) belgilangan vaqtda Telegram'ga CSV bo'lib yuboriladi.
          </DialogDescription>
        </DialogHeader>

        {!tgConnected && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠ Telegram hisobot boti ulanmagan — jadval ishlashi uchun avval botni Telegram orqali
            ulang (markaziy bot → /start).
          </div>
        )}

        {/* Yangi jadval */}
        <div className="space-y-3 rounded-lg border p-3">
          <Input placeholder="Nom (masalan: Kunlik kassa)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Davriylik
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly' | 'monthly')}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {CADENCE_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Yuborish soati
              <select
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </label>
          </div>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="w-full">
            Saqlash
          </Button>
        </div>

        {/* Mavjud jadvallar */}
        <div className="space-y-2">
          {schedules.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">Hozircha jadval yo'q.</p>
          )}
          {schedules.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  {!s.is_active && <Badge variant="secondary" className="text-[10px]">o'chiq</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {CADENCE_OPTIONS.find((c) => c.id === s.cadence)?.label} ·{' '}
                  {String(s.send_hour).padStart(2, '0')}:00 · {s.dimension}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="icon" variant="ghost" title="Hozir yubor" onClick={() => runMut.mutate(s.id)} disabled={runMut.isPending}>
                  <Play className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleMut.mutate({ id: s.id, active: !s.is_active })}
                >
                  {s.is_active ? 'To\'xtatish' : 'Yoqish'}
                </Button>
                <Button size="icon" variant="ghost" title="O'chirish" onClick={() => removeMut.mutate(s.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AnalyticsBuilderPage() {
  const { role } = useAuth();
  const [dimension, setDimension] = useState<Dimension>('time');
  const [grain, setGrain] = useState<Grain>('day');
  const [metric, setMetric] = useState<Metric>('revenue_uzs');
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const chartRef = useRef<HTMLDivElement>(null);

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

  // PDF / A4 chop etish uchun yagona HTML manbai (sarlavha + grafik + jadval + jami).
  function buildReportHtml(chartImg?: string | null): string {
    const dimLabel = DIMENSIONS.find((d) => d.id === dimension)?.label ?? dimension;
    const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue_uzs ?? 0), 0);
    const totalTx = rows.reduce((s, r) => s + Number(r.tx_count ?? 0), 0);
    const totalAvg = totalTx > 0 ? Math.round(totalRevenue / totalTx) : 0;
    const generated = new Date().toLocaleString('uz-UZ');
    const chartHtml = chartImg ? `<img class="doc-chart" src="${chartImg}" alt="grafik" />` : '';
    const body = rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.bucket)}</td>` +
          `<td class="r">${fmtMoney(r.revenue_uzs)}</td>` +
          `<td class="r">${fmtNum(r.tx_count)}</td>` +
          `<td class="r">${fmtMoney(r.avg_check_uzs)}</td></tr>`,
      )
      .join('');
    return (
      `<div class="doc-title">Hisobot — ${escapeHtml(dimLabel)}</div>` +
      `<div class="doc-meta">${escapeHtml(metricMeta.label)} · Davr: ${range.from} – ${range.to} · Yaratildi: ${escapeHtml(generated)}</div>` +
      chartHtml +
      `<table><thead><tr>` +
      `<th>Bo'lim</th><th class="r">Tushum</th><th class="r">Tranzaksiya</th><th class="r">O'rtacha chek</th>` +
      `</tr></thead><tbody>${body}</tbody>` +
      `<tfoot><tr><td>JAMI</td>` +
      `<td class="r">${fmtMoney(totalRevenue)}</td>` +
      `<td class="r">${fmtNum(totalTx)}</td>` +
      `<td class="r">${fmtMoney(totalAvg)}</td></tr></tfoot>` +
      `</table>` +
      `<div class="doc-footer">Clary Healthcare ERP · clary.uz</div>`
    );
  }

  // Grafikni rasm sifatida tortib oladi (PDF/A4 ichiga). On-screen recharts SVG.
  async function captureChart(): Promise<string | null> {
    return chartRef.current ? captureElementPng(chartRef.current) : null;
  }

  const [exporting, setExporting] = useState(false);

  async function exportPdf() {
    setExporting(true);
    try {
      const img = await captureChart();
      await downloadA4Pdf(buildReportHtml(img), `hisobot-${dimension}-${range.from}_${range.to}.pdf`);
    } catch (e) {
      toast.error((e as Error).message || 'PDF yaratishda xatolik');
    } finally {
      setExporting(false);
    }
  }

  async function printReport() {
    setExporting(true);
    try {
      const img = await captureChart();
      printA4(buildReportHtml(img), `Hisobot ${range.from} – ${range.to}`);
    } finally {
      setExporting(false);
    }
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={exportPdf} disabled={rows.length === 0 || exporting}>
            <FileText className="mr-2 h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" onClick={printReport} disabled={rows.length === 0 || exporting}>
            <Printer className="mr-2 h-4 w-4" /> A4 chop etish
          </Button>
          <ScheduleDialog dimension={dimension} grain={grain} />
        </div>
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
              <div ref={chartRef} className="bg-card">
                {dimension === 'time' ? (
                  <AreaChartView data={chartData} xKey="bucket" series={series} valueFormat={valueFormat} />
                ) : (
                  <BarChartView data={chartData} xKey="bucket" series={series} valueFormat={valueFormat} />
                )}
              </div>

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
