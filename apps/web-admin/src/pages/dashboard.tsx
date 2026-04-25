import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  CreditCard,
  DollarSign,
  MessageCircle,
  Pill,
  Stethoscope,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
} from '@clary/ui-web';

import { api } from '@/lib/api';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.admin.overview(),
  });

  const t = data?.totals;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
        <p className="text-sm text-muted-foreground">
          Platformadagi barcha klinikalar uchun umumiy nazorat paneli
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
        <StatCard
          label="Klinikalar"
          value={isLoading ? '—' : fmt(t?.tenants ?? 0)}
          hint={`${fmt(t?.active_tenants ?? 0)} faol`}
          icon={<Building2 className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Shifokorlar"
          value={isLoading ? '—' : fmt(t?.doctors ?? 0)}
          icon={<Stethoscope className="h-4 w-4" />}
        />
        <StatCard
          label="Dorixonalar"
          value={isLoading ? '—' : fmt(t?.medications ?? 0)}
          hint="Nomenklatura yozuvlari"
          icon={<Pill className="h-4 w-4" />}
        />
        <StatCard
          label="Obuna"
          value={isLoading ? '—' : fmt(t?.active_subscriptions ?? 0)}
          hint={`${fmt(t?.trial_subscriptions ?? 0)} demo`}
          icon={<CreditCard className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Tushum (USD)"
          value={isLoading ? '—' : `$${fmt(Math.round(t?.total_revenue_usd ?? 0))}`}
          hint="Jami to‘langan hisob-fakturalar"
          icon={<DollarSign className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="30 kun aylanma"
          value={isLoading ? '—' : `${fmt(t?.last_30d_uzs ?? 0)} so‘m`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Qarzdorlik"
          value={isLoading ? '—' : `${fmt(t?.debt_uzs ?? 0)} so‘m`}
          icon={<Wallet className="h-4 w-4" />}
          tone={(t?.debt_uzs ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Support"
          value={isLoading ? '—' : fmt(t?.open_tickets ?? 0)}
          hint="ochiq so‘rovlar"
          icon={<MessageCircle className="h-4 w-4" />}
          tone={(t?.open_tickets ?? 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> 30-kunlik tushum (UZS)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueSparkline data={data?.daily_revenue ?? []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yangi klinikalar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.recent_clinics ?? []).map((c) => (
              <Link
                key={c.id}
                to={`/tenants/${c.id}`}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm transition hover:bg-accent"
              >
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString('uz-UZ')}
                  </div>
                </div>
                {c.is_suspended ? (
                  <Badge variant="destructive">To‘xtatilgan</Badge>
                ) : (
                  <Badge variant="success">Faol</Badge>
                )}
              </Link>
            ))}
            {(data?.recent_clinics ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Klinikalar yo‘q</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RevenueSparkline({ data }: { data: Array<{ day: string; amount_uzs: number }> }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Ma'lumot yo‘q</p>;
  }
  const max = Math.max(...data.map((d) => d.amount_uzs));
  const w = 720;
  const h = 200;
  const step = data.length > 1 ? w / (data.length - 1) : w;

  const points = data
    .map((d, i) => {
      const x = i * step;
      const y = h - (max === 0 ? h / 2 : (d.amount_uzs / max) * (h - 30)) - 10;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full">
        <defs>
          <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" className="text-primary" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-primary" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#rev)" />
        <polyline
          points={points}
          fill="none"
          strokeWidth={2}
          className="stroke-primary"
        />
        {data.map((d, i) => (
          <circle
            key={d.day}
            cx={i * step}
            cy={h - (max === 0 ? h / 2 : (d.amount_uzs / max) * (h - 30)) - 10}
            r={2}
            className="fill-primary"
          />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}
