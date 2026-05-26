import { useQuery } from '@tanstack/react-query';
import { AlertOctagon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString('uz-UZ');
}

function fmtWeek(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
}

export function RefundFraudCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'refund-fraud-alerts'],
    queryFn: () => api.analytics.refundFraudAlerts(),
    refetchInterval: 5 * 60_000,
  });

  const alerts = (data ?? []).slice(0, 5);
  const highRiskCount = alerts.filter((a) => a.risk_level === 'high_risk').length;

  return (
    <Card className={cn(highRiskCount > 0 && 'border-rose-300')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertOctagon className={cn(
            'h-4 w-4',
            highRiskCount > 0 ? 'text-rose-600' : 'text-muted-foreground',
          )} />
          Vozvrat anomaliyalari
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : alerts.length === 0 ? (
          <div className="py-6 text-center text-sm text-emerald-700">
            ✓ Kassirlar vozvrat ko'rsatkichi normal
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => {
              const isHigh = a.risk_level === 'high_risk';
              return (
                <li
                  key={`${a.cashier_id}-${a.week_start}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md border p-2 text-sm',
                    isHigh
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : 'bg-amber-50 border-amber-300 text-amber-900',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{a.cashier?.full_name ?? 'Kassir'}</div>
                    <div className="text-[10px] opacity-80">
                      {fmtWeek(a.week_start)} hafta · {a.refunds_count}/{a.payments_count + a.refunds_count} tx
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold">
                      {a.refund_ratio_pct}%
                    </div>
                    <div className="text-[10px]">
                      {fmt(a.refunds_amount_uzs)} so'm
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
