import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Scale, Wallet, BookOpen, CheckCircle2, AlertCircle } from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge,
  Tabs, TabsList, TabsTrigger, TabsContent, EmptyState,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';

// =============================================================================
// Buxgalteriya (Accounting Spine) — double-entry General Ledger hisobotlari.
// P&L · Trial Balance · Cash Flow · Jurnal. /accounting (admin/owner).
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const TYPE_LABEL: Record<string, string> = {
  asset: 'Aktiv', liability: 'Passiv', income: 'Daromad', expense: 'Xarajat', equity: 'Kapital',
};

export function AccountingPage() {
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const params = rangeParamsFor(preset, customFrom, customTo);

  const { data: pnl } = useQuery({ queryKey: ['acc-pnl', params], queryFn: () => api.accounting.pnl(params) });
  const { data: tb } = useQuery({ queryKey: ['acc-tb', params], queryFn: () => api.accounting.trialBalance(params) });
  const { data: cf } = useQuery({ queryKey: ['acc-cf', params], queryFn: () => api.accounting.cashFlow(params) });
  const { data: journals } = useQuery({ queryKey: ['acc-jr', params], queryFn: () => api.accounting.journals(params) });

  return (
    <div className="space-y-5">
      <PageHeader title="Buxgalteriya" description="Ikki tomonlama General Ledger — P&L, balans, kassa oqimi, jurnal" />

      <PresetBar
        value={preset} onChange={setPreset}
        customFrom={customFrom} customTo={customTo}
        onFromChange={setCustomFrom} onToChange={setCustomTo}
      />

      <Tabs defaultValue="pnl">
        <TabsList>
          <TabsTrigger value="pnl">📊 P&L (Foyda/Zarar)</TabsTrigger>
          <TabsTrigger value="trial">⚖️ Trial Balance</TabsTrigger>
          <TabsTrigger value="cash">💵 Kassa oqimi</TabsTrigger>
          <TabsTrigger value="journal">📒 Jurnal</TabsTrigger>
        </TabsList>

        {/* ── P&L ── */}
        <TabsContent value="pnl">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-3">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                  <span className="text-sm text-muted-foreground">Daromad</span>
                  <span className="text-lg font-bold">{fmt(pnl?.total_income ?? 0)} so'm</span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-rose-600" />
                  <span className="text-sm text-muted-foreground">Xarajat</span>
                  <span className="text-lg font-bold">{fmt(pnl?.total_expense ?? 0)} so'm</span>
                </div>
                <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${(pnl?.net_profit ?? 0) >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                  <span className="text-sm font-medium">Sof foyda</span>
                  <span className={`text-xl font-extrabold ${(pnl?.net_profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {fmt(pnl?.net_profit ?? 0)} so'm
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="mb-2 text-sm font-semibold text-emerald-600">Daromad hisoblari</div>
                {(pnl?.income ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Yo'q</p> : (
                  <div className="space-y-1">
                    {pnl?.income.map((r) => (
                      <div key={r.code} className="flex justify-between text-sm">
                        <span className="text-muted-foreground"><span className="font-mono text-xs">{r.code}</span> {r.name}</span>
                        <span className="font-medium">{fmt(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardContent className="p-4">
                <div className="mb-2 text-sm font-semibold text-rose-600">Xarajat hisoblari</div>
                {(pnl?.expense ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Yo'q</p> : (
                  <div className="space-y-1">
                    {pnl?.expense.map((r) => (
                      <div key={r.code} className="flex justify-between text-sm">
                        <span className="text-muted-foreground"><span className="font-mono text-xs">{r.code}</span> {r.name}</span>
                        <span className="font-medium">{fmt(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Trial Balance ── */}
        <TabsContent value="trial">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Scale className="h-4 w-4" />
                <span className="font-semibold">Trial Balance</span>
                {tb && (
                  tb.balanced ? (
                    <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3" /> Balanslangan</Badge>
                  ) : (
                    <Badge className="gap-1 bg-rose-600 text-white hover:bg-rose-600"><AlertCircle className="h-3 w-3" /> Balans xato!</Badge>
                  )
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1.5">Hisob</th><th>Turi</th>
                      <th className="text-right">Debit</th><th className="text-right">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tb?.accounts ?? []).filter((a) => a.debit || a.credit).map((a) => (
                      <tr key={a.code} className="border-b">
                        <td className="py-1.5"><span className="font-mono text-xs">{a.code}</span> {a.name}</td>
                        <td className="text-xs text-muted-foreground">{TYPE_LABEL[a.type] ?? a.type}</td>
                        <td className="text-right">{a.debit ? fmt(a.debit) : '—'}</td>
                        <td className="text-right">{a.credit ? fmt(a.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold">
                      <td className="py-2" colSpan={2}>JAMI</td>
                      <td className="text-right">{fmt(tb?.total_debit ?? 0)}</td>
                      <td className="text-right">{fmt(tb?.total_credit ?? 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cash Flow ── */}
        <TabsContent value="cash">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2"><Wallet className="h-4 w-4" /><span className="font-semibold">Kassa oqimi</span></div>
              <div className="space-y-2">
                {(cf?.accounts ?? []).map((a) => (
                  <div key={a.code} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                    <span><span className="font-mono text-xs">{a.code}</span> {a.name}</span>
                    <div className="flex gap-4">
                      <span className="text-emerald-600">+{fmt(a.inflow)}</span>
                      <span className="text-rose-600">−{fmt(a.outflow)}</span>
                      <span className="w-32 text-right font-bold">{fmt(a.net)}</span>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between rounded-md bg-muted/40 p-2.5 text-sm font-bold">
                  <span>Sof o'zgarish</span><span>{fmt(cf?.net ?? 0)} so'm</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Jurnal (drill-down) ── */}
        <TabsContent value="journal">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2"><BookOpen className="h-4 w-4" /><span className="font-semibold">Buxgalteriya jurnali</span></div>
              {(journals ?? []).length === 0 ? (
                <EmptyState title="Yozuv yo'q" description="Tanlangan davrda jurnal yozuvi yo'q." />
              ) : (
                <div className="space-y-2">
                  {journals?.map((j) => (
                    <div key={j.id} className="rounded-md border p-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{j.type}</Badge>
                          <span className="font-medium">{j.memo}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{j.journal_date}</span>
                      </div>
                      <table className="mt-1.5 w-full text-xs">
                        <tbody>
                          {j.lines.map((l, i) => (
                            <tr key={i}>
                              <td className="text-muted-foreground">
                                <span className="font-mono">{l.account?.code}</span> {l.account?.name}
                              </td>
                              <td className="w-28 text-right">{l.debit_uzs ? fmt(l.debit_uzs) : ''}</td>
                              <td className="w-28 text-right">{l.credit_uzs ? fmt(l.credit_uzs) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
