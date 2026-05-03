import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Mail,
  MessageSquare,
  Send,
  XCircle,
  Clock,
  RefreshCw,
  Download,
  Filter,
  CheckCircle2,
  AlertCircle,
  Smartphone,
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

type NotifItem = {
  id: string;
  clinic_id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  status: string;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
  clinic: { id: string; name: string } | null;
};

type LogResponse = {
  items: NotifItem[];
  stats: { total: number; sent: number; failed: number; queued: number };
};

const CHANNEL_META: Record<string, { label: string; icon: typeof Mail; color: string }> = {
  sms:    { label: 'SMS',      icon: Smartphone,    color: 'text-violet-600 bg-violet-50 border-violet-200' },
  email:  { label: 'Email',    icon: Mail,          color: 'text-sky-600 bg-sky-50 border-sky-200' },
  push:   { label: 'Push',     icon: Smartphone,    color: 'text-amber-600 bg-amber-50 border-amber-200' },
  telegram: { label: 'Telegram', icon: Send,        color: 'text-blue-600 bg-blue-50 border-blue-200' },
  in_app: { label: 'In-app',   icon: Bell,          color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  sent:    { label: 'Yuborildi', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  failed:  { label: 'Xato',     color: 'text-rose-700 bg-rose-50 border-rose-200',           icon: XCircle },
  pending: { label: 'Navbatda', color: 'text-amber-700 bg-amber-50 border-amber-200',        icon: Clock },
  queued:  { label: 'Navbatda', color: 'text-amber-700 bg-amber-50 border-amber-200',        icon: Clock },
};

const DAYS_OPTIONS = [
  { label: 'Bugun', value: 1 },
  { label: '3 kun', value: 3 },
  { label: '7 kun', value: 7 },
  { label: '30 kun', value: 30 },
];

function fmt(d: string) {
  return new Date(d).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' });
}

function exportCsv(items: NotifItem[]) {
  const header = ['Vaqt', 'Kanal', 'Klinika', 'Qabul qiluvchi', 'Mavzu', 'Status', 'Xato'];
  const rows = items.map((r) => [
    fmt(r.created_at),
    r.channel,
    r.clinic?.name ?? r.clinic_id,
    r.recipient,
    r.subject ?? '',
    r.status,
    r.error_message ?? '',
  ]);
  const csv = [header, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `notifications-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function NotificationsLogPage() {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [days, setDays] = useState(7);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'notifications-log', channel, status, days],
    queryFn: () => {
      const params = new URLSearchParams();
      if (channel) params.set('channel', channel);
      if (status) params.set('status', status);
      params.set('days', String(days));
      return api.get<LogResponse>(`/api/v1/admin/notifications/log?${params}`);
    },
    refetchInterval: 30_000,
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/admin/notifications/${id}/resend`, {}),
    onSuccess: () => {
      toast.success('Qayta yuborish navbatga qo\'shildi');
      qc.invalidateQueries({ queryKey: ['admin', 'notifications-log'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = (data?.items ?? []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.recipient.toLowerCase().includes(q) ||
      (r.clinic?.name ?? '').toLowerCase().includes(q) ||
      (r.subject ?? '').toLowerCase().includes(q) ||
      r.body.toLowerCase().includes(q)
    );
  });

  const s = data?.stats;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-50 via-background to-sky-50 p-6 dark:from-violet-950/30 dark:to-sky-950/30">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gradient-to-br from-violet-400/20 to-sky-400/20 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-violet-600" />
              <h1 className="text-2xl font-semibold tracking-tight">Xabarlar jurnali</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Barcha klinikalar yuborgan SMS, email, push va Telegram xabarlari. Real-vaqt monitoring.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCsv(items)}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
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
        <StatCard label="Jami" value={isLoading ? '…' : String(s?.total ?? 0)} icon={<MessageSquare className="h-4 w-4" />} />
        <StatCard label="Yuborildi" value={isLoading ? '…' : String(s?.sent ?? 0)} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
        <StatCard label="Xato" value={isLoading ? '…' : String(s?.failed ?? 0)} icon={<XCircle className="h-4 w-4" />} tone={(s?.failed ?? 0) > 0 ? 'danger' : undefined} />
        <StatCard label="Navbatda" value={isLoading ? '…' : String(s?.queued ?? 0)} icon={<Clock className="h-4 w-4" />} tone="warning" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

          {/* Days */}
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => setDays(d.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  days === d.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Channel */}
          <div className="flex flex-wrap gap-1.5">
            {['', 'sms', 'email', 'push', 'telegram', 'in_app'].map((ch) => {
              const meta = ch ? CHANNEL_META[ch] : null;
              return (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={cn(
                    'rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                    channel === ch
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-accent text-muted-foreground',
                  )}
                >
                  {meta ? meta.label : 'Barchasi'}
                </button>
              );
            })}
          </div>

          {/* Status */}
          <div className="flex flex-wrap gap-1.5">
            {['', 'sent', 'failed', 'pending'].map((st) => (
              <button
                key={st}
                onClick={() => setStatus(st)}
                className={cn(
                  'rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                  status === st
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'hover:bg-accent text-muted-foreground',
                )}
              >
                {st ? (STATUS_META[st]?.label ?? st) : 'Barcha status'}
              </button>
            ))}
          </div>

          <div className="ml-auto w-60">
            <Input
              placeholder="Qidirish..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Xabarlar ({items.length}{data && items.length !== data.items.length ? ` / ${data.items.length}` : ''})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Vaqt</th>
                  <th className="px-4 py-2 text-left font-medium">Kanal</th>
                  <th className="px-4 py-2 text-left font-medium">Klinika</th>
                  <th className="px-4 py-2 text-left font-medium">Qabul qiluvchi</th>
                  <th className="px-4 py-2 text-left font-medium">Mavzu / Matn</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={7} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted/50" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-sm text-muted-foreground">
                      <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      <p>Xabarlar topilmadi</p>
                    </td>
                  </tr>
                ) : (
                  items.map((r) => {
                    const chMeta = CHANNEL_META[r.channel] ?? CHANNEL_META.in_app!;
                    const stMeta = STATUS_META[r.status] ?? STATUS_META.pending!;
                    const Icon = chMeta.icon;
                    const StIcon = stMeta.icon;
                    const isExpanded = expanded === r.id;

                    return (
                      <>
                        <tr
                          key={r.id}
                          className="hover:bg-muted/30 cursor-pointer"
                          onClick={() => setExpanded(isExpanded ? null : r.id)}
                        >
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {fmt(r.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium', chMeta.color)}>
                              <Icon className="h-3 w-3" />
                              {chMeta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs font-medium">
                            {r.clinic?.name ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono">{r.recipient}</td>
                          <td className="px-4 py-3 max-w-xs">
                            {r.subject && <div className="truncate font-medium text-xs">{r.subject}</div>}
                            <div className="truncate text-xs text-muted-foreground">{r.body}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium', stMeta.color)}>
                              <StIcon className="h-3 w-3" />
                              {stMeta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {r.status === 'failed' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); resendMutation.mutate(r.id); }}
                                disabled={resendMutation.isPending}
                                className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                              >
                                <RefreshCw className="h-3 w-3" /> Qayta
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${r.id}-expanded`} className="bg-muted/20">
                            <td colSpan={7} className="px-4 py-3">
                              <div className="grid gap-3 text-xs sm:grid-cols-2">
                                <div>
                                  <p className="font-medium text-muted-foreground mb-1">Xabar matni</p>
                                  <p className="whitespace-pre-wrap rounded bg-background p-2 border text-foreground">{r.body}</p>
                                </div>
                                {r.error_message && (
                                  <div>
                                    <p className="font-medium text-rose-600 mb-1">Xato sababi</p>
                                    <p className="whitespace-pre-wrap rounded bg-rose-50 border border-rose-200 p-2 text-rose-700 font-mono">{r.error_message}</p>
                                  </div>
                                )}
                                {r.sent_at && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-1">Yuborilgan vaqt</p>
                                    <p>{fmt(r.sent_at)}</p>
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
