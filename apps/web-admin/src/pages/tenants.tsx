import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@clary/ui-web';
import { Pencil, RotateCcw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  current_plan: string;
  subscription_status: string;
  is_suspended: boolean;
  deleted_at: string | null;
  created_at: string;
};

const PLAN_OPTS = ['all', 'demo', '25pro', '50pro', '120pro'] as const;
const STATUS_OPTS = ['all', 'active', 'trialing', 'past_due', 'canceled', 'paused'] as const;

export function TenantsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState<(typeof PLAN_OPTS)[number]>('all');
  const [status, setStatus] = useState<(typeof STATUS_OPTS)[number]>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [deleting, setDeleting] = useState<Tenant | null>(null);

  const { data } = useQuery({
    queryKey: ['tenants', { q, includeDeleted }],
    queryFn: () => api.admin.listTenants({ q: q || undefined, include_deleted: includeDeleted }),
  });

  // Plan + status filtri client tomonida (qator soni 200dan kam — qabul).
  const tenants = useMemo(() => {
    const list = data ?? [];
    return list.filter((t) => {
      if (plan !== 'all' && t.current_plan !== plan) return false;
      if (status !== 'all' && t.subscription_status !== status) return false;
      return true;
    });
  }, [data, plan, status]);

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.admin.restoreTenant(id),
    onSuccess: () => {
      toast.success('Klinika qaytarildi');
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Klinikalar</h1>
        <div className="text-sm text-muted-foreground">
          Jami: <span className="font-semibold text-foreground">{tenants.length}</span>
        </div>
      </div>

      {/* Filtrlar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Klinika nomi yoki slug..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value as typeof plan)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">Barcha tariflar</option>
            <option value="demo">Demo</option>
            <option value="25pro">Base (25pro)</option>
            <option value="50pro">Pro (50pro)</option>
            <option value="120pro">Enterprise (120pro)</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">Barcha holatlar</option>
            <option value="active">Faol</option>
            <option value="trialing">Sinov</option>
            <option value="past_due">Muddati o‘tgan</option>
            <option value="canceled">Bekor qilingan</option>
            <option value="paused">To‘xtatilgan</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
            />
            O‘chirilganlarni ko‘rsatish
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3">Nom</th>
                <th className="p-3">Tarif</th>
                <th className="p-3">Holat</th>
                <th className="p-3 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const isDeleted = !!t.deleted_at;
                return (
                  <tr
                    key={t.id}
                    className={
                      'border-b last:border-0 hover:bg-accent/50 ' +
                      (isDeleted ? 'opacity-60' : '')
                    }
                  >
                    <td className="p-3">
                      <Link to={`/tenants/${t.id}`} className="font-medium text-primary hover:underline">
                        {t.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{t.slug}</div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline">{t.current_plan}</Badge>
                    </td>
                    <td className="p-3">
                      {isDeleted ? (
                        <Badge variant="destructive">O‘chirilgan</Badge>
                      ) : t.is_suspended ? (
                        <Badge variant="destructive">Suspended</Badge>
                      ) : (
                        <Badge variant="success">{t.subscription_status}</Badge>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        {isDeleted ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={restoreMut.isPending}
                            onClick={() => restoreMut.mutate(t.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Qaytarish
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Tahrirlash"
                              onClick={() => setEditing(t)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              title="O‘chirish"
                              onClick={() => setDeleting(t)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">
                    Klinika topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editing && (
        <EditTenantDialog
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['tenants'] });
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteTenantDialog
          tenant={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ['tenants'] });
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function EditTenantDialog({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: Tenant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [slug, setSlug] = useState(tenant.slug);

  const saveMut = useMutation({
    mutationFn: () => api.admin.updateTenant(tenant.id, { name, slug }),
    onSuccess: () => {
      toast.success('Saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Klinikani tahrirlash</DialogTitle>
          <DialogDescription>Nom va slug o‘zgartirish.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="masalan: clinic-name"
            />
            <p className="text-[11px] text-muted-foreground">
              URL'da ko‘rinadi. Kichik harf, raqam va tire (-) ruxsat etiladi.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!name || !slug || saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTenantDialog({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: Tenant;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const canDelete = typed.trim() === tenant.name;

  const deleteMut = useMutation({
    mutationFn: () => api.admin.deleteTenant(tenant.id),
    onSuccess: () => {
      toast.success('Klinika o‘chirildi');
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-rose-600">Klinikani o‘chirish</DialogTitle>
          <DialogDescription>
            Bu klinika ro‘yxatdan yashiriladi va faol obunalar bekor qilinadi.
            Ma'lumotlar bazada qoladi — kerak bo‘lsa qaytarish mumkin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            Tasdiqlash uchun klinika nomini yozing:{' '}
            <span className="font-semibold">{tenant.name}</span>
          </div>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={tenant.name}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete || deleteMut.isPending}
            onClick={() => deleteMut.mutate()}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            O‘chirish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
