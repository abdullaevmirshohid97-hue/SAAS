import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, KeyRound, Lock, LogOut, ShieldCheck, User2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

interface Operator {
  id: string;
  full_name: string;
  role: string;
  color?: string | null;
}

interface Schedule {
  id: string;
  name_i18n: Record<string, string>;
  start_time: string;
  end_time: string;
  operators?: Array<{ operator: Operator }>;
}

function pickName(i18n: Record<string, string> | undefined, locale = 'uz-Latn'): string {
  if (!i18n) return '';
  return i18n[locale] ?? i18n['uz-Latn'] ?? i18n.ru ?? Object.values(i18n)[0] ?? '';
}

function formatTime(t: string): string {
  return t.slice(0, 5);
}

function currency(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n) + ' so\u2018m';
}

function elapsed(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}s ${m}d`;
}

export function ShiftBar() {
  const qc = useQueryClient();
  const { data: active, isLoading } = useQuery({
    queryKey: ['shifts', 'active'],
    queryFn: () => api.shifts.active(),
    refetchInterval: 30_000,
  });

  const [openDialog, setOpenDialog] = useState<'open' | 'close' | null>(null);
  const isOpen = Boolean(active && (active as { id?: string }).id);

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card/80 px-4 py-2.5 shadow-elevation-1 backdrop-blur',
        isOpen ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5',
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background shadow-inset-border">
        {isOpen ? <ShieldCheck className="h-4 w-4 text-success" /> : <Lock className="h-4 w-4 text-warning" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {isLoading ? 'Yuklanmoqda…' : isOpen ? 'Smena ochiq' : 'Smena yopiq'}
          </span>
          {isOpen && (active as { operator?: Operator })?.operator?.full_name && (
            <Badge variant="secondary" className="gap-1">
              <User2 className="h-3 w-3" />
              {(active as { operator?: Operator }).operator!.full_name}
            </Badge>
          )}
        </div>
        {isOpen && (
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {elapsed((active as { opened_at: string }).opened_at)}
            </span>
            {(active as unknown as { opening_cash_uzs?: number }).opening_cash_uzs ? (
              <span>Kassa: {currency((active as unknown as { opening_cash_uzs: number }).opening_cash_uzs)}</span>
            ) : null}
          </div>
        )}
      </div>
      {isOpen ? (
        <Button size="sm" variant="destructive" onClick={() => setOpenDialog('close')} className="gap-1.5">
          <LogOut className="h-3.5 w-3.5" /> Smenani yopish
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpenDialog('open')} className="gap-1.5">
          <KeyRound className="h-3.5 w-3.5" /> Smenani ochish
        </Button>
      )}

      {openDialog === 'open' && (
        <OpenShiftDialog
          onClose={() => setOpenDialog(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['shifts'] });
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === 'close' && isOpen && (
        <CloseShiftDialog
          shiftId={(active as { id: string }).id}
          openingCash={(active as unknown as { opening_cash_uzs?: number }).opening_cash_uzs ?? 0}
          onClose={() => setOpenDialog(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['shifts'] });
            setOpenDialog(null);
          }}
        />
      )}
    </div>
  );
}

function OpenShiftDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { data: schedules } = useQuery({
    queryKey: ['shift-schedules', 'for-date'],
    queryFn: () => api.shiftSchedules.forDate(),
  });
  const { data: operators } = useQuery({
    queryKey: ['shift-operators'],
    queryFn: () => api.shiftOperators.list(),
  });
  const [scheduleId, setScheduleId] = useState<string>('');
  const [operatorId, setOperatorId] = useState<string>('');
  const [pin, setPin] = useState('');
  const [openingCash, setOpeningCash] = useState<string>('0');

  const filteredOperators = useMemo(() => {
    if (!schedules || !scheduleId || !operators) return (operators as Operator[] | undefined) ?? [];
    const sched = (schedules as Schedule[]).find((s) => s.id === scheduleId);
    const assignedIds = new Set((sched?.operators ?? []).map((o) => o.operator.id));
    return (operators as Operator[]).filter((o) => assignedIds.has(o.id));
  }, [schedules, scheduleId, operators]);

  useEffect(() => {
    if (!scheduleId && schedules && (schedules as Schedule[]).length > 0) {
      const first = (schedules as Schedule[])[0];
      if (first) setScheduleId(first.id);
    }
  }, [schedules, scheduleId]);

  useEffect(() => {
    if (!operatorId && filteredOperators.length > 0) {
      const first = filteredOperators[0];
      if (first) setOperatorId(first.id);
    }
  }, [filteredOperators, operatorId]);

  const openMut = useMutation({
    mutationFn: () =>
      api.shifts.open({
        operator_id: operatorId,
        schedule_id: scheduleId || undefined,
        pin,
        opening_cash_uzs: Number.parseInt(openingCash || '0', 10) || 0,
        opened_via: 'pos',
      }),
    onSuccess: () => {
      toast.success('Smena ochildi');
      onSuccess();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Smenani ochish</DialogTitle>
          <DialogDescription>Smenani tanlang, navbatchi operatorni tanlang va PIN-kodingizni kiriting.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Smena jadvali</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {((schedules as Schedule[] | undefined) ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setScheduleId(s.id);
                    setOperatorId('');
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-sm transition',
                    scheduleId === s.id ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                  )}
                >
                  <div className="font-medium">{pickName(s.name_i18n)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatTime(s.start_time)} – {formatTime(s.end_time)}
                  </div>
                </button>
              ))}
              {!schedules || (schedules as Schedule[]).length === 0 ? (
                <div className="col-span-2 rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Bugun uchun jadval konfiguratsiya qilinmagan. Sozlamalar &rarr; Smena jadvallari.
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Navbatchi</label>
            <div className="grid grid-cols-2 gap-2">
              {filteredOperators.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOperatorId(o.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
                    operatorId === o.id ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                  )}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{ backgroundColor: o.color ?? 'hsl(var(--primary) / 0.15)', color: o.color ? '#fff' : 'hsl(var(--primary))' }}
                  >
                    {o.full_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.full_name}</div>
                    <div className="text-[11px] text-muted-foreground">{o.role}</div>
                  </div>
                </button>
              ))}
              {filteredOperators.length === 0 && (
                <div className="col-span-2 rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Jadvalga navbatchilar biriktirilmagan.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">PIN kod</label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="\u2022\u2022\u2022\u2022"
                className="text-center font-mono tracking-[0.3em]"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Ochilish kassasi (so&lsquo;m)</label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            onClick={() => openMut.mutate()}
            disabled={!operatorId || pin.length < 4 || openMut.isPending}
            className="gap-1.5"
          >
            {openMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Smenani ochish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseShiftDialog({
  shiftId,
  openingCash,
  onClose,
  onSuccess,
}: {
  shiftId: string;
  openingCash: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [actualCash, setActualCash] = useState<string>(String(openingCash));
  const [notes, setNotes] = useState('');
  const closeMut = useMutation({
    mutationFn: () =>
      api.shifts.close(shiftId, {
        actual_cash_uzs: Number.parseInt(actualCash || '0', 10) || 0,
        closing_notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Smena yopildi');
      onSuccess();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Smenani yopish</DialogTitle>
          <DialogDescription>Kassadagi haqiqiy naqd summasini kiriting va smenani yoping.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Kassadagi naqd pul (so&lsquo;m)</label>
            <Input type="number" inputMode="numeric" min={0} value={actualCash} onChange={(e) => setActualCash(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Izoh (ixtiyoriy)</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Masalan: 50 ming so&lsquo;m ayrildi" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button variant="destructive" onClick={() => closeMut.mutate()} disabled={closeMut.isPending} className="gap-1.5">
            {closeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
