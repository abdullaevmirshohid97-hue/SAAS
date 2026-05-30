import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Stethoscope } from 'lucide-react';
import { Button, Card, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function AnalyticsDoctorsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL'dan davrn o'qiymiz (analytics sahifasidan kelganda saqlanadi)
  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';
  const initialPreset = (searchParams.get('preset') as Preset) ?? (initialFrom && initialTo ? 'custom' : 'month');

  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [customFrom, setCustomFrom] = useState(initialFrom);
  const [customTo, setCustomTo] = useState(initialTo);

  const rangeParams = rangeParamsFor(preset, customFrom, customTo);

  // Davr o'zgarsa URL'ni ham yangilab boramiz (back tugma davrn saqlaydi)
  const syncUrl = (p: Preset, f: string, t: string) => {
    setSearchParams(rangeParamsFor(p, f, t) as Record<string, string>, { replace: true });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'all-doctors', preset, customFrom, customTo],
    queryFn: () => api.analytics.allDoctors(rangeParams),
  });

  const rows = data ?? [];
  const totalRevenue = rows.reduce((s, r) => s + r.revenue_uzs, 0);
  const totalCommission = rows.reduce((s, r) => s + r.commission_uzs, 0);
  const totalVisits = rows.reduce((s, r) => s + r.visits, 0);
  const maxRev = Math.max(1, ...rows.map((r) => r.revenue_uzs));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/analytics')} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Analitika
          </Button>
          <div className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Shifokorlar — davr bo'yicha daromad</h1>
          </div>
        </div>
        <PresetBar
          value={preset}
          onChange={(p) => {
            setPreset(p);
            syncUrl(p, customFrom, customTo);
          }}
          customFrom={customFrom}
          customTo={customTo}
          onFromChange={(v) => {
            setCustomFrom(v);
            syncUrl(preset, v, customTo);
          }}
          onToChange={(v) => {
            setCustomTo(v);
            syncUrl(preset, customFrom, v);
          }}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Shifokorlar topilmadi</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Shifokor</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qabullar</th>
                    <th className="px-4 py-2.5 text-right font-medium">Bemorlar</th>
                    <th className="px-4 py-2.5 text-right font-medium">Tushum (klinikaga)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Komissiya (shifokorga)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Ulush</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.doctor_id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{r.doctor_name}</div>
                        <div className="mt-1 h-1.5 w-40 rounded-full bg-muted">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{ width: `${(r.revenue_uzs / maxRev) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.visits}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.patients}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                        {fmt(r.revenue_uzs)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700">
                        {fmt(r.commission_uzs)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {totalRevenue > 0 ? ((r.revenue_uzs / totalRevenue) * 100).toFixed(1) : '0.0'}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 bg-muted/30 font-semibold">
                  <tr>
                    <td className="px-4 py-2.5">Jami ({rows.length} shifokor)</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totalVisits}</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmt(totalRevenue)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmt(totalCommission)}</td>
                    <td className="px-4 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
