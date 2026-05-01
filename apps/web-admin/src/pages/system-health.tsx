import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@clary/ui-web';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Database,
  Users,
  Building2,
  MessageCircle,
  Star,
  CalendarCheck,
  Clock,
} from 'lucide-react';

import { api } from '@/lib/api';

interface HealthCheck {
  status: 'ok' | 'warn' | 'error';
  latency_ms?: number;
  detail?: string;
}

interface SystemHealth {
  timestamp: string;
  uptime_check: 'ok' | 'slow';
  checks: Record<string, HealthCheck>;
  counts: {
    active_clinics: number;
    portal_users: number;
    open_tickets: number;
    live_reviews: number;
    active_bookings: number;
    audit_events_1h: number;
  };
}

function StatusIcon({ status }: { status: 'ok' | 'warn' | 'error' }) {
  if (status === 'ok') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === 'warn') return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function StatusBadge({ status }: { status: 'ok' | 'warn' | 'error' }) {
  const colors = {
    ok: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-100 text-amber-700 border-amber-200',
    error: 'bg-red-100 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

const COUNT_CARDS = [
  { key: 'active_clinics',  label: 'Faol klinikalar',  icon: Building2,     color: 'text-blue-600' },
  { key: 'portal_users',    label: 'Portal foydalanuvchilari', icon: Users, color: 'text-violet-600' },
  { key: 'open_tickets',    label: "Ochiq so'rovlar",  icon: MessageCircle, color: 'text-amber-600' },
  { key: 'live_reviews',    label: "Ko'rinadigan izohlar", icon: Star,      color: 'text-orange-500' },
  { key: 'active_bookings', label: 'Faol bronlar',     icon: CalendarCheck, color: 'text-emerald-600' },
  { key: 'audit_events_1h', label: 'Audit (1 soat)',   icon: Clock,         color: 'text-slate-600' },
] as const;

export function SystemHealthPage() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery<SystemHealth>({
    queryKey: ['system-health'],
    queryFn: () => api.get('/api/v1/admin/system/health'),
    refetchInterval: 60_000,
  });

  const overall = data
    ? Object.values(data.checks).some((c) => c.status === 'error')
      ? 'error'
      : Object.values(data.checks).some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok'
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tizim holati</h1>
          <p className="text-sm text-muted-foreground">
            {dataUpdatedAt
              ? `Yangilangan: ${new Date(dataUpdatedAt).toLocaleTimeString()}`
              : 'Yuklanmoqda...'}
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <>
          {/* Overall status */}
          {overall && (
            <div className={`rounded-2xl border p-5 flex items-center gap-4 ${
              overall === 'ok'
                ? 'border-emerald-200 bg-emerald-50/40'
                : overall === 'warn'
                ? 'border-amber-200 bg-amber-50/40'
                : 'border-red-200 bg-red-50/40'
            }`}>
              <StatusIcon status={overall} />
              <div>
                <p className="font-semibold text-sm">
                  {overall === 'ok' ? 'Barcha tizimlar normal ishlayapti' : overall === 'warn' ? 'Ba\'zi ogohlantirishlar mavjud' : 'Muammolar aniqlandi'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Uptime: {data.uptime_check === 'ok' ? 'Normal' : 'Sekin'} · {data.timestamp.slice(0, 19).replace('T', ' ')} UTC
                </p>
              </div>
            </div>
          )}

          {/* Checks */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(data.checks).map(([name, check]) => (
              <Card key={name}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium capitalize">{name}</span>
                    </div>
                    <StatusBadge status={check.status} />
                  </div>
                  {check.latency_ms !== undefined && (
                    <p className="text-xs text-muted-foreground">Kechikish: {check.latency_ms} ms</p>
                  )}
                  {check.detail && (
                    <p className="text-xs text-red-600 mt-1 line-clamp-2">{check.detail}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Count metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COUNT_CARDS.map(({ key, label, icon: Icon, color }) => (
              <Card key={key}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>
                  <p className={`text-3xl font-bold mt-1 ${color}`}>
                    {(data.counts[key] ?? 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Activity className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">Ma'lumot yuklanmadi</p>
        </div>
      )}
    </div>
  );
}
