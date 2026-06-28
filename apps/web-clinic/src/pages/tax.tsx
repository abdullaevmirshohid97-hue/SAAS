import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Percent, Settings as SettingsIcon } from 'lucide-react';

import { PageHeader, Card, CardContent, Button, Input } from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';

// =============================================================================
// QISM 2 / E5 — Soliq markazi (Tax Center). Estimate: QQS + foyda/aylanma + ijtimoiy.
// =============================================================================
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function TaxPage() {
  const qc = useQueryClient();
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const params = rangeParamsFor(preset, customFrom, customTo);

  const { data: settings } = useQuery({ queryKey: ['tax-settings'], queryFn: () => api.accounting.taxSettings() });
  const { data: rep } = useQuery({ queryKey: ['tax-report', params], queryFn: () => api.accounting.taxReport(params) });

  const isQqs = (settings?.regime ?? 'qqs_profit') === 'qqs_profit';

  return (
    <div className="space-y-5">
      <PageHeader title="Soliq markazi" description="QQS + foyda/aylanma + ijtimoiy soliq (taxminiy hisob, GL asosida)." />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Hisobot */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><Percent className="h-4 w-4" /><span className="font-semibold">Soliq hisobot (taxminiy)</span></div>
              <PresetBar value={preset} onChange={setPreset} customFrom={customFrom} customTo={customTo} onFromChange={setCustomFrom} onToChange={setCustomTo} />
            </div>
            <div className="space-y-1 text-sm">
              <Row label="Daromad (davr)" value={rep?.revenue ?? 0} />
              <Row label="Foyda (davr)" value={rep?.profit ?? 0} />
              <Row label="Maosh fondi" value={rep?.payroll ?? 0} />
              <div className="my-2 border-t" />
              {isQqs ? (
                <>
                  <Row label="QQS to'lov (output)" value={rep?.qqs_payable ?? 0} accent />
                  <Row label="Foyda solig'i" value={rep?.profit_tax ?? 0} accent />
                </>
              ) : (
                <Row label="Aylanma solig'i" value={rep?.turnover_tax ?? 0} accent />
              )}
              <Row label="Ijtimoiy soliq (JSHDS)" value={rep?.social_tax ?? 0} accent />
              <div className="my-2 border-t" />
              <div className="flex justify-between text-base font-bold">
                <span>JAMI taxminiy soliq</span><span className="text-rose-600">{fmt(rep?.total_estimated ?? 0)} so'm</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">⚠ Taxminiy hisob (GL asosida). Rasmiy hisobot uchun buxgalter tekshiruvi zarur. E-hisob-faktura va davlat API keyingi fazada.</p>
          </CardContent>
        </Card>

        {/* Sozlama */}
        <Card>
          <CardContent className="p-4"><TaxSettings settings={settings} onSaved={() => qc.invalidateQueries({ queryKey: ['tax-settings'] })} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${accent ? 'font-semibold' : ''}`}>{fmt(value)}</span>
    </div>
  );
}

function TaxSettings({ settings, onSaved }: { settings: Awaited<ReturnType<typeof api.accounting.taxSettings>> | undefined; onSaved: () => void }) {
  const [regime, setRegime] = useState(settings?.regime ?? 'qqs_profit');
  const [qqs, setQqs] = useState(String(settings?.qqs_pct ?? 12));
  const [profit, setProfit] = useState(String(settings?.profit_tax_pct ?? 15));
  const [turnover, setTurnover] = useState(String(settings?.turnover_tax_pct ?? 4));
  const [social, setSocial] = useState(String(settings?.social_tax_pct ?? 12));

  const mut = useMutation({
    mutationFn: () => api.accounting.setTaxSettings({
      regime, qqs_pct: Number(qqs), profit_tax_pct: Number(profit), turnover_tax_pct: Number(turnover), social_tax_pct: Number(social),
    }),
    onSuccess: () => { toast.success('Saqlandi'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><SettingsIcon className="h-4 w-4" /><span className="font-semibold">Soliq rejimi</span></div>
      <select value={regime} onChange={(e) => setRegime(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
        <option value="qqs_profit">QQS + Foyda solig'i</option>
        <option value="turnover">Aylanma solig'i (soddalashtirilgan)</option>
      </select>
      {regime === 'qqs_profit' ? (
        <>
          <label className="flex items-center justify-between gap-2 text-sm">QQS %<Input className="h-8 w-20" value={qqs} onChange={(e) => setQqs(e.target.value)} /></label>
          <label className="flex items-center justify-between gap-2 text-sm">Foyda solig'i %<Input className="h-8 w-20" value={profit} onChange={(e) => setProfit(e.target.value)} /></label>
        </>
      ) : (
        <label className="flex items-center justify-between gap-2 text-sm">Aylanma solig'i %<Input className="h-8 w-20" value={turnover} onChange={(e) => setTurnover(e.target.value)} /></label>
      )}
      <label className="flex items-center justify-between gap-2 text-sm">Ijtimoiy soliq %<Input className="h-8 w-20" value={social} onChange={(e) => setSocial(e.target.value)} /></label>
      <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>
    </div>
  );
}
