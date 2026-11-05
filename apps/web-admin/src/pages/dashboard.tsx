import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Hourglass,
  Lock,
  Send,
  TrendingUp,
} from 'lucide-react';
import type { AdminOverviewClinic } from '@clary/api-client';
import { Badge, Card, CardContent, CardHeader, CardTitle, StatCard, cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import { fmtDate, fmtUzs, planLabel, relDays, statusMeta } from '@/lib/clinic-status';

// =============================================================================
// Bosh sahifa — platforma egasi uchun: pul (MRR, invoyslar), obunalar holati
// va BUGUN e'tibor talab qiladigan klinikalar (sinovi tugayapti, bloklangan,
// to'lovi kechikkan). Demo (lidlar uchun vaqtinchalik) klinikalar hisobga kirmaydi.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

const STATUS_ORDER: Array<{ key: string; color: string }> = [
  { key: 'active', color: 'bg-emerald-500' },
  { key: 'trialing', color: 'bg-sky-500' },
  { key: 'past_due', color: 'bg-amber-500' },
  { key: 'unpaid', color: 'bg-rose-500' },
  { key: 'canceled', color: 'bg-rose-300' },
  { key: 'suspended', color: 'bg-slate-500' },
];

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.admin.overview(),
    refetchInterval: 120_000,
  });

  const t = data?.totals;
  const v = (n: number | undefined, f: (x: number) => string = fmt) =>
    isLoading || n === undefined ? '—' : f(n);
  const attention = data?.attention;
  const attentionCount =
    (attention?.trial_expiring.length ?? 0) +
    (attention?.blocked.length ?? 0) +
    (attention?.past_due.length ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bosh sahifa</h1>
          <p className="text-muted-foreground text-sm">
            {new Date().toLocaleDateString('uz-UZ', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}{' '}
            · obunalar, tushum va e'tibor talab qiladigan klinikalar
          </p>
        </div>
        {!isLoading && (
          <Badge variant={attentionCount > 0 ? 'warning' : 'success'} className="gap-1">
            {attentionCount > 0 ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5" /> {attentionCount} ta klinika e'tibor
                kutmoqda
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Hammasi joyida
              </>
            )}
          </Badge>
        )}
      </div>

      {/* Asosiy ko'rsatkichlar */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Oylik obuna tushumi (MRR)"
          value={v(t?.mrr_uzs, fmtUzs)}
          hint={`${v(t?.active_paying)} ta to‘layotgan klinika`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Klinikalar"
          value={v(t?.tenants)}
          hint={`${v(t?.demo_live)} ta demo hozir ochiq`}
          icon={<Building2 className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Sinovda"
          value={v(t?.trialing)}
          hint={`${attention?.trial_expiring.length ?? 0} tasi 7 kunda tugaydi`}
          icon={<Hourglass className="h-4 w-4" />}
          tone={(attention?.trial_expiring.length ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Bloklangan"
          value={v(t?.blocked)}
          hint="Obuna tugagan — ilovaga kira olmaydi"
          icon={<Lock className="h-4 w-4" />}
          tone={(t?.blocked ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          to="/subscriptions"
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          label="To‘lovi kechikkan"
          value={v(t?.past_due)}
        />
        <MiniStat
          to="/leads"
          icon={<Send className="h-4 w-4 text-sky-600" />}
          label="Yangi lidlar"
          value={v(t?.new_leads)}
        />
        <MiniStat
          to="/billing-docs"
          icon={<FileText className="h-4 w-4 text-emerald-600" />}
          label="Bu oy to‘langan invoyslar"
          value={v(t?.invoices_paid_month_uzs, fmtUzs)}
        />
        <MiniStat
          to="/billing-docs"
          icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
          label={`Muddati o‘tgan invoyslar (${t?.invoices_overdue_count ?? 0})`}
          value={v(t?.invoices_overdue_uzs, fmtUzs)}
        />
      </div>

      {/* Obunalar taqsimoti */}
      {data && t && t.tenants > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="text-sm font-medium">Obunalar holati</div>
            <div className="flex h-3 overflow-hidden rounded-full">
              {STATUS_ORDER.map((s) => {
                const n = data.by_status[s.key] ?? 0;
                return n > 0 ? (
                  <div
                    key={s.key}
                    className={s.color}
                    style={{ width: `${(n / t.tenants) * 100}%` }}
                    title={`${statusMeta(s.key).label}: ${n}`}
                  />
                ) : null;
              })}
            </div>
            <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {STATUS_ORDER.filter((s) => (data.by_status[s.key] ?? 0) > 0).map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', s.color)} />
                  {statusMeta(s.key).label}:{' '}
                  <b className="text-foreground">{data.by_status[s.key]}</b>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* E'tibor talab qiladi */}
      <div className="grid gap-4 lg:grid-cols-3">
        <AttentionList
          title="Sinovi tugayapti"
          hint="7 kun ichida — obunaga o‘tishga yordam bering"
          rows={attention?.trial_expiring}
          loading={isLoading}
          tone="info"
        />
        <AttentionList
          title="Obunasi tugagan"
          hint="Bloklangan — to‘lov kelsa obunani uzaytiring"
          rows={attention?.blocked}
          loading={isLoading}
          tone="danger"
          more={(t?.blocked ?? 0) - (attention?.blocked.length ?? 0)}
        />
        <AttentionList
          title="To‘lovi kechikkan"
          hint="Imtiyozli muddatda — tugasa bloklanadi"
          rows={attention?.past_due}
          loading={isLoading}
          tone="warning"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> Klinikalar aylanmasi (30 kun)
            </CardTitle>
            <span className="text-muted-foreground text-sm">
              {v(t?.clinics_turnover_30d_uzs, fmtUzs)}
            </span>
          </CardHeader>
          <CardContent>
            <RevenueSparkline data={data?.daily_revenue ?? []} />
            <p className="text-muted-foreground mt-2 text-xs">
              Klinikalarning bemorlardan olgan tushumi (kassa asosida) — platforma faolligi
              ko‘rsatkichi.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yangi klinikalar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(data?.recent_clinics ?? []).map((c) => {
              const st = statusMeta(c.status);
              return (
                <Link
                  key={c.id}
                  to={`/tenants/${c.id}`}
                  className="hover:bg-accent flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {fmtDate(c.date)} · {planLabel(c.plan)}
                    </div>
                  </div>
                  <Badge variant={st.tone}>{st.label}</Badge>
                </Link>
              );
            })}
            {!isLoading && (data?.recent_clinics ?? []).length === 0 && (
              <p className="text-muted-foreground text-sm">Klinikalar yo‘q</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({
  to,
  icon,
  label,
  value,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Link
      to={to}
      className="bg-card hover:bg-accent/50 flex items-center gap-3 rounded-xl border p-3 transition"
    >
      <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground truncate text-xs">{label}</div>
        <div className="truncate font-semibold">{value}</div>
      </div>
    </Link>
  );
}

const TONE_BORDER = {
  info: 'border-t-sky-500',
  danger: 'border-t-rose-500',
  warning: 'border-t-amber-500',
} as const;

function AttentionList({
  title,
  hint,
  rows,
  loading,
  tone,
  more = 0,
}: {
  title: string;
  hint: string;
  rows: AdminOverviewClinic[] | undefined;
  loading: boolean;
  tone: keyof typeof TONE_BORDER;
  more?: number;
}) {
  return (
    <Card className={cn('border-t-4', TONE_BORDER[tone])}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          {title}
          <span className="text-muted-foreground text-sm font-normal">
            {loading ? '' : (rows?.length ?? 0) + (more > 0 ? more : 0)}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {loading && <p className="text-muted-foreground text-sm">Yuklanmoqda…</p>}
        {!loading && (rows ?? []).length === 0 && (
          <p className="text-muted-foreground flex items-center gap-1.5 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Hech kim yo‘q
          </p>
        )}
        {(rows ?? []).map((c) => (
          <Link
            key={c.id}
            to={`/tenants/${c.id}?tab=billing`}
            className="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {[planLabel(c.plan), c.city].filter((x) => x && x !== '—').join(' · ')}
              </span>
            </span>
            <span className="text-muted-foreground shrink-0 text-right text-xs">
              {fmtDate(c.date)}
              <span className="block">{relDays(c.date)}</span>
            </span>
          </Link>
        ))}
        {more > 0 && (
          <Link
            to="/subscriptions"
            className="text-primary block px-2 pt-1 text-xs hover:underline"
          >
            yana {more} ta →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function RevenueSparkline({ data }: { data: Array<{ day: string; amount_uzs: number }> }) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">Ma'lumot yo‘q</p>;
  }
  const max = Math.max(...data.map((d) => d.amount_uzs));
  const w = 720;
  const h = 200;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const y = (n: number) => h - (max === 0 ? h / 2 : (n / max) * (h - 30)) - 10;
  const points = data.map((d, i) => `${i * step},${y(d.amount_uzs)}`).join(' ');

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full">
        <defs>
          <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="currentColor"
              stopOpacity="0.35"
              className="text-primary"
            />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-primary" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#rev)" />
        <polyline points={points} fill="none" strokeWidth={2} className="stroke-primary" />
        {data.map((d, i) => (
          <circle key={d.day} cx={i * step} cy={y(d.amount_uzs)} r={2} className="fill-primary">
            <title>
              {d.day}: {fmt(d.amount_uzs)} so‘m
            </title>
          </circle>
        ))}
      </svg>
      <div className="text-muted-foreground mt-2 flex justify-between text-xs">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}
