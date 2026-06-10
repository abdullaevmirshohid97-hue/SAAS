import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, PageHeader, StatCard } from '@clary/ui-web';

import { api } from '@/lib/api';
import { printPayslip } from '@/lib/payslip';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd', card: 'Plastik', humo: 'Humo', uzcard: 'Uzcard', click: 'Click', payme: 'Payme', bank_transfer: 'Bank',
};

// Kassada: berilgan va berilmagan maoshlar hisoboti (alohida sahifa).
// payroll.listPayouts (berilgan) + payroll.outstanding (berilmagan, oxirgi to'lovdan beri).
export function CashierSalariesPage() {
  const navigate = useNavigate();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const [from, setFrom] = useState(toISO(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(toISO(now));

  const payouts = useQuery({ queryKey: ['payroll', 'payouts'], queryFn: () => api.payroll.listPayouts() });
  const outstanding = useQuery({ queryKey: ['payroll', 'outstanding', to], queryFn: () => api.payroll.outstanding(to) });
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string; address?: string; phone?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinic = (me.data as { clinic?: { name?: string; address?: string; phone?: string } } | undefined)?.clinic;

  type Payout = Awaited<ReturnType<typeof api.payroll.listPayouts>>[number] & { doctor?: { full_name?: string } | null };

  const paid = useMemo(() => {
    const fromD = `${from}T00:00:00`;
    const toD = `${to}T23:59:59`;
    return ((payouts.data ?? []) as Payout[]).filter(
      (p) => p.status === 'paid' && p.paid_at && p.paid_at >= fromD && p.paid_at <= toD,
    );
  }, [payouts.data, from, to]);

  const unpaid = useMemo(
    () => (outstanding.data ?? []).filter((d) => d.owed_uzs > 0),
    [outstanding.data],
  );

  const paidTotal = paid.reduce((s, p) => s + Number(p.net_uzs ?? 0), 0);
  const unpaidTotal = unpaid.reduce((s, d) => s + Number(d.owed_uzs ?? 0), 0);

  const printChek = (p: Payout) => {
    printPayslip(
      {
        clinic_name: clinic?.name ?? 'Klinika',
        clinic_address: clinic?.address,
        clinic_phone: clinic?.phone,
        employee_name: p.doctor?.full_name ?? '—',
        period_from: p.period_start,
        period_to: p.period_end,
        commissions_uzs: Number(p.gross_commission_uzs ?? 0),
        monthly_base_uzs: 0,
        bonuses_uzs: Math.max(0, Number(p.adjustments_uzs ?? 0)),
        advances_uzs: Math.abs(Number(p.advances_uzs ?? 0)),
        penalties_uzs: 0,
        gross_uzs: Number(p.gross_commission_uzs ?? 0),
        deductions_uzs: Math.abs(Number(p.advances_uzs ?? 0)),
        net_uzs: Number(p.net_uzs ?? 0),
        generated_at: new Date().toISOString(),
      },
      'a4',
    );
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit gap-1.5" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Orqaga
      </Button>
      <PageHeader title="Maoshlar hisoboti" description="Berilgan va berilmagan maoshlar" />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Dan (to'langan sana)</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Gacha</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={() => { setFrom(toISO(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(toISO(new Date())); }}
          >
            Shu oy
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={`Berilgan maosh (${paid.length})`} value={`${fmt(paidTotal)} so'm`} tone="success" />
        <StatCard label={`Berilmagan maosh (${unpaid.length})`} value={`${fmt(unpaidTotal)} so'm`} tone={unpaidTotal > 0 ? 'warning' : 'success'} />
      </div>

      {/* Berilgan */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Berilgan maoshlar</CardTitle></CardHeader>
        <CardContent className="p-0">
          {paid.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted-foreground">Bu davrda berilgan maosh yo'q</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Xodim</th>
                    <th className="px-3 py-2 text-left font-medium">Davr</th>
                    <th className="px-3 py-2 text-left font-medium">Usul</th>
                    <th className="px-3 py-2 text-left font-medium">To'langan</th>
                    <th className="px-3 py-2 text-right font-medium">Summa</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paid.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{p.doctor?.full_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.period_start} → {p.period_end}</td>
                      <td className="px-3 py-2 text-xs">{p.method ? METHOD_LABEL[p.method] ?? p.method : '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.paid_at ? new Date(p.paid_at).toLocaleDateString('uz-UZ') : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-emerald-700">{fmt(p.net_uzs)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => printChek(p)}>
                          <Printer className="h-3.5 w-3.5" /> Chek
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20 text-sm font-semibold">
                  <tr><td className="px-3 py-2" colSpan={4}>Jami</td><td className="px-3 py-2 text-right font-mono text-emerald-700">{fmt(paidTotal)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Berilmagan */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Berilmagan maoshlar (oxirgi to'lovdan beri)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {unpaid.length === 0 ? (
            <EmptyState title="Berilmagan maosh yo'q" description="Barcha xodimlar to'langan." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Xodim</th>
                    <th className="px-3 py-2 text-left font-medium">Davr</th>
                    <th className="px-3 py-2 text-left font-medium">Oxirgi to'lov</th>
                    <th className="px-3 py-2 text-right font-medium">Berilmagan</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {unpaid.map((d) => (
                    <tr key={d.doctor_id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{d.doctor_name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.owed_from} → {d.owed_to}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.last_paid_period_end ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-amber-700">{fmt(d.owed_uzs)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => navigate('/payroll')}>To'lash</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20 text-sm font-semibold">
                  <tr><td className="px-3 py-2" colSpan={3}>Jami</td><td className="px-3 py-2 text-right font-mono text-amber-700">{fmt(unpaidTotal)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
