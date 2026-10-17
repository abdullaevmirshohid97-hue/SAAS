import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AdminEntitlementPlan, EntitlementCatalog } from '@clary/api-client';
import { Badge, Button, Card, CardContent, cn } from '@clary/ui-web';
import {
  Building2,
  Check,
  Minus,
  Pencil,
  Users,
  MonitorSmartphone,
  CreditCard,
} from 'lucide-react';

import { api } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/query-state';
import { fmtUzs, limitText } from '@/components/entitlements/ent-utils';

// =============================================================================
// Tariflar — ro'yxat + modullar bo'yicha taqqoslash matritsasi. Tahrirlash
// alohida sahifada (/plans/:code): narx, limitlar, modullar, jurnal, to'lov
// turlari, analitika, rollar va qurilmalar.
// =============================================================================

export function PlansPage() {
  const plansQ = useQuery({
    queryKey: ['admin', 'entitlement-plans'],
    queryFn: () => api.admin.entitlementPlans(),
  });
  const catalogQ = useQuery({
    queryKey: ['admin', 'entitlements-catalog'],
    queryFn: () => api.admin.entitlementsCatalog(),
    staleTime: 10 * 60_000,
  });

  if (plansQ.isLoading || catalogQ.isLoading) return <LoadingState />;
  if (plansQ.isError || catalogQ.isError) {
    return (
      <ErrorState
        message={((plansQ.error ?? catalogQ.error) as Error)?.message}
        onRetry={() => {
          void plansQ.refetch();
          void catalogQ.refetch();
        }}
      />
    );
  }
  const plans = plansQ.data ?? [];
  const catalog = catalogQ.data!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tariflar va imkoniyatlar</h1>
        <p className="text-muted-foreground text-sm">
          Har bir tarifga kiradigan modullar, jurnal va to‘lov cheklovlari, analitika, rollar va
          qurilmalar. Klinikaga alohida kelishuv — klinika sahifasidagi “Tarif va ruxsatlar”
          bo‘limida.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <PlanCard key={p.code} plan={p} catalog={catalog} />
        ))}
      </div>

      <Comparison plans={plans} catalog={catalog} />
    </div>
  );
}

function PlanCard({ plan, catalog }: { plan: AdminEntitlementPlan; catalog: EntitlementCatalog }) {
  const e = plan.entitlements;
  const enabled = catalog.modules.filter((m) => e.modules[m.key] !== false).length;
  return (
    <Card className={cn('flex flex-col', !plan.is_active && 'opacity-70')}>
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-lg font-semibold leading-tight">{plan.name}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="outline" className="font-mono text-[10px]">
                {plan.code}
              </Badge>
              {plan.is_active ? (
                <Badge variant="success">Faol</Badge>
              ) : (
                <Badge variant="destructive">Nofaol</Badge>
              )}
              {!plan.is_public && <Badge variant="secondary">Saytda yashirin</Badge>}
            </div>
          </div>
          <Link to={`/plans/${plan.code}`}>
            <Button size="sm" variant="outline" className="gap-1">
              <Pencil className="h-3.5 w-3.5" /> Tahrirlash
            </Button>
          </Link>
        </div>

        <div>
          <div className="text-2xl font-bold">{fmtUzs(plan.price_uzs)}</div>
          <div className="text-muted-foreground text-xs">
            oyiga · yillik {fmtUzs(plan.price_yearly_uzs)}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Stat icon={Users} label="Xodim" value={limitText(plan.max_staff)} />
          <Stat icon={MonitorSmartphone} label="Qurilma" value={limitText(plan.max_devices)} />
          <Stat icon={Building2} label="Klinika" value={String(plan.clinics.total)} />
        </div>

        <div className="space-y-1.5 text-xs">
          <Row label="Modullar" value={`${enabled} / ${catalog.modules.length}`} />
          <Row
            label="To‘lov turlari"
            value={e.payments.methods ? `${e.payments.methods.length} ta` : 'Hammasi'}
          />
          <Row
            label="Jurnal tarixi"
            value={e.journal.history_days ? `${e.journal.history_days} kun` : 'Cheksiz'}
          />
          <Row
            label="Jurnal tahriri / o‘chirish"
            value={`${e.journal.allow_edit ? 'Ha' : 'Yo‘q'} / ${e.journal.allow_delete ? 'Ha' : 'Yo‘q'}`}
          />
          <Row
            label="Rollar"
            value={e.roles.allowed ? `${e.roles.allowed.length} ta` : 'Hammasi'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-lg px-2 py-2">
      <Icon className="text-muted-foreground mx-auto mb-0.5 h-3.5 w-3.5" />
      <div className="font-semibold">{value}</div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Comparison({
  plans,
  catalog,
}: {
  plans: AdminEntitlementPlan[];
  catalog: EntitlementCatalog;
}) {
  const yes = <Check className="mx-auto h-4 w-4 text-emerald-500" />;
  const no = <Minus className="text-muted-foreground/50 mx-auto h-4 w-4" />;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <CreditCard className="text-muted-foreground h-4 w-4" />
          <span className="font-semibold">Taqqoslash</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Imkoniyat</th>
                {plans.map((p) => (
                  <th key={p.code} className="px-3 py-2.5 text-center font-medium">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.groups.map((g) => (
                <GroupRows key={g.key} title={g.label}>
                  {catalog.modules
                    .filter((m) => m.group === g.key)
                    .map((m) => (
                      <tr key={m.key} className="border-t">
                        <td className="px-4 py-2">{m.label}</td>
                        {plans.map((p) => (
                          <td key={p.code} className="px-3 py-2">
                            {p.entitlements.modules[m.key] === false ? no : yes}
                          </td>
                        ))}
                      </tr>
                    ))}
                </GroupRows>
              ))}
              <GroupRows title="Jurnal va to‘lovlar">
                <tr className="border-t">
                  <td className="px-4 py-2">Jurnal tarixi</td>
                  {plans.map((p) => (
                    <td key={p.code} className="px-3 py-2 text-center text-xs">
                      {p.entitlements.journal.history_days
                        ? `${p.entitlements.journal.history_days} kun`
                        : 'Cheksiz'}
                    </td>
                  ))}
                </tr>
                {(['allow_edit', 'allow_delete', 'allow_export'] as const).map((k) => (
                  <tr key={k} className="border-t">
                    <td className="px-4 py-2">
                      {k === 'allow_edit'
                        ? 'Jurnalni tahrirlash'
                        : k === 'allow_delete'
                          ? 'O‘chirish / bekor qilish'
                          : 'Eksport'}
                    </td>
                    {plans.map((p) => (
                      <td key={p.code} className="px-3 py-2">
                        {p.entitlements.journal[k] ? yes : no}
                      </td>
                    ))}
                  </tr>
                ))}
                {catalog.payment_methods.map((pm) => (
                  <tr key={pm.key} className="border-t">
                    <td className="px-4 py-2">To‘lov: {pm.label}</td>
                    {plans.map((p) => (
                      <td key={p.code} className="px-3 py-2">
                        {!p.entitlements.payments.methods ||
                        p.entitlements.payments.methods.includes(pm.key)
                          ? yes
                          : no}
                      </td>
                    ))}
                  </tr>
                ))}
              </GroupRows>
              <GroupRows title="Qurilmalar">
                {catalog.clients.map((c) => (
                  <tr key={c.key} className="border-t">
                    <td className="px-4 py-2">{c.label}</td>
                    {plans.map((p) => (
                      <td key={p.code} className="px-3 py-2">
                        {p.entitlements.devices.clients[c.key] ? yes : no}
                      </td>
                    ))}
                  </tr>
                ))}
              </GroupRows>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function GroupRows({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-muted/20 border-t">
        <td
          colSpan={99}
          className="text-muted-foreground px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
        >
          {title}
        </td>
      </tr>
      {children}
    </>
  );
}
