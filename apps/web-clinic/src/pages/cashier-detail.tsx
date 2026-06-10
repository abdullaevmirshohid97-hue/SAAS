import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, PageHeader, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

// Kassa KPI batafsil — alohida SAHIFA (popup emas). Jurnal feed/qarzdorlar
// ko'rinishida; qator bosilsa /journal/entry/:refId (tahrir/transfer).
type Metric = 'revenue' | 'expenses' | 'profit' | 'pharmacy_debt' | 'inpatient_debt' | 'method';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd', card: 'Plastik', transfer: "O'tkazma", humo: 'Humo', uzcard: 'Uzcard',
  click: 'Click', payme: 'Payme', insurance: 'Sug\'urta',
};
const TITLE: Record<Metric, string> = {
  revenue: 'Tushum', expenses: 'Rasxotlar', profit: 'Sof foyda',
  pharmacy_debt: 'Dorixona qarzi', inpatient_debt: 'Statsionar qarzi', method: "To'lovlar",
};

export function CashierDetailPage() {
  const { metric: metricParam } = useParams<{ metric: string }>();
  const metric = (metricParam ?? 'revenue') as Metric;
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;
  const register = sp.get('register') ?? 'reception';
  const method = sp.get('method') ?? undefined;
  const label = sp.get('label') ?? (metric === 'method' && method ? METHOD_LABEL[method] ?? method : '');

  const isFeed = metric === 'revenue' || metric === 'expenses' || metric === 'profit' || metric === 'method';
  const feedSource = metric === 'expenses' ? 'expenses' : metric === 'revenue' || metric === 'method' ? 'transactions' : 'all';

  const feed = useQuery({
    queryKey: ['journal', 'feed', 'kpi-page', metric, from, to, register, method],
    queryFn: () => api.journal.feed({ from, to, source: feedSource as 'all', register: register as 'reception', limit: 500 }),
    enabled: isFeed,
  });
  const summary = useQuery({
    queryKey: ['journal', 'summary', 'kpi-page', from, to, register],
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

  const feedRows = (feed.data ?? []).filter((r) => {
    if (metric === 'revenue') return r.amount_uzs >= 0 && r.status !== 'expense';
    if (metric === 'method') return method ? r.payment_method === method : true;
    return true;
  });

  const openRow = (r: { ref_id: string }) =>
    navigate(`/journal/entry/${r.ref_id}`, { state: { entry: r } });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit gap-1.5" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" /> Orqaga
      </Button>
      <PageHeader title={TITLE[metric]} description={label} />

      {/* Profit summary header */}
      {metric === 'profit' && summary.data && (
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-5">
          <SumCell label="Tushum" value={fmt(summary.data.revenue)} cls="text-emerald-700" />
          <SumCell label="Rasxot" value={fmt(summary.data.expenses)} cls="text-rose-700" />
          <SumCell label="Maosh" value={fmt(summary.data.payroll ?? 0)} cls="text-rose-700" />
          <SumCell label="Dorixona foydasi" value={`+${fmt(summary.data.pharmacy_profit ?? 0)}`} cls="text-emerald-700" />
          <SumCell label="Sof foyda" value={fmt(summary.data.profit)} cls={summary.data.profit >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'} />
        </div>
      )}

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
                  <tr
                    key={r.id}
                    className={cn('cursor-pointer hover:bg-muted/30', r.is_void && 'line-through opacity-50')}
                    onClick={() => openRow(r)}
                    title="Batafsil / tahrir / transfer"
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{fmtDate(r.occurred_at)}</td>
                    <td className="px-3 py-2">{r.patient_name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.doctor_name ?? r.description ?? r.diagnosis ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.payment_method === 'mixed' ? 'Aralash' : (r.payment_method ? METHOD_LABEL[r.payment_method] ?? r.payment_method : '—')}</td>
                    <td className={cn('px-3 py-2 text-right font-mono tabular-nums', r.amount_uzs < 0 ? 'text-rose-700' : '')}>{fmt(r.amount_uzs)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/20 text-sm font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={4}>Jami ({feedRows.length})</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(feedRows.reduce((s, r) => s + Number(r.amount_uzs ?? 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {metric === 'pharmacy_debt' && (
        <DebtorTable
          loading={pharmDebt.isLoading}
          rows={((pharmDebt.data ?? []) as Array<{ id: string; created_at: string; debt_uzs: number; patient?: { full_name?: string } | null }>)
            .filter((s) => Number(s.debt_uzs ?? 0) > 0)
            .map((s) => ({ id: s.id, name: s.patient?.full_name ?? 'Anonim', phone: null, debt: Number(s.debt_uzs ?? 0) }))}
        />
      )}
      {metric === 'inpatient_debt' && (
        <DebtorTable
          loading={inpDebt.isLoading}
          rows={(inpDebt.data ?? []).map((d) => ({ id: d.id, name: d.full_name, phone: d.phone, debt: Number(d.debt_uzs ?? 0) }))}
        />
      )}
    </div>
  );
}

function SumCell({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={cn('font-mono font-semibold', cls)}>{value}</div>
    </div>
  );
}

function DebtorTable({ rows, loading }: { rows: Array<{ id: string; name: string | null; phone: string | null; debt: number }>; loading: boolean }) {
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
