import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck, CheckCircle2, AlertCircle, Lock, Unlock } from 'lucide-react';

import { PageHeader, Card, CardContent, Badge, Button, Input } from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// QISM 3 / P1 — One-Click Month Closing. Oyni bitta tugma bilan yopish:
// amortizatsiya + balans tekshiruvi + P&L/soliq snapshot + davr lock.
// =============================================================================
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

export function MonthClosingPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.accounting.closeMonth>> | null>(null);

  const { data: periods } = useQuery({ queryKey: ['acc-periods'], queryFn: () => api.accounting.periods() });

  const closeMut = useMutation({
    mutationFn: () => api.accounting.closeMonth({ year, month }),
    onSuccess: (r) => { setResult(r); toast.success('Oy yopildi'); qc.invalidateQueries({ queryKey: ['acc-periods'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reopenMut = useMutation({
    mutationFn: (p: { year: number; month: number }) => api.accounting.reopenMonth(p),
    onSuccess: () => { toast.success('Davr qayta ochildi'); qc.invalidateQueries({ queryKey: ['acc-periods'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Oy yopish (Month Closing)" description="Bitta tugma: amortizatsiya + balans tekshiruvi + P&L/soliq snapshot + davr qulflash." />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-sm">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <Input className="h-9 w-24" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <Button onClick={() => closeMut.mutate()} disabled={closeMut.isPending}><CalendarCheck className="mr-1.5 h-4 w-4" /> Oyni yopish</Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="font-semibold">{MONTHS[result.month - 1]} {result.year} — yopish natijasi</div>
            <div className="space-y-1.5 text-sm">
              <Check ok label={`Amortizatsiya hisoblandi: ${result.checklist.depreciation_posted} ta`} />
              <Check ok={result.checklist.gl_balanced} label={result.checklist.gl_balanced ? 'GL balansda (debit = kredit)' : 'GL balans XATO — tekshiring!'} />
              <Check ok={result.checklist.payroll_posted} label="Maosh provodkalari GL'da (avtomatik)" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Daromad" v={result.summary.revenue} />
              <Kpi label="Xarajat" v={result.summary.expense} />
              <Kpi label="Sof foyda" v={result.summary.net_profit} />
              <Kpi label="Soliq (taxminiy)" v={result.summary.tax_estimate} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Yopilgan davrlar */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 font-semibold">Davrlar</div>
          {(periods ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Hali yopilgan oy yo'q.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1">Davr</th><th>Holat</th><th className="text-right">Daromad</th><th className="text-right">Foyda</th><th></th></tr></thead>
              <tbody>
                {periods?.map((p) => (
                  <tr key={`${p.period_year}-${p.period_month}`} className="border-b last:border-0">
                    <td className="py-1.5">{MONTHS[p.period_month - 1]} {p.period_year}</td>
                    <td>{p.status === 'closed' ? <Badge variant="secondary" className="gap-1 bg-slate-500/15 text-[10px]"><Lock className="h-3 w-3" /> Yopiq</Badge> : <Badge variant="secondary" className="text-[10px]">Ochiq</Badge>}</td>
                    <td className="text-right tabular-nums">{fmt(p.revenue_uzs)}</td>
                    <td className="text-right tabular-nums font-medium">{fmt(p.net_profit_uzs)}</td>
                    <td className="text-right">{p.status === 'closed' && <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline" onClick={() => reopenMut.mutate({ year: p.period_year, month: p.period_month })}><Unlock className="h-3 w-3" /> ochish</button>}</td>
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

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <div className="flex items-center gap-2">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-rose-600" />}<span>{label}</span></div>;
}
function Kpi({ label, v }: { label: string; v: number }) {
  return <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{label}</div><div className="font-bold tabular-nums">{fmt(v)}</div></div>;
}
