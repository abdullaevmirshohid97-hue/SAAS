import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

export type KpiMetric =
  | 'revenue'
  | 'expenses'
  | 'profit'
  | 'pharmacy_debt'
  | 'inpatient_debt';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
const STATUS_LABEL: Record<string, string> = {
  paid: 'To\'langan', debt: 'Qarz', refund: 'Vozvrat', partial: 'Qisman', pending: 'Kutilmoqda', expense: 'Rasxot',
};
const TITLE: Record<KpiMetric, string> = {
  revenue: 'Tushum', expenses: 'Rasxotlar', profit: 'Sof foyda',
  pharmacy_debt: 'Dorixona qarzi', inpatient_debt: 'Statsionar qarzi',
};

/**
 * KPI karta drill-down — bosilgan ko'rsatkichni tashkil etgan ma'lumotlar
 * "asosiy jurnaldagidek" ro'yxat ko'rinishida. revenue/expenses/profit jurnal
 * feed'idan; qarzlar — qarzdorlar ro'yxatidan.
 */
export function KpiDetailDialog({
  metric,
  from,
  to,
  label,
  register,
  onClose,
}: {
  metric: KpiMetric;
  from?: string;
  to?: string;
  label: string;
  register?: string;
  onClose: () => void;
}) {
  const isFeed = metric === 'revenue' || metric === 'expenses' || metric === 'profit';
  const feedSource = metric === 'expenses' ? 'expenses' : metric === 'revenue' ? 'transactions' : 'all';

  const feed = useQuery({
    queryKey: ['journal', 'feed', 'kpi', metric, from, to, register ?? 'reception'],
    queryFn: () => api.journal.feed({ from, to, source: feedSource as 'all', register: (register as 'reception') , limit: 300 }),
    enabled: isFeed,
  });
  const summary = useQuery({
    queryKey: ['journal', 'summary', 'kpi', from, to, register ?? 'reception'],
    queryFn: () => api.journal.summary({ from, to, register: register as 'reception' }),
    enabled: metric === 'profit',
  });
  const pharmDebt = useQuery({
    queryKey: ['pharmacy', 'sales', 'debt'],
    queryFn: () => api.pharmacy.listSales(),
    enabled: metric === 'pharmacy_debt',
  });
  const inpDebt = useQuery({
    queryKey: ['cashier', 'debtors', 'kpi'],
    queryFn: () => api.cashier.debtors(),
    enabled: metric === 'inpatient_debt',
  });

  const feedRows = (feed.data ?? []).filter((r) =>
    metric === 'revenue' ? r.amount_uzs >= 0 && r.status !== 'expense' : true,
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TITLE[metric]}</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>

        {/* Profit summary header */}
        {metric === 'profit' && summary.data && (
          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Tushum</div>
              <div className="font-mono font-semibold text-emerald-700">{fmt(summary.data.revenue)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Rasxot</div>
              <div className="font-mono font-semibold text-rose-700">{fmt(summary.data.expenses)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Maosh</div>
              <div className="font-mono font-semibold text-rose-700">{fmt(summary.data.payroll ?? 0)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Sof foyda</div>
              <div className={cn('font-mono font-bold', summary.data.profit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                {fmt(summary.data.profit)}
              </div>
            </div>
          </div>
        )}

        {/* Feed (revenue/expenses/profit) */}
        {isFeed && (
          <div className="overflow-x-auto rounded-md border">
            {feed.isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
            ) : feedRows.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Ma'lumot yo'q</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Sana</th>
                    <th className="px-3 py-2 text-left font-medium">Bemor</th>
                    <th className="px-3 py-2 text-left font-medium">Shifokor / Tavsif</th>
                    <th className="px-3 py-2 text-left font-medium">Usul</th>
                    <th className="px-3 py-2 text-right font-medium">Summa</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {feedRows.map((r) => (
                    <tr key={r.id} className={cn('hover:bg-muted/30', r.is_void && 'line-through opacity-50')}>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{fmtDate(r.occurred_at)}</td>
                      <td className="px-3 py-2">{r.patient_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.doctor_name ?? r.description ?? r.diagnosis ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.payment_method === 'mixed' ? 'Aralash' : (r.payment_method ?? '—')}</td>
                      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', r.amount_uzs < 0 ? 'text-rose-700' : '')}>
                        {fmt(r.amount_uzs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Dorixona qarzi */}
        {metric === 'pharmacy_debt' && (
          <DebtorTable
            loading={pharmDebt.isLoading}
            rows={((pharmDebt.data ?? []) as Array<{
              id: string;
              created_at: string;
              debt_uzs: number;
              patient?: { full_name?: string } | null;
            }>)
              .filter((s) => Number(s.debt_uzs ?? 0) > 0)
              .map((s) => ({
                id: s.id,
                name: s.patient?.full_name ?? 'Anonim',
                phone: null,
                debt: Number(s.debt_uzs ?? 0),
                date: s.created_at,
              }))}
          />
        )}

        {/* Statsionar/umumiy qarz */}
        {metric === 'inpatient_debt' && (
          <DebtorTable
            loading={inpDebt.isLoading}
            rows={(inpDebt.data ?? []).map((d) => ({
              id: d.id,
              name: d.full_name,
              phone: d.phone,
              debt: Number(d.debt_uzs ?? 0),
              date: null,
            }))}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DebtorTable({
  rows,
  loading,
}: {
  rows: Array<{ id: string; name: string | null; phone: string | null; debt: number; date: string | null }>;
  loading: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.debt, 0);
  return (
    <div className="overflow-x-auto rounded-md border">
      {loading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Qarzdor yo'q</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Bemor</th>
              <th className="px-3 py-2 text-left font-medium">Telefon</th>
              <th className="px-3 py-2 text-right font-medium">Qarz</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">{r.name ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.phone ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-rose-700">{fmt(r.debt)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/20 text-sm font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={2}>Jami</td>
              <td className="px-3 py-2 text-right font-mono text-rose-700">{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
