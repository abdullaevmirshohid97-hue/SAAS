import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CreditCard,
  FileBarChart2,
  HandCoins,
  Landmark,
  Lock,
  PiggyBank,
  Receipt,
  Users,
  Vault,
  Wallet,
} from 'lucide-react';
import type { MoneyCenter, MoneyPeriodTotals } from '@clary/api-client';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@clary/ui-web';

import { api } from '@/lib/api';
import { cycleRange, prevCycleRange } from '@/lib/finance-periods';
import { useClosingDay } from '@/hooks/use-closing-day';

// =============================================================================
// PUL MARKAZI — rahbarning bosh oynasi (A1)
// =============================================================================
// Bir qarashda: pul HOZIR qayerda (kassa/seyf/yo'lda/bank), kim kimga qarzdor,
// tanlangan davrda nima bo'ldi va o'tgan teng davrga nisbatan qancha o'zgardi.
// Raqamlar oylik moliyaviy hisobot bilan BIR manbadan (finance_* RPC'lar).
// Har kartadan tegishli amalga o'tish mumkin (inkasatsiya, bankka tushdi, …).
// =============================================================================

const fmt = (n: number) => Math.round(Number(n ?? 0)).toLocaleString('uz-UZ');

type PeriodKey = 'today' | 'week' | 'month' | 'cycle' | 'prev_cycle';
const PERIODS: Array<{ k: PeriodKey; label: string }> = [
  { k: 'today', label: 'Bugun' },
  { k: 'week', label: '7 kun' },
  { k: 'month', label: 'Shu oy' },
  { k: 'cycle', label: 'Moliyaviy oy' },
  { k: 'prev_cycle', label: "O'tgan moliyaviy oy" },
];

const METHOD_LABEL: Record<string, string> = {
  card: 'Plastik',
  humo: 'Humo',
  uzcard: 'Uzcard',
  transfer: "O'tkazma",
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
};

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v == null) return <span className="text-muted-foreground text-xs">—</span>;
  const good = invert ? v <= 0 : v >= 0;
  const Icon = v >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? 'text-emerald-600' : 'text-rose-600'}`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(v)}%
    </span>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
  to,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint?: ReactNode;
  to?: string;
  tone?: 'good' | 'bad' | 'warn';
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-600'
      : tone === 'bad'
        ? 'text-rose-600'
        : tone === 'warn'
          ? 'text-amber-600'
          : '';
  const body = (
    <Card className={to ? 'hover:border-primary/50 transition-colors' : ''}>
      <CardContent className="p-4">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {icon}
          {label}
        </div>
        <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{fmt(value)}</div>
        {hint ? <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div> : null}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function PeriodBlock({ cur, mc }: { cur: MoneyPeriodTotals; mc: MoneyCenter }) {
  const methods = [
    { k: 'Naqd', v: cur.by_method.cash },
    { k: 'Plastik', v: cur.by_method.card },
    { k: "O'tkazma", v: cur.by_method.transfer },
    { k: 'Click/Payme va b.', v: cur.by_method.other },
  ].filter((m) => m.v !== 0);
  const total = Math.max(
    1,
    methods.reduce((s, m) => s + m.v, 0),
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tushum qayerdan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {methods.length === 0 ? (
            <p className="text-muted-foreground">Davrda tushum yo‘q</p>
          ) : (
            methods.map((m) => (
              <div key={m.k}>
                <div className="flex justify-between">
                  <span>{m.k}</span>
                  <span className="tabular-nums">{fmt(m.v)}</span>
                </div>
                <div className="bg-muted mt-1 h-1.5 rounded-full">
                  <div
                    className="bg-primary h-1.5 rounded-full"
                    style={{ width: `${(m.v / total) * 100}%` }}
                  />
                </div>
              </div>
            ))
          )}
          <div className="text-muted-foreground border-t pt-2 text-xs">
            Qabulxona {fmt(cur.revenue_reception)} · Statsionar {fmt(cur.revenue_inpatient)}
            {cur.pharmacy_revenue ? ` · Dorixona savdosi ${fmt(cur.pharmacy_revenue)}` : ''}
            {cur.refunds ? ` · Vozvrat −${fmt(cur.refunds)}` : ''}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rasxot kategoriyalar bo‘yicha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {mc.expenses_by_category.length === 0 ? (
            <p className="text-muted-foreground">Davrda rasxot yo‘q</p>
          ) : (
            mc.expenses_by_category.slice(0, 8).map((e) => (
              <div key={e.category} className="flex justify-between">
                <span className="truncate pr-2">{e.category}</span>
                <span className="tabular-nums">{fmt(e.amount_uzs)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function MoneyCenterPage() {
  const closingDay = useClosingDay();
  const [period, setPeriod] = useState<PeriodKey>('cycle');

  const params = useMemo(() => {
    if (period === 'cycle') return cycleRange(closingDay);
    if (period === 'prev_cycle') return prevCycleRange(closingDay);
    return { preset: period };
  }, [period, closingDay]);

  const {
    data: mc,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['money-center', params],
    queryFn: () => api.financeReport.moneyCenter(params),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <PiggyBank className="text-primary h-6 w-6" /> Pul markazi
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pul hozir qayerda, kim kimga qarzdor va davrda nima bo‘ldi — oylik hisobot bilan bir
            manbadan.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <Button
              key={p.k}
              size="sm"
              variant={period === p.k ? 'default' : 'outline'}
              onClick={() => setPeriod(p.k)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-sm">{(error as Error).message}</p>
      ) : isLoading || !mc ? (
        <p className="text-muted-foreground text-sm">Yuklanmoqda…</p>
      ) : (
        <>
          <p className="text-muted-foreground -mt-2 text-xs">
            Davr: {mc.period.from} — {mc.period.to} · solishtiruv: {mc.period.prev_from} —{' '}
            {mc.period.prev_to}
          </p>

          {/* 1) Pul hozir qayerda */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Pul hozir qayerda</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Tile
                icon={<Wallet className="h-3.5 w-3.5" />}
                label="Kassada (naqd)"
                value={mc.now.cash}
                hint="Inkasatsiya →"
                to="/cashier"
              />
              <Tile
                icon={<Vault className="h-3.5 w-3.5" />}
                label="Seyfda"
                value={mc.now.safe}
                to="/cashier"
              />
              <Tile
                icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
                label="Yo‘lda (naqdsiz)"
                value={mc.now.pending}
                hint={
                  mc.now.pending_by_method.length
                    ? mc.now.pending_by_method
                        .slice(0, 3)
                        .map((p) => `${METHOD_LABEL[p.method] ?? p.method} ${fmt(p.pending_uzs)}`)
                        .join(' · ')
                    : 'Bankka tushdi →'
                }
                tone={mc.now.pending > 0 ? 'warn' : undefined}
                to="/cashier"
              />
              <Tile
                icon={<Landmark className="h-3.5 w-3.5" />}
                label="Bankda"
                value={mc.now.bank}
                to="/bank"
              />
              <Tile
                icon={<Banknote className="h-3.5 w-3.5" />}
                label="Jami pul"
                value={mc.now.total}
                tone="good"
              />
            </div>
          </section>

          {/* 2) Majburiyatlar */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Kimdan olinadi / kimga beriladi</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile
                icon={<HandCoins className="h-3.5 w-3.5" />}
                label="Bemorlar qarzi"
                value={mc.obligations.patients_owe}
                hint={`${mc.obligations.debtors} bemor${mc.debt ? ` · davrda +${fmt(mc.debt.given_uzs)} / −${fmt(mc.debt.collected_uzs)}` : ''}`}
                tone={mc.obligations.patients_owe > 0 ? 'warn' : undefined}
                to="/cashier/debtors"
              />
              <Tile
                icon={<Users className="h-3.5 w-3.5" />}
                label="Xodimlarga to‘lanmagan ulush"
                value={mc.obligations.staff_unpaid_commission}
                hint="Maosh →"
                to="/payroll"
              />
              <Tile
                icon={<Users className="h-3.5 w-3.5" />}
                label="Agentlarga to‘lanmagan"
                value={mc.obligations.agents_unpaid}
                to="/inpatient"
              />
              <Tile
                icon={<PiggyBank className="h-3.5 w-3.5" />}
                label="Sof holat"
                value={mc.obligations.net_position}
                hint="pul + bemorlardan − xodim/agentlarga"
                tone={mc.obligations.net_position >= 0 ? 'good' : 'bad'}
              />
            </div>
          </section>

          {/* 3) Davr */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Davrda</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile
                icon={<Wallet className="h-3.5 w-3.5" />}
                label="Tushum"
                value={mc.current.revenue}
                hint={
                  <>
                    o‘tgan davr {fmt(mc.previous.revenue)} <Delta v={mc.delta_pct.revenue} />
                  </>
                }
                to="/analytics"
              />
              <Tile
                icon={<Receipt className="h-3.5 w-3.5" />}
                label="Rasxot"
                value={mc.current.expenses}
                hint={
                  <>
                    o‘tgan davr {fmt(mc.previous.expenses)}{' '}
                    <Delta v={mc.delta_pct.expenses} invert />
                  </>
                }
              />
              <Tile
                icon={<CreditCard className="h-3.5 w-3.5" />}
                label="Maosh to‘landi"
                value={mc.current.payroll}
                hint={
                  <>
                    hisoblangan ulush {fmt(mc.current.commission_accrued)}{' '}
                    <Delta v={mc.delta_pct.payroll} invert />
                  </>
                }
                to="/payroll"
              />
              <Tile
                icon={<PiggyBank className="h-3.5 w-3.5" />}
                label="Kassa foydasi"
                value={mc.current.cash_profit}
                hint={
                  <>
                    {mc.current.pharmacy_profit
                      ? `dorixona bilan ${fmt(mc.current.profit_with_pharmacy)} · `
                      : ''}
                    <Delta v={mc.delta_pct.cash_profit} />
                  </>
                }
                tone={mc.current.cash_profit >= 0 ? 'good' : 'bad'}
              />
            </div>
            <PeriodBlock cur={mc.current} mc={mc} />
          </section>

          {/* 4) Tezkor amallar */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Amallar</h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/reports">
                  <FileBarChart2 className="mr-1.5 h-4 w-4" /> Hisobotlar (1 tugma)
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/cashier">
                  <Vault className="mr-1.5 h-4 w-4" /> Inkasatsiya / bankka tushdi
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/cashier/debtors">
                  <HandCoins className="mr-1.5 h-4 w-4" /> Qarzdorlar
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/payroll">
                  <Users className="mr-1.5 h-4 w-4" /> Maosh to‘lash
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/analytics/builder">
                  <Lock className="mr-1.5 h-4 w-4" /> Oyni yopish
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/month-closing">
                  <CalendarClock className="mr-1.5 h-4 w-4" /> Buxgalteriya davri
                </Link>
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
