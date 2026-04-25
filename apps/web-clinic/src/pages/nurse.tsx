import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  HeartPulse,
  Plus,
  Siren,
  User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'general', label: 'Umumiy' },
  { value: 'injection', label: 'Ukol' },
  { value: 'iv_drip', label: 'Kapelnitsa' },
  { value: 'dressing', label: 'Bog‘lash' },
  { value: 'vitals', label: 'Vital belgilari' },
  { value: 'medication', label: 'Dori berish' },
  { value: 'home_visit', label: 'Uyga chiqish' },
  { value: 'procedure', label: 'Protsedura' },
  { value: 'observation', label: 'Kuzatish' },
];

function priorityBadge(p: number) {
  if (p >= 3) return <Badge variant="destructive">Kritik</Badge>;
  if (p === 2) return <Badge variant="warning">Yuqori</Badge>;
  if (p === 1) return <Badge variant="secondary">O‘rta</Badge>;
  return <Badge variant="outline">Oddiy</Badge>;
}

export function NursePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [open, setOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  const tasks = useQuery({
    queryKey: ['nurse', 'tasks', tab],
    queryFn: () => api.nurse.listTasks({ mine: tab === 'mine', status: undefined }),
    refetchInterval: 60_000,
  });

  const emergencies = useQuery({
    queryKey: ['nurse', 'emergencies'],
    queryFn: () => api.nurse.listEmergencies(false),
    refetchInterval: 10_000,
  });

  const updateTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'in_progress' | 'done' | 'skipped' }) =>
      api.nurse.updateTask(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse', 'tasks'] });
      toast.success('Vazifa yangilandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ackEmergency = useMutation({
    mutationFn: api.nurse.ackEmergency,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nurse', 'emergencies'] }),
  });
  const resolveEmergency = useMutation({
    mutationFn: api.nurse.resolveEmergency,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nurse', 'emergencies'] }),
  });

  type Task = NonNullable<typeof tasks.data>[number];
  const grouped = useMemo(() => {
    const byStatus: Record<string, Array<Task>> = {
      pending: [],
      in_progress: [],
      done: [],
    };
    for (const t of tasks.data ?? []) {
      (byStatus[t.status] ?? byStatus['pending']).push(t);
    }
    return byStatus;
  }, [tasks.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hamshira posti"
        description="Kunlik vazifalar, ukol va kapelnitsalar, tezkor chaqiriqlar"
        actions={
          <div className="flex gap-2">
            <Button variant="destructive" onClick={() => setEmergencyOpen(true)}>
              <Siren className="mr-2 h-4 w-4" />
              Tezkor chaqiruv
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Vazifa qo‘shish
            </Button>
          </div>
        }
      />

      {(emergencies.data ?? []).length > 0 && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Hal qilinmagan tezkor chaqiriqlar ({emergencies.data!.length})
            </div>
            <div className="space-y-2">
              {emergencies.data!.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-md border border-destructive/40 bg-background p-3"
                >
                  <div className="flex items-start gap-3">
                    <Siren className="mt-0.5 h-5 w-5 text-destructive" />
                    <div>
                      <div className="font-medium">{e.message}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.profiles?.full_name ?? 'Nomalum'} • {e.room?.name ?? '—'} •{' '}
                        {new Date(e.broadcast_at).toLocaleTimeString('uz-UZ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!e.acknowledged_at && (
                      <Button size="sm" variant="outline" onClick={() => ackEmergency.mutate(e.id)}>
                        <Bell className="mr-1 h-3 w-3" />
                        Qabul qildim
                      </Button>
                    )}
                    <Button size="sm" onClick={() => resolveEmergency.mutate(e.id)}>
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Yopish
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="inline-flex items-center rounded-lg border bg-card p-1">
        {(['mine', 'all'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              tab === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {v === 'mine' ? 'Mening vazifalarim' : 'Barcha vazifalar'}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <TaskColumn
          title="Kutilmoqda"
          icon={<Clock className="h-4 w-4" />}
          accent="border-amber-400"
          tasks={grouped['pending'] ?? []}
          onStart={(id) => updateTask.mutate({ id, status: 'in_progress' })}
        />
        <TaskColumn
          title="Bajarilmoqda"
          icon={<HeartPulse className="h-4 w-4" />}
          accent="border-blue-500"
          tasks={grouped['in_progress'] ?? []}
          onComplete={(id) => updateTask.mutate({ id, status: 'done' })}
          onSkip={(id) => updateTask.mutate({ id, status: 'skipped' })}
        />
        <TaskColumn
          title="Bajarilgan"
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="border-emerald-500"
          tasks={grouped['done'] ?? []}
        />
      </div>

      {open && <CreateTaskDialog onClose={() => setOpen(false)} />}
      {emergencyOpen && <TriggerEmergencyDialog onClose={() => setEmergencyOpen(false)} />}
    </div>
  );
}

function TaskColumn({
  title,
  icon,
  accent,
  tasks,
  onStart,
  onComplete,
  onSkip,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  tasks: Array<{
    id: string;
    title: string;
    notes: string | null;
    category: string;
    priority: number;
    due_at: string | null;
    patient?: { full_name: string } | null;
    assignee?: { full_name: string } | null;
  }>;
  onStart?: (id: string) => void;
  onComplete?: (id: string) => void;
  onSkip?: (id: string) => void;
}) {
  return (
    <Card className={cn('border-t-4', accent)}>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
          </div>
          <Badge variant="outline">{tasks.length}</Badge>
        </div>
        {tasks.length === 0 ? (
          <EmptyState title="Bo‘sh" description="Hali vazifa yo‘q" />
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium leading-snug">{t.title}</div>
                  {priorityBadge(t.priority)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}
                  </Badge>
                  {t.patient?.full_name && (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3 w-3" />
                      {t.patient.full_name}
                    </span>
                  )}
                  {t.due_at && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(t.due_at).toLocaleString('uz-UZ', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
                {t.notes && <div className="mt-2 text-xs text-muted-foreground">{t.notes}</div>}
                <div className="mt-2 flex gap-1">
                  {onStart && (
                    <Button size="sm" variant="secondary" onClick={() => onStart(t.id)}>
                      Boshlash
                    </Button>
                  )}
                  {onComplete && (
                    <Button size="sm" onClick={() => onComplete(t.id)}>
                      Yakunlash
                    </Button>
                  )}
                  {onSkip && (
                    <Button size="sm" variant="outline" onClick={() => onSkip(t.id)}>
                      O‘tkazib yuborish
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateTaskDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState(1);
  const [dueAt, setDueAt] = useState('');

  const mut = useMutation({
    mutationFn: api.nurse.createTask,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse', 'tasks'] });
      toast.success('Vazifa qo‘shildi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yangi vazifa</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Sarlavha *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bemor 3-xonaga ukol" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Izoh</label>
            <textarea
              className="min-h-[80px] w-full rounded-md border bg-background p-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Turi</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Ustuvorlik</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                <option value="0">Oddiy</option>
                <option value="1">O‘rta</option>
                <option value="2">Yuqori</option>
                <option value="3">Kritik</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Muddat</label>
              <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            disabled={title.length < 2 || mut.isPending}
            onClick={() =>
              mut.mutate({
                title,
                notes: notes || undefined,
                category,
                priority,
                due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
              })
            }
          >
            Qo‘shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TriggerEmergencyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState('Tez yordam kerak!');
  const [severity, setSeverity] = useState<'normal' | 'high' | 'critical'>('high');

  const mut = useMutation({
    mutationFn: api.nurse.triggerEmergency,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse', 'emergencies'] });
      toast.success("Chaqiriq barcha xodimlarga yuborildi");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Siren className="h-5 w-5" />
            Tezkor chaqiruv
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Xabar</label>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Daraja</label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value as 'normal' | 'high' | 'critical')}>
              <option value="normal">Oddiy</option>
              <option value="high">Yuqori</option>
              <option value="critical">Kritik</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Xabar klinika bo‘ylab barcha xodimlarga realtime tarqatiladi.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button variant="destructive" disabled={mut.isPending} onClick={() => mut.mutate({ message, severity })}>
            Yuborish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
