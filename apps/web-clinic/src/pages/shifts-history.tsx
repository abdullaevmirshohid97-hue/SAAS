import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  FileBarChart,
  History,
  Loader2,
  Printer,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import { printShiftReport, type ShiftReportData } from '@/lib/shift-report';

// Dataviz: 2 seriya uchun tekshirilgan kategorik palitra (validator PASS).
const COLOR_EXPECTED = '#2a78d6'; // ko'k — kutilgan naqd
const COLOR_ACTUAL = '#008300'; // yashil — haqiqiy naqd

const fmt = (n: number) => new Intl.NumberFormat('uz-UZ').format(Math.round(n ?? 0));
const fmtUzs = (n: number) => `${fmt(n)} so'm`;
const fmtDT = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('uz-UZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd', card: 'Karta', transfer: "O'tkazma", click: 'Click', payme: 'Payme',
  mixed: 'Aralash', insurance: "Sug'urta", uzum: 'Uzum', humo: 'Humo', uzcard: 'Uzcard',
};

type ShiftRow = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  opening_cash_uzs: number | null;
  actual_cash_uzs: number | null;
  expected_cash_uzs: number | null;
  cash_diff_uzs: number | null;
  closing_notes: string | null;
  operator?: { id: string; full_name: string; role: string } | null;
};

function StatTile({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg',
            tone === 'bad' ? 'bg-rose-500/10 text-rose-600' : tone === 'good' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={cn('truncate text-lg font-semibold', tone === 'bad' && 'text-rose-600', tone === 'good' && 'text-emerald-600')}>
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Farq (kamchilik/ortiqcha) — status rang: manfiy = kamchilik (qizil).
function DiffCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  if (v === 0) return <span className="font-medium text-emerald-600">0</span>;
  return (
    <span className={cn('font-semibold', v < 0 ? 'text-rose-600' : 'text-amber-600')}>
      {v > 0 ? '+' : ''}
      {fmt(v)}
    </span>
  );
}

export function ShiftsHistoryPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['shifts', 'history-page', from, to],
    queryFn: () =>
      api.shifts.list({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
      }),
  });
  const shifts = ((listQ.data ?? []) as ShiftRow[]);
  const closed = shifts.filter((s) => s.closed_at);

  const totals = useMemo(() => {
    const expected = closed.reduce((a, s) => a + Number(s.expected_cash_uzs ?? 0), 0);
    const actual = closed.reduce((a, s) => a + Number(s.actual_cash_uzs ?? 0), 0);
    const diff = closed.reduce((a, s) => a + Number(s.cash_diff_uzs ?? 0), 0);
    return { expected, actual, diff };
  }, [closed]);

  // Grafik: eng eski → eng yangi (o'qish tabiiy chapdan o'ngga).
  const chartData = useMemo(
    () =>
      [...closed]
        .sort((a, b) => a.opened_at.localeCompare(b.opened_at))
        .map((s) => ({
          name:
            new Date(s.opened_at).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' }) +
            (s.operator?.full_name ? ` · ${s.operator.full_name.split(' ')[0]}` : ''),
          Kutilgan: Number(s.expected_cash_uzs ?? 0),
          Haqiqiy: Number(s.actual_cash_uzs ?? 0),
          diff: Number(s.cash_diff_uzs ?? 0),
        })),
    [closed],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/reception')} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Qabulxona
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <History className="h-5 w-5 text-primary" /> Smenalar tarixi
            </h1>
            <p className="text-sm text-muted-foreground">
              Kassa smenalari — kutilgan/haqiqiy naqd, kamchiliklar va to'liq hisobotlar
            </p>
          </div>
        </div>
        {/* Filtrlar — grafiklardan yuqorida bitta qator */}
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sanadan</label>
            <Input type="date" className="h-9 w-[150px]" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sanagacha</label>
            <Input type="date" className="h-9 w-[150px]" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Stat kartalar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={History} label="Smenalar (yopilgan)" value={`${closed.length} ta`} />
        <StatTile icon={Wallet} label="Kutilgan naqd (jami)" value={fmtUzs(totals.expected)} />
        <StatTile icon={TrendingUp} label="Haqiqiy naqd (jami)" value={fmtUzs(totals.actual)} />
        <StatTile
          icon={TrendingDown}
          label="Farq (jami)"
          value={`${totals.diff > 0 ? '+' : ''}${fmt(totals.diff)} so'm`}
          tone={totals.diff < 0 ? 'bad' : totals.diff === 0 ? 'good' : 'default'}
        />
      </div>

      {/* Analitik grafik — kutilgan vs haqiqiy naqd, smena kesimida */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Kassa aniqligi — smena kesimida</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Grafik uchun yopilgan smena yo'q</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <BarChart data={chartData} barGap={2} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="currentColor" className="text-border" strokeOpacity={0.4} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : fmt(v))} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip
                    formatter={(v, name) => [fmtUzs(Number(v ?? 0)), String(name ?? '')]}
                    labelFormatter={(l) => `Smena: ${String(l ?? '')}`}
                    cursor={{ fillOpacity: 0.06 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Kutilgan" fill={COLOR_EXPECTED} radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="Haqiqiy" fill={COLOR_ACTUAL} radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Smenalar jadvali — to'liq ustunlar */}
      <Card>
        <CardContent className="p-0">
          {listQ.isLoading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : listQ.isError ? (
            <div className="p-8 text-center text-sm text-destructive">
              Yuklashda xatolik: {(listQ.error as Error)?.message}
              <Button variant="outline" size="sm" className="ml-3" onClick={() => void listQ.refetch()}>
                Qayta urinish
              </Button>
            </div>
          ) : shifts.length === 0 ? (
            <EmptyState title="Smena topilmadi" description="Tanlangan sana oralig'ida smena yo'q" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">Ochilish</th>
                    <th className="px-3 py-2.5 text-left font-medium">Yopilish</th>
                    <th className="px-3 py-2.5 text-left font-medium">Operator</th>
                    <th className="px-3 py-2.5 text-left font-medium">Holat</th>
                    <th className="px-3 py-2.5 text-right font-medium">Boshl. kassa</th>
                    <th className="px-3 py-2.5 text-right font-medium">Kutilgan</th>
                    <th className="px-3 py-2.5 text-right font-medium">Haqiqiy</th>
                    <th className="px-3 py-2.5 text-right font-medium">Farq</th>
                    <th className="px-3 py-2.5 text-left font-medium">Izoh</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shifts.map((s) => (
                    <tr
                      key={s.id}
                      className={cn('hover:bg-accent/40', selectedId === s.id && 'bg-primary/5')}
                    >
                      <td className="whitespace-nowrap px-3 py-2">{fmtDT(s.opened_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtDT(s.closed_at)}</td>
                      <td className="px-3 py-2">{s.operator?.full_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge variant={s.closed_at ? 'secondary' : 'success'}>
                          {s.closed_at ? 'Yopilgan' : 'Ochiq'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.opening_cash_uzs != null ? fmt(s.opening_cash_uzs) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.expected_cash_uzs != null ? fmt(s.expected_cash_uzs) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.actual_cash_uzs != null ? fmt(s.actual_cash_uzs) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><DiffCell v={s.cash_diff_uzs} /></td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-xs text-muted-foreground" title={s.closing_notes ?? ''}>
                        {s.closing_notes ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant={selectedId === s.id ? 'default' : 'outline'} className="gap-1" onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}>
                          <FileBarChart className="h-3.5 w-3.5" /> Hisobot
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedId && <ShiftFullReport shiftId={selectedId} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// To'liq professional hisobot — barcha qatorlar, kamchiliklar, chop etish.
// ─────────────────────────────────────────────────────────────────────────────
function ShiftFullReport({ shiftId }: { shiftId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['shift-report', shiftId],
    queryFn: () => api.shifts.report(shiftId),
  });
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string; address?: string; phone?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const { data: breakdown } = useQuery({
    queryKey: ['shift-breakdown', shiftId],
    queryFn: () => api.cashier.shiftBreakdown(shiftId),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Hisobot tayyorlanmoqda…
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const t = data.totals;
  const clinic = (me.data as { clinic?: { name?: string; address?: string; phone?: string } } | undefined)?.clinic;
  const drawerTx = data.transactions.filter((x) => !x.is_encashment && x.source !== 'safe');

  const handlePrint = (format: 'a4' | '80mm') => {
    const rd: ShiftReportData = {
      clinic_name: clinic?.name ?? 'Klinika',
      clinic_address: clinic?.address,
      clinic_phone: clinic?.phone,
      operator_name: data.operator_name,
      opened_at: data.opened_at,
      closed_at: data.closed_at,
      totals: t,
      cash_summary: {
        opening_uzs: (data.shift as { opening_cash_uzs?: number | null }).opening_cash_uzs ?? null,
        expected_uzs: (data.shift as { expected_cash_uzs?: number | null }).expected_cash_uzs ?? null,
        actual_uzs: (data.shift as { actual_cash_uzs?: number | null }).actual_cash_uzs ?? null,
        diff_uzs: (data.shift as { cash_diff_uzs?: number | null }).cash_diff_uzs ?? null,
      },
      closing_notes: (data.shift as { closing_notes?: string | null }).closing_notes ?? null,
      cash_breakdown: breakdown as Record<string, { in: number; out: number; net: number }> | undefined,
      transactions: drawerTx.map((x) => ({
        occurred_at: x.occurred_at,
        patient_name: x.patient_name,
        service_name: x.service_name,
        doctor_name: x.doctor_name,
        cashier_name: x.cashier_name,
        payment_method: x.payment_method,
        amount_uzs: x.amount_uzs,
        kind: x.kind,
        is_void: x.is_void,
      })),
      expenses: data.expenses,
      staff: data.staff,
      salary_payouts: data.salary_payouts,
    };
    printShiftReport(rd, format);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">
            Smena hisoboti — {data.operator_name ?? 'Operator'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {fmtDT(data.opened_at)} → {fmtDT(data.closed_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handlePrint('a4')}>
            <Printer className="h-3.5 w-3.5" /> A4 chop etish
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handlePrint('80mm')}>
            <Printer className="h-3.5 w-3.5" /> Chek (80mm)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Jami ko'rsatkichlar */}
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ['Tushum', t.revenue, ''],
            ['Vozvratlar', t.refunds, 'text-rose-600'],
            ['Rasxodlar', t.expenses, 'text-rose-600'],
            ['Shifokor komissiyasi', t.commission_accrued, ''],
            ['Maosh to‘lovlari', t.salaries, ''],
            ['Inkasatsiya (seyfga)', t.encashment, ''],
            ['Jami chiqim', t.total_expense, 'text-rose-600'],
            ['Sof foyda', t.net_profit, 'font-semibold text-emerald-600'],
          ].map(([label, v, cls]) => (
            <div key={label as string} className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-xs text-muted-foreground">{label as string}</div>
              <div className={cn('tabular-nums', (cls as string) || 'font-medium')}>{fmtUzs(Number(v))}</div>
            </div>
          ))}
        </div>

        {/* Tranzaksiyalar — TO'LIQ qatorlar */}
        <ReportTable
          title={`Tranzaksiyalar (${drawerTx.length})`}
          head={['Vaqt', 'Bemor', 'Xizmat', 'Shifokor', 'Kassir', 'Usul', 'Summa']}
          rows={drawerTx.map((x) => [
            fmtDT(x.occurred_at),
            x.patient_name ?? '—',
            x.service_name ?? (x.kind === 'refund' ? 'Vozvrat' : '—'),
            x.doctor_name ?? '—',
            x.cashier_name ?? '—',
            METHOD_LABEL[x.payment_method] ?? x.payment_method,
            <span key="a" className={cn('tabular-nums', x.is_void && 'line-through opacity-50', x.amount_uzs < 0 && 'text-rose-600')}>
              {fmt(x.amount_uzs)}
            </span>,
          ])}
        />

        {data.pharmacy_sales.length > 0 && (
          <ReportTable
            title={`Dorixona sotuvlari (${data.pharmacy_sales.length})`}
            head={['Vaqt', 'Bemor', 'Jami', 'To‘langan']}
            rows={data.pharmacy_sales.map((x) => [
              fmtDT(x.occurred_at),
              x.patient_name,
              fmt(x.total_uzs),
              fmt(x.paid_uzs),
            ])}
          />
        )}

        {data.expenses.length > 0 && (
          <ReportTable
            title={`Rasxodlar (${data.expenses.length})`}
            head={['Vaqt', 'Kategoriya', 'Izoh', 'Kim', 'Manba', 'Summa']}
            rows={data.expenses.map((x) => [
              fmtDT(x.occurred_at),
              x.category,
              x.description ?? '—',
              x.recorder_name ?? '—',
              x.source === 'safe' ? 'Seyf' : 'Kassa',
              <span key="a" className="tabular-nums text-rose-600">-{fmt(x.amount_uzs)}</span>,
            ])}
          />
        )}

        {data.salary_payouts.length > 0 && (
          <ReportTable
            title={`Maosh to‘lovlari (${data.salary_payouts.length})`}
            head={['Vaqt', 'Xodim', 'Manba', 'Summa']}
            rows={data.salary_payouts.map((x) => [
              fmtDT(x.paid_at),
              x.doctor_name,
              x.source === 'safe' ? 'Seyf' : 'Kassa',
              fmt(x.net_uzs),
            ])}
          />
        )}

        {data.shift_commissions.length > 0 && (
          <ReportTable
            title="Shifokor komissiyalari"
            head={['Shifokor', 'Hisoblangan']}
            rows={data.shift_commissions.map((x) => [x.doctor_name, fmt(x.amount_uzs)])}
          />
        )}

        {data.staff.length > 0 && (
          <ReportTable
            title="Xodimlar faoliyati"
            head={['Xodim', 'Rol', 'Qabullar', 'Navbat']}
            rows={data.staff.map((x) => [x.name, x.role, String(x.appointments), String(x.queue)])}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ReportTable({
  title,
  head,
  rows,
}: {
  title: string;
  head: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold">{title}</div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              {head.map((h) => (
                <th key={h} className={cn('px-3 py-2 text-left font-medium', /Summa|Jami|langan|Hisoblangan/.test(h) && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-accent/30">
                {r.map((c, j) => (
                  <td key={j} className={cn('px-3 py-1.5', j >= head.length - 1 && 'text-right')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={head.length} className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Yozuv yo'q
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
