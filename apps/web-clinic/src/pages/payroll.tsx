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
  X,
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
import { SourcePicker } from '@/components/cashier/source-picker';
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

      <PaydayReminder />

      {tab === 'overview' && <OverviewTab balances={balances.data ?? []} />}
      {tab === 'rates' && <RatesTab doctors={doctors} />}
      {tab === 'ledger' && <LedgerTab doctors={doctors} />}
      {tab === 'payouts' && <PayoutsTab doctors={doctors} />}
    </div>
  );
}

// Joriy oyda oylik berish kuni kelgan (yoki o'tgan), lekin hali to'lov qilinmagan
// xodimlar haqida eslatma. X bossa sessiya davomida yopiladi.
function PaydayReminder() {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('payday-reminder-dismissed') === '1',
  );
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const { data } = useQuery({
    queryKey: ['payroll', 'payday-status', from, to],
    queryFn: () => api.payroll.paydayStatus(from, to),
    refetchInterval: 5 * 60_000,
  });

  const due = (data ?? []).filter((d) => d.due);
  if (dismissed || due.length === 0) return null;

  const names = due.map((d) => d.doctor_name).join(', ');
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Oylik berish vaqti keldi!</div>
        <div className="mt-0.5">
          Quyidagi {due.length} xodimga oylik berish kerak:{' '}
          <span className="font-medium">{names}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem('payday-reminder-dismissed', '1');
          setDismissed(true);
        }}
        className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100"
        title="Yopish"
      >
        <X className="h-4 w-4" />
      </button>
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

type Period = 'current_month' | 'last_month' | 'quarter' | 'year' | 'all' | 'custom';

function periodRange(p: Exclude<Period, 'custom'>): { from: string; to: string; label: string } {
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
  const isoToday = new Date().toISOString().slice(0, 10);
  const monthStart = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); })();
  const [customFrom, setCustomFrom] = useState(monthStart);
  const [customTo, setCustomTo] = useState(isoToday);
  const range = useMemo(
    () =>
      period === 'custom'
        ? { from: customFrom, to: customTo, label: `${customFrom} → ${customTo}` }
        : periodRange(period),
    [period, customFrom, customTo],
  );

  // Shifokor drill-down (jurnaldek) — bosilgan shifokor summary qatori
  const [drill, setDrill] = useState<
    | (Awaited<ReturnType<typeof api.payroll.clinicPeriodSummary>>[number])
    | null
  >(null);
  // Maosh berish (createPayout owed_from→cutoff + pay + chek) — tanlangan owed qatori
  const [payNow, setPayNow] = useState<Awaited<ReturnType<typeof api.payroll.outstanding>>[number] | null>(null);

  const summary = useQuery({
    queryKey: ['payroll', 'clinic-period', range.from, range.to],
    queryFn: () => api.payroll.clinicPeriodSummary(range.from, range.to),
  });

  // Klinika vs shifokor ulushi (gross − komissiya)
  const share = useQuery({
    queryKey: ['payroll', 'share', range.from, range.to],
    queryFn: () => api.payroll.shareSummary(range.from, range.to),
  });
  const grossByDoctor = useMemo(
    () => new Map((share.data?.by_doctor ?? []).map((d) => [d.doctor_id, d])),
    [share.data],
  );

  // Berilmagan maosh — "oxirgi to'lovdan beri" (cutoff = range.to)
  const outstanding = useQuery({
    queryKey: ['payroll', 'outstanding', range.to],
    queryFn: () => api.payroll.outstanding(range.to),
  });
  const owedByDoctor = useMemo(
    () => new Map((outstanding.data ?? []).map((d) => [d.doctor_id, d])),
    [outstanding.data],
  );
  const owedList = useMemo(
    () => (outstanding.data ?? []).filter((d) => d.owed_uzs > 0),
    [outstanding.data],
  );
  const owedTotal = useMemo(
    () => (outstanding.data ?? []).reduce((s, d) => s + Number(d.owed_uzs ?? 0), 0),
    [outstanding.data],
  );

  // Statsionar payroll har xodim uchun (doctor_id -> summa)
  const inpatientPayroll = useQuery({
    queryKey: ['payroll', 'inpatient-period', range.from, range.to],
    queryFn: () => api.payroll.inpatientPayrollByPeriod(range.from, range.to),
  });
  const inpatientMap = (inpatientPayroll.data ?? {}) as Record<string, number>;

  // Mavjud payout'lar — duplicate'ni oldini olish uchun.
  // Shu davr (range.from, range.to) ichida xodimga payout bo'lganmi tekshiramiz.
  const existingPayouts = useQuery({
    queryKey: ['payroll', 'payouts'],
    queryFn: () => api.payroll.listPayouts(),
  });
  // Oylik oldi/olmadi holati (tanlangan davr bo'yicha)
  const paydayStatus = useQuery({
    queryKey: ['payroll', 'payday-status', range.from, range.to],
    queryFn: () => api.payroll.paydayStatus(range.from, range.to),
  });
  const paidList = (paydayStatus.data ?? []).filter((d) => d.paid);

  // To'langan payout davri (qaysi kundan qaysi kungacha) — doctor_id bo'yicha
  const paidPeriodByDoctor = useMemo(() => {
    const m = new Map<string, { period_start: string; period_end: string }>();
    for (const p of (existingPayouts.data ?? []) as Array<{ doctor_id: string; status: string; period_start: string; period_end: string }>) {
      if (p.status !== 'paid') continue;
      m.set(p.doctor_id, { period_start: p.period_start, period_end: p.period_end });
    }
    return m;
  }, [existingPayouts.data]);

  // Qoralama (draft) payout bor shifokorlar — ikki marta yaratmaslik uchun
  const draftByDoctor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of (existingPayouts.data ?? []) as Array<{ id: string; doctor_id: string; status: string }>) {
      if (p.status === 'draft') m.set(p.doctor_id, p.id);
    }
    return m;
  }, [existingPayouts.data]);

  // Har xodim bo'yicha to'langan/qoldiq (jadval ustunlari uchun) + jami summalar.
  const payInfo = useMemo(
    () => new Map((paydayStatus.data ?? []).map((d) => [d.doctor_id, d])),
    [paydayStatus.data],
  );
  const paidTotal = (paydayStatus.data ?? []).reduce((s, d) => s + Number(d.paid_uzs ?? 0), 0);

  // Payslip uchun klinika nomi/manzili kerak
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{ clinic?: { name?: string; address?: string; phone?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicInfo = (me.data as { clinic?: { name?: string; address?: string; phone?: string } } | undefined)?.clinic;

  const qc = useQueryClient();

  // Bulk payout — owed > 0 va qoralamasi yo'q xodimlarga [owed_from → cutoff] payout
  const bulkPayoutMut = useMutation({
    mutationFn: async () => {
      const eligible = owedList.filter((d) => !draftByDoctor.has(d.doctor_id));
      if (eligible.length === 0) throw new Error("To'lanadigan xodim yo'q (yoki qoralamada turibdi)");
      let ok = 0;
      let fail = 0;
      for (const d of eligible) {
        try {
          await api.payroll.createPayout({
            doctor_id: d.doctor_id,
            period_start: d.owed_from,
            period_end: d.owed_to,
            period_label: `${d.owed_from} → ${d.owed_to}`,
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {(
              [
                { id: 'current_month', label: 'Joriy oy' },
                { id: 'last_month', label: "O'tgan oy" },
                { id: 'quarter', label: 'Kvartal' },
                { id: 'year', label: 'Yil' },
                { id: 'all', label: 'Hammasi' },
                { id: 'custom', label: 'Sanadan-sanagacha' },
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
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => { setCustomFrom(monthStart); setCustomTo(isoToday); setPeriod('custom'); }}
            title="Oy boshidan bugungacha"
          >
            Bugungacha
          </Button>
          {period === 'custom' && (
            <div className="flex items-center gap-1.5">
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-36 text-xs" />
              <span className="text-xs text-muted-foreground">→</span>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">
            {range.from} → {range.to}
          </div>
          <Button
            size="sm"
            onClick={() => {
              const eligible = owedList.filter((d) => !draftByDoctor.has(d.doctor_id));
              const total = eligible.reduce((s, d) => s + Number(d.owed_uzs), 0);
              const skipped = owedList.filter((d) => draftByDoctor.has(d.doctor_id)).length;
              if (eligible.length === 0) {
                toast.error(
                  skipped > 0
                    ? `${skipped} xodim qoralamada — To'lovlar tabida tasdiqlang`
                    : "Berilmagan maosh yo'q",
                );
                return;
              }
              const skipMsg = skipped > 0 ? ` (${skipped} ta qoralamada — o'tkazib yuboriladi)` : '';
              if (confirm(`${eligible.length} xodimga jami ${fmt(total)} so'm payout (qoralama) yaratilsinmi?${skipMsg}`)) {
                bulkPayoutMut.mutate();
              }
            }}
            disabled={bulkPayoutMut.isPending || owedList.length === 0}
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

      {/* To'langan / To'lanmagan maosh — jami summalar (aniq ajratilgan) */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="To'langan maosh"
          value={`${fmt(paidTotal)} so'm`}
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Berilmagan (oxirgi to'lovdan beri)"
          value={`${fmt(owedTotal)} so'm`}
          icon={<ArrowUpRight className="h-4 w-4" />}
          tone={owedTotal > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* Klinika ulushi vs Shifokorlar ulushi (xizmat summasi − komissiya) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ulush taqsimoti — {range.label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatCard label="Xizmatlar summasi (gross)" value={`${fmt(share.data?.total_gross_uzs ?? 0)} so'm`} icon={<Coins className="h-4 w-4" />} />
            <StatCard label="Shifokorlar ulushi (komissiya)" value={`${fmt(share.data?.total_commission_uzs ?? 0)} so'm`} icon={<Stethoscope className="h-4 w-4" />} tone="info" />
            <StatCard label="Klinika ulushi" value={`${fmt(share.data?.clinic_share_uzs ?? 0)} so'm`} icon={<Wallet className="h-4 w-4" />} tone="success" />
          </div>
          {(share.data?.total_gross_uzs ?? 0) > 0 && (
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-sky-500"
                  style={{ width: `${Math.round(((share.data?.total_commission_uzs ?? 0) / (share.data?.total_gross_uzs || 1)) * 100)}%` }}
                  title="Shifokorlar ulushi"
                />
                <div className="flex-1 bg-emerald-500" title="Klinika ulushi" />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>Shifokorlar: {Math.round(((share.data?.total_commission_uzs ?? 0) / (share.data?.total_gross_uzs || 1)) * 100)}%</span>
                <span>Klinika: {Math.round(((share.data?.clinic_share_uzs ?? 0) / (share.data?.total_gross_uzs || 1)) * 100)}%</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Oylik oldi / olishi kerak — 2 ro'yxat */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowDownRight className="h-4 w-4 text-emerald-600" />
              Oylik oldi ({paidList.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {paidList.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Hali oylik berilmagan</div>
            ) : (
              <div className="divide-y">
                {paidList.map((d) => {
                  const per = paidPeriodByDoctor.get(d.doctor_id);
                  return (
                    <div key={d.doctor_id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <div className="text-sm font-medium">{d.doctor_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {per ? `${per.period_start} → ${per.period_end}` : ''}
                          {d.paid_at ? ` · ${new Date(d.paid_at).toLocaleDateString('uz-UZ')}` : ''}
                        </div>
                      </div>
                      <Badge variant="success">To'langan</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={owedList.some((d) => payInfo.get(d.doctor_id)?.due) ? 'border-amber-300' : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpRight className="h-4 w-4 text-amber-600" />
              Oylik olishi kerak ({owedList.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {owedList.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Berilmagan maosh yo'q</div>
            ) : (
              <div className="divide-y">
                {owedList.map((d) => {
                  const row = rows.find((x) => x.doctor_id === d.doctor_id);
                  const due = payInfo.get(d.doctor_id)?.due;
                  const hasDraft = draftByDoctor.has(d.doctor_id);
                  return (
                    <button
                      key={d.doctor_id}
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30"
                      onClick={() => row && setDrill(row)}
                      title="Batafsil — kim qancha topgani (jurnaldek)"
                    >
                      <div>
                        <div className="text-sm font-medium">{d.doctor_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {d.owed_from} → {d.owed_to} · <strong>{fmt(d.owed_uzs)}</strong> so'm
                        </div>
                      </div>
                      {hasDraft ? (
                        <Badge variant="info">Qoralama</Badge>
                      ) : due ? (
                        <Badge variant="warning">Vaqti keldi</Badge>
                      ) : (
                        <Badge variant="info">Kutilmoqda</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
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
                    <th className="px-3 py-2.5 text-right" title="Statsionar payroll (kunlik foiz/oylik + admission bonuslari)">Statsionar</th>
                    <th className="px-3 py-2.5 text-right">Avans</th>
                    <th className="px-3 py-2.5 text-right">Jarima</th>
                    <th className="px-3 py-2.5 text-right">Gross</th>
                    <th className="px-3 py-2.5 text-right">NET</th>
                    <th className="px-3 py-2.5 text-center">Oxirgi to'lov</th>
                    <th className="px-3 py-2.5 text-right" title="Oxirgi to'lovdan beri berilmagan">Berilmagan</th>
                    <th className="px-3 py-2.5 text-center">Holat</th>
                    <th className="px-3 py-2.5 text-center">Maosh</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.doctor_id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-medium">
                        <button
                          type="button"
                          className="text-left hover:text-primary hover:underline"
                          onClick={() => setDrill(r)}
                          title="Batafsil — kunlar/xizmatlar (jurnaldek)"
                        >
                          {r.doctor_name}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmt(r.commissions_uzs)}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(r.monthly_base_uzs)}</td>
                      <td className="px-3 py-2.5 text-right text-emerald-600">{r.bonuses_uzs > 0 ? `+${fmt(r.bonuses_uzs)}` : '0'}</td>
                      <td className="px-3 py-2.5 text-right text-sky-700">{(inpatientMap[r.doctor_id] ?? 0) > 0 ? fmt(inpatientMap[r.doctor_id] ?? 0) : '0'}</td>
                      <td className="px-3 py-2.5 text-right text-red-600">{r.advances_uzs > 0 ? `−${fmt(r.advances_uzs)}` : '0'}</td>
                      <td className="px-3 py-2.5 text-right text-red-600">{r.penalties_uzs > 0 ? `−${fmt(r.penalties_uzs)}` : '0'}</td>
                      <td className="px-3 py-2.5 text-right">{fmt(r.gross_uzs)}</td>
                      <td className={'px-3 py-2.5 text-right font-semibold ' + (r.net_uzs < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {fmt(r.net_uzs)}
                      </td>
                      <td className="px-3 py-2.5 text-center text-[11px] text-muted-foreground">
                        {owedByDoctor.get(r.doctor_id)?.last_paid_period_end ?? '—'}
                      </td>
                      <td className={'px-3 py-2.5 text-right ' + ((owedByDoctor.get(r.doctor_id)?.owed_uzs ?? 0) > 0 ? 'font-medium text-amber-600' : 'text-muted-foreground')}>
                        {(owedByDoctor.get(r.doctor_id)?.owed_uzs ?? 0) !== 0 ? fmt(owedByDoctor.get(r.doctor_id)?.owed_uzs ?? 0) : '—'}
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
                        {draftByDoctor.has(r.doctor_id) ? (
                          <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800" title="To'lovlar tabida tasdiqlang">
                            Qoralama
                          </span>
                        ) : (owedByDoctor.get(r.doctor_id)?.owed_uzs ?? 0) > 0 ? (
                          <Button
                            size="sm"
                            className="h-7 gap-1"
                            onClick={() => { const o = owedByDoctor.get(r.doctor_id); if (o) setPayNow(o); }}
                            title="Maosh berish (oxirgi to'lovdan beri)"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                            Maosh berish
                          </Button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600" title="Berilmagan yo'q">
                            ✓ Berilgan
                          </span>
                        )}
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
                    <td className="px-3 py-2 text-right text-sky-700">{fmt(Object.values(inpatientMap).reduce<number>((s, n) => s + Number(n ?? 0), 0))}</td>
                    <td className="px-3 py-2 text-right text-red-700">{fmt(periodTotals.advances)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{fmt(periodTotals.penalties)}</td>
                    <td className="px-3 py-2 text-right">{fmt(periodTotals.gross)}</td>
                    <td className={'px-3 py-2 text-right ' + (periodTotals.net < 0 ? 'text-red-700' : 'text-emerald-700')}>
                      {fmt(periodTotals.net)}
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right text-amber-700">{fmt(owedTotal)}</td>
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

      {drill && (
        <DoctorEarningsDialog
          row={drill}
          from={owedByDoctor.get(drill.doctor_id)?.owed_from ?? range.from}
          to={range.to}
          gross={grossByDoctor.get(drill.doctor_id)}
          owed={owedByDoctor.get(drill.doctor_id)}
          hasDraft={draftByDoctor.has(drill.doctor_id)}
          clinicInfo={clinicInfo}
          onClose={() => setDrill(null)}
          onPay={(o) => { setDrill(null); setPayNow(o); }}
        />
      )}

      {payNow && (
        <PayNowDialog
          owed={payNow}
          clinicInfo={clinicInfo}
          onClose={() => setPayNow(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: ['payroll'] }); setPayNow(null); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shifokor drill-down — kunlar/xizmatlar (jurnaldek) + chek + payout
// ---------------------------------------------------------------------------
function DoctorEarningsDialog({
  row,
  from,
  to,
  gross,
  owed,
  hasDraft,
  clinicInfo,
  onClose,
  onPay,
}: {
  row: Awaited<ReturnType<typeof api.payroll.clinicPeriodSummary>>[number];
  from: string;
  to: string;
  gross?: { gross_uzs: number; commission_uzs: number; clinic_share_uzs: number; tx_count: number };
  owed?: Awaited<ReturnType<typeof api.payroll.outstanding>>[number];
  hasDraft?: boolean;
  clinicInfo?: { name?: string; address?: string; phone?: string };
  onClose: () => void;
  onPay: (owed: Awaited<ReturnType<typeof api.payroll.outstanding>>[number]) => void;
}) {
  const earnings = useQuery({
    queryKey: ['payroll', 'doctor-earnings', row.doctor_id, from, to],
    queryFn: () => api.payroll.doctorEarnings(row.doctor_id, from, to),
  });
  const items = earnings.data ?? [];

  const byDay = useMemo(() => {
    const m = new Map<string, { day: string; items: typeof items; total: number }>();
    for (const r of items) {
      const day = r.date.slice(0, 10);
      const cur = m.get(day) ?? { day, items: [] as typeof items, total: 0 };
      cur.items.push(r);
      cur.total += Number(r.amount_uzs);
      m.set(day, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.day.localeCompare(a.day));
  }, [items]);

  const earnedTotal = items.reduce((s, r) => s + Number(r.amount_uzs), 0);
  const owedUzs = Number(owed?.owed_uzs ?? 0);

  const printChek = () => {
    // Owed (oxirgi to'lovdan beri) bo'lsa o'shani, bo'lmasa tanlangan davr summary.
    const c = owed
      ? {
          commissions: owed.accrued_commissions_uzs,
          base: owed.base_uzs,
          bonuses: owed.bonuses_uzs,
          advances: owed.advances_uzs,
          penalties: owed.penalties_uzs,
          net: owed.owed_uzs,
        }
      : {
          commissions: Number(row.commissions_uzs),
          base: Number(row.monthly_base_uzs),
          bonuses: Number(row.bonuses_uzs),
          advances: Number(row.advances_uzs),
          penalties: Number(row.penalties_uzs),
          net: Number(row.net_uzs),
        };
    printPayslip(
      {
        clinic_name: clinicInfo?.name ?? 'Klinika',
        clinic_address: clinicInfo?.address,
        clinic_phone: clinicInfo?.phone,
        employee_name: row.doctor_name,
        period_from: from,
        period_to: to,
        commissions_uzs: c.commissions,
        monthly_base_uzs: c.base,
        bonuses_uzs: c.bonuses,
        advances_uzs: c.advances,
        penalties_uzs: c.penalties,
        gross_uzs: c.commissions + c.base + c.bonuses,
        deductions_uzs: c.advances + c.penalties,
        net_uzs: c.net,
        generated_at: new Date().toISOString(),
      },
      'a4',
    );
  };

  const fmtDay = (d: string) =>
    new Date(d).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.doctor_name} — topgani (kunlar/xizmatlar)</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 text-sm md:grid-cols-4">
          <div><div className="text-[10px] uppercase text-muted-foreground">Davr</div><div className="text-xs font-medium">{from} → {to}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Xizmat summasi</div><div className="font-mono font-semibold">{fmt(gross?.gross_uzs ?? 0)}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Komissiya (topgani)</div><div className="font-mono font-semibold text-sky-700">{fmt(earnedTotal)}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Berilmagan</div><div className="font-mono font-bold text-amber-700">{fmt(owedUzs)}</div></div>
        </div>

        {earnings.isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : byDay.length === 0 ? (
          <EmptyState icon={<ReceiptText className="h-8 w-8" />} title="Yozuv yo'q" description="Bu davrda komissiya yozuvi topilmadi." />
        ) : (
          <div className="space-y-3">
            {byDay.map((d) => (
              <div key={d.day} className="overflow-hidden rounded-md border">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5 text-xs font-semibold">
                  <span>{fmtDay(d.day)}</span>
                  <span className="font-mono">{fmt(d.total)} so'm</span>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {d.items.map((it) => (
                      <tr key={it.id} className="hover:bg-muted/20">
                        <td className="px-3 py-1.5">{it.patient_name ?? '—'}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{it.service_name ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs">{fmt(it.gross_uzs)}</td>
                        <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">{it.percent}%</td>
                        <td className="px-3 py-1.5 text-right font-mono font-medium text-sky-700">{fmt(it.amount_uzs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={printChek} className="gap-1">
            <Printer className="h-4 w-4" /> Chek (A4)
          </Button>
          {hasDraft ? (
            <Button disabled variant="outline">Qoralama — To'lovlar tabida</Button>
          ) : owed && owedUzs > 0 ? (
            <Button onClick={() => onPay(owed)} className="gap-1">
              <Wallet className="h-4 w-4" /> Maosh berish ({fmt(owedUzs)})
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Maosh berish — createPayout(owed_from→cutoff) + pay(usul/source) + chek
// ---------------------------------------------------------------------------
function PayNowDialog({
  owed,
  clinicInfo,
  onClose,
  onDone,
}: {
  owed: Awaited<ReturnType<typeof api.payroll.outstanding>>[number];
  clinicInfo?: { name?: string; address?: string; phone?: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<'cash' | 'card' | 'humo' | 'uzcard' | 'click' | 'payme' | 'bank_transfer'>('cash');
  const [source, setSource] = useState<'cash_drawer' | 'safe'>('cash_drawer');

  const printChek = () => {
    printPayslip(
      {
        clinic_name: clinicInfo?.name ?? 'Klinika',
        clinic_address: clinicInfo?.address,
        clinic_phone: clinicInfo?.phone,
        employee_name: owed.doctor_name,
        period_from: owed.owed_from,
        period_to: owed.owed_to,
        commissions_uzs: Number(owed.accrued_commissions_uzs),
        monthly_base_uzs: Number(owed.base_uzs),
        bonuses_uzs: Number(owed.bonuses_uzs),
        advances_uzs: Number(owed.advances_uzs),
        penalties_uzs: Number(owed.penalties_uzs),
        gross_uzs: Number(owed.accrued_commissions_uzs) + Number(owed.base_uzs) + Number(owed.bonuses_uzs),
        deductions_uzs: Number(owed.advances_uzs) + Number(owed.penalties_uzs),
        net_uzs: Number(owed.owed_uzs),
        generated_at: new Date().toISOString(),
      },
      'a4',
    );
  };

  const pay = useMutation({
    mutationFn: async () => {
      const payout = await api.payroll.createPayout({
        doctor_id: owed.doctor_id,
        period_start: owed.owed_from,
        period_end: owed.owed_to,
        period_label: `${owed.owed_from} → ${owed.owed_to}`,
      });
      await api.payroll.pay((payout as { id: string }).id, { method, source });
      return payout;
    },
    onSuccess: () => {
      toast.success('Maosh berildi');
      printChek();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Maosh berish — {owed.doctor_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Davr</span><span className="font-medium">{owed.owed_from} → {owed.owed_to}</span></div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-muted-foreground">Beriladi (berilmagan)</span>
              <span className="text-lg font-bold text-emerald-600">{fmt(owed.owed_uzs)} so'm</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              <span>Komissiya: {fmt(owed.accrued_commissions_uzs)}</span>
              {owed.base_uzs > 0 && <span>Oylik fix: {fmt(owed.base_uzs)}</span>}
              {owed.bonuses_uzs > 0 && <span>Bonus: +{fmt(owed.bonuses_uzs)}</span>}
              {owed.advances_uzs > 0 && <span>Avans: −{fmt(owed.advances_uzs)}</span>}
              {owed.penalties_uzs > 0 && <span>Jarima: −{fmt(owed.penalties_uzs)}</span>}
            </div>
          </div>
          <div>
            <Label>Usul</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Plastik</SelectItem>
                <SelectItem value="humo">Humo</SelectItem>
                <SelectItem value="uzcard">Uzcard</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="bank_transfer">Bank o'tkazma</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SourcePicker value={source} onChange={setSource} amount={Number(owed.owed_uzs)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button onClick={() => pay.mutate()} disabled={pay.isPending || owed.owed_uzs <= 0}>
            To'lash va chek
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
type PayoutDateFilter = 'all' | 'today' | 'week' | 'month' | 'custom';
type PayoutStatusFilter = 'all' | 'paid' | 'draft' | 'approved' | 'advance' | 'canceled';

function payoutDateRange(f: PayoutDateFilter): { from: string | null; to: string | null } {
  if (f === 'all' || f === 'custom') return { from: null, to: null };
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (f === 'today') return { from: iso(new Date(y, m, d)), to: iso(new Date(y, m, d)) };
  if (f === 'week') {
    const dow = today.getDay() || 7; // 1..7 (Mon..Sun)
    return { from: iso(new Date(y, m, d - dow + 1)), to: iso(new Date(y, m, d - dow + 7)) };
  }
  // month
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}

function PayoutsTab({ doctors }: { doctors: Doctor[] }) {
  const qc = useQueryClient();
  const payouts = useQuery({ queryKey: ['payroll', 'payouts'], queryFn: () => api.payroll.listPayouts() });
  const [open, setOpen] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Klinika ma'lumotlari payslip uchun
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{ clinic?: { name?: string; address?: string; phone?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicInfo = (me.data as { clinic?: { name?: string; address?: string; phone?: string } } | undefined)?.clinic;

  // Filter holati
  const [dateFilter, setDateFilter] = useState<PayoutDateFilter>('all');
  const [statusFilter, setStatusFilter] = useState<PayoutStatusFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { from: presetFrom, to: presetTo } = useMemo(() => payoutDateRange(dateFilter), [dateFilter]);
  const effFrom = dateFilter === 'custom' ? (customFrom || null) : presetFrom;
  const effTo = dateFilter === 'custom' ? (customTo || null) : presetTo;

  const filteredPayouts = useMemo(() => {
    const all = payouts.data ?? [];
    return all.filter((p) => {
      // Holat filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'advance') {
          // "Avans berilgan" — payout'da avans summasi > 0
          if (!(Number(p.advances_uzs) > 0)) return false;
        } else if (p.status !== statusFilter) {
          return false;
        }
      }
      // Sana filter — payout davriga tegishli (overlap)
      if (effFrom && p.period_end < effFrom) return false;
      if (effTo && p.period_start > effTo) return false;
      return true;
    });
  }, [payouts.data, statusFilter, effFrom, effTo]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Sana preset */}
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {(
              [
                { id: 'all', label: 'Hammasi' },
                { id: 'today', label: 'Kunlik' },
                { id: 'week', label: 'Haftalik' },
                { id: 'month', label: 'Oylik' },
                { id: 'custom', label: 'Sanadan-sanagacha' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDateFilter(p.id)}
                className={
                  'rounded px-3 py-1.5 text-xs font-medium transition ' +
                  (dateFilter === p.id ? 'bg-background shadow-sm' : 'text-muted-foreground')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Custom sanalar */}
          {dateFilter === 'custom' && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-36 text-xs"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-36 text-xs"
              />
            </div>
          )}
          {/* Holat filter */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PayoutStatusFilter)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha holatlar</SelectItem>
              <SelectItem value="paid">To'langan</SelectItem>
              <SelectItem value="advance">Avans berilgan</SelectItem>
              <SelectItem value="draft">Qoralama</SelectItem>
              <SelectItem value="approved">Tasdiqlangan</SelectItem>
              <SelectItem value="canceled">Bekor qilingan</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            {filteredPayouts.length} / {(payouts.data ?? []).length}
          </div>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Yangi to‘lov
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredPayouts.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="h-8 w-8" />}
              title="To‘lovlar yo‘q"
              description={(payouts.data ?? []).length === 0 ? "Xodimlarga haftalik yoki oylik ulush hisoblang" : "Filterga mos to'lov topilmadi"}
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
                  {filteredPayouts.map((p) => {
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
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1"
                              onClick={() => setPrintingId(p.id)}
                              title="Maosh varaqasini chop etish"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Chop
                            </Button>
                            {p.status === 'draft' && (
                              <Button size="sm" onClick={() => setPayingId(p.id)}>
                                To‘lash
                              </Button>
                            )}
                          </div>
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
      {printingId && (
        <PayoutPrintDialog
          id={printingId}
          clinicInfo={clinicInfo}
          onClose={() => setPrintingId(null)}
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
  const [source, setSource] = useState<'cash_drawer' | 'safe'>('cash_drawer');
  const details = useQuery({ queryKey: ['payroll', 'payout', id], queryFn: () => api.payroll.getPayout(id) });
  const payout = details.data?.payout as { net_uzs?: number; doctor?: { full_name?: string } } | undefined;

  const pay = useMutation({
    mutationFn: () => api.payroll.pay(id, { method, reference: reference || undefined, source }),
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
          <SourcePicker value={source} onChange={setSource} amount={Number(payout?.net_uzs ?? 0)} />
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

// ---------------------------------------------------------------------------
// Payout uchun payslip print dialogi (A4 PDF / 80mm / 58mm)
// ---------------------------------------------------------------------------
function PayoutPrintDialog({
  id,
  clinicInfo,
  onClose,
}: {
  id: string;
  clinicInfo?: { name?: string; address?: string; phone?: string };
  onClose: () => void;
}) {
  const details = useQuery({
    queryKey: ['payroll', 'payout', id],
    queryFn: () => api.payroll.getPayout(id),
  });
  const payout = details.data?.payout as
    | {
        period_start: string;
        period_end: string;
        gross_commission_uzs: number;
        advances_uzs: number;
        adjustments_uzs: number;
        net_uzs: number;
        doctor?: { full_name?: string };
      }
    | undefined;

  const handleFormat = (format: PayslipFormat) => {
    if (!payout) return;
    printPayslip(
      {
        clinic_name: clinicInfo?.name ?? 'Klinika',
        clinic_address: clinicInfo?.address,
        clinic_phone: clinicInfo?.phone,
        employee_name: payout.doctor?.full_name ?? '-',
        period_from: payout.period_start,
        period_to: payout.period_end,
        commissions_uzs: Number(payout.gross_commission_uzs),
        monthly_base_uzs: 0,
        bonuses_uzs: Math.max(0, Number(payout.adjustments_uzs)),
        advances_uzs: Math.abs(Number(payout.advances_uzs)),
        penalties_uzs: 0,
        gross_uzs: Number(payout.gross_commission_uzs),
        deductions_uzs: Math.abs(Number(payout.advances_uzs)),
        net_uzs: Number(payout.net_uzs),
        generated_at: new Date().toISOString(),
      },
      format,
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Maosh varaqasi formatini tanlang</DialogTitle>
        </DialogHeader>
        {payout && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-semibold">{payout.doctor?.full_name ?? '-'}</div>
            <div className="text-xs text-muted-foreground">
              Davr: {payout.period_start} → {payout.period_end}
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Sof maosh (NET):</span>
              <span className="text-lg font-bold text-emerald-600">
                {fmt(Number(payout.net_uzs))} so'm
              </span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 pt-2">
          <button
            type="button"
            onClick={() => handleFormat('a4')}
            disabled={!payout}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-3 transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="rounded-lg bg-blue-100 p-2.5 text-blue-700 transition group-hover:bg-blue-200">
              <FileType className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold">A4 PDF</div>
            <div className="text-[10px] text-center text-muted-foreground">.pdf yuklab olish</div>
          </button>
          <button
            type="button"
            onClick={() => handleFormat('80mm')}
            disabled={!payout}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-3 transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="rounded-lg bg-amber-100 p-2.5 text-amber-700 transition group-hover:bg-amber-200">
              <FileText className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold">80mm</div>
            <div className="text-[10px] text-center text-muted-foreground">Termal chek printer</div>
          </button>
          <button
            type="button"
            onClick={() => handleFormat('58mm')}
            disabled={!payout}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-3 transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="rounded-lg bg-rose-100 p-2.5 text-rose-700 transition group-hover:bg-rose-200">
              <FileText className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold">58mm</div>
            <div className="text-[10px] text-center text-muted-foreground">Kichik chek printer</div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
