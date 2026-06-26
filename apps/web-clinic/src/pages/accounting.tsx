import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TrendingUp, TrendingDown, Scale, Wallet, BookOpen, CheckCircle2, AlertCircle, Building2, FileDown } from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge, Button,
  Tabs, TabsList, TabsTrigger, TabsContent, EmptyState,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';
import { downloadA4Pdf, escapeHtml } from '@/lib/report-export';

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
  const { data: bs } = useQuery({ queryKey: ['acc-bs', params], queryFn: () => api.accounting.balanceSheet(params.to) });

  // Moliyaviy hisobotlarni A4 PDF qilib eksport (P&L + Balance Sheet)
  const [exporting, setExporting] = useState(false);
  async function exportPdf() {
    setExporting(true);
    try {
      const row = (label: string, val: number, bold = false) =>
        `<tr><td${bold ? ' style="font-weight:700"' : ''}>${escapeHtml(label)}</td><td class="r"${bold ? ' style="font-weight:700"' : ''}>${fmt(val)}</td></tr>`;
      const pnlRows = [
        ...(pnl?.income ?? []).map((r) => row(`${r.code} ${r.name}`, r.amount)),
        row('Jami daromad', pnl?.total_income ?? 0, true),
        ...(pnl?.expense ?? []).map((r) => row(`${r.code} ${r.name}`, r.amount)),
        row('Jami xarajat', pnl?.total_expense ?? 0, true),
        row('SOF FOYDA', pnl?.net_profit ?? 0, true),
      ].join('');
      const bsRows = [
        ...(bs?.assets ?? []).map((r) => row(`${r.code} ${r.name}`, r.balance)),
        row('Jami aktivlar', bs?.total_assets ?? 0, true),
        ...(bs?.liabilities ?? []).map((r) => row(`${r.code} ${r.name}`, r.balance)),
        ...(bs?.equity ?? []).map((r) => row(`${r.code} ${r.name}`, r.balance)),
        row('Jami passiv + kapital', (bs?.total_liabilities ?? 0) + (bs?.total_equity ?? 0), true),
      ].join('');
      const html =
        `<div class="doc-title">Moliyaviy hisobotlar</div>` +
        `<div class="doc-meta">Davr: ${params.from ?? params.preset ?? ''} – ${params.to ?? ''}</div>` +
        `<div class="doc-title" style="font-size:14px;margin-top:8px">Foyda va zarar (P&L)</div>` +
        `<table><tbody>${pnlRows}</tbody></table>` +
        `<div class="doc-title" style="font-size:14px;margin-top:14px">Balans (Balance Sheet)</div>` +
        `<table><tbody>${bsRows}</tbody></table>` +
        `<div class="doc-footer">Clary Healthcare ERP · Buxgalteriya</div>`;
      await downloadA4Pdf(html, `moliyaviy-hisobot-${params.to ?? 'davr'}.pdf`);
    } catch (e) {
      toast.error((e as Error).message || 'PDF xatolik');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Buxgalteriya" description="Ikki tomonlama General Ledger — P&L, balans, kassa oqimi, jurnal" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PresetBar
          value={preset} onChange={setPreset}
          customFrom={customFrom} customTo={customTo}
          onFromChange={setCustomFrom} onToChange={setCustomTo}
        />
        <Button variant="outline" onClick={exportPdf} disabled={exporting}>
          <FileDown className="mr-2 h-4 w-4" /> PDF eksport
        </Button>
      </div>

      <Tabs defaultValue="pnl">
        <TabsList>
          <TabsTrigger value="pnl">📊 P&L (Foyda/Zarar)</TabsTrigger>
          <TabsTrigger value="trial">⚖️ Trial Balance</TabsTrigger>
          <TabsTrigger value="cash">💵 Kassa oqimi</TabsTrigger>
          <TabsTrigger value="balance">🏦 Balans</TabsTrigger>
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

        {/* ── Balance Sheet ── */}
        <TabsContent value="balance">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-600" /><span className="font-semibold">Aktivlar</span></div>
                <div className="space-y-1 text-sm">
                  {(bs?.assets ?? []).filter((a) => a.balance).map((a) => (
                    <div key={a.code} className="flex justify-between">
                      <span className="text-muted-foreground"><span className="font-mono text-xs">{a.code}</span> {a.name}</span>
                      <span className="font-medium">{fmt(a.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-bold"><span>Jami aktivlar</span><span>{fmt(bs?.total_assets ?? 0)}</span></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-2"><Scale className="h-4 w-4 text-amber-600" /><span className="font-semibold">Passiv + Kapital</span></div>
                <div className="space-y-1 text-sm">
                  {(bs?.liabilities ?? []).filter((a) => a.balance).map((a) => (
                    <div key={a.code} className="flex justify-between">
                      <span className="text-muted-foreground"><span className="font-mono text-xs">{a.code}</span> {a.name}</span>
                      <span className="font-medium">{fmt(a.balance)}</span>
                    </div>
                  ))}
                  {(bs?.equity ?? []).filter((a) => a.balance).map((a) => (
                    <div key={a.code} className="flex justify-between">
                      <span className="text-muted-foreground"><span className="font-mono text-xs">{a.code}</span> {a.name}</span>
                      <span className="font-medium">{fmt(a.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-bold"><span>Jami passiv + kapital</span><span>{fmt((bs?.total_liabilities ?? 0) + (bs?.total_equity ?? 0))}</span></div>
                </div>
              </CardContent>
            </Card>
            <div className="md:col-span-2">
              {bs && (
                bs.balanced ? (
                  <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3" /> Balans tenglashdi (Aktiv = Passiv + Kapital)</Badge>
                ) : (
                  <Badge className="gap-1 bg-rose-600 text-white hover:bg-rose-600"><AlertCircle className="h-3 w-3" /> Balans tenglashmadi!</Badge>
                )
              )}
            </div>
          </div>
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
