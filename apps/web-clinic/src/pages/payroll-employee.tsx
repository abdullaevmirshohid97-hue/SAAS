import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeDollarSign,
  CalendarDays,
  Clock,
  Gift,
  HandCoins,
  Printer,
  ReceiptText,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  StatCard,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { printPayslip } from '@/lib/payslip';
import { PayNowDialog, LedgerDialog, fmt } from './payroll';

// =============================================================================
// Xodim maosh sahifasi (/payroll/employee/:doctorId) — investor-ready ko'rinish:
//   • Aqlli davr karta: oxirgi to'lov qaysi davr uchun + joriy qarzdorlik davri
//   • Kunlik daromad: har kun → soat, bemor, xizmat, summa, kimning smenasida
//   • Davriy daromadlar alohida: oylik baza, statsionar kunlik, bonuslar
//   • Amallar: maosh berish (avto-chek), bonus, avans/qarz
// =============================================================================

const SALARY_TYPE_LABEL: Record<string, string> = {
  fixed: 'Oylik (fix)',
  percent: 'Foiz (komissiya)',
  weekly: 'Haftalik',
  bonus: 'Bonus',
  mixed: 'Aralash (fix + %)',
};

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short',
  });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

type EmpPeriod = 'current_month' | 'last_month' | 'custom';

function empPeriodRange(p: Exclude<EmpPeriod, 'custom'>): { from: string; to: string; label: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === 'last_month') {
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)), label: "O'tgan oy" };
  }
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)), label: 'Joriy oy' };
}

export function PayrollEmployeePage() {
  const { doctorId } = useParams<{ doctorId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isoToday = new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState<EmpPeriod>('current_month');
  const [customFrom, setCustomFrom] = useState(empPeriodRange('current_month').from);
  const [customTo, setCustomTo] = useState(isoToday);
  const range = useMemo(
    () =>
      period === 'custom'
        ? { from: customFrom, to: customTo, label: `${customFrom} → ${customTo}` }
        : empPeriodRange(period),
    [period, customFrom, customTo],
  );

  const [payNowOpen, setPayNowOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());

  const overview = useQuery({
    queryKey: ['payroll', 'employee-overview', doctorId, range.from, range.to],
    queryFn: () => api.payroll.employeeOverview(doctorId!, range.from, range.to),
    enabled: !!doctorId,
  });
  const earnings = useQuery({
    queryKey: ['payroll', 'doctor-earnings', doctorId, range.from, range.to],
    queryFn: () => api.payroll.doctorEarnings(doctorId!, range.from, range.to),
    enabled: !!doctorId,
  });
  const periodic = useQuery({
    queryKey: ['payroll', 'employee-periodic', doctorId, range.from, range.to],
    queryFn: () => api.payroll.employeePeriodic(doctorId!, range.from, range.to),
    enabled: !!doctorId,
  });
  const payouts = useQuery({
    queryKey: ['payroll', 'payouts', doctorId],
    queryFn: () => api.payroll.listPayouts(doctorId),
    enabled: !!doctorId,
  });
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{ clinic?: { name?: string; address?: string; phone?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicInfo = me.data?.clinic;

  const ov = overview.data;
  const staff = ov?.staff;
  const sum = ov?.summary;
  const owed = ov?.outstanding ?? null;
  const lastPayout = ov?.last_payout ?? null;

  // Kunlik guruh — boyitilgan earnings (vaqt + smena operatori bilan)
  const byDay = useMemo(() => {
    const items = earnings.data ?? [];
    const m = new Map<string, { day: string; items: typeof items; total: number }>();
    for (const r of items) {
      const day = new Date(r.time ?? r.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
      const cur = m.get(day) ?? { day, items: [] as typeof items, total: 0 };
      cur.items.push(r);
      cur.total += Number(r.amount_uzs);
      m.set(day, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.day.localeCompare(a.day));
  }, [earnings.data]);

  const toggleDay = (day: string) =>
    setOpenDays((p) => {
      const n = new Set(p);
      if (n.has(day)) n.delete(day);
      else n.add(day);
      return n;
    });

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['payroll'] });

  // To'lov tarixidan chek qayta chiqarish
  const reprintPayout = (p: NonNullable<typeof payouts.data>[number]) => {
    printPayslip(
      {
        clinic_name: clinicInfo?.name ?? 'Klinika',
        clinic_address: clinicInfo?.address,
        clinic_phone: clinicInfo?.phone,
        employee_name: staff?.full_name ?? '—',
        employee_position: staff?.position ?? undefined,
        period_from: p.period_start,
        period_to: p.period_end,
        commissions_uzs: Number(p.gross_commission_uzs ?? 0),
        monthly_base_uzs: 0,
        bonuses_uzs: Math.max(0, Number(p.adjustments_uzs ?? 0)),
        advances_uzs: Number(p.advances_uzs ?? 0),
        penalties_uzs: Math.max(0, -Number(p.adjustments_uzs ?? 0)),
        gross_uzs: Number(p.gross_commission_uzs ?? 0) + Math.max(0, Number(p.adjustments_uzs ?? 0)),
        deductions_uzs: Number(p.advances_uzs ?? 0),
        net_uzs: Number(p.net_uzs ?? 0),
        generated_at: new Date().toISOString(),
      },
      'a4',
    );
  };

  if (!doctorId) return null;
  if (overview.isLoading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>;
  }
  if (!staff) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Xodim topilmadi.{' '}
        <button type="button" className="text-primary underline" onClick={() => navigate('/payroll')}>
          Maosh sahifasiga qaytish
        </button>
      </div>
    );
  }

  const paydayLabel =
    staff.payday_kind === 'weekly'
      ? `har hafta ${['', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan', 'Yak'][staff.payday_day ?? 1]}`
      : `har oyning ${staff.payday_day ?? 3}-sanasi`;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit gap-1.5" onClick={() => navigate('/payroll')}>
        <ArrowLeft className="h-4 w-4" /> Maosh
      </Button>

      {/* Sarlavha */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {staff.full_name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {staff.position && <Badge variant="outline">{staff.position}</Badge>}
            {staff.salary_type && (
              <Badge variant="secondary">{SALARY_TYPE_LABEL[staff.salary_type] ?? staff.salary_type}</Badge>
            )}
            <span className="flex items-center gap-1 text-xs">
              <CalendarDays className="h-3.5 w-3.5" /> Oylik kuni: {paydayLabel}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setLedgerOpen(true)}>
            <Gift className="mr-1.5 h-4 w-4" /> Bonus / Avans
          </Button>
        </div>
      </div>

      {/* 🧠 Aqlli maosh karta */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-emerald-50/50">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-muted-foreground" />
              {lastPayout ? (
                <span>
                  Oxirgi maosh:{' '}
                  <strong>
                    {fmtDate(lastPayout.period_start)} — {fmtDate(lastPayout.period_end)}
                  </strong>{' '}
                  davri uchun, {lastPayout.paid_at ? fmtDate(lastPayout.paid_at) : '—'} da to'langan (
                  <strong>{fmt(lastPayout.net_uzs)}</strong> so'm)
                </span>
              ) : (
                <span className="text-muted-foreground">Hali birorta maosh to'lanmagan</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-amber-600" />
              {owed && owed.owed_uzs > 0 ? (
                <span>
                  Hozirgi qarzdorlik:{' '}
                  <strong className="text-amber-700">
                    {fmtDate(owed.owed_from)} — {fmtDate(owed.owed_to)}
                  </strong>{' '}
                  uchun{' '}
                  <strong className="text-lg text-amber-700">{fmt(owed.owed_uzs)} so'm</strong>
                </span>
              ) : (
                <span className="font-medium text-emerald-700">✅ Qarzdorlik yo'q — hammasi to'langan</span>
              )}
            </div>
            {owed && owed.owed_uzs > 0 && (
              <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                <span>Komissiya: {fmt(owed.accrued_commissions_uzs)}</span>
                {owed.base_uzs > 0 && <span>Oylik fix: {fmt(owed.base_uzs)}</span>}
                {owed.bonuses_uzs > 0 && <span>Bonus: +{fmt(owed.bonuses_uzs)}</span>}
                {owed.advances_uzs > 0 && <span>Avans: −{fmt(owed.advances_uzs)}</span>}
                {owed.penalties_uzs > 0 && <span>Jarima: −{fmt(owed.penalties_uzs)}</span>}
              </div>
            )}
          </div>
          {owed && owed.owed_uzs > 0 && (
            <Button size="lg" className="gap-2" onClick={() => setPayNowOpen(true)}>
              <Wallet className="h-5 w-5" /> Maosh berish ({fmt(owed.owed_uzs)})
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Davr tanlash */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-muted/30 p-1">
          {(
            [
              { id: 'current_month', label: 'Joriy oy' },
              { id: 'last_month', label: "O'tgan oy" },
              { id: 'custom', label: 'Boshqa davr' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={
                'rounded-md px-3 py-1 text-sm font-medium transition ' +
                (period === p.id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground hover:text-foreground')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-1.5">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-36" />
            <span className="text-muted-foreground">→</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-36" />
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={invalidateAll}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* KPI qatori */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Komissiya" value={`${fmt(sum?.commissions_uzs ?? 0)} so'm`} icon={<BadgeDollarSign className="h-4 w-4" />} />
        <StatCard label="Oylik baza" value={`${fmt(sum?.monthly_base_uzs ?? 0)} so'm`} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Bonus" value={`+${fmt(sum?.bonuses_uzs ?? 0)} so'm`} icon={<Gift className="h-4 w-4" />} tone="success" />
        <StatCard
          label="Avans + Jarima"
          value={`−${fmt(Number(sum?.advances_uzs ?? 0) + Number(sum?.penalties_uzs ?? 0))} so'm`}
          icon={<HandCoins className="h-4 w-4" />}
          tone={(Number(sum?.advances_uzs ?? 0) + Number(sum?.penalties_uzs ?? 0)) > 0 ? 'warning' : undefined}
        />
        <StatCard label="NET (davr)" value={`${fmt(sum?.net_uzs ?? 0)} so'm`} icon={<Wallet className="h-4 w-4" />} tone="success" />
      </div>

      {/* 📅 Kunlik daromad */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" /> Kunlik daromad ({range.label})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {earnings.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
          ) : byDay.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<ReceiptText className="h-8 w-8" />} title="Yozuv yo'q" description="Bu davrda komissiya daromadi topilmadi" />
            </div>
          ) : (
            <div className="divide-y">
              {byDay.map((d) => {
                const open = openDays.has(d.day);
                return (
                  <div key={d.day}>
                    <button
                      type="button"
                      onClick={() => toggleDay(d.day)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30"
                    >
                      <span className="text-sm font-semibold">{fmtDay(d.day)}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{d.items.length} ta amal</span>
                        <span className="font-mono font-bold text-emerald-700">{fmt(d.total)} so'm</span>
                        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {open && (
                      <div className="overflow-x-auto border-t bg-muted/10">
                        <table className="w-full text-sm">
                          <thead className="text-[10px] uppercase text-muted-foreground">
                            <tr>
                              <th className="px-3 py-1.5 text-left">Soat</th>
                              <th className="px-3 py-1.5 text-left">Bemor</th>
                              <th className="px-3 py-1.5 text-left">Xizmat</th>
                              <th className="px-3 py-1.5 text-right">Narx</th>
                              <th className="px-3 py-1.5 text-right">%</th>
                              <th className="px-3 py-1.5 text-right">Xodimga</th>
                              <th className="px-3 py-1.5 text-left">Smena</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {d.items.map((it) => (
                              <tr key={it.id} className="hover:bg-muted/20">
                                <td className="px-3 py-1.5 font-mono text-xs">
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3 text-muted-foreground" />
                                    {fmtTime(it.time ?? it.date)}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5">{it.patient_name ?? '—'}</td>
                                <td className="px-3 py-1.5 text-xs text-muted-foreground">{it.service_name ?? '—'}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs">{fmt(it.gross_uzs)}</td>
                                <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">{it.percent}%</td>
                                <td className="px-3 py-1.5 text-right font-mono font-medium text-emerald-700">{fmt(it.amount_uzs)}</td>
                                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                  {it.shift_operator ? `${it.shift_operator} smenasi` : it.cashier_name ? `kassir: ${it.cashier_name}` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 🔄 Davriy daromadlar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" /> Davriy daromadlar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {(periodic.data?.monthly_base ?? []).length === 0 &&
          (periodic.data?.inpatient ?? []).length === 0 &&
          (periodic.data?.other_bonuses ?? []).length === 0 ? (
            <div className="text-muted-foreground">Bu davrda davriy daromad yo'q</div>
          ) : (
            <>
              {(periodic.data?.monthly_base ?? []).length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Oylik baza (fix)</div>
                  {(periodic.data?.monthly_base ?? []).map((m) => (
                    <div key={m.month} className="flex items-center justify-between border-b py-1 last:border-0">
                      <span>{m.month} oyi</span>
                      <span className="font-mono font-medium">{fmt(m.amount_uzs)} so'm</span>
                    </div>
                  ))}
                </div>
              )}
              {(periodic.data?.inpatient ?? []).length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Statsionar (kunlik)</div>
                  {(periodic.data?.inpatient ?? []).map((l) => (
                    <div key={l.id} className="flex items-center justify-between border-b py-1 last:border-0">
                      <span className="text-xs">
                        {fmtDate(l.created_at)} {l.notes ? `· ${l.notes}` : ''}
                      </span>
                      <span className="font-mono text-sky-700">+{fmt(l.amount_uzs)} so'm</span>
                    </div>
                  ))}
                </div>
              )}
              {(periodic.data?.other_bonuses ?? []).length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Bonuslar / tuzatishlar</div>
                  {(periodic.data?.other_bonuses ?? []).map((l) => (
                    <div key={l.id} className="flex items-center justify-between border-b py-1 last:border-0">
                      <span className="text-xs">
                        {fmtDate(l.created_at)} {l.notes ? `· ${l.notes}` : ''}
                      </span>
                      <span className={'font-mono ' + (l.amount_uzs >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                        {l.amount_uzs >= 0 ? '+' : ''}
                        {fmt(l.amount_uzs)} so'm
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* To'lovlar tarixi */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" /> To'lovlar tarixi
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(payouts.data ?? []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Hali to'lov yo'q</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Davr</th>
                  <th className="px-3 py-2 text-right">Summa</th>
                  <th className="px-3 py-2">Holat</th>
                  <th className="px-3 py-2">To'langan</th>
                  <th className="px-3 py-2 text-right">Chek</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(payouts.data ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 text-xs">
                      {fmtDate(p.period_start)} — {fmtDate(p.period_end)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{fmt(p.net_uzs)} so'm</td>
                    <td className="px-3 py-2">
                      {p.status === 'paid' ? (
                        <Badge variant="success">To'langan</Badge>
                      ) : p.status === 'draft' ? (
                        <Badge variant="warning">Qoralama</Badge>
                      ) : (
                        <Badge variant="secondary">{p.status}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {p.paid_at ? fmtDate(p.paid_at) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.status === 'paid' && (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => reprintPayout(p)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Dialoglar */}
      {payNowOpen && owed && (
        <PayNowDialog
          owed={{ ...owed, doctor_id: doctorId, doctor_name: staff.full_name }}
          clinicInfo={clinicInfo}
          onClose={() => setPayNowOpen(false)}
          onDone={() => {
            setPayNowOpen(false);
            invalidateAll();
          }}
        />
      )}
      {ledgerOpen && (
        <LedgerDialog
          doctors={[{ id: doctorId, full_name: staff.full_name }]}
          onClose={() => setLedgerOpen(false)}
          onSaved={() => {
            setLedgerOpen(false);
            invalidateAll();
          }}
        />
      )}
    </div>
  );
}
