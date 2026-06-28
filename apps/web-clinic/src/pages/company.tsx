import { useQuery } from '@tanstack/react-query';
import { Building2, TrendingUp, TrendingDown, Trophy, MapPin } from 'lucide-react';

import { PageHeader, Card, CardContent, Badge, EmptyState } from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';
import { useState } from 'react';

// =============================================================================
// Kompaniya (multi-branch) — CEO ko'rinishi: filiallar + konsolidatsiyalangan P&L
// + filial reytingi. /company (clinic_owner/admin). Faqat o'z kompaniyasi.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function CompanyPage() {
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const params = rangeParamsFor(preset, customFrom, customTo);

  const { data: my } = useQuery({ queryKey: ['company-my'], queryFn: () => api.company.my() });
  const { data: cons } = useQuery({ queryKey: ['company-cons', params], queryFn: () => api.company.consolidated({ from: params.from, to: params.to }) });

  const branchCount = my?.branch_count ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Kompaniya — ${my?.company?.name ?? ''}`}
        description={`${branchCount} filial · ${my?.company?.package ? my.company.package.toUpperCase() : ''} paket · konsolidatsiyalangan moliya`}
      />

      {branchCount <= 1 && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Hozircha 1 ta filial. Ko'p filialli kompaniya uchun (Business/Enterprise paket) bu sahifada barcha filiallar
          konsolidatsiyalangan foyda/zarar va reyting bilan ko'rinadi.
        </CardContent></Card>
      )}

      {/* Konsolidatsiyalangan KPI */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-600" /><span className="text-sm text-muted-foreground">Daromad</span></div>
          <span className="text-lg font-bold">{fmt(cons?.consolidated.income ?? 0)}</span>
        </CardContent></Card>
        <Card><CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2"><TrendingDown className="h-5 w-5 text-rose-600" /><span className="text-sm text-muted-foreground">Xarajat</span></div>
          <span className="text-lg font-bold">{fmt(cons?.consolidated.expense ?? 0)}</span>
        </CardContent></Card>
        <Card><CardContent className={`flex items-center justify-between p-4 ${(cons?.consolidated.profit ?? 0) >= 0 ? '' : 'bg-rose-500/5'}`}>
          <span className="text-sm font-medium">Konsolidatsiya foyda</span>
          <span className={`text-xl font-extrabold ${(cons?.consolidated.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(cons?.consolidated.profit ?? 0)}</span>
        </CardContent></Card>
      </div>

      <div className="flex items-center justify-between">
        <PresetBar value={preset} onChange={setPreset} customFrom={customFrom} customTo={customTo} onFromChange={setCustomFrom} onToChange={setCustomTo} />
      </div>

      {/* Filial reytingi */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-600" /><span className="font-semibold">Filial reytingi (foyda bo'yicha)</span></div>
          {(cons?.branches ?? []).length === 0 ? (
            <EmptyState title="Ma'lumot yo'q" description="Tanlangan davrda filial moliyasi yo'q." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5">#</th><th>Filial</th>
                    <th className="text-right">Daromad</th><th className="text-right">Xarajat</th><th className="text-right">Foyda</th>
                  </tr>
                </thead>
                <tbody>
                  {cons?.branches.map((b, i) => (
                    <tr key={b.clinic_id} className="border-b last:border-0">
                      <td className="py-1.5">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                      <td className="font-medium">{b.clinic_name}</td>
                      <td className="text-right text-emerald-600">{fmt(b.income)}</td>
                      <td className="text-right text-rose-600">{fmt(b.expense)}</td>
                      <td className={`text-right font-semibold ${b.profit >= 0 ? '' : 'text-rose-600'}`}>{fmt(b.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filiallar ro'yxati */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2"><Building2 className="h-4 w-4" /><span className="font-semibold">Filiallar</span></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {my?.branches.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {b.name}
                  {b.is_hq && <Badge variant="secondary" className="text-[10px]">HQ</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">{b.city ?? ''}{b.branch_code ? ` · ${b.branch_code}` : ''}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
