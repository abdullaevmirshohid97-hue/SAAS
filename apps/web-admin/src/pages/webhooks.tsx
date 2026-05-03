import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Webhook,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Zap,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  StatCard,
  cn,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Delivery = {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  http_status: number | null;
  response_body: string | null;
  response_time_ms: number | null;
  attempt_count: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
  endpoint: {
    id: string;
    url: string;
    clinic_id: string;
    clinic_name: string | null;
    events: string[];
    is_active: boolean;
  } | null;
};

type WebhooksResponse = {
  deliveries: Delivery[];
  stats: {
    total: number;
    success: number;
    failed: number;
    retrying: number;
    avg_response_ms: number;
  };
  endpoints: Array<{
    id: string;
    url: string;
    clinic_name: string | null;
    is_active: boolean;
    success_rate: number;
    total_deliveries: number;
  }>;
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  success:  { label: 'Muvaffaq',  color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  failed:   { label: 'Xato',      color: 'text-rose-700 bg-rose-50 border-rose-200',           icon: XCircle },
  retrying: { label: 'Qayta',     color: 'text-amber-700 bg-amber-50 border-amber-200',        icon: RotateCcw },
  pending:  { label: 'Navbatda',  color: 'text-slate-600 bg-slate-50 border-slate-200',        icon: Clock },
};

function fmt(d: string) {
  return new Date(d).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' });
}

function truncateUrl(url: string, max = 50) {
  return url.length > max ? `${url.slice(0, max)}…` : url;
}

export function WebhooksPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [days, setDays] = useState(3);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'webhooks', statusFilter, days],
    queryFn: () => {
      const p = new URLSearchParams({ days: String(days) });
      if (statusFilter) p.set('status', statusFilter);
      return api.get<WebhooksResponse>(`/api/v1/admin/webhooks/deliveries?${p}`);
    },
    refetchInterval: 30_000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/admin/webhooks/deliveries/${id}/retry`, {}),
    onSuccess: () => {
      toast.success('Webhook qayta yuborishga navbatga qo\'shildi');
      qc.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deliveries = (data?.deliveries ?? []).filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.event_type.toLowerCase().includes(q) ||
      (d.endpoint?.url ?? '').toLowerCase().includes(q) ||
      (d.endpoint?.clinic_name ?? '').toLowerCase().includes(q)
    );
  });

  const s = data?.stats;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-orange-50 via-background to-amber-50 p-6 dark:from-orange-950/30 dark:to-amber-950/30">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gradient-to-br from-orange-400/20 to-amber-400/20 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-orange-600" />
              <h1 className="text-2xl font-semibold tracking-tight">Webhook yetkazib berish</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Barcha klinikalar webhook endpointlari va yetkazib berish tarixi. Muvaffaqiyatsiz webhook'larni qayta yuboring.
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Jami" value={isLoading ? '…' : String(s?.total ?? 0)} icon={<Zap className="h-4 w-4" />} />
        <StatCard label="Muvaffaq" value={isLoading ? '…' : String(s?.success ?? 0)} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
        <StatCard label="Xato" value={isLoading ? '…' : String(s?.failed ?? 0)} icon={<XCircle className="h-4 w-4" />} tone={(s?.failed ?? 0) > 0 ? 'danger' : undefined} />
        <StatCard label="Qayta urinish" value={isLoading ? '…' : String(s?.retrying ?? 0)} icon={<RotateCcw className="h-4 w-4" />} tone={(s?.retrying ?? 0) > 0 ? 'warning' : undefined} />
        <StatCard label="O'rt. javob" value={isLoading ? '…' : s?.avg_response_ms ? `${Math.round(s.avg_response_ms)} ms` : '—'} icon={<Activity className="h-4 w-4" />} />
      </div>

      {/* Endpoints summary */}
      {(data?.endpoints ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Endpoint'lar ({data!.endpoints.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data!.endpoints.map((ep) => (
                <div key={ep.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className={cn('h-2 w-2 rounded-full shrink-0', ep.is_active ? 'bg-emerald-500' : 'bg-slate-300')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs font-medium">{truncateUrl(ep.url)}</span>
                      <a href={ep.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </a>
                    </div>
                    <div className="text-xs text-muted-foreground">{ep.clinic_name ?? 'Klinika yo\'q'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn('text-sm font-semibold', ep.success_rate > 90 ? 'text-emerald-600' : ep.success_rate > 70 ? 'text-amber-600' : 'text-rose-600')}>
                      {ep.success_rate.toFixed(0)}%
                    </div>
                    <div className="text-xs text-muted-foreground">{ep.total_deliveries} ta</div>
                  </div>
                  <div className="h-8 w-20 shrink-0">
                    <div className="h-2 overflow-hidden rounded-full bg-muted mt-3">
                      <div
                        className={cn('h-full rounded-full', ep.success_rate > 90 ? 'bg-emerald-400' : ep.success_rate > 70 ? 'bg-amber-400' : 'bg-rose-400')}
                        style={{ width: `${ep.success_rate}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters + table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">
            Yetkazib berish tarixi ({deliveries.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Days filter */}
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              {[1, 3, 7].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d}k
                </button>
              ))}
            </div>
            {/* Status filter */}
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              {['', 'success', 'failed', 'retrying'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    statusFilter === st ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {st ? (STATUS_META[st]?.label ?? st) : 'Barchasi'}
                </button>
              ))}
            </div>
            <Input
              placeholder="Qidirish..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-44 text-xs"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-4 px-4 py-2" />
                  <th className="px-4 py-2 text-left font-medium">Vaqt</th>
                  <th className="px-4 py-2 text-left font-medium">Hodisa</th>
                  <th className="px-4 py-2 text-left font-medium">Endpoint</th>
                  <th className="px-4 py-2 text-left font-medium">Klinika</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Javob vaqti</th>
                  <th className="px-4 py-2 text-right font-medium">Urinish</th>
                  <th className="px-4 py-2 text-right font-medium">Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={9} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted/50" />
                      </td>
                    </tr>
                  ))
                ) : deliveries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center text-sm text-muted-foreground">
                      <Webhook className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      <p>Webhook yetkazib berish tarixi yo'q</p>
                    </td>
                  </tr>
                ) : (
                  deliveries.map((d) => {
                    const stMeta = STATUS_META[d.status] ?? STATUS_META.pending!;
                    const StIcon = stMeta.icon;
                    const isExp = expanded === d.id;

                    return (
                      <>
                        <tr
                          key={d.id}
                          className="hover:bg-muted/30 cursor-pointer"
                          onClick={() => setExpanded(isExp ? null : d.id)}
                        >
                          <td className="px-4 py-3">
                            {isExp ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {fmt(d.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{d.event_type}</span>
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <span className="truncate font-mono text-xs block">{truncateUrl(d.endpoint?.url ?? '—', 40)}</span>
                          </td>
                          <td className="px-4 py-3 text-xs">{d.endpoint?.clinic_name ?? '—'}</td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium', stMeta.color)}>
                              <StIcon className="h-3 w-3" />
                              {d.http_status ? `${d.http_status} ` : ''}{stMeta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs">
                            {d.response_time_ms != null ? (
                              <span className={cn(d.response_time_ms > 2000 ? 'text-rose-600' : d.response_time_ms > 500 ? 'text-amber-600' : 'text-emerald-600')}>
                                {d.response_time_ms} ms
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-xs">
                            {d.attempt_count > 1 ? (
                              <span className="text-amber-600 font-medium">{d.attempt_count}×</span>
                            ) : '1×'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(d.status === 'failed' || d.status === 'retrying') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); retryMutation.mutate(d.id); }}
                                disabled={retryMutation.isPending}
                                className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                              >
                                <RotateCcw className="h-3 w-3" /> Retry
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExp && (
                          <tr key={`${d.id}-exp`} className="bg-muted/20">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="grid gap-3 text-xs sm:grid-cols-2">
                                <div>
                                  <p className="font-medium text-muted-foreground mb-1">Payload</p>
                                  <pre className="whitespace-pre-wrap rounded bg-background border p-2 font-mono overflow-x-auto max-h-48 text-[11px]">
                                    {JSON.stringify(d.payload, null, 2)}
                                  </pre>
                                </div>
                                {d.response_body && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-1">Response</p>
                                    <pre className="whitespace-pre-wrap rounded bg-background border p-2 font-mono overflow-x-auto max-h-48 text-[11px]">
                                      {d.response_body}
                                    </pre>
                                  </div>
                                )}
                                {d.next_retry_at && d.status === 'retrying' && (
                                  <div>
                                    <p className="font-medium text-amber-600 mb-1">Keyingi urinish</p>
                                    <p>{fmt(d.next_retry_at)}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
