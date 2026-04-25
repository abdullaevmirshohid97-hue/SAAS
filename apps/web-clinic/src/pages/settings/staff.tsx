import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Plus,
  Shield,
  User,
  UserPlus,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@clary/ui-web';

import { api } from '@/lib/api';

type Staff = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  last_sign_in_at: string | null;
  custom_role_id: string | null;
  permissions_override: Record<string, boolean> | null;
  custom_role: { id: string; name: string; permissions: Record<string, boolean> } | null;
  effective_permissions: Record<string, boolean>;
};

type CustomRole = {
  id: string;
  name: string;
  description: string | null;
  base_role: string;
  permissions: Record<string, boolean>;
};

const ROLE_LABELS: Record<string, string> = {
  clinic_owner: 'Egasi',
  clinic_admin: 'Administrator',
  doctor: 'Shifokor',
  receptionist: 'Qabulxona',
  cashier: 'Kassir',
  pharmacist: 'Dorixonachi',
  lab_technician: 'Laborant',
  radiologist: 'Radiolog',
  nurse: 'Hamshira',
  staff: 'Xodim',
};

export function SettingsStaffPage() {
  const [tab, setTab] = useState<'staff' | 'roles'>('staff');
  const qc = useQueryClient();

  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.staff.list() });
  const roles = useQuery({ queryKey: ['staff', 'roles'], queryFn: () => api.staff.listRoles() });
  const catalog = useQuery({ queryKey: ['staff', 'catalog'], queryFn: () => api.staff.catalog() });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Xodimlar va ruxsatlar</h2>
          <p className="text-sm text-muted-foreground">Xodimlarni qo‘shing va ularning ruxsatlarini moslang</p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {[
            { id: 'staff', label: 'Xodimlar', icon: User },
            { id: 'roles', label: 'Rollar (RBAC)', icon: Shield },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
              className={
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ' +
                (tab === id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground')
              }
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'staff' && (
        <StaffTab
          items={(staff.data ?? []) as Staff[]}
          roles={(roles.data ?? []) as CustomRole[]}
          catalog={catalog.data ?? { groups: {}, all: [], role_defaults: {} }}
          onChange={() => qc.invalidateQueries({ queryKey: ['staff'] })}
        />
      )}
      {tab === 'roles' && (
        <RolesTab
          items={(roles.data ?? []) as CustomRole[]}
          catalog={catalog.data ?? { groups: {}, all: [], role_defaults: {} }}
          onChange={() => qc.invalidateQueries({ queryKey: ['staff'] })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function StaffTab({
  items,
  roles,
  catalog,
  onChange,
}: {
  items: Staff[];
  roles: CustomRole[];
  catalog: { groups: Record<string, string[]>; all: string[]; role_defaults: Record<string, string[]> };
  onChange: () => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <div className="text-muted-foreground">{items.length} xodim</div>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" /> Taklif qilish
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {items.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="font-semibold">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </div>
                <div>
                  <Badge variant="secondary">{ROLE_LABELS[s.role] ?? s.role}</Badge>
                  {s.custom_role && (
                    <Badge variant="outline" className="ml-1.5 text-[10px]">
                      {s.custom_role.name}
                    </Badge>
                  )}
                </div>
                <Badge variant={s.is_active ? 'success' : 'destructive'}>
                  {s.is_active ? 'Faol' : 'O‘chirilgan'}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                  Ruxsatlar
                </Button>
              </div>
            ))}
            {items.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Hali xodimlar yo‘q. Taklif yuboring.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {inviteOpen && (
        <InviteDialog
          roles={roles}
          onClose={() => setInviteOpen(false)}
          onCreated={() => {
            onChange();
            setInviteOpen(false);
          }}
        />
      )}
      {editing && (
        <EditStaffDialog
          staff={editing}
          roles={roles}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={() => {
            onChange();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function InviteDialog({
  roles,
  onClose,
  onCreated,
}: {
  roles: CustomRole[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    email: '',
    full_name: '',
    phone: '',
    role: 'receptionist',
  });
  const invite = useMutation({
    mutationFn: () =>
      api.staff.invite({
        email: form.email,
        full_name: form.full_name,
        phone: form.phone || undefined,
        role: form.role,
      }),
    onSuccess: () => {
      toast.success('Taklif yuborildi');
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yangi xodim taklif qilish</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="To‘liq ism">
            <Input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Telefon">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Asosiy rol">
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {roles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Taklif jo‘natilgandan keyin shaxsiy ruxsatlarni moslashingiz mumkin.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={!form.email || !form.full_name || invite.isPending} onClick={() => invite.mutate()}>
            Jo‘natish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditStaffDialog({
  staff,
  roles,
  catalog,
  onClose,
  onSaved,
}: {
  staff: Staff;
  roles: CustomRole[];
  catalog: { groups: Record<string, string[]>; all: string[]; role_defaults: Record<string, string[]> };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customRoleId, setCustomRoleId] = useState<string | null>(staff.custom_role_id);
  const [active, setActive] = useState(staff.is_active);
  const [role, setRole] = useState(staff.role);
  const [override, setOverride] = useState<Record<string, boolean>>(
    staff.permissions_override ?? {},
  );

  const baseline = useMemo(() => {
    const defaults = new Set(catalog.role_defaults[role] ?? []);
    const customRole = roles.find((r) => r.id === customRoleId);
    const combined = new Set(defaults);
    if (customRole) {
      for (const [k, v] of Object.entries(customRole.permissions)) {
        if (v) combined.add(k);
        else combined.delete(k);
      }
    }
    return combined;
  }, [role, customRoleId, roles, catalog.role_defaults]);

  const effective = useMemo(() => {
    const set = new Set(baseline);
    for (const [k, v] of Object.entries(override)) {
      if (v) set.add(k);
      else set.delete(k);
    }
    return set;
  }, [baseline, override]);

  const save = useMutation({
    mutationFn: () =>
      api.staff.update(staff.id, {
        role,
        is_active: active,
        custom_role_id: customRoleId,
        permissions_override: override,
      }),
    onSuccess: () => {
      toast.success('Saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePerm = (key: string) => {
    const current = effective.has(key);
    const baseHas = baseline.has(key);
    const next = { ...override };
    if (current === baseHas) {
      next[key] = !current;
    } else {
      delete next[key];
    }
    setOverride(next);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{staff.full_name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_1.5fr]">
          <div className="space-y-3">
            <Field label="Asosiy rol">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Maxsus rol (ixtiyoriy)">
              <select
                value={customRoleId ?? ''}
                onChange={(e) => setCustomRoleId(e.target.value || null)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— yo‘q —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Faol
            </label>
            <div className="text-xs text-muted-foreground">
              O‘zgartirishlar: {Object.keys(override).length} ta ruxsat qo‘lda o‘zgartirilgan.
            </div>
          </div>
          <PermissionMatrix
            groups={catalog.groups}
            baseline={baseline}
            effective={effective}
            onToggle={togglePerm}
          />
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Saqlash
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function RolesTab({
  items,
  catalog,
  onChange,
}: {
  items: CustomRole[];
  catalog: { groups: Record<string, string[]>; all: string[]; role_defaults: Record<string, string[]> };
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">{items.length} maxsus rol</div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="mr-1 h-4 w-4" /> Yangi rol
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Asos: {ROLE_LABELS[r.base_role] ?? r.base_role}
                  </div>
                </div>
                <Badge variant="secondary">
                  {Object.values(r.permissions).filter(Boolean).length} ruxsat
                </Badge>
              </div>
              {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  Tahrirlash
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && (
        <RoleEditorDialog
          role={editing === 'new' ? null : editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={() => {
            onChange();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RoleEditorDialog({
  role,
  catalog,
  onClose,
  onSaved,
}: {
  role: CustomRole | null;
  catalog: { groups: Record<string, string[]>; all: string[]; role_defaults: Record<string, string[]> };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [baseRole, setBaseRole] = useState(role?.base_role ?? 'staff');
  const [permissions, setPermissions] = useState<Record<string, boolean>>(
    role?.permissions ?? Object.fromEntries((catalog.role_defaults['staff'] ?? []).map((k) => [k, true])),
  );

  const baseline = useMemo(() => new Set<string>(catalog.role_defaults[baseRole] ?? []), [baseRole, catalog]);
  const effective = useMemo(() => {
    const set = new Set(baseline);
    for (const [k, v] of Object.entries(permissions)) {
      if (v) set.add(k);
      else set.delete(k);
    }
    return set;
  }, [baseline, permissions]);

  const save = useMutation({
    mutationFn: () =>
      role
        ? api.staff.updateRole(role.id, {
            name,
            description: description || undefined,
            base_role: baseRole,
            permissions,
          })
        : api.staff.createRole({
            name,
            description: description || undefined,
            base_role: baseRole,
            permissions,
          }),
    onSuccess: () => {
      toast.success('Saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePerm = (key: string) => {
    const baseHas = baseline.has(key);
    const currentHas = effective.has(key);
    const next = { ...permissions };
    if (currentHas === baseHas) {
      next[key] = !currentHas;
    } else {
      delete next[key];
    }
    setPermissions(next);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{role ? 'Rolni tahrirlash' : 'Yangi rol'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_1.5fr]">
          <div className="space-y-3">
            <Field label="Nomi">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Izoh">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Asosiy rol">
              <select
                value={baseRole}
                onChange={(e) => setBaseRole(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <PermissionMatrix
            groups={catalog.groups}
            baseline={baseline}
            effective={effective}
            onToggle={togglePerm}
          />
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={!name || save.isPending} onClick={() => save.mutate()}>
            Saqlash
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function PermissionMatrix({
  groups,
  baseline,
  effective,
  onToggle,
}: {
  groups: Record<string, string[]>;
  baseline: Set<string>;
  effective: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Ruxsatlar</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[60vh] space-y-4 overflow-auto p-4">
        {Object.entries(groups).map(([group, keys]) => (
          <div key={group}>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </div>
            <div className="grid grid-cols-1 gap-1">
              {keys.map((k) => {
                const on = effective.has(k);
                const baseHas = baseline.has(k);
                const override = on !== baseHas;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onToggle(k)}
                    className={
                      'flex items-center justify-between rounded border px-2.5 py-1.5 text-xs transition ' +
                      (on ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted')
                    }
                  >
                    <span className="font-mono">{k}</span>
                    <span className="flex items-center gap-1.5">
                      {override && (
                        <Badge variant="outline" className="text-[10px]">
                          override
                        </Badge>
                      )}
                      {on ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
