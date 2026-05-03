import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Code2,
  RefreshCw,
  TrendingUp,
  Clock,
  AlertTriangle,
  Zap,
  BarChart3,
  Shield,
  Activity,
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

type EndpointStat = {
  path: string;
  method: string;
  total_calls: number;
  avg_response_ms: number;
  p95_response_ms: number;
  error_rate: number;
  last_called_at: string | null;
};

type TenantUsage = {
  clinic_id: string;
  clinic_name: string | null;
  total_calls: number;
  error_calls: number;
  rate_limit_hits: number;
};

type ApiUsageResponse = {
  overview: {
    total_calls: number;
    error_calls: number;
    avg_response_ms: number;
    rate_limit_hits: number;
    unique_tenants: number;
    period_days: number;
  };
  top_endpoints: EndpointStat[];
  by_tenant: TenantUsage[];
  error_rate_pct: number;
};

const METHOD_COLOR: Record<string, string> = {
  GET:    'text-sky-700 bg-sky-50 border-sky-200',
  POST:   'text-emerald-700 bg-emerald-50 border-emerald-200',
  PATCH:  'text-amber-700 bg-amber-50 border-amber-200',
  PUT:    'text-violet-700 bg-violet-50 border-violet-200',
  DELETE: 'text-rose-700 bg-rose-50 border-rose-200',
};

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function responseColor(ms: number) {
  if (ms < 100) return 'text-emerald-600';
  if (ms < 500) return 'text-amber-600';
  return 'text-rose-600';
}

export function ApiUsagePage() {
  const [days, setDays] = useState(7);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'api-usage', days],
    queryFn: () => api.get<ApiUsageResponse>(`/api/v1/admin/api-usage?days=${days}`),
    refetchInterval: 60_000,
  });

  const o = data?.overview;
  const endpoints = data?.top_endpoints ?? [];
  const tenants = data?.by_tenant ?? [];
  const maxCalls = Math.max(...endpoints.map((e) => e.total_calls), 1);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50 via-background to-teal-50 p-6 dark:from-emerald-950/30 dark:to-teal-950/30">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gradient-to-br from-emerald-400/20 to-teal-400/20 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Code2 className="h-5 w-5 text-emerald-600" />
              <h1 className="text-2xl font-semibold tracking-tight">API foydalanish</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Eng ko'p chaqiriladigan endpoint'lar, javob vaqti, xato foizi va rate limit statistikasi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
              {[1, 7, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d === 1 ? 'Bugun' : `${d} kun`}
                </button>
              ))}
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
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard
          label="Jami so'rovlar"
          value={isLoading ? '…' : fmtNum(o?.total_calls ?? 0)}
          icon={<Zap className="h-4 w-4" />}
        />
        <StatCard
          label="O'rt. javob vaqti"
          value={isLoading ? '…' : o?.avg_response_ms ? `${Math.round(o.avg_response_ms)} ms` : '—'}
          icon={<Clock className="h-4 w-4" />}
          tone={o?.avg_response_ms && o.avg_response_ms < 200 ? 'success' : o?.avg_response_ms && o.avg_response_ms < 500 ? 'warning' : undefined}
        />
        <StatCard
          label="Xato foizi"
          value={isLoading ? '…' : o ? `${(data?.error_rate_pct ?? 0).toFixed(2)}%` : '—'}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={(data?.error_rate_pct ?? 0) > 5 ? 'danger' : (data?.error_rate_pct ?? 0) > 1 ? 'warning' : 'success'}
        />
        <StatCard
          label="Rate limit hits"
          value={isLoading ? '…' : String(o?.rate_limit_hits ?? 0)}
          icon={<Shield className="h-4 w-4" />}
          tone={(o?.rate_limit_hits ?? 0) > 100 ? 'warning' : undefined}
        />
        <StatCard
          label="Faol tenant"
          value={isLoading ? '…' : String(o?.unique_tenants ?? 0)}
          icon={<Activity className="h-4 w-4" />}
        />
      </div>

      {/* Top endpoints */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Top endpoint'lar — so'nggi {days} kun
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">#</th>
                  <th className="px-4 py-2 text-left font-medium">Method</th>
                  <th className="px-4 py-2 text-left font-medium">Endpoint</th>
                  <th className="px-4 py-2 text-right font-medium">Chaqiriqlar</th>
                  <th className="px-4 py-2 text-right font-medium">O'rt. ms</th>
                  <th className="px-4 py-2 text-right font-medium">P95 ms</th>
                  <th className="px-4 py-2 text-right font-medium">Xato %</th>
                  <th className="px-4 py-2 text-left font-medium">Trafik</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={8} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted/50" />
                      </td>
                    </tr>
                  ))
                ) : endpoints.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-sm text-muted-foreground">
                      <BarChart3 className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      <p>Ma'lumot yo'q</p>
                      <p className="text-xs mt-1">API usage logging faol bo'lganda bu yerda ko'rsatiladi</p>
                    </td>
                  </tr>
                ) : (
                  endpoints.map((ep, i) => {
                    const pct = (ep.total_calls / maxCalls) * 100;
                    return (
                      <tr key={`${ep.method}-${ep.path}`} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[11px] font-bold', METHOD_COLOR[ep.method] ?? 'bg-muted')}>
                            {ep.method}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-xs">{ep.path}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold">{fmtNum(ep.total_calls)}</td>
                        <td className={cn('px-4 py-2.5 text-right text-xs font-medium', responseColor(ep.avg_response_ms))}>
                          {Math.round(ep.avg_response_ms)} ms
                        </td>
                        <td className={cn('px-4 py-2.5 text-right text-xs', responseColor(ep.p95_response_ms))}>
                          {Math.round(ep.p95_response_ms)} ms
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={cn('text-xs font-medium', ep.error_rate > 5 ? 'text-rose-600' : ep.error_rate > 1 ? 'text-amber-600' : 'text-emerald-600')}>
                            {ep.error_rate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 w-32">
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* By tenant */}
      {tenants.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tenant bo'yicha API foydalanish (top 20)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Klinika</th>
                    <th className="px-4 py-2 text-right font-medium">So'rovlar</th>
                    <th className="px-4 py-2 text-right font-medium">Xatolar</th>
                    <th className="px-4 py-2 text-right font-medium">Rate limits</th>
                    <th className="px-4 py-2 text-left font-medium">Ulush</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tenants.slice(0, 20).map((t) => {
                    const total = o?.total_calls ?? 1;
                    const pct = (t.total_calls / total) * 100;
                    return (
                      <tr key={t.clinic_id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                              {(t.clinic_name ?? '??').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-xs font-medium">{t.clinic_name ?? t.clinic_id}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold">{fmtNum(t.total_calls)}</td>
                        <td className="px-4 py-2.5 text-right text-xs">
                          {t.error_calls > 0 ? <span className="text-rose-600 font-medium">{t.error_calls}</span> : <span className="text-muted-foreground">0</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs">
                          {t.rate_limit_hits > 0 ? <span className="text-amber-600 font-medium">{t.rate_limit_hits}</span> : <span className="text-muted-foreground">0</span>}
                        </td>
                        <td className="px-4 py-2.5 w-36">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-8 text-right text-[11px] text-muted-foreground">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
