import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, cn } from '@clary/ui-web';

import { api } from '@/lib/api';

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString('uz-UZ');
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const LEVEL_META: Record<string, { label: string; tone: string; icon: 'alert' | 'shield' }> = {
  high_anomaly: { label: 'YUQORI', tone: 'bg-rose-100 text-rose-700 border-rose-300', icon: 'shield' },
  medium_anomaly: { label: 'O\'RTA', tone: 'bg-amber-100 text-amber-700 border-amber-300', icon: 'alert' },
};

export function CashAnomalyCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'cash-anomalies'],
    queryFn: () => api.analytics.cashAnomalies(20),
    refetchInterval: 2 * 60_000,
  });

  // Faqat anomaliyalarni ko'rsatamiz
  const anomalies = (data ?? []).filter(
    (s) => s.anomaly_level === 'high_anomaly' || s.anomaly_level === 'medium_anomaly',
  );

  const highCount = anomalies.filter((s) => s.anomaly_level === 'high_anomaly').length;

  return (
    <Card className={cn(highCount > 0 && 'border-rose-300 bg-rose-50/30')}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className={cn(
            'h-4 w-4',
            highCount > 0 ? 'text-rose-600' : 'text-muted-foreground',
          )} />
          Kassa anomaliyalar
        </CardTitle>
        {anomalies.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {anomalies.length} ta topildi
          </span>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : anomalies.length === 0 ? (
          <div className="py-6 text-center text-sm text-emerald-700">
            ✓ Smena yopilishlarida anomaliya yo'q
          </div>
        ) : (
          <ul className="space-y-2">
            {anomalies.slice(0, 5).map((s) => {
              const meta = LEVEL_META[s.anomaly_level] ?? LEVEL_META.medium_anomaly!;
              const Icon = meta.icon === 'shield' ? ShieldAlert : AlertTriangle;
              const sign = s.diff_uzs >= 0 ? '+' : '−';
              return (
                <li key={s.id} className={cn('flex items-center gap-2 rounded-md border p-2 text-sm', meta.tone)}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {s.operator?.full_name ?? 'Operator'}
                    </div>
                    <div className="text-[10px] opacity-80">
                      {fmtTime(s.closed_at)} · kutilgan {fmt(s.expected_cash_uzs)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold">
                      {sign}{fmt(Math.abs(s.diff_uzs))} so'm
                    </div>
                    <div className="text-[10px] font-medium uppercase">{meta.label}</div>
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
