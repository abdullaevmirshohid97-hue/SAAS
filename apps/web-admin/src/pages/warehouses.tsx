import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@clary/ui-web';
import { Loader2, Plus, RefreshCw, Warehouse } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type WarehouseTenant = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  plan_code: string;
  status: string;
  created_at: string;
  warehouse_tenant_domains?: Array<{ hostname: string }>;
  warehouse_tenant_databases?:
    | { status: string; last_error: string | null; provisioned_at: string | null }
    | Array<{ status: string; last_error: string | null; provisioned_at: string | null }>
    | null;
};

const statusLabel: Record<string, string> = {
  PENDING: 'Navbatda',
  PROVISIONING: 'Yaratilmoqda',
  ACTIVE: 'Faol',
  SUSPENDED: 'To‘xtatilgan',
  FAILED: 'Xatolik',
  DELETING: 'O‘chirilmoqda',
};

export function WarehousesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [planCode, setPlanCode] = useState('starter');

  const tenants = useQuery({
    queryKey: ['warehouse-tenants'],
    queryFn: () => api.get<WarehouseTenant[]>('/api/v1/admin/warehouses'),
    refetchInterval: 15000,
  });

  const retry = useMutation({
    mutationFn: (tenantId: string) =>
      api.post<{ tenant_id: string; status: string }>(`/api/v1/admin/warehouses/${tenantId}/retry`, {}),
    onSuccess: () => {
      toast.success('Provisioning qayta navbatga qo‘yildi');
      void qc.invalidateQueries({ queryKey: ['warehouse-tenants'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ tenant_id: string; hostname: string; status: string }>(
        '/api/v1/admin/warehouses',
        {
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          owner_user_id: ownerUserId.trim(),
          plan_code: planCode,
        },
      ),
    onSuccess: (result) => {
      toast.success(`Ombor tenant yaratildi: ${result.hostname}`);
      setName('');
      setSlug('');
      setOwnerUserId('');
      void qc.invalidateQueries({ queryKey: ['warehouse-tenants'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Warehouse className="h-6 w-6" /> CLARY Sklad
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Har bir kompaniya uchun alohida PostgreSQL database va subdomen.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void tenants.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Yangilash
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> Yangi Warehouse tenant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || !slug.trim() || !ownerUserId.trim()) {
                toast.error('Kompaniya nomi, subdomen va mavjud CLARY foydalanuvchi ID sini kiriting');
                return;
              }
              create.mutate();
            }}
          >
            <label className="space-y-1 text-sm">
              <span>Kompaniya nomi</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: ABC Distribution" />
            </label>
            <label className="space-y-1 text-sm">
              <span>Subdomen nomi</span>
              <div className="flex items-center gap-2">
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="abc-distribution" />
                <span className="text-muted-foreground whitespace-nowrap text-xs">.sklad.clary.uz</span>
              </div>
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span>Tenant egasining CLARY User ID (UUID)</span>
              <Input value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} placeholder="Supabase Auth user UUID" />
              <span className="text-muted-foreground text-xs">
                Hozircha mavjud CLARY hisobidan foydalaniladi. Yangi hisob/invite oqimi alohida bosqichda qo‘shiladi.
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span>Tarif kodi</span>
              <Input value={planCode} onChange={(e) => setPlanCode(e.target.value)} placeholder="starter" />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Tenant yaratish
              </Button>
            </div>
          </form>
          <p className="text-muted-foreground mt-3 text-xs">
            Yaratishdan so‘ng PostgreSQL database background worker orqali tayyorlanadi. WAREHOUSE_DATABASE_ADMIN_URL sozlanmagan bo‘lsa tenant ACTIVE bo‘lmaydi.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Warehouse tenantlar</CardTitle></CardHeader>
        <CardContent className="p-0">
          {tenants.isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...
            </div>
          ) : tenants.isError ? (
            <p className="text-destructive p-5 text-sm">{(tenants.error as Error).message}</p>
          ) : (tenants.data ?? []).length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">Hozircha ombor tenantlari yo‘q.</p>
          ) : (
            <div className="divide-y">
              {(tenants.data ?? []).map((tenant) => {
                const dbValue = tenant.warehouse_tenant_databases;
                const db = Array.isArray(dbValue) ? dbValue[0] : dbValue;
                const host = tenant.warehouse_tenant_domains?.[0]?.hostname ?? `${tenant.slug}.sklad.clary.uz`;
                return (
                  <div key={tenant.id} className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="font-medium">{tenant.name}</div>
                      <a className="text-primary text-sm hover:underline" href={`https://${host}`} target="_blank" rel="noreferrer">{host}</a>
                      <div className="text-muted-foreground mt-1 text-xs">
                        DB: {db?.status ?? 'PENDING'} · Tarif: {tenant.plan_code} · {tenant.id}
                      </div>
                      {db?.last_error && <p className="text-destructive mt-1 text-xs">{db.last_error}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={tenant.status === 'ACTIVE' ? 'default' : tenant.status === 'FAILED' ? 'destructive' : 'outline'}>
                        {statusLabel[tenant.status] ?? tenant.status}
                      </Badge>
                      {tenant.status === 'FAILED' && (
                        <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(tenant.id)}>
                          Qayta urinish
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void tenants.refetch()}>Holat</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
