import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, cn } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

type Period = 'monthly' | 'yearly';

export function SettingsSubscriptionPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('monthly');
  const { data: current } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.subscription.current(),
  });
  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.subscription.plans(),
  });
  const { data: usage } = useQuery({
    queryKey: ['subscription', 'usage'],
    queryFn: () => api.subscription.usage(),
  });

  const planList = plans ?? [];

  const checkoutMut = useMutation({
    mutationFn: (plan_code: string) =>
      api.subscription.checkout({
        plan_code,
        email: user?.email ?? '',
        billing_period: period,
      }),
    onSuccess: (r) => {
      window.location.href = (r as { url: string }).url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cur = current as
    | { current_plan?: string; subscription_status?: string; trial_ends_at?: string }
    | undefined;

  const priceFor = (p: (typeof planList)[number]) => {
    if (period === 'yearly') {
      const yearly = p.price_yearly_cents ?? Math.round(p.price_usd_cents * 12 * 0.8);
      return { amount: yearly, suffix: '/yil', monthlyEquiv: Math.round(yearly / 12) };
    }
    return { amount: p.price_usd_cents, suffix: '/oy', monthlyEquiv: p.price_usd_cents };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Obuna</h2>
          <p className="text-sm text-muted-foreground">
            Joriy tarif: <Badge>{cur?.current_plan?.toUpperCase() ?? 'DEMO'}</Badge>
            {cur?.trial_ends_at && (
              <span className="ml-2">
                Demo {new Date(cur.trial_ends_at).toLocaleDateString('uz-UZ')} gacha
              </span>
            )}
          </p>
          {usage && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>
                Xodimlar: <strong className="text-foreground">{usage.staff_used}</strong>
                {usage.staff_limit != null ? ` / ${usage.staff_limit}` : ' / ∞'}
              </span>
              <span>
                Qurilmalar: <strong className="text-foreground">{usage.devices_used}</strong>
                {usage.devices_limit != null ? ` / ${usage.devices_limit}` : ' / ∞'}
              </span>
            </div>
          )}
        </div>

        <div className="inline-flex items-center rounded-lg border bg-card p-1">
          {(['monthly', 'yearly'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPeriod(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm',
                period === v
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {v === 'monthly' ? 'Oylik' : 'Yillik'}
              {v === 'yearly' && (
                <span className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-800">
                  −20%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {planList.map((p) => {
          const price = priceFor(p);
          const overLimit =
            usage?.staff_limit != null &&
            p.max_staff != null &&
            usage.staff_used > p.max_staff;
          return (
            <Card key={p.code} className={p.code === cur?.current_plan ? 'border-primary' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {p.name}
                  {p.code === cur?.current_plan && <Badge>Joriy</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="text-3xl font-bold">
                    ${(price.amount / 100).toFixed(0)}
                    <span className="text-sm font-normal text-muted-foreground">{price.suffix}</span>
                  </div>
                  {period === 'yearly' && p.price_usd_cents > 0 && (
                    <div className="text-xs text-muted-foreground">
                      ≈ ${(price.monthlyEquiv / 100).toFixed(0)}/oy
                    </div>
                  )}
                </div>
                <ul className="space-y-1 text-sm">
                  <li>{p.max_staff ?? 'Cheksiz'} xodim</li>
                  <li>{p.max_devices ?? 'Cheksiz'} qurilma</li>
                  <li>{p.features?.analytics ? '✓' : '✗'} Analitika</li>
                  <li>{p.features?.custom_roles ? '✓' : '✗'} Custom rollar</li>
                  <li>{p.features?.sla ? '✓' : '✗'} SLA</li>
                </ul>
                {overLimit && p.code !== cur?.current_plan && (
                  <p className="text-[11px] text-destructive">
                    Sizning xodimlar soni bu plan limitidan ortiq
                  </p>
                )}
                {p.code !== cur?.current_plan && p.code !== 'demo' && (
                  <Button
                    className="w-full"
                    onClick={() => checkoutMut.mutate(p.code)}
                    disabled={checkoutMut.isPending || overLimit}
                  >
                    {period === 'yearly' ? 'Yillik tanlash' : 'Tanlash'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
