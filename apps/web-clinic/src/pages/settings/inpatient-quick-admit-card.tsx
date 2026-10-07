import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Plus, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import {
  MAX_DEPARTMENTS,
  assignRoom,
  autoDepartmentsByBuilding,
  autoDepartmentsBySection,
  compareRoomNumber,
  newDepartmentId,
  readQuickAdmit,
  unassignedRooms,
  type QuickAdmitDepartment,
  type QuickAdmitSettings,
} from '@/lib/inpatient-quick-admit';

type MapRoom = {
  id: string;
  number: string;
  section: string | null;
  building: string | null;
  tier: string | null;
  capacity: number;
};

// Qabulxonadagi qizil "Statsionarga qabul" tugmasi (F1) va statsionar bo'limlari.
export function InpatientQuickAdmitCard() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { settings?: Record<string, unknown> } }>('/api/v1/auth/me'),
  });
  const saved = useMemo(() => readQuickAdmit(me?.clinic?.settings), [me]);
  const { data: map } = useQuery({
    queryKey: ['inpatient-room-map'],
    queryFn: () => api.inpatient.roomMap(),
  });
  const rooms = useMemo(
    () =>
      ((map?.floors ?? []).flatMap((f) => f.rooms) as MapRoom[]).sort((a, b) =>
        compareRoomNumber(a.number, b.number),
      ),
    [map],
  );

  const [draft, setDraft] = useState<QuickAdmitDepartment[]>(saved.departments);
  const [openId, setOpenId] = useState<string | null>(null);
  const savedKey = JSON.stringify(saved.departments);
  useEffect(() => {
    setDraft(saved.departments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const dirty = JSON.stringify(draft) !== savedKey;

  const mut = useMutation({
    mutationFn: (next: QuickAdmitSettings) =>
      api.patch('/api/v1/auth/clinic/settings', { inpatient_quick_admit: next }),
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roomDept = useMemo(() => {
    const m = new Map<string, QuickAdmitDepartment>();
    for (const d of draft) for (const id of d.room_ids) m.set(id, d);
    return m;
  }, [draft]);
  const loose = unassignedRooms(rooms, draft);

  const addDept = () => {
    if (draft.length >= MAX_DEPARTMENTS) return;
    const id = newDepartmentId();
    setDraft((p) => [...p, { id, name: `${p.length + 1}-bo'lim`, room_ids: [] }]);
    setOpenId(id);
  };
  const applyAuto = (ds: QuickAdmitDepartment[]) => {
    if (
      draft.some((d) => d.room_ids.length) &&
      !window.confirm("Joriy bo'limlar almashtirilsinmi?")
    )
      return;
    // Saqlangandan keyin ham barqaror bo'lishi uchun noyob id
    setDraft(ds.slice(0, MAX_DEPARTMENTS).map((d) => ({ ...d, id: newDepartmentId() + d.id })));
    setOpenId(null);
  };
  const save = () => {
    const clean = draft.map((d) => ({ ...d, name: d.name.trim() || "Bo'lim" }));
    mut.mutate({ enabled: saved.enabled, departments: clean });
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BedDouble className="h-4 w-4 text-red-600" />
          Statsionarga tezkor qabul (qabulxona)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Qabulxonaning yuqori o&lsquo;rtasida qizil <b>&quot;Statsionarga qabul&quot;</b> tugmasi
          (yoki <b>F1</b>): bo&lsquo;lim → bo&lsquo;sh xona (tarifi bilan) → bemor ma&lsquo;lumoti →
          qabul. Statsionar sahifasiga o&lsquo;tish shart emas.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={saved.enabled}
            disabled={mut.isPending}
            onClick={() => mut.mutate({ enabled: !saved.enabled, departments: saved.departments })}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              saved.enabled ? 'bg-primary' : 'bg-muted'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                saved.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-muted-foreground text-xs">
            Tugma:{' '}
            <b className={saved.enabled ? 'text-emerald-600' : ''}>
              {saved.enabled ? "Ko'rinadi" : "O'chiq"}
            </b>
          </span>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Bo&lsquo;limlar{' '}
              <span className="text-muted-foreground font-normal">
                ({draft.length}/{MAX_DEPARTMENTS})
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                disabled={!rooms.length}
                title="Xonadagi «Bo'lim» maydoni boshidagi raqam bo'yicha: «1-bolim oldi» → 1-bo'lim"
                onClick={() => applyAuto(autoDepartmentsBySection(rooms))}
              >
                <Wand2 className="h-3.5 w-3.5" /> Bo&lsquo;lim maydoni bo&lsquo;yicha
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                disabled={!rooms.length}
                onClick={() => applyAuto(autoDepartmentsByBuilding(rooms))}
              >
                <Wand2 className="h-3.5 w-3.5" /> Bino bo&lsquo;yicha
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={draft.length >= MAX_DEPARTMENTS}
                onClick={addDept}
              >
                <Plus className="h-3.5 w-3.5" /> Bo&lsquo;lim qo&lsquo;shish
              </Button>
            </div>
          </div>

          {rooms.length === 0 && (
            <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
              Statsionar xonalari yo&lsquo;q — avval Katalog → Xonalar&apos;da xona qo&lsquo;shing.
              Xona bo&lsquo;lmasa qabulxonada tugma ko&lsquo;rinmaydi.
            </div>
          )}

          {draft.length === 0 && rooms.length > 0 && (
            <div className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
              Bo&lsquo;limlar yo&lsquo;q — tugma bosilganda barcha {rooms.length} ta xona bitta
              ro&lsquo;yxatda chiqadi.
            </div>
          )}

          {draft.map((d) => {
            const open = openId === d.id;
            return (
              <div key={d.id} className="rounded-lg border">
                <div className="flex items-center gap-2 p-2">
                  <Input
                    value={d.name}
                    maxLength={60}
                    onChange={(e) =>
                      setDraft((p) =>
                        p.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    className="h-8 max-w-[220px]"
                  />
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : d.id)}
                    className={cn(
                      'h-8 rounded-md border px-2.5 text-xs font-medium transition',
                      open ? 'bg-accent' : 'hover:bg-accent',
                      d.room_ids.length === 0 && 'border-amber-300 text-amber-700',
                    )}
                  >
                    {d.room_ids.length} ta xona {open ? '▲' : '▼'}
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive ml-auto h-8 w-8 p-0"
                    title="Bo'limni o'chirish"
                    onClick={() => setDraft((p) => p.filter((x) => x.id !== d.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {open && (
                  <div className="border-t p-2">
                    <div className="text-muted-foreground mb-1.5 text-[11px]">
                      Xonani bosing — shu bo&lsquo;limga qo&lsquo;shiladi (boshqa bo&lsquo;limdan
                      ko&lsquo;chadi).
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {rooms.map((r) => {
                        const owner = roomDept.get(r.id);
                        const mine = owner?.id === d.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            title={[r.section, r.building, owner && !mine ? `→ ${owner.name}` : '']
                              .filter(Boolean)
                              .join(' · ')}
                            onClick={() => setDraft((p) => assignRoom(p, d.id, r.id, !mine))}
                            className={cn(
                              'h-8 rounded-md border px-2 text-xs font-medium transition',
                              mine
                                ? 'border-primary bg-primary text-primary-foreground'
                                : owner
                                  ? 'text-muted-foreground border-dashed opacity-60 hover:opacity-100'
                                  : 'hover:bg-accent',
                            )}
                          >
                            № {r.number}
                            {owner && !mine && (
                              <span className="ml-1 text-[10px]">({owner.name})</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {draft.length > 0 && loose.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              {loose.length} ta xona hech bir bo&lsquo;limga biriktirilmagan — tezkor qabulda
              ko&lsquo;rinmaydi: {loose.map((r) => `№${r.number}`).join(', ')}
            </div>
          )}

          {dirty && (
            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDraft(saved.departments)}
                disabled={mut.isPending}
              >
                Bekor
              </Button>
              <Button size="sm" onClick={save} disabled={mut.isPending}>
                {mut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
