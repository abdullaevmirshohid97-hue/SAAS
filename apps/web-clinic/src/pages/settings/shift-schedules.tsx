import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

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
  EmptyState,
  Input,
  PageHeader,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

interface Schedule {
  id: string;
  name_i18n: Record<string, string>;
  code?: string | null;
  color?: string | null;
  start_time: string;
  end_time: string;
  days_of_week: number[];
}

interface Operator {
  id: string;
  full_name: string;
  role: string;
  color?: string | null;
}

const DAYS = [
  { value: 1, label: 'Dush' },
  { value: 2, label: 'Sesh' },
  { value: 3, label: 'Chor' },
  { value: 4, label: 'Pay' },
  { value: 5, label: 'Jum' },
  { value: 6, label: 'Shan' },
  { value: 7, label: 'Yak' },
];

function pickName(i18n: Record<string, string> | undefined): string {
  if (!i18n) return '';
  return i18n['uz-Latn'] ?? i18n.ru ?? Object.values(i18n)[0] ?? '';
}

export function ShiftSchedulesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['shift-schedules'],
    queryFn: () => api.shiftSchedules.list(),
  });

  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<Schedule | null>(null);
  const [assignTarget, setAssignTarget] = useState<Schedule | null>(null);

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.shiftSchedules.archive(id),
    onSuccess: () => {
      toast.success('Arxivlandi');
      qc.invalidateQueries({ queryKey: ['shift-schedules'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const schedules = (data as Schedule[] | undefined) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sozlamalar"
        title="Smena jadvallari"
        description="Smena vaqt oynalarini aniqlang va navbatchilarni biriktiring. Smenani ochganda shu jadvaldagi operatorlar tanlanadi."
        actions={
          <Button onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Jadval qo&lsquo;shish
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Yuklanmoqda…</div>
      ) : schedules.length === 0 ? (
        <EmptyState
          title="Jadvallar yo\u2018q"
          description="Masalan: Ertalabki (08:00-14:00), Kechki (14:00-20:00), Tungi (20:00-08:00)"
          action={<Button onClick={() => setCreating(true)}>Birinchi jadvalni yaratish</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {schedules.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <div className="h-1.5" style={{ backgroundColor: s.color ?? 'hsl(var(--primary))' }} />
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-base font-semibold">{pickName(s.name_i18n)}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="h-3 w-3" />
                      {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                    </div>
                  </div>
                  {s.code && <Badge variant="outline">{s.code}</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {DAYS.map((d) => (
                    <span
                      key={d.value}
                      className={cn(
                        'rounded px-2 py-0.5 text-[11px] font-medium',
                        s.days_of_week.includes(d.value)
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground line-through',
                      )}
                    >
                      {d.label}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setAssignTarget(s)} className="gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Navbatchilar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditTarget(s)}>
                    Tahrir
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => archiveMut.mutate(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && <ScheduleDialog onClose={() => setCreating(false)} />}
      {editTarget && <ScheduleDialog schedule={editTarget} onClose={() => setEditTarget(null)} />}
      {assignTarget && <AssignmentDialog schedule={assignTarget} onClose={() => setAssignTarget(null)} />}
    </div>
  );
}

function ScheduleDialog({ schedule, onClose }: { schedule?: Schedule; onClose: () => void }) {
  const qc = useQueryClient();
  const [nameUz, setNameUz] = useState(schedule?.name_i18n?.['uz-Latn'] ?? '');
  const [nameRu, setNameRu] = useState(schedule?.name_i18n?.ru ?? '');
  const [code, setCode] = useState(schedule?.code ?? '');
  const [color, setColor] = useState(schedule?.color ?? '#2563eb');
  const [startTime, setStartTime] = useState(schedule?.start_time?.slice(0, 5) ?? '08:00');
  const [endTime, setEndTime] = useState(schedule?.end_time?.slice(0, 5) ?? '14:00');
  const [days, setDays] = useState<number[]>(schedule?.days_of_week ?? [1, 2, 3, 4, 5]);

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        name_i18n: { 'uz-Latn': nameUz, ru: nameRu || nameUz },
        code: code || undefined,
        color,
        start_time: `${startTime}:00`,
        end_time: `${endTime}:00`,
        days_of_week: days,
      };
      return schedule ? api.shiftSchedules.update(schedule.id, payload) : api.shiftSchedules.create(payload);
    },
    onSuccess: () => {
      toast.success(schedule ? 'Yangilandi' : 'Yaratildi');
      qc.invalidateQueries({ queryKey: ['shift-schedules'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  const valid = nameUz.length > 0 && startTime && endTime && days.length > 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{schedule ? 'Jadvalni tahrirlash' : 'Yangi smena jadvali'}</DialogTitle>
          <DialogDescription>Jadval vaqtini va amal qilish kunlarini kiriting.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nomi (O&lsquo;zbekcha)</label>
              <Input value={nameUz} onChange={(e) => setNameUz(e.target.value)} placeholder="Ertalabki smena" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nomi (Ruscha)</label>
              <Input value={nameRu} onChange={(e) => setNameRu(e.target.value)} placeholder="Утренняя смена" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Boshlanish</label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tugash</label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Kod</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="AM" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Kunlar</label>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-medium transition',
                    days.includes(d.value) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Rang</label>
            <div className="flex flex-wrap gap-2">
              {['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#16a34a', '#ea580c', '#eab308', '#64748b'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('h-8 w-8 rounded-full transition', color === c && 'ring-2 ring-offset-2 ring-foreground')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="gap-1.5">
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentDialog({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: operators } = useQuery({
    queryKey: ['shift-operators'],
    queryFn: () => api.shiftOperators.list(),
  });
  const { data: assigns } = useQuery({
    queryKey: ['shift-schedule-assignments', schedule.id],
    queryFn: () => api.shiftSchedules.assignments(schedule.id),
  });

  const assignments = (assigns as Array<{ id: string; operator_id: string; is_primary: boolean }> | undefined) ?? [];
  const assignedIds = new Set(assignments.map((a) => a.operator_id));

  const addMut = useMutation({
    mutationFn: (operatorId: string) => api.shiftSchedules.addAssignment(schedule.id, { operator_id: operatorId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-schedule-assignments', schedule.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: (assignmentId: string) => api.shiftSchedules.removeAssignment(assignmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift-schedule-assignments', schedule.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pickName(schedule.name_i18n)} — navbatchilar</DialogTitle>
          <DialogDescription>Ushbu jadvalda ishlaydigan navbatchilarni tanlang.</DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-1 overflow-y-auto scrollbar-thin">
          {((operators as Operator[] | undefined) ?? []).map((op) => {
            const assignment = assignments.find((a) => a.operator_id === op.id);
            const isAssigned = assignedIds.has(op.id);
            return (
              <div
                key={op.id}
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3 py-2 transition',
                  isAssigned ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: op.color ?? 'hsl(var(--primary))' }}
                  >
                    {op.full_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{op.full_name}</div>
                    <div className="text-xs text-muted-foreground">{op.role}</div>
                  </div>
                </div>
                {isAssigned ? (
                  <Button size="sm" variant="ghost" onClick={() => assignment && removeMut.mutate(assignment.id)} className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => addMut.mutate(op.id)}>
                    Qo&lsquo;shish
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
