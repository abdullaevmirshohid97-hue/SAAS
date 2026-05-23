import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  FileSpreadsheet,
  Percent,
  Plus,
  ReceiptText,
  Stethoscope,
  Wallet,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  Textarea,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { printPayslip, type PayslipFormat } from '@/lib/payslip';
import { Printer, FileText, FileType } from 'lucide-react';

type Tab = 'overview' | 'rates' | 'ledger' | 'payouts';

type Doctor = { id: string; full_name: string };
type ServiceRow = { id: string; name: string };

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

type BadgeTone = 'success' | 'warning' | 'destructive' | 'info' | 'default';

const KIND_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  advance: { label: 'Avans', tone: 'warning' },
  bonus: { label: 'Bonus', tone: 'success' },
  penalty: { label: 'Jarima', tone: 'destructive' },
  adjustment: { label: 'Tuzatish', tone: 'info' },
  debt_write_off: { label: 'Qarz hisobdan chiqarish', tone: 'default' },
};

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Qoralama', tone: 'info' },
  approved: { label: 'Tasdiqlandi', tone: 'warning' },
  paid: { label: 'To‘langan', tone: 'success' },
  canceled: { label: 'Bekor qilindi', tone: 'destructive' },
};

export function PayrollPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const balances = useQuery({
    queryKey: ['payroll', 'balances'],
    queryFn: () => api.payroll.balances(),
  });

  // Xodimlar ro'yxati — barcha shifokorlardan (api.doctors.list), faqat
  // komissiya balansi borlardan EMAS. Aks holda yangi klinikada ro'yxat bo'sh
  // bo'lib qoladi va foiz belgilab bo'lmaydi.
  const doctorsQuery = useQuery({
    queryKey: ['doctors', 'payroll-list'],
    // payrollList — anketadagi shifokorlarni ham avtomatik ulaydi
    // (ghost profile yaratiladi). Shu yo'l Hisob-kitob ro'yxatida hammasi
    // ko'rinishi uchun.
    queryFn: () => api.doctors.payrollList(),
  });

  const doctors = useMemo<Doctor[]>(() => {
    const fromApi = (doctorsQuery.data ?? []).map((d) => ({
      id: d.id,
      full_name: d.full_name,
    }));
    if (fromApi.length > 0) return fromApi;
    // Zaxira — agar doctors API bo'sh bo'lsa, balanslardan
    return (balances.data ?? []).map((b) => ({ id: b.doctor_id, full_name: b.full_name }));
  }, [doctorsQuery.data, balances.data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hisob-kitob</h1>
          <p className="text-sm text-muted-foreground">
            Xodim ulushlari, avanslar, bonuslar va oylik to‘lovlar
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {[
            { id: 'overview', label: 'Umumiy', icon: Coins },
            { id: 'rates', label: 'Foizlar', icon: Percent },
            { id: 'ledger', label: 'Avans/Bonus', icon: ReceiptText },
            { id: 'payouts', label: 'To‘lovlar', icon: Wallet },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={
                'flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors ' +
                (tab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <OverviewTab balances={balances.data ?? []} />}
      {tab === 'rates' && <RatesTab doctors={doctors} />}
      {tab === 'ledger' && <LedgerTab doctors={doctors} />}
      {tab === 'payouts' && <PayoutsTab doctors={doctors} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
// Oxirgi N oy uchun [start, end] sanalar ro'yxati
function lastNMonths(n: number): Array<{ key: string; label: string; from: string; to: string }> {
  const today = new Date();
  const months: Array<{ key: string; label: string; from: string; to: string }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const monthName = d.toLocaleString('uz-UZ', { month: 'short' });
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${monthName} ${d.getFullYear() === today.getFullYear() ? '' : d.getFullYear()}`.trim(),
      from: iso(d),
      to: iso(last),
    });
  }
  return months;
}

// 12 oylik klinika payroll trendi (SVG bar chart, paketsiz)
function PayrollTrendChart() {
  const months = useMemo(() => lastNMonths(6), []);
  const queries = useQuery({
    queryKey: ['payroll', 'trend', months.map((m) => m.key).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        months.map((m) =>
          api.payroll
            .clinicPeriodSummary(m.from, m.to)
            .then((rows) => ({
              key: m.key,
              label: m.label,
              total: rows.reduce((s, r) => s + Number(r.net_uzs), 0),
              count: rows.length,
            }))
            .catch(() => ({ key: m.key, label: m.label, total: 0, count: 0 })),
        ),
      );
      return results;
    },
    staleTime: 60_000,
  });

  const data = queries.data ?? [];
  const max = Math.max(1, ...data.map((d) => d.total));
  const totalSum = data.reduce((s, d) => s + d.total, 0);
  const avg = data.length ? totalSum / data.length : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Klinika payroll trendi (oxirgi 6 oy)</CardTitle>
        <div className="text-xs text-muted-foreground">
          O'rtacha: <strong>{fmt(Math.round(avg))}</strong> so'm/oy
        </div>
      </CardHeader>
      <CardContent>
        {queries.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (
          <div className="flex h-48 items-end gap-3">
            {data.map((d) => {
              const h = max > 0 ? Math.round((d.total / max) * 100) : 0;
              return (
                <div key={d.key} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {d.total > 0 ? fmt(Math.round(d.total / 1000)) + 'k' : '—'}
                  </div>
                  <div
                    className="w-full rounded-t bg-primary/70 transition-all hover:bg-primary"
                    style={{ height: `${h}%`, minHeight: d.total > 0 ? '4px' : '1px' }}
                    title={`${d.label}: ${fmt(d.total)} so'm (${d.count} xodim)`}
                  />
                  <div className="text-[10px] font-medium">{d.label}</div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Period = 'current_month' | 'last_month' | 'quarter' | 'year' | 'all';

function periodRange(p: Period): { from: string; to: string; label: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === 'current_month') {
    return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)), label: 'Joriy oy' };
  }
  if (p === 'last_month') {
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)), label: "O'tgan oy" };
  }
  if (p === 'quarter') {
    const qStart = Math.floor(m / 3) * 3;
    return { from: iso(new Date(y, qStart, 1)), to: iso(new Date(y, qStart + 3, 0)), label: 'Joriy kvartal' };
  }
  if (p === 'year') {
    return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)), label: 'Joriy yil' };
  }
  return { from: '2020-01-01', to: iso(new Date(y, 11, 31)), label: 'Hammasi' };
}

function OverviewTab({ balances }: { balances: Awaited<ReturnType<typeof api.payroll.balances>> }) {
  const [period, setPeriod] = useState<Period>('current_month');
  const range = useMemo(() => periodRange(period), [period]);

  const summary = useQuery({
    queryKey: ['payroll', 'clinic-period', range.from, range.to],
    queryFn: () => api.payroll.clinicPeriodSummary(range.from, range.to),
  });

  // Payslip uchun klinika nomi/manzili kerak
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{ clinic?: { name?: string; address?: string; phone?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicInfo = (me.data as { clinic?: { name?: string; address?: string; phone?: string } } | undefined)?.clinic;

  const qc = useQueryClient();

  // Bulk payout — davr ichida net > 0 bo'lgan barcha xodimlarga payout yaratiladi
  const bulkPayoutMut = useMutation({
    mutationFn: async () => {
      const eligible = rows.filter((r) => Number(r.net_uzs) > 0);
      if (eligible.length === 0) throw new Error("To'lanadigan xodim yo'q");
      const label = `${range.from} – ${range.to}`;
      let ok = 0;
      let fail = 0;
      for (const r of eligible) {
        try {
          await api.payroll.createPayout({
            doctor_id: r.doctor_id,
            period_start: range.from,
            period_end: range.to,
            period_label: label,
            notes: 'Bulk payout',
          });
          ok++;
        } catch {
          fail++;
        }
      }
      return { ok, fail, total: eligible.length };
    },
    onSuccess: ({ ok, fail, total }) => {
      if (fail === 0) {
        toast.success(`${ok}/${total} xodim uchun payout yaratildi`);
      } else {
        toast.warning(`${ok}/${total} muvaffaqiyatli, ${fail} ta xato`);
      }
      qc.invalidateQueries({ queryKey: ['payroll'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Payslip dialog state — qaysi xodim, qaysi format
  const [payslipTarget, setPayslipTarget] = useState<null | {
    doctor_name: string;
    commissions_uzs: number;
    monthly_base_uzs: number;
    bonuses_uzs: number;
    advances_uzs: number;
    penalties_uzs: number;
    gross_uzs: number;
    deductions_uzs: number;
    net_uzs: number;
  }>(null);

  const handlePayslipFormat = (format: PayslipFormat) => {
    if (!payslipTarget) return;
    printPayslip({
      clinic_name: clinicInfo?.name ?? 'Klinika',
      clinic_address: clinicInfo?.address,
      clinic_phone: clinicInfo?.phone,
      employee_name: payslipTarget.doctor_name,
      period_from: range.from,
      period_to: range.to,
      commissions_uzs: Number(payslipTarget.commissions_uzs),
      monthly_base_uzs: Number(payslipTarget.monthly_base_uzs),
      bonuses_uzs: Number(payslipTarget.bonuses_uzs),
      advances_uzs: Number(payslipTarget.advances_uzs),
      penalties_uzs: Number(payslipTarget.penalties_uzs),
      gross_uzs: Number(payslipTarget.gross_uzs),
      deductions_uzs: Number(payslipTarget.deductions_uzs),
      net_uzs: Number(payslipTarget.net_uzs),
      generated_at: new Date().toISOString(),
    }, format);
    setPayslipTarget(null);
  };

  const rows = summary.data ?? [];
  const periodTotals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.commissions += Number(r.commissions_uzs);
          acc.monthly_base += Number(r.monthly_base_uzs);
          acc.bonuses += Number(r.bonuses_uzs);
          acc.advances += Number(r.advances_uzs);
          acc.penalties += Number(r.penalties_uzs);
          acc.gross += Number(r.gross_uzs);
          acc.deductions += Number(r.deductions_uzs);
          acc.net += Number(r.net_uzs);
          return acc;
        },
        { commissions: 0, monthly_base: 0, bonuses: 0, advances: 0, penalties: 0, gross: 0, deductions: 0, net: 0 },
      ),
    [rows],
  );

  const overallBalanceTotal = useMemo(
    () => balances.reduce((s, b) => s + Number(b.balance_uzs), 0),
    [balances],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {(
            [
              { id: 'current_month', label: 'Joriy oy' },
              { id: 'last_month', label: "O'tgan oy" },
              { id: 'quarter', label: 'Kvartal' },
              { id: 'year', label: 'Yil' },
              { id: 'all', label: 'Hammasi' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={
                'rounded px-3 py-1.5 text-xs font-medium transition ' +
                (period === p.id ? 'bg-background shadow-sm' : 'text-muted-foreground')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">
            {range.from} → {range.to}
          </div>
          <Button
            size="sm"
            onClick={() => {
              const eligible = rows.filter((r) => Number(r.net_uzs) > 0);
              const total = eligible.reduce((s, r) => s + Number(r.net_uzs), 0);
              if (eligible.length === 0) {
                toast.error("Bu davrda to'lanadigan xodim yo'q");
                return;
              }
              if (confirm(`${eligible.length} xodim uchun jami ${fmt(total)} so'm payout yaratilsinmi?`)) {
                bulkPayoutMut.mutate();
              }
            }}
            disabled={bulkPayoutMut.isPending || rows.length === 0}
            className="gap-1"
          >
            <Wallet className="h-3.5 w-3.5" />
            {bulkPayoutMut.isPending ? 'Yaratilmoqda…' : 'Hammaga payout'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Komissiya + Oylik fix"
          value={`${fmt(periodTotals.commissions + periodTotals.monthly_base)} so'm`}
          icon={<Stethoscope className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Bonus"
          value={`${fmt(periodTotals.bonuses)} so'm`}
          icon={<ArrowUpRight className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Avans + Jarima"
          value={`${fmt(periodTotals.deductions)} so'm`}
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Sof maosh (NET)"
          value={`${fmt(periodTotals.net)} so'm`}
          icon={<Wallet className="h-4 w-4" />}
          tone={periodTotals.net >= 0 ? 'success' : 'danger'}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Xodimlar oylik hisobi ({range.label})</CardTitle>
          <div className="text-xs text-muted-foreground">
            Umumiy qoldiq: <strong className={overallBalanceTotal >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmt(overallBalanceTotal)}</strong> so'm
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {summary.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Coins className="h-8 w-8" />}
              title="Ma'lumot yo'q"
              description="Bu davrda xodim hisobi bo'sh"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5">Xodim</th>
                    <th className="px-3 py-2.5 text-right">Komissiya</th>
                    <th className="px-3 py-2.5 text-right">Oylik fix</th>
                    <th className="px-3 py-2.5 text-right">Bonus</th>
                    <th className="px-3 py-2.5 text-right">Avans</th>
                    <th className="px-3 py-2.5 text-right">Jarima</th>
                    <th className="px-3 py-2.5 text-right">Gross</th>
                    <th className="px-3 py-2.5 text-right">NET</th>
                    <th className="px-3 py-2.5 text-center">Holat</th>
                    <th className="px-3 py-2.5 text-center">Hujjat</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.doctor_id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-medium">{r.doctor_name}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(r.commissions_uzs)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(r.monthly_base_uzs)}</td>
                      <td className="px-3 py-2.5 text-right text-emerald-600">{r.bonuses_uzs > 0 ? `+${fmt(r.bonuses_uzs)}` : '0'}</td>
                      <td className="px-3 py-2.5 text-right text-red-600">{r.advances_uzs > 0 ? `−${fmt(r.advances_uzs)}` : '0'}</td>
                      <td className="px-3 py-2.5 text-right text-red-600">{r.penalties_uzs > 0 ? `−${fmt(r.penalties_uzs)}` : '0'}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(r.gross_uzs)}</td>
                      <td className={'px-3 py-2.5 text-right font-semibold ' + (r.net_uzs < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {fmt(r.net_uzs)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {!r.rate_configured ? (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800" title="Stavka sozlanmagan">
                            Sozlanmagan
                          </span>
                        ) : r.unaccrued_count > 0 ? (
                          <span className="rounded bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800" title="Komissiya hisoblanmagan tx'lar">
                            {r.unaccrued_count} tx skip
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">OK</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1"
                          onClick={() => setPayslipTarget(r)}
                          title="Maosh varaqasini chop etish"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Payslip
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/20 text-xs font-semibold">
                  <tr>
                    <td className="px-3 py-2">Jami</td>
                    <td className="px-3 py-2 text-right">{fmt(periodTotals.commissions)}</td>
                    <td className="px-3 py-2 text-right">{fmt(periodTotals.monthly_base)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{fmt(periodTotals.bonuses)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{fmt(periodTotals.advances)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{fmt(periodTotals.penalties)}</td>
                    <td className="px-3 py-2 text-right">{fmt(periodTotals.gross)}</td>
                    <td className={'px-3 py-2 text-right ' + (periodTotals.net < 0 ? 'text-red-700' : 'text-emerald-700')}>
                      {fmt(periodTotals.net)}
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PayrollTrendChart />

      {/* Format tanlash dialog'i (A4 yoki Thermal) */}
      <Dialog open={!!payslipTarget} onOpenChange={(o) => !o && setPayslipTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Maosh varaqasi formatini tanlang</DialogTitle>
          </DialogHeader>
          {payslipTarget && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-semibold">{payslipTarget.doctor_name}</div>
              <div className="text-xs text-muted-foreground">
                Davr: {range.from} → {range.to}
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Sof maosh (NET):</span>
                <span className="text-lg font-bold text-emerald-600">
                  {fmt(payslipTarget.net_uzs)} so'm
                </span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <button
              type="button"
              onClick={() => handlePayslipFormat('a4')}
              className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-3 transition hover:border-primary hover:bg-primary/5"
            >
              <div className="rounded-lg bg-blue-100 p-2.5 text-blue-700 transition group-hover:bg-blue-200">
                <FileType className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold">A4 PDF</div>
              <div className="text-[10px] text-center text-muted-foreground">
                .pdf yuklab olish
              </div>
            </button>
            <button
              type="button"
              onClick={() => handlePayslipFormat('80mm')}
              className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-3 transition hover:border-primary hover:bg-primary/5"
            >
              <div className="rounded-lg bg-amber-100 p-2.5 text-amber-700 transition group-hover:bg-amber-200">
                <FileText className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold">80mm</div>
              <div className="text-[10px] text-center text-muted-foreground">
                Termal chek printer
              </div>
            </button>
            <button
              type="button"
              onClick={() => handlePayslipFormat('58mm')}
              className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-3 transition hover:border-primary hover:bg-primary/5"
            >
              <div className="rounded-lg bg-rose-100 p-2.5 text-rose-700 transition group-hover:bg-rose-200">
                <FileText className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold">58mm</div>
              <div className="text-[10px] text-center text-muted-foreground">
                Kichik chek printer
              </div>
            </button>
          </div>
          <div className="pt-2 text-center text-[11px] text-muted-foreground">
            <a href="/settings/printer" className="underline hover:text-primary">
              ⚙ Maosh varaqasi sozlamalari
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------
function RatesTab({ doctors }: { doctors: Doctor[] }) {
  const qc = useQueryClient();
  const rates = useQuery({ queryKey: ['payroll', 'rates'], queryFn: () => api.payroll.listRates() });
  const services = useQuery({
    queryKey: ['catalog', 'services'],
    queryFn: () => api.catalog.list('services', { pageSize: 500 }),
  });
  const servicesList: ServiceRow[] = useMemo(() => {
    return ((services.data?.items as Array<Record<string, unknown>>) ?? []).map((s) => ({
      id: String(s.id),
      name: String(s.name),
    }));
  }, [services.data]);

  const [open, setOpen] = useState(false);

  const archive = useMutation({
    mutationFn: (id: string) => api.payroll.archiveRate(id),
    onSuccess: () => {
      toast.success('Arxivlandi');
      qc.invalidateQueries({ queryKey: ['payroll', 'rates'] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Yangi foiz
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {(rates.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Percent className="h-8 w-8" />}
              title="Foizlar kiritilmagan"
              description="Har bir shifokorga umumiy yoki xizmat bo‘yicha ulush foizini belgilang"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Xodim</th>
                    <th className="px-4 py-2.5">Xizmat</th>
                    <th className="px-4 py-2.5 text-right">Foiz</th>
                    <th className="px-4 py-2.5 text-right">Fixed (so‘m)</th>
                    <th className="px-4 py-2.5">Davr</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(rates.data ?? []).map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{r.doctor?.full_name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {r.service?.name ?? <span className="italic">Barcha xizmatlar</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">{r.percent}%</td>
                      <td className="px-4 py-2.5 text-right">{fmt(r.fixed_uzs)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {r.valid_from}
                        {r.valid_to ? ` → ${r.valid_to}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => archive.mutate(r.id)}
                          disabled={archive.isPending}
                        >
                          Arxivla
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

      {open && (
        <RateDialog
          doctors={doctors}
          services={servicesList}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'rates'] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RateDialog({
  doctors,
  services,
  onClose,
  onSaved,
}: {
  doctors: Doctor[];
  services: ServiceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState<string>('__all__');
  const [percent, setPercent] = useState('30');
  const [fixed, setFixed] = useState('0');
  const [monthlyBase, setMonthlyBase] = useState('0');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const save = useMutation({
    mutationFn: () =>
      api.payroll.setRate({
        doctor_id: doctorId,
        service_id: serviceId === '__all__' ? null : serviceId,
        percent: Number(percent) || 0,
        fixed_uzs: Number(fixed) || 0,
        monthly_base_uzs: Number(monthlyBase) || 0,
        valid_from: from,
      }),
    onSuccess: () => {
      toast.success('Foiz saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ulush foizi</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label>Xodim</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Xizmat (ixtiyoriy)</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Barcha xizmatlar</SelectItem>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Foiz (%)</Label>
              <Input value={percent} onChange={(e) => setPercent(e.target.value)} type="number" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Har tranzaksiyaga: gross × foiz
              </p>
            </div>
            <div>
              <Label>Har tx fix (so‘m)</Label>
              <Input value={fixed} onChange={(e) => setFixed(e.target.value)} type="number" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Har tranzaksiyaga qo‘shimcha
              </p>
            </div>
          </div>
          <div>
            <Label>Oylik fix maosh (so‘m)</Label>
            <Input
              value={monthlyBase}
              onChange={(e) => setMonthlyBase(e.target.value)}
              type="number"
              placeholder="0"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Davr ichidagi har oy uchun avtomatik qo‘shiladi (oylik tarif)
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
            <strong>Rejim tanlash:</strong> faqat foiz (komissiya) — Foiz to‘ldiring;
            faqat oylik — Oylik fix to‘ldiring; aralash — ikkalasini birga.
            Avans/bonus/jarima alohida tabda yoziladi.
          </div>
          <div>
            <Label>Amal qila boshlash</Label>
            <Input value={from} onChange={(e) => setFrom(e.target.value)} type="date" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => save.mutate()} disabled={!doctorId || save.isPending}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Ledger (advance / bonus / penalty)
// ---------------------------------------------------------------------------
function LedgerTab({ doctors }: { doctors: Doctor[] }) {
  const qc = useQueryClient();
  const ledger = useQuery({ queryKey: ['payroll', 'ledger'], queryFn: () => api.payroll.listLedger() });
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Yangi yozuv
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {(ledger.data ?? []).length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="h-8 w-8" />}
              title="Yozuvlar yo‘q"
              description="Avans, bonus yoki jarima qo‘shing"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Sana</th>
                    <th className="px-4 py-2.5">Xodim</th>
                    <th className="px-4 py-2.5">Tur</th>
                    <th className="px-4 py-2.5 text-right">Summa</th>
                    <th className="px-4 py-2.5">Izoh</th>
                    <th className="px-4 py-2.5">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data ?? []).map((row) => {
                    const kind = KIND_LABEL[row.kind] ?? { label: row.kind, tone: 'default' as const };
                    return (
                      <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {new Date(row.created_at).toLocaleString('uz-UZ')}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{row.doctor?.full_name ?? '-'}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={kind.tone}>{kind.label}</Badge>
                        </td>
                        <td className={'px-4 py-2.5 text-right font-medium ' + (row.amount_uzs < 0 ? 'text-red-600' : 'text-emerald-600')}>
                          {fmt(row.amount_uzs)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.notes ?? '-'}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={row.status === 'open' ? 'info' : 'default'}>
                            {row.status === 'open' ? 'Ochiq' : 'Qo‘llanildi'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <LedgerDialog
          doctors={doctors}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'ledger'] });
            qc.invalidateQueries({ queryKey: ['payroll', 'balances'] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function LedgerDialog({
  doctors,
  onClose,
  onSaved,
}: {
  doctors: Doctor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const [kind, setKind] = useState<'advance' | 'bonus' | 'penalty' | 'adjustment' | 'debt_write_off'>('advance');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Avans limiti uchun joriy oy net hisobi
  const monthRange = useMemo(() => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return {
      from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }, []);
  const currentPeriod = useQuery({
    queryKey: ['payroll', 'period-summary', doctorId, monthRange.from, monthRange.to],
    queryFn: () => api.payroll.periodSummary(doctorId, monthRange.from, monthRange.to),
    enabled: !!doctorId && kind === 'advance',
  });
  const ADVANCE_LIMIT_PCT = 50; // joriy oy gross'idan maks foiz
  const periodGross = Number(
    (currentPeriod.data as Array<{ gross_uzs: number }> | undefined)?.[0]?.gross_uzs ?? 0,
  );
  const advancesAlready = Number(
    (currentPeriod.data as Array<{ advances_uzs: number }> | undefined)?.[0]?.advances_uzs ?? 0,
  );
  const advanceLimit = Math.floor((periodGross * ADVANCE_LIMIT_PCT) / 100);
  const advanceAvailable = Math.max(0, advanceLimit - advancesAlready);
  const advanceAmt = Math.max(0, Number(amount) || 0);
  const advanceOverLimit =
    kind === 'advance' && periodGross > 0 && advanceAmt > advanceAvailable;

  const save = useMutation({
    mutationFn: () =>
      api.payroll.createLedger({
        doctor_id: doctorId,
        kind,
        amount_uzs: Number(amount) || 0,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi yozuv</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Xodim</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tur</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="advance">Avans</SelectItem>
                <SelectItem value="bonus">Bonus</SelectItem>
                <SelectItem value="penalty">Jarima</SelectItem>
                <SelectItem value="adjustment">Tuzatish</SelectItem>
                <SelectItem value="debt_write_off">Qarz hisobdan chiqarish</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Summa (so‘m)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100000"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {kind === 'advance' || kind === 'penalty' || kind === 'debt_write_off'
                ? 'Xodim qoldig‘idan ayriladi'
                : 'Xodim qoldig‘iga qo‘shiladi'}
            </p>
            {kind === 'advance' && doctorId && periodGross > 0 && (
              <div className={`mt-2 rounded-md border p-2 text-xs ${advanceOverLimit ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
                <div>Joriy oy gross: <strong>{fmt(periodGross)}</strong> so'm</div>
                <div>Limit ({ADVANCE_LIMIT_PCT}%): <strong>{fmt(advanceLimit)}</strong> so'm</div>
                <div>Allaqachon olingan avans: <strong>{fmt(advancesAlready)}</strong> so'm</div>
                <div>Hozir berish mumkin: <strong>{fmt(advanceAvailable)}</strong> so'm</div>
                {advanceOverLimit && (
                  <div className="mt-1 font-semibold">⚠ Limitdan oshib ketdi!</div>
                )}
              </div>
            )}
          </div>
          <div>
            <Label>Izoh</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => save.mutate()} disabled={!doctorId || !amount || save.isPending || advanceOverLimit}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------
function PayoutsTab({ doctors }: { doctors: Doctor[] }) {
  const qc = useQueryClient();
  const payouts = useQuery({ queryKey: ['payroll', 'payouts'], queryFn: () => api.payroll.listPayouts() });
  const [open, setOpen] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Yangi to‘lov
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {(payouts.data ?? []).length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="h-8 w-8" />}
              title="To‘lovlar yo‘q"
              description="Xodimlarga haftalik yoki oylik ulush hisoblang"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Xodim</th>
                    <th className="px-4 py-2.5">Davr</th>
                    <th className="px-4 py-2.5 text-right">Hisoblangan</th>
                    <th className="px-4 py-2.5 text-right">Avans</th>
                    <th className="px-4 py-2.5 text-right">Tuzatish</th>
                    <th className="px-4 py-2.5 text-right">To‘lanadi</th>
                    <th className="px-4 py-2.5">Holat</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(payouts.data ?? []).map((p) => {
                    const s = STATUS_LABEL[p.status] ?? { label: p.status, tone: 'default' as const };
                    return (
                      <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium">{p.doctor?.full_name ?? '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {p.period_label ?? `${p.period_start} → ${p.period_end}`}
                        </td>
                        <td className="px-4 py-2.5 text-right">{fmt(p.gross_commission_uzs)}</td>
                        <td className="px-4 py-2.5 text-right text-red-600">{fmt(p.advances_uzs)}</td>
                        <td className="px-4 py-2.5 text-right">{fmt(p.adjustments_uzs)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmt(p.net_uzs)}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={s.tone}>{s.label}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {p.status === 'draft' && (
                            <Button size="sm" onClick={() => setPayingId(p.id)}>
                              To‘lash
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <PayoutDialog
          doctors={doctors}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'payouts'] });
            qc.invalidateQueries({ queryKey: ['payroll', 'balances'] });
            setOpen(false);
          }}
        />
      )}
      {payingId && (
        <PayDialog
          id={payingId}
          onClose={() => setPayingId(null)}
          onPaid={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'payouts'] });
            qc.invalidateQueries({ queryKey: ['payroll', 'balances'] });
            setPayingId(null);
          }}
        />
      )}
    </div>
  );
}

function PayoutDialog({
  doctors,
  onClose,
  onSaved,
}: {
  doctors: Doctor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(lastDay);
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.payroll.createPayout({
        doctor_id: doctorId,
        period_start: from,
        period_end: to,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('To‘lov qoralamasi yaratildi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi to‘lov</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Xodim</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Boshlanish</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>Tugash</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Izoh</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Davrdagi barcha hisoblangan ulushlar va ochiq avans/bonuslar avtomatik yig‘iladi
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => save.mutate()} disabled={!doctorId || save.isPending}>
            Yaratish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ id, onClose, onPaid }: { id: string; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState<'cash' | 'card' | 'humo' | 'uzcard' | 'click' | 'payme' | 'bank_transfer'>('cash');
  const [reference, setReference] = useState('');
  const details = useQuery({ queryKey: ['payroll', 'payout', id], queryFn: () => api.payroll.getPayout(id) });
  const payout = details.data?.payout as { net_uzs?: number; doctor?: { full_name?: string } } | undefined;

  const pay = useMutation({
    mutationFn: () => api.payroll.pay(id, { method, reference: reference || undefined }),
    onSuccess: () => {
      toast.success('To‘landi');
      onPaid();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>To‘lov amalga oshirish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Xodim</span>
              <span className="font-medium">{payout?.doctor?.full_name ?? '-'}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">Summa</span>
              <span className="font-semibold">{fmt(Number(payout?.net_uzs ?? 0))} so‘m</span>
            </div>
          </div>
          <div>
            <Label>Usul</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Plastik</SelectItem>
                <SelectItem value="humo">Humo</SelectItem>
                <SelectItem value="uzcard">Uzcard</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="bank_transfer">Bank o‘tkazma</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reference (ixtiyoriy)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => pay.mutate()} disabled={pay.isPending}>
            Tasdiqlash va to‘lash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
