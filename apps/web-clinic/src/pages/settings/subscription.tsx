import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@clary/ui-web';
import { toast } from 'sonner';
import { Copy, Check } from 'lucide-react';

import { api } from '@/lib/api';

type CurrentSub = {
  current_plan?: string;
  subscription_status?: string;
  trial_ends_at?: string | null;
  subscription_ends_at?: string | null;
  grace_ends_at?: string | null;
  billing_code?: string | null;
  trial_used?: boolean;
};

const STATUS_META: Record<string, { label: string; tone: string }> = {
  trialing: { label: 'Bepul sinov', tone: 'bg-sky-100 text-sky-800' },
  active: { label: 'Faol', tone: 'bg-emerald-100 text-emerald-800' },
  past_due: { label: "To'lov kutilmoqda", tone: 'bg-amber-100 text-amber-800' },
  unpaid: { label: "To'lanmagan", tone: 'bg-red-100 text-red-800' },
  canceled: { label: 'Bekor qilingan', tone: 'bg-zinc-100 text-zinc-700' },
  paused: { label: "To'xtatilgan", tone: 'bg-zinc-100 text-zinc-700' },
};

function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

export function SettingsSubscriptionPage() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

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
  const { data: recommendation } = useQuery({
    queryKey: ['subscription', 'recommendation'],
    queryFn: () => api.subscription.recommendation(),
  });

  const planList = plans ?? [];
  const cur = current as CurrentSub | undefined;
  const status = cur?.subscription_status ?? 'trialing';
  const isDemo = !cur?.current_plan || cur.current_plan === 'demo';

  const trialMut = useMutation({
    mutationFn: (planCode: '25pro' | '50pro' | '120pro') =>
      api.subscription.startTrial(planCode),
    onSuccess: () => {
      toast.success('1 oylik bepul sinov boshlandi!');
      qc.invalidateQueries({ queryKey: ['subscription'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyCode = () => {
    if (!cur?.billing_code) return;
    navigator.clipboard.writeText(cur.billing_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Holat banneri uchun
  const trialDays = daysLeft(cur?.trial_ends_at);
  const graceDays = daysLeft(cur?.grace_ends_at);
  const subDays = daysLeft(cur?.subscription_ends_at);
  const statusMeta = STATUS_META[status] ?? { label: status, tone: 'bg-zinc-100 text-zinc-700' };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Obuna va to&apos;lov</h2>
        <p className="text-sm text-muted-foreground">
          Tarifni tanlang, 1 oy bepul sinab ko&apos;ring, keyin to&apos;lang.
        </p>
      </div>

      {/* Joriy holat banneri */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusMeta.tone}`}>
                {statusMeta.label}
              </span>
              {cur?.current_plan && cur.current_plan !== 'demo' && (
                <Badge variant="outline">
                  {planList.find((p) => p.code === cur.current_plan)?.name ?? cur.current_plan}
                </Badge>
              )}
            </div>
            {status === 'trialing' && trialDays != null && (
              <p className="text-sm text-muted-foreground">
                Bepul sinov: <strong className="text-foreground">{trialDays} kun</strong> qoldi
              </p>
            )}
            {status === 'active' && subDays != null && (
              <p className="text-sm text-muted-foreground">
                Obuna <strong className="text-foreground">{subDays} kun</strong> amal qiladi
              </p>
            )}
            {status === 'past_due' && (
              <p className="text-sm text-amber-700">
                To&apos;lov muddati o&apos;tdi.{' '}
                {graceDays != null && <>Bloklanishigacha <strong>{graceDays} kun</strong>.</>}
              </p>
            )}
            {status === 'unpaid' && (
              <p className="text-sm text-red-700">
                Obuna to&apos;lanmagan — klinika cheklangan. Iltimos to&apos;lovni amalga oshiring.
              </p>
            )}
          </div>

          {/* Billing kod */}
          {cur?.billing_code && (
            <div className="rounded-lg border bg-muted/30 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                To&apos;lov kodingiz
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="mt-0.5 flex items-center gap-2 font-mono text-lg font-bold"
              >
                {cur.billing_code}
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* To'lov ko'rsatmasi */}
      {(status === 'trialing' || status === 'past_due' || status === 'unpaid' || status === 'active') &&
        !isDemo && (
          <Card>
            <CardContent className="space-y-1.5 p-4 text-sm">
              <div className="font-semibold">Qanday to&apos;lash kerak</div>
              <p className="text-muted-foreground">
                Click yoki Payme orqali tarif summasini to&apos;lang. To&apos;lov izohiga{' '}
                <strong className="font-mono text-foreground">{cur?.billing_code}</strong> kodini
                yozing — tizim to&apos;lovni avtomatik aniqlab, obunani 1 oyga uzaytiradi.
              </p>
              <p className="text-muted-foreground">
                Bank o&apos;tkazmasi orqali to&apos;lasangiz — administrator bilan bog&apos;laning,
                to&apos;lov tasdiqlangach obuna faollashtiriladi.
              </p>
            </CardContent>
          </Card>
        )}

      {/* Usage */}
      {usage && (
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
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

      {/* Tizim tavsiyasi */}
      {isDemo && recommendation && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary">
              Tizim tavsiyasi
            </div>
            <p className="mt-1 text-sm">
              {recommendation.reason}{' '}
              <strong>
                Tavsiya:{' '}
                {planList.find((p) => p.code === recommendation.recommended_code)?.name ??
                  recommendation.recommended_code}
              </strong>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tariflar */}
      <div>
        <h3 className="mb-3 text-lg font-semibold">
          {isDemo ? 'Tarifni tanlang — 1 oy bepul sinab ko‘ring' : 'Tariflar'}
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          {planList
            .filter((p) => p.code !== 'demo')
            .map((p) => {
              const isCurrent = p.code === cur?.current_plan;
              const isRecommended =
                isDemo && recommendation?.recommended_code === p.code;
              const overLimit =
                usage?.staff_limit != null &&
                p.max_staff != null &&
                usage.staff_used > p.max_staff;
              return (
                <Card
                  key={p.code}
                  className={
                    isCurrent || isRecommended ? 'border-primary' : ''
                  }
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      {p.name}
                      {isCurrent && <Badge>Joriy</Badge>}
                      {!isCurrent && isRecommended && <Badge>Tavsiya</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-bold">
                      {(p.price_uzs ?? 0).toLocaleString('uz-UZ')}
                      <span className="text-sm font-normal text-muted-foreground"> so‘m/oy</span>
                    </div>
                    <ul className="space-y-1 text-sm">
                      <li>{p.max_staff ?? 'Cheksiz'} xodim</li>
                      <li>{p.max_devices ?? 'Cheksiz'} qurilma</li>
                      <li>{p.features?.analytics ? '✓' : '✗'} Analitika</li>
                      <li>{p.features?.custom_roles ? '✓' : '✗'} Custom rollar</li>
                      <li>{p.features?.sla ? '✓' : '✗'} SLA</li>
                    </ul>
                    {overLimit && !isCurrent && (
                      <p className="text-[11px] text-destructive">
                        Xodimlar soni bu tarif limitidan ortiq
                      </p>
                    )}
                    {/* Demo + trial hali ishlatilmagan — "1 oy bepul" tugmasi */}
                    {isDemo && !cur?.trial_used && (
                      <Button
                        className="w-full"
                        onClick={() =>
                          trialMut.mutate(p.code as '25pro' | '50pro' | '120pro')
                        }
                        disabled={trialMut.isPending || overLimit}
                      >
                        1 oy bepul sinash
                      </Button>
                    )}
                    {/* Trial ishlatilgan — faqat to'lov (billing kod orqali) */}
                    {isDemo && cur?.trial_used && (
                      <div className="rounded-md bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
                        Bepul sinov ishlatilgan. To&apos;lov uchun yuqoridagi
                        billing kodni ishlating.
                      </div>
                    )}
                    {/* Trial/to'lov holatida — tarif almashtirish */}
                    {!isDemo && !isCurrent && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          trialMut.mutate(p.code as '25pro' | '50pro' | '120pro')
                        }
                        disabled={trialMut.isPending || overLimit}
                      >
                        Bu tarifga o&apos;tish
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Tarif yoki to&apos;lov bo&apos;yicha savollar uchun:{' '}
          <a
            href="mailto:clarysupport@gmail.com"
            className="font-medium text-primary hover:underline"
          >
            clarysupport@gmail.com
          </a>
        </p>
      </div>
    </div>
  );
}
