import { useQuery } from '@tanstack/react-query';
import {
  Database,
  HardDrive,
  RefreshCw,
  Table2,
  TrendingUp,
  Layers,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

type TableStat = {
  table_name: string;
  row_estimate: number;
  size_bytes: number;
  total_size_bytes: number;
  index_size_bytes: number;
  seq_scan: number;
  idx_scan: number;
};

type DbInsights = {
  tables: TableStat[];
  hint?: string;
  db_size_bytes?: number;
  connection_count?: number;
  cache_hit_ratio?: number;
  index_hit_ratio?: number;
};

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function fmtNum(n: number): string {
  return Number(n ?? 0).toLocaleString('uz-UZ');
}

export function DatabaseInsightsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'database-insights'],
    queryFn: () => api.get<DbInsights>('/api/v1/admin/database/insights'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const tables = (data?.tables ?? []).sort((a, b) => b.total_size_bytes - a.total_size_bytes);
  const topByRows = [...tables].sort((a, b) => b.row_estimate - a.row_estimate).slice(0, 5);
  const totalRows = tables.reduce((s, t) => s + t.row_estimate, 0);
  const totalSize = data?.db_size_bytes ?? tables.reduce((s, t) => s + t.total_size_bytes, 0);
  const indexRatio = data?.index_hit_ratio ?? null;
  const cacheRatio = data?.cache_hit_ratio ?? null;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-50 via-background to-indigo-50 p-6 dark:from-slate-950/40 dark:to-indigo-950/30">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gradient-to-br from-slate-400/15 to-indigo-400/15 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-indigo-600" />
              <h1 className="text-2xl font-semibold tracking-tight">Ma'lumotlar bazasi</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Jadval hajmlari, qator soni, index foydalanish va kesh ko'rsatkichlari.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Yangilash
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Jami hajm"
          value={isLoading ? '…' : fmtBytes(totalSize)}
          icon={<HardDrive className="h-4 w-4" />}
        />
        <StatCard
          label="Jadvallar"
          value={isLoading ? '…' : String(tables.length)}
          icon={<Table2 className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Jami qatorlar (est.)"
          value={isLoading ? '…' : fmtNum(totalRows)}
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          label="Index hit ratio"
          value={isLoading ? '…' : indexRatio !== null ? `${(indexRatio * 100).toFixed(1)}%` : 'N/A'}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={indexRatio !== null && indexRatio > 0.9 ? 'success' : indexRatio !== null && indexRatio > 0.7 ? 'warning' : undefined}
        />
      </div>

      {/* Health indicators */}
      {(cacheRatio !== null || indexRatio !== null) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {cacheRatio !== null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Buffer cache hit ratio</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Kesh samaradorligi</span>
                  <span className={cn('font-semibold', cacheRatio > 0.95 ? 'text-emerald-600' : cacheRatio > 0.8 ? 'text-amber-600' : 'text-rose-600')}>
                    {(cacheRatio * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all', cacheRatio > 0.95 ? 'bg-emerald-400' : cacheRatio > 0.8 ? 'bg-amber-400' : 'bg-rose-400')}
                    style={{ width: `${cacheRatio * 100}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {cacheRatio > 0.95 ? '✅ Ajoyib — deyarli hamma so\'rov keshdan' : cacheRatio > 0.8 ? '⚠️ O\'rtacha — shared_buffers oshirilishi mumkin' : '❌ Past — kesh sozlamasi kerak'}
                </p>
              </CardContent>
            </Card>
          )}
          {indexRatio !== null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Index foydalanish</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Index vs sequential scan</span>
                  <span className={cn('font-semibold', indexRatio > 0.9 ? 'text-emerald-600' : indexRatio > 0.7 ? 'text-amber-600' : 'text-rose-600')}>
                    {(indexRatio * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all', indexRatio > 0.9 ? 'bg-indigo-400' : indexRatio > 0.7 ? 'bg-amber-400' : 'bg-rose-400')}
                    style={{ width: `${indexRatio * 100}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {indexRatio > 0.9 ? '✅ Index yaxshi ishlatilmoqda' : '⚠️ Ba\'zi jadvallar index yo\'q'}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Top tables by rows */}
      {topByRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Eng katta jadvallar (qatorlar bo'yicha)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topByRows.map((t) => {
                const pct = totalRows > 0 ? (t.row_estimate / totalRows) * 100 : 0;
                return (
                  <div key={t.table_name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono font-medium">{t.table_name}</span>
                      <span className="text-muted-foreground">{fmtNum(t.row_estimate)} qator</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-sky-400" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full tables list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Barcha jadvallar ({tables.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data?.hint && !tables.length ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-8 w-8 opacity-40" />
              <p className="font-medium">Funksiya topilmadi</p>
              <p className="text-xs">{data.hint}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Jadval</th>
                    <th className="px-4 py-2 text-right font-medium">Qatorlar (est.)</th>
                    <th className="px-4 py-2 text-right font-medium">Ma'lumot</th>
                    <th className="px-4 py-2 text-right font-medium">Index</th>
                    <th className="px-4 py-2 text-right font-medium">Jami</th>
                    <th className="px-4 py-2 text-right font-medium">Index/Seq scan</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={6} className="px-4 py-3">
                          <div className="h-4 animate-pulse rounded bg-muted/50" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    tables.map((t) => {
                      const total = t.idx_scan + t.seq_scan;
                      const idxPct = total > 0 ? Math.round((t.idx_scan / total) * 100) : null;
                      return (
                        <tr key={t.table_name} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="font-mono text-xs">{t.table_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">{fmtNum(t.row_estimate)}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{fmtBytes(t.size_bytes)}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{fmtBytes(t.index_size_bytes)}</td>
                          <td className="px-4 py-2.5 text-right text-xs font-medium">{fmtBytes(t.total_size_bytes)}</td>
                          <td className="px-4 py-2.5 text-right">
                            {idxPct !== null ? (
                              <span className={cn('text-xs font-medium', idxPct > 80 ? 'text-emerald-600' : idxPct > 50 ? 'text-amber-600' : 'text-rose-600')}>
                                {idxPct > 80 ? <CheckCircle2 className="inline h-3 w-3 mr-0.5" /> : <AlertCircle className="inline h-3 w-3 mr-0.5" />}
                                {idxPct}%
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
