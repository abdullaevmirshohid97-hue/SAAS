import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Target, TrendingUp, TrendingDown } from 'lucide-react';

import { PageHeader, Card, CardContent, Input, EmptyState } from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// QISM 2 / E3 — Budget & Variance: reja (account bo'yicha) vs fakt (GL). /budget.
// =============================================================================
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

export function BudgetPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data } = useQuery({ queryKey: ['budget', year, month], queryFn: () => api.accounting.budget({ year, month }) });

  const setMut = useMutation({
    mutationFn: (b: { account_code: string; planned_uzs: number }) =>
      api.accounting.setBudget({ period_year: year, period_month: month, ...b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget', year, month] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const s = data?.summary;
  const incomeRows = (data?.rows ?? []).filter((r) => r.type === 'income');
  const expenseRows = (data?.rows ?? []).filter((r) => r.type === 'expense');

  return (
    <div className="space-y-5">
      <PageHeader title="Byudjet (reja-fakt)" description="Hisob bo'yicha oylik reja vs haqiqiy (GL). Variance = farq." />

      <div className="flex flex-wrap items-center gap-2">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2 text-sm">
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <Input className="h-9 w-24" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </div>

      {/* Xulosa */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><TrendingUp className="h-4 w-4 text-emerald-600" /> Daromad: reja vs fakt</div>
          <div className="mt-1 flex items-baseline gap-3"><span className="text-lg font-bold">{fmt(s?.actual_income ?? 0)}</span><span className="text-sm text-muted-foreground">/ reja {fmt(s?.planned_income ?? 0)}</span>
            {(s?.planned_income ?? 0) > 0 && <span className={`text-sm font-medium ${(s!.actual_income) >= (s!.planned_income) ? 'text-emerald-600' : 'text-amber-600'}`}>{Math.round((s!.actual_income / s!.planned_income) * 100)}%</span>}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><TrendingDown className="h-4 w-4 text-rose-600" /> Xarajat: reja vs fakt</div>
          <div className="mt-1 flex items-baseline gap-3"><span className="text-lg font-bold">{fmt(s?.actual_expense ?? 0)}</span><span className="text-sm text-muted-foreground">/ reja {fmt(s?.planned_expense ?? 0)}</span>
            {(s?.planned_expense ?? 0) > 0 && <span className={`text-sm font-medium ${(s!.actual_expense) <= (s!.planned_expense) ? 'text-emerald-600' : 'text-rose-600'}`}>{Math.round((s!.actual_expense / s!.planned_expense) * 100)}%</span>}
          </div>
        </CardContent></Card>
      </div>

      {(data?.rows ?? []).length === 0 ? (
        <EmptyState title="Ma'lumot yo'q" description="Hisoblar rejasi bo'sh." />
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2"><Target className="h-4 w-4" /><span className="font-semibold">Reja-fakt (rejani tahrirlash uchun kiriting)</span></div>
            <BudgetTable title="Daromad" rows={incomeRows} onSet={(code, v) => setMut.mutate({ account_code: code, planned_uzs: v })} />
            <div className="mt-4"><BudgetTable title="Xarajat" rows={expenseRows} onSet={(code, v) => setMut.mutate({ account_code: code, planned_uzs: v })} /></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BudgetTable({ title, rows, onSet }: {
  title: string;
  rows: Array<{ code: string; name: string; planned: number; actual: number; variance: number; achieved_pct: number | null }>;
  onSet: (code: string, planned: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{title}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1">Hisob</th><th className="text-right">Reja</th><th className="text-right">Fakt</th><th className="text-right">Farq</th><th className="text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b last:border-0">
              <td className="py-1"><span className="font-mono text-xs">{r.code}</span> {r.name}</td>
              <td className="text-right">
                <Input className="ml-auto h-7 w-28 text-right" type="number" defaultValue={r.planned || ''} placeholder="0"
                  onBlur={(e) => { const v = Number(e.target.value || 0); if (v !== r.planned) onSet(r.code, v); }} />
              </td>
              <td className="text-right tabular-nums">{fmt(r.actual)}</td>
              <td className={`text-right tabular-nums font-medium ${r.variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.variance)}</td>
              <td className="text-right text-xs text-muted-foreground">{r.achieved_pct == null ? '—' : `${r.achieved_pct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
