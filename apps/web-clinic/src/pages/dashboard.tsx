import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Activity, Users, ListOrdered, Wallet, TrendingUp, TrendingDown,
  Sparkles, ArrowRight, Calendar, Stethoscope, Pill, AlertCircle,
} from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent, Badge, Button, cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import { OnboardingChecklist } from '@/components/onboarding-checklist';
import { WelcomeModal } from '@/components/welcome-modal';

function fmtUZS(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function pctDelta(today?: number, yesterday?: number): { value: number; up: boolean } | null {
  if (!today || !yesterday) return null;
  const d = ((today - yesterday) / yesterday) * 100;
  return { value: Math.abs(d), up: d >= 0 };
}

function KpiCard({
  title, value, sub, icon: Icon, accent, delta, to,
}: {
  title: string;
  value: React.ReactNode;
  sub?: string;
  icon: typeof Users;
  accent: 'blue' | 'emerald' | 'amber' | 'rose';
  delta?: { value: number; up: boolean } | null;
  to?: string;
}) {
  const tints: Record<string, string> = {
    blue:    'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber:   'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    rose:    'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  };
  const inner = (
    <Card className="card-hover relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
            <div className="mt-2 text-3xl font-bold tabular-nums">{value}</div>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
          </div>
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', tints[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {delta && (
          <div className={cn('mt-3 inline-flex items-center gap-1 text-xs font-medium', delta.up ? 'text-emerald-600' : 'text-rose-600')}>
            {delta.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta.value.toFixed(1)}% kechagi kunga nisbatan
          </div>
        )}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export function DashboardPage() {
  const { t } = useTranslation();

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { name?: string }; full_name?: string }>('/api/v1/auth/me'),
  });
  const { data: queue } = useQuery({
    queryKey: ['dash-queue'],
    queryFn: () => api.queues.list(),
    refetchInterval: 30_000,
  });
  const { data: appts } = useQuery({
    queryKey: ['dash-appts'],
    queryFn: () => api.appointments.list({ from: new Date().toISOString().slice(0, 10) }),
    refetchInterval: 60_000,
  });
  const { data: kpis } = useQuery({
    queryKey: ['dash-cashier-kpis'],
    queryFn: () => api.cashier.kpis(),
    refetchInterval: 60_000,
  });
  const { data: topServices } = useQuery({
    queryKey: ['dash-top-services'],
    queryFn: () => api.analytics.topServices({ preset: '7d' }),
  });

  const queueLen = Array.isArray(queue) ? queue.length : 0;
  const apptsLen = Array.isArray(appts) ? appts.length : 0;
  const todayDelta = pctDelta(kpis?.today, kpis?.yesterday);

  const aiSummary = useMemo(() => {
    const lines: string[] = [];
    if (apptsLen > 0) lines.push(`Bugun ${apptsLen} ta qabul rejalashtirilgan.`);
    if (queueLen > 5) lines.push(`Navbatda ${queueLen} bemor — yuklamaga e'tibor bering.`);
    else if (queueLen > 0) lines.push(`Navbatda hozir ${queueLen} bemor.`);
    if (kpis?.today != null) lines.push(`Bugungi tushum: ${fmtUZS(kpis.today)} so'm.`);
    if (todayDelta) {
      lines.push(todayDelta.up
        ? `Tushum kechaga qaraganda ${todayDelta.value.toFixed(0)}% yuqori — yaxshi tendentsiya.`
        : `Tushum kechaga qaraganda ${todayDelta.value.toFixed(0)}% past — sabablarni tekshiring.`);
    }
    if (kpis && (kpis.pharmacy_debt > 0 || kpis.inpatient_debt > 0)) {
      const total = (kpis.pharmacy_debt ?? 0) + (kpis.inpatient_debt ?? 0);
      lines.push(`Yopilmagan qarz: ${fmtUZS(total)} so'm — kassir bilan tekshiring.`);
    }
    if (kpis?.open_shifts && kpis.open_shifts > 0) lines.push(`${kpis.open_shifts} ta ochiq smena bor.`);
    if (lines.length === 0) lines.push("Bugun yangi ma'lumot yo'q. Ish kuningiz xayrli bo'lsin.");
    return lines;
  }, [apptsLen, queueLen, kpis, todayDelta]);

  return (
    <div className="space-y-6">
      <WelcomeModal />
      <OnboardingChecklist />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {t('dashboard.greeting')}, {me?.full_name ?? ''}
          </h1>
          <p className="text-muted-foreground">{me?.clinic?.name ?? 'Clary'} · {new Date().toLocaleDateString('uz-UZ', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/reception?new=appointment"><Calendar className="mr-2 h-4 w-4" />Qabul belgilash</Link></Button>
          <Button asChild size="sm"><Link to="/reception?new=true"><Users className="mr-2 h-4 w-4" />Yangi bemor</Link></Button>
        </div>
      </div>

      {/* AI Today summary */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Bugun nima bor?</div>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {aiSummary.map((line, i) => (
                  <li key={i} className="flex gap-2"><span className="text-primary">•</span>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Navbatda"
          value={queueLen}
          sub="Hozir kutmoqda"
          icon={ListOrdered}
          accent="amber"
          to="/queue"
        />
        <KpiCard
          title="Bugungi qabullar"
          value={apptsLen}
          sub="Rejalashtirilgan"
          icon={Calendar}
          accent="blue"
          to="/reception"
        />
        <KpiCard
          title="Bugungi tushum"
          value={`${fmtUZS(kpis?.today)} `}
          sub="UZS"
          icon={Wallet}
          accent="emerald"
          delta={todayDelta}
          to="/cashier"
        />
        <KpiCard
          title="Oylik foyda"
          value={`${fmtUZS(kpis?.month_profit)} `}
          sub={`Daromad ${fmtUZS(kpis?.month_revenue)} − xarajat ${fmtUZS(kpis?.month_expenses)}`}
          icon={Activity}
          accent="rose"
          to="/analytics"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Top services */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Top xizmatlar (7 kun)</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link to="/analytics">Hammasi <ArrowRight className="ml-1 h-3 w-3" /></Link></Button>
          </CardHeader>
          <CardContent>
            {!topServices || topServices.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Hozircha ma'lumot yo'q</div>
            ) : (
              <ul className="space-y-2">
                {topServices.slice(0, 6).map((s, i) => {
                  const max = topServices[0]?.revenue || 1;
                  const w = Math.max(4, (s.revenue / max) * 100);
                  return (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-6 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="flex-1 truncate">{s.service_name}</span>
                      <span className="hidden w-24 sm:block">
                        <div className="h-1.5 w-full rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
                        </div>
                      </span>
                      <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">×{s.count}</span>
                      <span className="w-20 text-right font-medium tabular-nums">{fmtUZS(s.revenue)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Quick actions / status */}
        <Card>
          <CardHeader><CardTitle className="text-base">Tezkor amallar</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Link to="/queue" className="flex items-center justify-between rounded-md p-2 hover:bg-accent">
              <span className="flex items-center gap-2"><ListOrdered className="h-4 w-4 text-amber-600" />Navbatni ko'rish</span>
              <Badge variant="secondary">{queueLen}</Badge>
            </Link>
            <Link to="/doctor" className="flex items-center justify-between rounded-md p-2 hover:bg-accent">
              <span className="flex items-center gap-2"><Stethoscope className="h-4 w-4 text-blue-600" />Shifokor konsoli</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link to="/pharmacy" className="flex items-center justify-between rounded-md p-2 hover:bg-accent">
              <span className="flex items-center gap-2"><Pill className="h-4 w-4 text-emerald-600" />Dorixona</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link to="/cashier" className="flex items-center justify-between rounded-md p-2 hover:bg-accent">
              <span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-rose-600" />Kassa</span>
              {kpis?.open_shifts ? <Badge>{kpis.open_shifts} ochiq smena</Badge> : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            </Link>
            {kpis && (kpis.pharmacy_debt > 0 || kpis.inpatient_debt > 0) && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Yopilmagan qarz: {fmtUZS((kpis.pharmacy_debt ?? 0) + (kpis.inpatient_debt ?? 0))} so'm</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
