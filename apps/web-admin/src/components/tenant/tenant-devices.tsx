import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClinicDevice } from '@clary/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  cn,
} from '@clary/ui-web';
import {
  Ban,
  CheckCircle2,
  Laptop,
  Monitor,
  Pencil,
  ShieldCheck,
  Smartphone,
  Trash2,
  Tv,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/query-state';
import { limitText } from '@/components/entitlements/ent-utils';
import { ROLE_LABELS } from './tenant-roles';

// =============================================================================
// Klinika qurilmalari — qaysi kompyuter/telefondan kim ishlaydi. Bloklash
// (qurilma darhol API'dan uziladi), ishonchli deb belgilash, nomlash, o'chirish
// (keyingi kirishda yangi qurilma sifatida qayta yoziladi).
// =============================================================================

const CLIENT_ICON = { web: Monitor, desktop: Laptop, mobile: Smartphone, kiosk: Tv } as const;
const CLIENT_LABEL: Record<string, string> = {
  web: 'Brauzer',
  desktop: 'Kompyuter ilovasi',
  mobile: 'Mobil ilova',
  kiosk: 'Kiosk / TV',
};

export function TenantDevices({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  // Limit — amaldagi imkoniyatlardan ("Tarif va ruxsatlar" bilan umumiy kesh)
  const entQ = useQuery({
    queryKey: ['admin', 'clinic-entitlements', clinicId],
    queryFn: () => api.admin.clinicEntitlements(clinicId),
  });
  const maxDevices = entQ.data?.effective.limits.max_devices ?? null;
  const enforced = entQ.data?.effective.devices.enforce_limit ?? false;
  const q = useQuery({
    queryKey: ['admin', 'clinic-devices', clinicId],
    queryFn: () => api.admin.clinicDevices(clinicId),
  });
  const [deleting, setDeleting] = useState<ClinicDevice | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'clinic-devices', clinicId] });

  const updMut = useMutation({
    mutationFn: (v: {
      id: string;
      body: { name?: string; is_revoked?: boolean; is_trusted?: boolean };
    }) => api.admin.updateClinicDevice(clinicId, v.id, v.body),
    onSuccess: () => {
      toast.success('Qurilma yangilandi');
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.admin.deleteClinicDevice(clinicId, id),
    onSuccess: () => {
      toast.success('Qurilma o‘chirildi');
      setDeleting(null);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError)
    return <ErrorState message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  const active = rows.filter((d) => !d.is_revoked).length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="text-base">Qurilmalar</CardTitle>
        <Badge variant={maxDevices != null && active > maxDevices ? 'destructive' : 'outline'}>
          {active} faol / limit {limitText(maxDevices)}
        </Badge>
        <Badge variant={enforced ? 'warning' : 'secondary'}>
          {enforced ? 'Qat’iy cheklov yoqilgan' : 'Faqat hisob (cheklanmaydi)'}
        </Badge>
        <span className="text-muted-foreground w-full text-xs">
          Qurilma xodim yangi ilova versiyasi bilan kirganda avtomatik yoziladi. Bloklangan qurilma
          darhol uziladi; o‘chirilgani keyingi kirishda yana paydo bo‘ladi (limit yoqilgan bo‘lsa —
          joy bo‘shaydi).
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground px-4 pb-4 text-sm">Hali qurilma yozilmagan</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                <tr>
                  <th className="px-4 py-2.5">Qurilma</th>
                  <th className="px-4 py-2.5">Xodim</th>
                  <th className="px-4 py-2.5">So‘nggi faollik</th>
                  <th className="px-4 py-2.5">Holat</th>
                  <th className="px-4 py-2.5 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const Icon =
                    CLIENT_ICON[(d.client ?? 'web') as keyof typeof CLIENT_ICON] ?? Monitor;
                  return (
                    <tr
                      key={d.id}
                      className={cn('border-b last:border-b-0', d.is_revoked && 'bg-rose-500/5')}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                          <div>
                            <div className="font-medium">{d.name}</div>
                            <div className="text-muted-foreground text-xs">
                              {CLIENT_LABEL[d.client ?? ''] ?? 'Noma‘lum'}
                              {d.app_version ? ` · v${d.app_version}` : ''}
                              {d.last_ip ? ` · ${d.last_ip}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div>{d.user_name ?? '—'}</div>
                        <div className="text-muted-foreground text-xs">
                          {d.user_role ? (ROLE_LABELS[d.user_role] ?? d.user_role) : ''}
                        </div>
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 text-xs">
                        {new Date(d.last_used_at).toLocaleString('uz-UZ')}
                        <div>qo‘shilgan {new Date(d.created_at).toLocaleDateString('uz-UZ')}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {d.is_revoked ? (
                            <Badge variant="destructive">Bloklangan</Badge>
                          ) : (
                            <Badge variant="success">Faol</Badge>
                          )}
                          {d.is_trusted && <Badge variant="info">Ishonchli</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Nomlash"
                            onClick={() => {
                              const name = prompt('Qurilma nomi', d.name);
                              if (name && name.trim())
                                updMut.mutate({ id: d.id, body: { name: name.trim() } });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title={d.is_trusted ? 'Ishonchlidan olish' : 'Ishonchli deb belgilash'}
                            onClick={() =>
                              updMut.mutate({ id: d.id, body: { is_trusted: !d.is_trusted } })
                            }
                          >
                            <ShieldCheck
                              className={cn('h-3.5 w-3.5', d.is_trusted && 'text-sky-500')}
                            />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title={d.is_revoked ? 'Blokdan chiqarish' : 'Bloklash'}
                            onClick={() =>
                              updMut.mutate({ id: d.id, body: { is_revoked: !d.is_revoked } })
                            }
                          >
                            {d.is_revoked ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Ban className="h-3.5 w-3.5 text-amber-600" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive h-8 w-8"
                            title="O‘chirish"
                            onClick={() => setDeleting(d)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`"${deleting?.name ?? ''}" o‘chirilsinmi?`}
        description="Qurilma ro‘yxatdan olinadi. Bloklash uchun “Bloklash” tugmasidan foydalaning — o‘chirilgan qurilma keyingi kirishda qayta yoziladi."
        confirmLabel="O‘chirish"
        destructive
        loading={delMut.isPending}
        onConfirm={() => deleting && delMut.mutate(deleting.id)}
      />
    </Card>
  );
}
