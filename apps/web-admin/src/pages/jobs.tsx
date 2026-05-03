import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cpu,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Pause,
  Trash2,
  RotateCcw,
  Loader2,
  Activity,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  StatCard,
  cn,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type QueueStat = {
  name: string;
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
};

type JobItem = {
  id: string;
  queue: string;
  name: string;
  status: 'active' | 'waiting' | 'completed' | 'failed' | 'delayed';
  progress: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  data: Record<string, unknown>;
  created_at: string;
  processed_at: string | null;
  finished_at: string | null;
  delay_until: string | null;
};

type JobsResponse = {
  queues: QueueStat[];
  recent_jobs: JobItem[];
  failed_jobs: JobItem[];
  workers: Array<{ id: string; queue: string; status: 'idle' | 'busy'; current_job: string | null }>;
  stats: {
    total_active: number;
    total_waiting: number;
    total_failed: number;
    total_completed_24h: number;
  };
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active:    { label: 'Ishlamoqda', color: 'text-sky-700 bg-sky-50 border-sky-200',           icon: Loader2 },
  waiting:   { label: 'Navbatda',   color: 'text-amber-700 bg-amber-50 border-amber-200',     icon: Clock },
  completed: { label: 'Bajarildi',  color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  failed:    { label: 'Xato',       color: 'text-rose-700 bg-rose-50 border-rose-200',         icon: XCircle },
  delayed:   { label: 'Kechiktirildi', color: 'text-slate-600 bg-slate-50 border-slate-200',  icon: Clock },
};

function fmt(d: string) {
  return new Date(d).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' });
}

export function JobsPage() {
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: () => api.get<JobsResponse>('/api/v1/admin/jobs'),
    refetchInterval: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: ({ queue, id }: { queue: string; id: string }) =>
      api.post(`/api/v1/admin/jobs/${queue}/${id}/retry`, {}),
    onSuccess: () => {
      toast.success('Job qayta ishga tushirildi');
      qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ queue, id }: { queue: string; id: string }) =>
      api.delete(`/api/v1/admin/jobs/${queue}/${id}`),
    onSuccess: () => {
      toast.success('Job o\'chirildi');
      qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = data?.stats;
  const queues = data?.queues ?? [];
  const failedJobs = data?.failed_jobs ?? [];
  const recentJobs = data?.recent_jobs ?? [];
  const workers = data?.workers ?? [];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-purple-50 via-background to-indigo-50 p-6 dark:from-purple-950/30 dark:to-indigo-950/30">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gradient-to-br from-purple-400/20 to-indigo-400/20 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-purple-600" />
              <h1 className="text-2xl font-semibold tracking-tight">Background jobs</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              BullMQ navbatlari holati, worker'lar va muvaffaqiyatsiz job'larni boshqarish.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-muted-foreground">Live (10s)</span>
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Faol job"
          value={isLoading ? '…' : String(s?.total_active ?? 0)}
          icon={<Activity className="h-4 w-4" />}
          tone={(s?.total_active ?? 0) > 0 ? 'info' : undefined}
        />
        <StatCard
          label="Navbatda"
          value={isLoading ? '…' : String(s?.total_waiting ?? 0)}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Muvaffaqiyatsiz"
          value={isLoading ? '…' : String(s?.total_failed ?? 0)}
          icon={<XCircle className="h-4 w-4" />}
          tone={(s?.total_failed ?? 0) > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Bajarildi (24h)"
          value={isLoading ? '…' : String(s?.total_completed_24h ?? 0)}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
        />
      </div>

      {/* Queue overview */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="space-y-2 animate-pulse">
                    <div className="h-4 w-32 rounded bg-muted/50" />
                    <div className="h-8 w-full rounded bg-muted/30" />
                  </div>
                </CardContent>
              </Card>
            ))
          : queues.map((q) => {
              const total = q.active + q.waiting + q.failed + q.delayed;
              return (
                <Card key={q.name} className={cn(q.failed > 0 && 'border-rose-200 dark:border-rose-900')}>
                  <CardHeader className="pb-2 pt-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">{q.name}</CardTitle>
                      <div className="flex items-center gap-1.5">
                        {q.paused && (
                          <span className="flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            <Pause className="h-2.5 w-2.5" /> Paused
                          </span>
                        )}
                        <div className={cn('h-2 w-2 rounded-full', q.active > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300')} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div className="grid grid-cols-4 gap-1 text-center">
                      {[
                        { label: 'Faol', value: q.active, color: 'text-sky-600' },
                        { label: 'Navbat', value: q.waiting, color: 'text-amber-600' },
                        { label: 'Xato', value: q.failed, color: q.failed > 0 ? 'text-rose-600' : 'text-muted-foreground' },
                        { label: "Kech'd", value: q.delayed, color: 'text-slate-500' },
                      ].map((item) => (
                        <div key={item.label} className="rounded bg-muted/30 px-1 py-2">
                          <div className={cn('text-lg font-bold tabular-nums leading-none', item.color)}>
                            {item.value}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{item.label}</div>
                        </div>
                      ))}
                    </div>
                    {total === 0 && !q.paused && (
                      <p className="mt-2 text-center text-xs text-muted-foreground">Navbat bo'sh ✓</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* Workers */}
      {workers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Worker'lar ({workers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {workers.map((w) => (
                <div key={w.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', w.status === 'busy' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300')} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-medium truncate">{w.queue}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {w.status === 'busy' && w.current_job ? `Job: ${w.current_job}` : 'Bo\'sh'}
                    </div>
                  </div>
                  <Badge variant={w.status === 'busy' ? 'success' : 'secondary'} className="text-[10px] shrink-0">
                    {w.status === 'busy' ? 'Ishlamoqda' : 'Tayyor'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Failed jobs */}
      {failedJobs.length > 0 && (
        <Card className="border-rose-200 dark:border-rose-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <CardTitle className="text-base text-rose-700 dark:text-rose-400">
                  Muvaffaqiyatsiz job'lar ({failedJobs.length})
                </CardTitle>
              </div>
              {failedJobs.length > 0 && (
                <button
                  onClick={() => {
                    failedJobs.forEach((j) => retryMutation.mutate({ queue: j.queue, id: j.id }));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Hammasini qayta
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-rose-50/50 text-xs uppercase tracking-wide text-muted-foreground dark:bg-rose-950/20">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Vaqt</th>
                    <th className="px-4 py-2 text-left font-medium">Navbat</th>
                    <th className="px-4 py-2 text-left font-medium">Job nomi</th>
                    <th className="px-4 py-2 text-right font-medium">Urinishlar</th>
                    <th className="px-4 py-2 text-left font-medium">Xato</th>
                    <th className="px-4 py-2 text-right font-medium">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {failedJobs.map((j) => (
                    <tr key={j.id} className="hover:bg-rose-50/30 dark:hover:bg-rose-950/10">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmt(j.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{j.queue}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{j.name}</td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="text-rose-600 font-medium">{j.attempts}/{j.max_attempts}</span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="truncate text-xs text-rose-600 font-mono">{j.error ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => retryMutation.mutate({ queue: j.queue, id: j.id })}
                            disabled={retryMutation.isPending}
                            className="rounded border bg-card p-1.5 hover:bg-accent disabled:opacity-50"
                            title="Qayta urinish"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate({ queue: j.queue, id: j.id })}
                            disabled={deleteMutation.isPending}
                            className="rounded border bg-card p-1.5 hover:bg-rose-50 text-rose-600 disabled:opacity-50"
                            title="O'chirish"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent jobs */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">So'nggi job'lar</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Vaqt</th>
                  <th className="px-4 py-2 text-left font-medium">Navbat</th>
                  <th className="px-4 py-2 text-left font-medium">Job nomi</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Progress</th>
                  <th className="px-4 py-2 text-right font-medium">Davomiyligi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted/50" />
                      </td>
                    </tr>
                  ))
                ) : recentJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">
                      <Cpu className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      <p>Hali job bajarilmagan</p>
                    </td>
                  </tr>
                ) : (
                  recentJobs.map((j) => {
                    const stMeta = STATUS_META[j.status] ?? STATUS_META.waiting!;
                    const StIcon = stMeta.icon;
                    const duration =
                      j.finished_at && j.processed_at
                        ? Math.round((new Date(j.finished_at).getTime() - new Date(j.processed_at).getTime()) / 1000)
                        : null;
                    return (
                      <tr key={j.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {fmt(j.created_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{j.queue}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{j.name}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium', stMeta.color)}>
                            <StIcon className={cn('h-3 w-3', j.status === 'active' && 'animate-spin')} />
                            {stMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {j.status === 'active' ? (
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-sky-400 transition-all"
                                  style={{ width: `${j.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-sky-600 font-medium w-8 text-right">{j.progress}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                          {duration !== null ? `${duration}s` : '—'}
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
    </div>
  );
}
