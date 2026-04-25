import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';
import {
  Bell,
  CheckCircle2,
  Clock3,
  MonitorPlay,
  PhoneIncoming,
  Printer,
  SkipForward,
  Stethoscope,
  UserCheck,
} from 'lucide-react';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type QueueRow = {
  id: string;
  ticket_no: string | null;
  ticket_code: string | null;
  ticket_color: string | null;
  status: 'waiting' | 'called' | 'serving' | 'served' | 'left';
  priority: number;
  doctor_id: string | null;
  doctor?: { id: string; full_name: string } | null;
  patient?: { id: string; full_name: string } | null;
  queue_seq: number | null;
  joined_at: string;
};

const STATUS_COLUMNS: Array<{ key: QueueRow['status']; title: string; icon: typeof Clock3; tone: string }> = [
  { key: 'waiting', title: 'Kutmoqda', icon: Clock3, tone: 'text-warning' },
  { key: 'called', title: 'Chaqirildi', icon: Bell, tone: 'text-primary' },
  { key: 'serving', title: 'Qabulda', icon: Stethoscope, tone: 'text-success' },
  { key: 'served', title: 'Yakunlangan', icon: CheckCircle2, tone: 'text-muted-foreground' },
];

export function QueuePage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [doctorFilter, setDoctorFilter] = useState<string>('all');

  const { data: doctors } = useQuery({
    queryKey: ['doctors-list'],
    queryFn: () => api.doctors.list(),
  });

  const { data: kanban, isLoading } = useQuery({
    queryKey: ['queue-kanban', date],
    queryFn: () => api.queues.kanban(date),
    refetchInterval: 20_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel('queues-all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queues' },
        () => qc.invalidateQueries({ queryKey: ['queue-kanban'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const callMut = useMutation({
    mutationFn: (id: string) => api.queues.call(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-kanban'] }),
  });
  const acceptMut = useMutation({
    mutationFn: (id: string) => api.queues.accept(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue-kanban'] });
      toast.success('Bemor qabulga chaqirildi');
    },
  });
  const completeMut = useMutation({
    mutationFn: (id: string) => api.queues.complete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue-kanban'] });
      toast.success('Qabul yakunlandi');
    },
  });
  const skipMut = useMutation({
    mutationFn: (id: string) => api.queues.skip(id, 'Bemor kelmadi'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queue-kanban'] });
      toast.info('Navbat tashlab ketildi');
    },
  });

  const byStatus = (kanban?.by_status ?? {}) as Record<string, QueueRow[]>;

  const filterRows = (rows: QueueRow[]) => {
    if (doctorFilter === 'all') return rows;
    if (doctorFilter === 'unassigned') return rows.filter((r) => !r.doctor_id);
    return rows.filter((r) => r.doctor_id === doctorFilter);
  };

  const totalLive =
    (byStatus.waiting?.length ?? 0) + (byStatus.called?.length ?? 0) + (byStatus.serving?.length ?? 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Navbat boshqaruvi</h1>
          <p className="text-sm text-muted-foreground">
            Real-time kanban. Bugun {totalLive} ta faol navbat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          />
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha shifokorlar</SelectItem>
              <SelectItem value="unassigned">Biriktirilmagan</SelectItem>
              {((doctors as Array<{ id: string; full_name: string }>) ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => window.open('/kiosk', '_blank')}>
            <MonitorPlay className="mr-1.5 h-4 w-4" />
            Kiosk
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STATUS_COLUMNS.map((c) => (
            <Card key={c.key}>
              <CardContent className="h-96 animate-pulse" />
            </Card>
          ))}
        </div>
      ) : totalLive === 0 && (byStatus.served?.length ?? 0) === 0 ? (
        <EmptyState
          title="Navbat bo'sh"
          description="Qabulxonadan bemor qo'shilishini kuting yoki qabulxona orqali yangi navbat oching."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STATUS_COLUMNS.map((col) => {
            const rows = filterRows(byStatus[col.key] ?? []);
            const Icon = col.icon;
            return (
              <Card key={col.key} className="flex flex-col">
                <CardContent className="space-y-3 p-3">
                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-2 text-sm font-semibold ${col.tone}`}>
                      <Icon className="h-4 w-4" />
                      {col.title}
                    </div>
                    <Badge variant="secondary">{rows.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {rows.length === 0 && (
                      <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                        —
                      </div>
                    )}
                    {rows.map((row) => (
                      <QueueCard
                        key={row.id}
                        row={row}
                        onCall={() => callMut.mutate(row.id)}
                        onAccept={() => acceptMut.mutate(row.id)}
                        onComplete={() => completeMut.mutate(row.id)}
                        onSkip={() => skipMut.mutate(row.id)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QueueCard({
  row,
  onCall,
  onAccept,
  onComplete,
  onSkip,
}: {
  row: QueueRow;
  onCall: () => void;
  onAccept: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const code = row.ticket_code ?? row.ticket_no ?? '—';
  const dotColor = row.ticket_color ?? '#1976d2';
  return (
    <div
      className="group rounded-lg border bg-background p-2.5 shadow-sm transition hover:border-primary/40"
      style={{ borderLeft: `3px solid ${dotColor}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-base font-bold tracking-wide" style={{ color: dotColor }}>
            {code}
          </div>
          <div className="truncate text-sm font-medium">{row.patient?.full_name ?? 'Noma\u2019lum'}</div>
          {row.doctor?.full_name && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {row.doctor.full_name}
            </div>
          )}
        </div>
        {row.priority > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            Shosh.
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 opacity-80 transition group-hover:opacity-100">
        {row.status === 'waiting' && (
          <>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onCall}>
              <PhoneIncoming className="h-3 w-3" />
              Chaqirish
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={onSkip}>
              <SkipForward className="h-3 w-3" />
              O&lsquo;tkazib yubor
            </Button>
          </>
        )}
        {row.status === 'called' && (
          <>
            <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={onAccept}>
              <UserCheck className="h-3 w-3" />
              Qabul qilish
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              onClick={() => window.print()}
            >
              <Printer className="h-3 w-3" />
              Chek
            </Button>
          </>
        )}
        {row.status === 'serving' && (
          <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={onComplete}>
            <CheckCircle2 className="h-3 w-3" />
            Yakunlash
          </Button>
        )}
        {row.status === 'served' && (
          <Badge variant="outline" className="text-[10px]">
            Yakunlangan
          </Badge>
        )}
      </div>
    </div>
  );
}
