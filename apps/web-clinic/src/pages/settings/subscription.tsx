import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export function SettingsSubscriptionPage() {
  const { user } = useAuth();
  const { data: current } = useQuery({ queryKey: ['subscription'], queryFn: () => api.subscription.current() });
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: () => api.subscription.plans() });
  const planList = (plans ?? []) as Array<{ code: string; name: string; price_usd_cents: number; max_staff: number | null; max_devices: number | null; features: Record<string, boolean> }>;

  const checkoutMut = useMutation({
    mutationFn: (plan_code: string) => api.subscription.checkout({ plan_code, email: user?.email ?? '' }),
    onSuccess: (r) => { window.location.href = (r as { url: string }).url; },
    onError: (e: Error) => toast.error(e.message),
  });

  const cur = current as { current_plan?: string; subscription_status?: string; trial_ends_at?: string } | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Obuna</h2>
        <p className="text-sm text-muted-foreground">
          Joriy tarif: <Badge>{cur?.current_plan?.toUpperCase() ?? 'DEMO'}</Badge>
          {cur?.trial_ends_at && <span className="ml-2">Demo {new Date(cur.trial_ends_at).toLocaleDateString('uz-UZ')} gacha</span>}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {planList.map((p) => (
          <Card key={p.code} className={p.code === cur?.current_plan ? 'border-primary' : ''}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {p.name}
                {p.code === cur?.current_plan && <Badge>Joriy</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-bold">${(p.price_usd_cents / 100).toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/oy</span></div>
              <ul className="space-y-1 text-sm">
                <li>{p.max_staff ?? 'Cheksiz'} xodim</li>
                <li>{p.max_devices ?? 'Cheksiz'} qurilma</li>
                <li>{p.features?.analytics ? '✓' : '✗'} Analitika</li>
                <li>{p.features?.custom_roles ? '✓' : '✗'} Custom rollar</li>
                <li>{p.features?.sla ? '✓' : '✗'} SLA</li>
              </ul>
              {p.code !== cur?.current_plan && p.code !== 'demo' && (
                <Button className="w-full" onClick={() => checkoutMut.mutate(p.code)} disabled={checkoutMut.isPending}>Tanlash</Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
