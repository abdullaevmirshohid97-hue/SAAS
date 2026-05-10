import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';
import { Plus, Trash2 } from 'lucide-react';

import { api } from '@/lib/api';

const DAYS = [
  { v: 1, label: 'Du' },
  { v: 2, label: 'Se' },
  { v: 3, label: 'Ch' },
  { v: 4, label: 'Pa' },
  { v: 5, label: 'Ju' },
  { v: 6, label: 'Sh' },
  { v: 0, label: 'Ya' },
];

type Schedule = Awaited<ReturnType<typeof api.nurse.listSchedules>>[number];

export function NurseSchedulesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['nurse', 'schedules'],
    queryFn: () => api.nurse.listSchedules(),
  });

  const delMut = useMutation({
    mutationFn: api.nurse.deleteSchedule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse', 'schedules'] });
      toast.success('O‘chirildi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const byFloor = useMemo(() => {
    const map = new Map<number, Schedule[]>();
    for (const s of data ?? []) {
      const arr = map.get(s.floor) ?? [];
      arr.push(s);
      map.set(s.floor, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hamshira navbatchilik jadvali"
        description="Qaysi hamshira qaysi qavatda qaysi kunlari ishlaydi. Doktor retsept yozsa, tizim shu jadvalga qarab vazifani avtomatik tegishli hamshiraga yo‘naltiradi."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Yangi qator
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Yuklanmoqda...</div>
      ) : byFloor.length === 0 ? (
        <EmptyState
          title="Hali jadval yo‘q"
          description="Birinchi qatorni qo‘shing — hamshira × qavat × kun."
        />
      ) : (
        <div className="space-y-3">
          {byFloor.map(([floor, rows]) => (
            <Card key={floor}>
              <CardContent className="space-y-2 p-4">
                <div className="text-sm font-semibold">{floor}-qavat</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1">Hamshira</th>
                        <th className="px-2 py-1">Kun</th>
                        <th className="px-2 py-1">Vaqt</th>
                        <th className="px-2 py-1">Holat</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .slice()
                        .sort((a, b) => a.day_of_week - b.day_of_week)
                        .map((r) => (
                          <tr key={r.id} className="border-t">
                            <td className="px-2 py-2">
                              {r.nurse?.full_name ?? r.nurse_id}
                            </td>
                            <td className="px-2 py-2">
                              {DAYS.find((d) => d.v === r.day_of_week)?.label ?? r.day_of_week}
                            </td>
                            <td className="px-2 py-2 font-mono text-xs">
                              {r.start_time}–{r.end_time}
                            </td>
                            <td className="px-2 py-2">
                              {r.is_active ? (
                                <Badge variant="default">Faol</Badge>
                              ) : (
                                <Badge variant="outline">O‘chiq</Badge>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => delMut.mutate(r.id)}
                                disabled={delMut.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && <ScheduleDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [nurseId, setNurseId] = useState('');
  const [floor, setFloor] = useState(1);
  const [dow, setDow] = useState<number>(1);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('20:00');

  const { data: staff } = useQuery({
    queryKey: ['staff', 'nurses'],
    queryFn: () => api.staff.list(),
  });

  type StaffRow = { id: string; full_name: string; role: string };
  const nurses = ((staff as StaffRow[] | undefined) ?? []).filter(
    (s) => s.role === 'nurse',
  );

  const mut = useMutation({
    mutationFn: api.nurse.upsertSchedule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse', 'schedules'] });
      toast.success('Saqlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yangi navbatchilik qatori</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Hamshira *</label>
            <Select value={nurseId} onValueChange={setNurseId}>
              <SelectTrigger>
                <SelectValue placeholder="Tanlang..." />
              </SelectTrigger>
              <SelectContent>
                {nurses.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Qavat</label>
              <Input
                type="number"
                min={1}
                value={floor}
                onChange={(e) => setFloor(Number(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Kun</label>
              <Select value={String(dow)} onValueChange={(v) => setDow(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => (
                    <SelectItem key={d.v} value={String(d.v)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Boshlanish</label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Tugash</label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Bir hamshira bir qavatda bir kun ichida bitta qatorga ega bo‘ladi.
            Mavjud bo‘lsa qayta yozadi (upsert).
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!nurseId || mut.isPending}
            onClick={() =>
              mut.mutate({
                nurse_id: nurseId,
                floor,
                day_of_week: dow,
                start_time: startTime,
                end_time: endTime,
                is_active: true,
              })
            }
          >
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
