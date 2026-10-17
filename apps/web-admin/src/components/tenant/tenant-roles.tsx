import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminClinicCustomRole, AdminClinicRoles } from '@clary/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  cn,
} from '@clary/ui-web';
import { Pencil, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/query-state';
import { Switch } from '@/components/entitlements/entitlements-editor';

// =============================================================================
// Klinika — rollar: xodimlar roli/maxsus roli/faolligi, maxsus rollarni
// yaratish, tahrirlash (ruxsatlar to'plami) va o'chirish. Rol o'zgarishi
// JWT'ga ham yoziladi (xodim keyingi kirishda yangi rol bilan ishlaydi).
// =============================================================================

export const ROLE_LABELS: Record<string, string> = {
  clinic_owner: 'Klinika egasi',
  clinic_admin: 'Administrator',
  doctor: 'Shifokor',
  receptionist: 'Qabulxona',
  cashier: 'Kassir',
  pharmacist: 'Farmatsevt',
  lab_technician: 'Laborant',
  radiologist: 'Radiolog',
  nurse: 'Hamshira',
  staff: 'Xodim',
};

const PERM_MODULE_LABELS: Record<string, string> = {
  patients: 'Bemorlar',
  appointments: 'Qabul / navbat yozuvi',
  queue: 'Navbat',
  doctor_view: 'Shifokor ish joyi',
  prescriptions: 'Retseptlar',
  lab: 'Laboratoriya',
  diagnostics: 'Diagnostika',
  dental: 'Stomatologiya',
  pharmacy: 'Dorixona',
  medications: 'Dorilar katalogi',
  cashier: 'Kassa',
  inpatient: 'Statsionar',
  nurse: 'Hamshira',
  home_nurse: 'Uyga hamshira',
  marketing: 'Marketing',
  analytics: 'Analitika',
  payroll: 'Maosh',
  staff: 'Xodimlar',
  settings: 'Sozlamalar',
  audit: 'Audit',
  support: 'Yordam',
};

const ROLES = Object.keys(ROLE_LABELS);

export function TenantRoles({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'clinic-roles', clinicId],
    queryFn: () => api.admin.clinicRoles(clinicId),
  });
  const [editing, setEditing] = useState<AdminClinicCustomRole | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminClinicCustomRole | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'clinic-roles', clinicId] });
  const staffMut = useMutation({
    mutationFn: (v: {
      userId: string;
      body: { role?: string; custom_role_id?: string | null; is_active?: boolean };
    }) => api.admin.updateClinicStaff(clinicId, v.userId, v.body),
    onSuccess: () => {
      toast.success('Xodim yangilandi');
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (roleId: string) => api.admin.deleteClinicRole(clinicId, roleId),
    onSuccess: (r) => {
      toast.success(r.archived ? 'Rol arxivlandi' : 'Rol o‘chirildi');
      setDeleting(null);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError)
    return <ErrorState message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  const activeRoles = data.custom_roles.filter((r) => !r.is_archived);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <UserCog className="text-muted-foreground h-4 w-4" />
          <CardTitle className="text-base">Xodimlar va rollar</CardTitle>
          <Badge variant="outline" className="ml-auto">
            {data.staff.filter((s) => s.is_active).length} faol / {data.staff.length}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                <tr>
                  <th className="px-4 py-2.5">Xodim</th>
                  <th className="px-4 py-2.5">Asosiy rol</th>
                  <th className="px-4 py-2.5">Maxsus rol</th>
                  <th className="px-4 py-2.5">So‘nggi kirish</th>
                  <th className="px-4 py-2.5 text-right">Faol</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr
                    key={s.id}
                    className={cn('border-b last:border-b-0', !s.is_active && 'opacity-60')}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{s.full_name || '—'}</div>
                      <div className="text-muted-foreground text-xs">{s.email}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className="bg-background h-8 rounded-md border px-2 text-xs"
                        value={s.role}
                        disabled={staffMut.isPending}
                        onChange={(e) => {
                          const role = e.target.value;
                          if (
                            confirm(
                              `${s.full_name || s.email}: rol "${ROLE_LABELS[s.role] ?? s.role}" → "${ROLE_LABELS[role] ?? role}"?`,
                            )
                          ) {
                            staffMut.mutate({ userId: s.id, body: { role } });
                          }
                        }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className="bg-background h-8 max-w-[180px] rounded-md border px-2 text-xs"
                        value={s.custom_role_id ?? ''}
                        disabled={staffMut.isPending}
                        onChange={(e) =>
                          staffMut.mutate({
                            userId: s.id,
                            body: { custom_role_id: e.target.value || null },
                          })
                        }
                      >
                        <option value="">— yo‘q (asosiy rol ruxsatlari) —</option>
                        {activeRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 text-xs">
                      {s.last_sign_in_at
                        ? new Date(s.last_sign_in_at).toLocaleString('uz-UZ')
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Switch
                        checked={s.is_active}
                        disabled={staffMut.isPending}
                        onChange={(v) => staffMut.mutate({ userId: s.id, body: { is_active: v } })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldCheck className="text-muted-foreground h-4 w-4" />
          <CardTitle className="text-base">Maxsus rollar</CardTitle>
          <Button size="sm" className="ml-auto gap-1" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" /> Yangi rol
          </Button>
        </CardHeader>
        <CardContent>
          {data.custom_roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Maxsus rol yo‘q. Xodimlar asosiy rol ruxsatlari bilan ishlaydi.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.custom_roles.map((r) => {
                const n = Object.values(r.permissions ?? {}).filter(Boolean).length;
                return (
                  <div
                    key={r.id}
                    className={cn('rounded-xl border p-4', r.is_archived && 'opacity-60')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-muted-foreground text-xs">
                          Asos: {ROLE_LABELS[r.base_role] ?? r.base_role}
                        </div>
                      </div>
                      {r.is_archived && <Badge variant="secondary">Arxiv</Badge>}
                    </div>
                    {r.description && (
                      <p className="text-muted-foreground mt-2 text-xs">{r.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                      <Badge variant="outline">{n} ta ruxsat</Badge>
                      <Badge variant="outline">{r.assigned} ta xodim</Badge>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => setEditing(r)}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Tahrirlash
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive gap-1"
                        onClick={() => setDeleting(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> O‘chirish
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <RoleDialog
          clinicId={clinicId}
          data={data}
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`"${deleting?.name ?? ''}" o‘chirilsinmi?`}
        description={`Rol ${deleting?.assigned ?? 0} ta xodimdan olinadi — ular asosiy rol ruxsatlari bilan ishlaydi.`}
        confirmLabel="O‘chirish"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleting && deleteMut.mutate(deleting.id)}
      />
    </div>
  );
}

function RoleDialog({
  clinicId,
  data,
  role,
  onClose,
  onSaved,
}: {
  clinicId: string;
  data: AdminClinicRoles;
  role: AdminClinicCustomRole | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [baseRole, setBaseRole] = useState(role?.base_role ?? 'staff');
  const [perms, setPerms] = useState<Record<string, boolean>>(() => ({
    ...(role?.permissions ?? {}),
  }));
  const [archived, setArchived] = useState(role?.is_archived ?? false);

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        base_role: baseRole,
        permissions: Object.fromEntries(Object.entries(perms).filter(([, v]) => v)),
      };
      return role
        ? api.admin.updateClinicRole(clinicId, role.id, { ...body, is_archived: archived })
        : api.admin.createClinicRole(clinicId, body);
    },
    onSuccess: () => {
      toast.success('Rol saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fillDefaults = () => {
    const defs = data.role_defaults[baseRole] ?? [];
    setPerms(Object.fromEntries(defs.map((k) => [k, true])));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? 'Rolni tahrirlash' : 'Yangi maxsus rol'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Nomi</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masalan: Katta kassir"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Asosiy rol</Label>
            <select
              className="bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value)}
            >
              {ROLES.filter((r) => r !== 'clinic_owner').map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Tavsif</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm font-semibold">Ruxsatlar</span>
          <Badge variant="outline">{Object.values(perms).filter(Boolean).length}</Badge>
          <button
            type="button"
            className="text-primary ml-auto text-xs hover:underline"
            onClick={fillDefaults}
          >
            Asosiy rol ruxsatlari bilan to‘ldirish
          </button>
          <button
            type="button"
            className="text-muted-foreground text-xs hover:underline"
            onClick={() => setPerms({})}
          >
            Tozalash
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(data.permission_modules).map(([mod, actions]) => {
            const keys = (actions as readonly string[]).map((a) => `${mod}.${a}`);
            const all = keys.every((k) => perms[k]);
            return (
              <div key={mod} className="rounded-lg border p-2.5">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={(e) => {
                      const next = { ...perms };
                      for (const k of keys) next[k] = e.target.checked;
                      setPerms(next);
                    }}
                  />
                  {PERM_MODULE_LABELS[mod] ?? mod}
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(actions as readonly string[]).map((a) => {
                    const k = `${mod}.${a}`;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPerms({ ...perms, [k]: !perms[k] })}
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[11px]',
                          perms[k]
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'text-muted-foreground',
                        )}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {role && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <Switch checked={archived} onChange={setArchived} /> Arxivlangan (yangi xodimga
            berilmaydi)
          </label>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={!name.trim() || saveMut.isPending}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
