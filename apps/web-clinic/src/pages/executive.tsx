import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Wallet, TrendingUp, TrendingDown, Banknote, Users, ShieldCheck, Boxes, Truck, Flame, Trophy, Receipt,
} from 'lucide-react';

import { PageHeader, Card, CardContent, EmptyState } from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';

// =============================================================================
// CFO / Executive Dashboard — bitta oynada: kassa, EBITDA, foyda, debitor/kreditor,
// insurance receivable, inventar, top xizmat/xarajat, filial reytingi. /executive.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function Kpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{fmt(value)}</div>
      </CardContent>
    </Card>
  );
}

export function ExecutivePage() {
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const params = rangeParamsFor(preset, customFrom, customTo);

  const { data: ex } = useQuery({ queryKey: ['exec', params], queryFn: () => api.accounting.executive(params) });
  const { data: top } = useQuery({ queryKey: ['exec-top', params], queryFn: () => api.analytics.topServices(params) });
  const { data: cons } = useQuery({ queryKey: ['exec-cons', params], queryFn: () => api.company.consolidated({ from: params.from, to: params.to }) });

  const k = ex?.kpis;
  const multiBranch = (cons?.branches.length ?? 0) > 1;

  return (
    <div className="space-y-5">
      <PageHeader title="CFO Dashboard" description="Bitta oynada: kassa, EBITDA, foyda, debitor/kreditor, inventar, top xizmat/xarajat, filial reytingi." />

      <PresetBar value={preset} onChange={setPreset} customFrom={customFrom} customTo={customTo} onFromChange={setCustomFrom} onToChange={setCustomTo} />

      {/* Asosiy KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={<Wallet className="h-3.5 w-3.5" />} label="Kassa qoldiq" value={k?.cash ?? 0} />
        <Kpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Daromad" value={k?.revenue ?? 0} tone="good" />
        <Kpi icon={<TrendingDown className="h-3.5 w-3.5" />} label="Xarajat" value={k?.expense ?? 0} tone="bad" />
        <Kpi icon={<Banknote className="h-3.5 w-3.5" />} label="Sof foyda" value={k?.profit ?? 0} tone={(k?.profit ?? 0) >= 0 ? 'good' : 'bad'} />
        <Kpi icon={<Banknote className="h-3.5 w-3.5" />} label="EBITDA" value={k?.ebitda ?? 0} tone={(k?.ebitda ?? 0) >= 0 ? 'good' : 'bad'} />
        <Kpi icon={<Users className="h-3.5 w-3.5" />} label="Bemor qarzi (AR)" value={k?.patient_ar ?? 0} />
        <Kpi icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Sug'urta qarzi" value={k?.insurer_ar ?? 0} />
        <Kpi icon={<Truck className="h-3.5 w-3.5" />} label="Kreditor (AP)" value={k?.accounts_payable ?? 0} tone="bad" />
        <Kpi icon={<Boxes className="h-3.5 w-3.5" />} label="Inventar qiymati" value={k?.inventory_value ?? 0} />
        <Kpi icon={<Flame className="h-3.5 w-3.5" />} label="Cash burn (oy)" value={k?.cash_burn ?? 0} tone="bad" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top xizmatlar (foyda) */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-600" /><span className="font-semibold">Top xizmatlar</span></div>
            {(top ?? []).length === 0 ? <EmptyState title="Ma'lumot yo'q" description="Davrda sotuv yo'q." /> : (
              <div className="space-y-1 text-sm">
                {top?.slice(0, 8).map((s, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="truncate">{s.service_name}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{fmt(s.revenue)}</span>
                      {typeof s.margin_pct === 'number' && (s.cost ?? 0) > 0 && (
                        <span className={`w-10 text-right text-xs tabular-nums ${s.margin_pct >= 50 ? 'text-emerald-600' : s.margin_pct >= 20 ? 'text-amber-600' : 'text-rose-600'}`}>{s.margin_pct}%</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top xarajatlar */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2"><Receipt className="h-4 w-4 text-rose-600" /><span className="font-semibold">Top xarajatlar</span></div>
            {(ex?.top_expenses ?? []).length === 0 ? <EmptyState title="Ma'lumot yo'q" description="Davrda xarajat yo'q." /> : (
              <div className="space-y-1 text-sm">
                {ex?.top_expenses.map((e, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="truncate">{e.label}</span>
                    <span className="tabular-nums text-rose-600">{fmt(e.amount_uzs)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filial reytingi (faqat ko'p-filialli kompaniya) */}
      {multiBranch && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-600" /><span className="font-semibold">Filial reytingi (foyda)</span></div>
            <div className="space-y-1 text-sm">
              {cons?.branches.map((b, i) => (
                <div key={b.clinic_id} className="flex items-center justify-between">
                  <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {b.clinic_name}</span>
                  <span className={`tabular-nums font-semibold ${b.profit >= 0 ? '' : 'text-rose-600'}`}>{fmt(b.profit)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
