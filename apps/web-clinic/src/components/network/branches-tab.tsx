import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, MapPin, Phone, Save, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Badge, Button, Card, CardContent, EmptyState, Input } from '@clary/ui-web';
import type { NetworkBranch } from '@clary/api-client';

import { api } from '@/lib/api';
import { branchColor, switchToBranch } from '@/components/branch-switcher';
import { BranchName } from './shared';

/** Filiallar ro'yxati: belgisi (kod, rang) va bir bosishda o'tish */
export function BranchesTab({
  branches,
  activeClinicId,
  canManage,
}: {
  branches: NetworkBranch[];
  activeClinicId: string;
  canManage: boolean;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {branches.map((b) => (
        <BranchCard
          key={b.id}
          branch={b}
          isActive={b.id === activeClinicId}
          canManage={canManage}
        />
      ))}
    </div>
  );
}

function BranchCard({
  branch: b,
  isActive,
  canManage,
}: {
  branch: NetworkBranch;
  isActive: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(b.branch_code ?? '');
  const [color, setColor] = useState(branchColor(b.id, b.branch_color));
  const [busy, setBusy] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api.company.updateBranch(b.id, { branch_code: code || null, branch_color: color }),
    onSuccess: () => {
      toast.success('Saqlandi');
      void qc.invalidateQueries({ queryKey: ['company-my'] });
      void qc.invalidateQueries({ queryKey: ['company-access'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const dirty = code !== (b.branch_code ?? '') || color !== branchColor(b.id, b.branch_color);

  return (
    <Card className={isActive ? 'ring-primary/40 ring-2' : ''}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="font-semibold">
              <BranchName branch={b} />
            </div>
            <div className="text-muted-foreground space-y-0.5 text-xs">
              {(b.city || b.address) && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {[b.city, b.address].filter(Boolean).join(', ')}
                </div>
              )}
              {b.phone && (
                <div className="flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {b.phone}
                </div>
              )}
            </div>
          </div>
          {isActive ? (
            <Badge variant="secondary">Siz shu yerdasiz</Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await switchToBranch(b.id);
                } catch (e) {
                  toast.error((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> O‘tish
            </Button>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Filial kodi</span>
              <Input value={code} onChange={(e) => setCode(e.target.value)} className="h-8 w-32" />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Rang</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="block h-8 w-12 cursor-pointer rounded border"
              />
            </label>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              <Save className="mr-1 h-3.5 w-3.5" /> Saqlash
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Barcha filiallar xodimlari bitta ro'yxatda */
export function StaffTab({ branches }: { branches: NetworkBranch[] }) {
  const [branch, setBranch] = useState<string>('all');
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery({
    queryKey: ['company-staff'],
    queryFn: () => api.company.staff(),
  });
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.filter(
      (r) =>
        (branch === 'all' || r.clinic_id === branch) &&
        (!term ||
          r.full_name.toLowerCase().includes(term) ||
          (r.phone ?? '').includes(term) ||
          (r.position ?? r.role ?? '').toLowerCase().includes(term)),
    );
  }, [data, branch, q]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data) if (r.is_active) m.set(r.clinic_id, (m.get(r.clinic_id) ?? 0) + 1);
    return m;
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2 top-2.5 h-4 w-4" />
          <Input
            placeholder="Ism, telefon, lavozim"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64 pl-8"
          />
        </div>
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="bg-background h-9 rounded-md border px-2 text-sm"
        >
          <option value="all">Barcha filiallar ({data.filter((r) => r.is_active).length})</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({counts.get(b.id) ?? 0})
            </option>
          ))}
        </select>
      </div>
      <Card>
        <CardContent className="p-0">
          {!isLoading && rows.length === 0 ? (
            <EmptyState title="Xodim topilmadi" description="Filtrni o'zgartiring." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th className="px-3 py-2">F.I.Sh.</th>
                    <th>Filial</th>
                    <th>Lavozim</th>
                    <th>Telefon</th>
                    <th>Tizimga kirish</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.key}
                      className={`border-b last:border-0 ${r.is_active ? '' : 'opacity-50'}`}
                    >
                      <td className="px-3 py-2 font-medium">
                        {r.full_name}
                        {r.specialization && (
                          <div className="text-muted-foreground text-xs">{r.specialization}</div>
                        )}
                      </td>
                      <td>{r.clinic_name}</td>
                      <td>{r.position ?? r.role ?? '—'}</td>
                      <td>{r.phone ?? '—'}</td>
                      <td className="text-xs">
                        {r.has_login ? (
                          <span>
                            {r.email}
                            {r.last_sign_in_at && (
                              <div className="text-muted-foreground">
                                oxirgi: {new Date(r.last_sign_in_at).toLocaleDateString('uz-UZ')}
                              </div>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">login yo'q</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">
        Xodim qo'shish yoki tahrirlash — o'sha filialga o'tib, Sozlamalar → Xodimlar bo'limida.
      </p>
    </div>
  );
}
