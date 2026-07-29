import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, PieChart as PieIcon } from 'lucide-react';
import { Button, Card, CardContent } from '@clary/ui-web';

import { api } from '@/lib/api';
import { PresetBar, rangeParamsFor, type Preset } from '@/components/analytics/preset-bar';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

type ServiceRow = {
  service_id: string;
  service_name: string;
  count: number;
  revenue: number;
  doctors: Array<{ name: string; times: number }>;
  daily: Array<{ day: string; count: number; revenue: number }>;
};

export function AnalyticsServicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFrom = searchParams.get('from') ?? '';
  const initialTo = searchParams.get('to') ?? '';
  const initialPreset =
    (searchParams.get('preset') as Preset) ?? (initialFrom && initialTo ? 'custom' : 'month');

  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [customFrom, setCustomFrom] = useState(initialFrom);
  const [customTo, setCustomTo] = useState(initialTo);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rangeParams = rangeParamsFor(preset, customFrom, customTo);
  const syncUrl = (p: Preset, f: string, t: string) => {
    setSearchParams(rangeParamsFor(p, f, t) as Record<string, string>, { replace: true });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'service-detail', preset, customFrom, customTo],
    queryFn: () => api.analytics.serviceDetail(rangeParams),
  });

  const rows = (data ?? []) as ServiceRow[];
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0) || 1;
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/analytics')}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> Analitika
          </Button>
          <div className="flex items-center gap-2">
            <PieIcon className="text-primary h-5 w-5" />
            <h1 className="text-2xl font-semibold tracking-tight">Top xizmatlar — to'liq tahlil</h1>
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
            <div className="text-muted-foreground p-6 text-sm">Yuklanmoqda…</div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground p-6 text-sm">Xizmatlar topilmadi</div>
          ) : (
            <div className="divide-y">
              {/* Sarlavha */}
              <div className="bg-muted/40 text-muted-foreground grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-2.5 text-xs uppercase">
                <div className="w-4" />
                <div>Xizmat</div>
                <div className="text-right">Soni</div>
                <div className="w-32 text-right">Summa</div>
                <div className="w-16 text-right">Ulush</div>
              </div>

              {rows.map((r) => {
                const isOpen = expanded === r.service_id;
                const maxDaily = Math.max(1, ...r.daily.map((d) => d.revenue));
                return (
                  <div key={r.service_id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : r.service_id)}
                      className="hover:bg-muted/30 grid w-full grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-3 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="text-muted-foreground h-4 w-4" />
                      ) : (
                        <ChevronRight className="text-muted-foreground h-4 w-4" />
                      )}
                      <div className="font-medium">{r.service_name}</div>
                      <div className="text-right tabular-nums">{r.count}</div>
                      <div className="w-32 text-right font-mono font-semibold tabular-nums">
                        {fmt(r.revenue)}
                      </div>
                      <div className="text-muted-foreground w-16 text-right text-xs">
                        {((r.revenue / totalRev) * 100).toFixed(1)}%
                      </div>
                    </button>

                    {isOpen && (
                      <div className="bg-muted/20 grid gap-4 px-10 py-4 md:grid-cols-2">
                        {/* Kunlik dinamika */}
                        <div>
                          <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                            Kunlik dinamika
                          </div>
                          {r.daily.length === 0 ? (
                            <div className="text-muted-foreground text-xs">Ma'lumot yo'q</div>
                          ) : (
                            <div className="space-y-1">
                              {r.daily.map((d) => (
                                <div key={d.day} className="flex items-center gap-2 text-xs">
                                  <span className="text-muted-foreground w-20 font-mono">
                                    {d.day}
                                  </span>
                                  <div className="bg-muted h-3 flex-1 rounded-full">
                                    <div
                                      className="bg-primary/70 h-3 rounded-full"
                                      style={{ width: `${(d.revenue / maxDaily) * 100}%` }}
                                    />
                                  </div>
                                  <span className="w-12 text-right tabular-nums">{d.count}x</span>
                                  <span className="w-24 text-right font-mono tabular-nums">
                                    {fmt(d.revenue)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Ko'rsatgan shifokorlar */}
                        <div>
                          <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                            Ko'rsatgan shifokorlar
                          </div>
                          {r.doctors.length === 0 ? (
                            <div className="text-muted-foreground text-xs">
                              Shifokor biriktirilmagan
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {r.doctors.map((d) => (
                                <div
                                  key={d.name}
                                  className="bg-card flex items-center justify-between rounded border px-2 py-1 text-xs"
                                >
                                  <span>{d.name}</span>
                                  <span className="text-muted-foreground font-medium">
                                    {d.times} marta
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Jami */}
              <div className="bg-muted/40 grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-3 font-semibold">
                <div className="w-4" />
                <div>Jami ({rows.length} xizmat)</div>
                <div className="text-right tabular-nums">{totalCount}</div>
                <div className="w-32 text-right font-mono tabular-nums">{fmt(totalRevenue)}</div>
                <div className="w-16" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
