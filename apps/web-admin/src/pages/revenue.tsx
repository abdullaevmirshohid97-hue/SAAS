import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, NavLink } from 'react-router-dom';
import { Wallet, CreditCard, TrendingUp, TrendingDown, Building2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Badge, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmtUzs(n: number) {
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('uz-UZ')} so‘m`;
}

type Tab = 'revenue' | 'payments' | 'debts';

export function RevenuePage() {
  const loc = useLocation();
  const tab: Tab = loc.pathname.includes('/payments')
    ? 'payments'
    : loc.pathname.includes('/debts')
      ? 'debts'
      : 'revenue';
  const [days, setDays] = useState(30);

  const q = useQuery({
    queryKey: ['admin', 'finance', 'overview', days],
    queryFn: () => api.admin.financeOverview(days),
  });

  const totals = q.data?.totals ?? {
    revenue_uzs: 0,
    expenses_uzs: 0,
    debts_uzs: 0,
    profit_uzs: 0,
    subscriptions_usd: 0,
  };
  const byMethod = q.data?.by_method ?? [];
  const leaderboard = useMemo(() => q.data?.leaderboard ?? [], [q.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Moliyaviy markaz</h1>
          <p className="text-sm text-muted-foreground">
            Tushum, to&apos;lov kanallari va qarzdorliklar — klinikalar bo&apos;yicha taqsimot.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1">
          {[7, 30, 90, 180, 365].map((d) => (
            <button
              key={d}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium',
                days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
              onClick={() => setDays(d)}
            >
              {d} kun
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
        {(
          [
            { id: 'revenue', label: 'Tushum', icon: TrendingUp, to: '/revenue' },
            { id: 'payments', label: "To'lov kanallari", icon: CreditCard, to: '/payments' },
            { id: 'debts', label: 'Qarzdorlar', icon: TrendingDown, to: '/debts' },
          ] as const
        ).map((t) => {
          const I = t.icon;
          return (
            <NavLink
              key={t.id}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm',
                  isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                )
              }
            >
              <I className="h-4 w-4" />
              {t.label}
            </NavLink>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Kpi title="Tushum (UZS)" value={fmtUzs(totals.revenue_uzs)} icon={<Wallet className="h-4 w-4" />} />
        <Kpi title="Xarajat (UZS)" value={fmtUzs(totals.expenses_uzs)} icon={<TrendingDown className="h-4 w-4" />} />
        <Kpi title="Sof foyda (UZS)" value={fmtUzs(totals.profit_uzs)} icon={<TrendingUp className="h-4 w-4" />} highlight />
        <Kpi title="Obunalar (USD)" value={`$${Math.round(totals.subscriptions_usd).toLocaleString('en-US')}`} icon={<CreditCard className="h-4 w-4" />} />
      </div>

      {tab === 'payments' && (
        <Card>
          <CardHeader>
            <CardTitle>To&apos;lov kanallari</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {byMethod.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">Ma&apos;lumot yo&apos;q</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Kanal</th>
                    <th className="px-4 py-2.5 text-right">Summa</th>
                    <th className="px-4 py-2.5 text-right">Ulush</th>
                  </tr>
                </thead>
                <tbody>
                  {byMethod.map((m) => {
                    const pct = totals.revenue_uzs ? (m.amount_uzs / totals.revenue_uzs) * 100 : 0;
                    return (
                      <tr key={m.method} className="border-b last:border-b-0">
                        <td className="px-4 py-2.5 font-medium">{m.method}</td>
                        <td className="px-4 py-2.5 text-right">{fmtUzs(m.amount_uzs)}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Klinika leaderboard</CardTitle>
          {tab === 'debts' && <Badge variant="destructive">Qarz bo&apos;yicha saralandi</Badge>}
        </CardHeader>
        <CardContent className="p-0">
          {leaderboard.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Ma&apos;lumot yo&apos;q</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Klinika</th>
                  <th className="px-4 py-2.5 text-right">Tushum</th>
                  <th className="px-4 py-2.5 text-right">Xarajat</th>
                  <th className="px-4 py-2.5 text-right">Sof foyda</th>
                  <th className="px-4 py-2.5 text-right">Qarz</th>
                </tr>
              </thead>
              <tbody>
                {(tab === 'debts'
                  ? [...leaderboard].sort((a, b) => b.debts - a.debts)
                  : leaderboard
                ).map((row, i) => (
                  <tr key={row.clinic_id} className="border-b last:border-b-0">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        {row.clinic_name}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">{fmtUzs(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{fmtUzs(row.expenses)}</td>
                    <td
                      className={cn(
                        'px-4 py-2.5 text-right font-semibold',
                        row.profit >= 0 ? 'text-emerald-600' : 'text-destructive',
                      )}
                    >
                      {fmtUzs(row.profit)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2.5 text-right',
                        row.debts > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground',
                      )}
                    >
                      {fmtUzs(row.debts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  title,
  value,
  icon,
  highlight = false,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-primary/40' : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
