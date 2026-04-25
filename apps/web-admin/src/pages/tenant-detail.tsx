import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@clary/ui-web';
import { toast } from 'sonner';
import { LogIn, ShieldOff, ShieldCheck } from 'lucide-react';

import { api } from '@/lib/api';

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  is_suspended: boolean;
  current_plan?: string;
  profiles?: Array<{ id: string; email: string; full_name: string; role: string }>;
}

export function TenantDetailPage() {
  const { id } = useParams();
  const { data, refetch } = useQuery({
    queryKey: ['tenant', id],
    queryFn: () => api.get<TenantDetail>(`/api/v1/admin/tenants/${id}`),
    enabled: !!id,
  });

  const suspendMut = useMutation({
    mutationFn: (reason: string) => api.post(`/api/v1/admin/tenants/${id}/suspend`, { reason }),
    onSuccess: () => {
      toast.success('Klinika to‘xtatildi');
      refetch();
    },
  });
  const unsuspendMut = useMutation({
    mutationFn: () => api.post(`/api/v1/admin/tenants/${id}/unsuspend`, {}),
    onSuccess: () => {
      toast.success('Klinika yoqildi');
      refetch();
    },
  });
  const impersonate = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      api.admin.impersonate(userId, reason),
    onSuccess: (r) => {
      toast.success('Impersonation sessiyasi yaratildi');
      if (r.action_link) window.open(r.action_link, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return <div className="text-sm text-muted-foreground">Yuklanmoqda…</div>;

  const owner = data.profiles?.find((p) => p.role === 'clinic_owner' || p.role === 'clinic_admin');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <p className="text-sm text-muted-foreground">{data.slug}</p>
        </div>
        <div className="flex gap-2">
          {owner && (
            <Button
              variant="outline"
              onClick={() => {
                const reason = window.prompt(
                  `${owner.email} sifatida kirish uchun sababni kiriting (kamida 10 ta belgi):`,
                );
                if (reason && reason.length >= 10) {
                  impersonate.mutate({ userId: owner.id, reason });
                } else if (reason !== null) {
                  toast.error('Sabab kamida 10 ta belgi bo‘lishi kerak');
                }
              }}
              disabled={impersonate.isPending}
            >
              <LogIn className="mr-1.5 h-4 w-4" /> Impersonate
            </Button>
          )}
          {data.is_suspended ? (
            <Button variant="outline" onClick={() => unsuspendMut.mutate()} disabled={unsuspendMut.isPending}>
              <ShieldCheck className="mr-1.5 h-4 w-4" /> Yoqish
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={suspendMut.isPending}
              onClick={() => {
                const r = prompt('To‘xtatish sababi:');
                if (r) suspendMut.mutate(r);
              }}
            >
              <ShieldOff className="mr-1.5 h-4 w-4" /> To‘xtatish
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Holat</CardTitle>
          </CardHeader>
          <CardContent>
            {data.is_suspended ? (
              <Badge variant="destructive">To‘xtatilgan</Badge>
            ) : (
              <Badge variant="success">Faol</Badge>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tarif</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">{data.current_plan ?? '—'}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Xodimlar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data.profiles?.length ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Xodimlar ro‘yxati</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Ism</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Rol</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(data.profiles ?? []).map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{p.full_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.email}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline">{p.role}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={impersonate.isPending}
                        onClick={() => {
                          const reason = window.prompt(
                            `${p.email} sifatida kirish uchun sabab (>=10 belgi):`,
                          );
                          if (reason && reason.length >= 10) {
                            impersonate.mutate({ userId: p.id, reason });
                          } else if (reason !== null) {
                            toast.error('Sabab kamida 10 ta belgi');
                          }
                        }}
                      >
                        Impersonate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
