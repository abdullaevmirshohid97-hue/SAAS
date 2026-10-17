import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '@clary/ui-web';
import {
  ENTITLEMENT_GROUPS,
  ENTITLEMENT_MODULES,
  PAYMENT_METHOD_OPTIONS,
  moduleEnabled,
} from '@clary/schemas';
import {
  Ban,
  CheckCircle2,
  Laptop,
  Lock,
  Monitor,
  Smartphone,
  Sparkles,
  Trash2,
  Tv,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { deviceId } from '@/lib/device';
import { useEntitlements } from '@/hooks/use-entitlements';
import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Obuna sahifasi: (1) tarifga nimalar kiradi — modullar, to'lov turlari,
// jurnal; (2) klinika qurilmalari (egasi/administrator bloklaydi, o'chiradi).
// =============================================================================

export function PlanAccessCard() {
  const { ent } = useEntitlements();
  if (!ent) return null;
  const closed = ENTITLEMENT_MODULES.filter((m) => !moduleEnabled(ent, m.key));
  const methods = ent.payments.methods;
  const ov = ent.override;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="text-base">Tarifingizga nimalar kiradi</CardTitle>
        {ent.plan_name && <Badge variant="outline">{ent.plan_name}</Badge>}
        {ov?.active && (
          <Badge className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Sparkles className="h-3 w-3" /> Individual kelishuv
            {ov.valid_until ? ` · ${ov.valid_until} gacha` : ''}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ENTITLEMENT_GROUPS.map((g) => {
            const mods = ENTITLEMENT_MODULES.filter((m) => m.group === g.key);
            return (
              <div key={g.key} className="rounded-lg border p-3">
                <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                  {g.label}
                </div>
                <ul className="space-y-1">
                  {mods.map((m) => {
                    const on = moduleEnabled(ent, m.key);
                    return (
                      <li
                        key={m.key}
                        className={cn('flex items-center gap-2', !on && 'text-muted-foreground')}
                      >
                        {on ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        ) : (
                          <Lock className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {m.label}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>
            To‘lov turlari:{' '}
            <b className="text-foreground">
              {methods
                ? methods
                    .map((k) => PAYMENT_METHOD_OPTIONS.find((o) => o.key === k)?.label ?? k)
                    .join(', ')
                : 'hammasi'}
            </b>
          </span>
          <span>
            Jurnal tarixi:{' '}
            <b className="text-foreground">
              {ent.journal.history_days ? `${ent.journal.history_days} kun` : 'cheksiz'}
            </b>
          </span>
          <span>
            Jurnalni tahrirlash/o‘chirish:{' '}
            <b className="text-foreground">
              {ent.journal.allow_edit ? 'ha' : 'yo‘q'} / {ent.journal.allow_delete ? 'ha' : 'yo‘q'}
            </b>
          </span>
        </div>
        {closed.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Yopiq bo‘limlarni yoqish uchun tarifni kengaytiring yoki Clary bilan bog‘laning —
            ma’lumotlaringiz saqlanadi.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const CLIENT_ICON = { web: Monitor, desktop: Laptop, mobile: Smartphone, kiosk: Tv } as const;

export function ClinicDevicesCard() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const isAdmin = role === 'clinic_owner' || role === 'clinic_admin';
  const q = useQuery({
    queryKey: ['clinic-devices'],
    queryFn: () => api.entitlements.devices(),
    enabled: isAdmin,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['clinic-devices'] });
  const updMut = useMutation({
    mutationFn: (v: { id: string; is_revoked: boolean }) =>
      api.entitlements.updateDevice(v.id, { is_revoked: v.is_revoked }),
    onSuccess: () => {
      toast.success('Qurilma yangilandi');
      void refresh();
      void qc.invalidateQueries({ queryKey: ['subscription', 'usage'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.entitlements.deleteDevice(id),
    onSuccess: () => {
      toast.success('Qurilma o‘chirildi');
      void refresh();
      void qc.invalidateQueries({ queryKey: ['subscription', 'usage'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;
  const rows = q.data ?? [];
  const mine = deviceId();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Qurilmalar</CardTitle>
        <p className="text-muted-foreground text-xs">
          Xodimlar kirgan kompyuter va telefonlar. Yo‘qolgan yoki begona qurilmani bloklang — u
          darhol uziladi. O‘chirilgan qurilma keyingi kirishda qayta yoziladi.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground px-6 pb-4 text-sm">
            {q.isLoading ? 'Yuklanmoqda…' : 'Hali qurilma yozilmagan'}
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((d) => {
              const Icon = CLIENT_ICON[(d.client ?? 'web') as keyof typeof CLIENT_ICON] ?? Monitor;
              const isMine = d.fingerprint === mine;
              return (
                <li
                  key={d.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-6 py-3',
                    d.is_revoked && 'bg-rose-500/5',
                  )}
                >
                  <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {d.name}
                      {isMine && <Badge variant="outline">Shu qurilma</Badge>}
                      {d.is_revoked && <Badge variant="destructive">Bloklangan</Badge>}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {d.user_name ?? '—'} · {new Date(d.last_used_at).toLocaleString('uz-UZ')}
                    </div>
                  </div>
                  {!isMine && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={updMut.isPending}
                        onClick={() => updMut.mutate({ id: d.id, is_revoked: !d.is_revoked })}
                      >
                        {d.is_revoked ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Ochish
                          </>
                        ) : (
                          <>
                            <Ban className="h-3.5 w-3.5" /> Bloklash
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={delMut.isPending}
                        onClick={() => {
                          if (confirm(`"${d.name}" ro‘yxatdan o‘chirilsinmi?`)) delMut.mutate(d.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
