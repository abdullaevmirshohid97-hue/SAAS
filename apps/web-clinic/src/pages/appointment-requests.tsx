import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Phone, Clock, User as UserIcon, Stethoscope, CheckCircle2, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge, Button, Card, CardContent, Dialog, DialogContent, DialogFooter, DialogHeader,
  DialogTitle, EmptyState, Input, PageHeader, cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

const STATUS_TABS = [
  { value: 'pending',   label: 'Yangi',         tone: 'border-amber-400' },
  { value: 'confirmed', label: 'Tasdiqlangan',  tone: 'border-emerald-500' },
  { value: 'rejected',  label: 'Rad etilgan',   tone: 'border-rose-500' },
  { value: 'canceled',  label: 'Bekor qilingan', tone: 'border-muted' },
] as const;

type Tab = typeof STATUS_TABS[number]['value'];
type Req = Awaited<ReturnType<typeof api.clinicAppointments.list>>[number];

function fmtTime(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('uz-UZ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AppointmentRequestsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [confirming, setConfirming] = useState<Req | null>(null);
  const [rejecting, setRejecting] = useState<Req | null>(null);

  const requests = useQuery({
    queryKey: ['clinic-appt-reqs', tab],
    queryFn: () => api.clinicAppointments.list(tab),
    refetchInterval: 30_000,
  });

  const counts = useQuery({
    queryKey: ['clinic-appt-reqs-counts'],
    queryFn: () => api.clinicAppointments.list(),
    refetchInterval: 60_000,
  });
  const countMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of counts.data ?? []) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [counts.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Navbat so'rovlari"
        description="Bemorlardan online kelgan navbat so'rovlari — tasdiqlash yoki rad etish"
      />

      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        {STATUS_TABS.map((s) => (
          <button
            key={s.value}
            onClick={() => setTab(s.value)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
              tab === s.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {s.label}
            {countMap[s.value] ? (
              <Badge variant={tab === s.value ? 'secondary' : 'outline'} className="text-[10px]">
                {countMap[s.value]}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

      {requests.isLoading ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Yuklanmoqda…</CardContent></Card>
      ) : (requests.data ?? []).length === 0 ? (
        <EmptyState title="So'rov yo'q" description="Bu holatdagi so'rovlar mavjud emas" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {requests.data!.map((r) => (
            <RequestCard
              key={r.id}
              req={r}
              tone={STATUS_TABS.find((s) => s.value === r.status)?.tone ?? 'border-muted'}
              onConfirm={() => setConfirming(r)}
              onReject={() => setRejecting(r)}
            />
          ))}
        </div>
      )}

      {confirming && <ConfirmDialog req={confirming} onClose={() => setConfirming(null)} />}
      {rejecting && <RejectDialog req={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function RequestCard({
  req, tone, onConfirm, onReject,
}: { req: Req; tone: string; onConfirm: () => void; onReject: () => void }) {
  return (
    <Card className={cn('border-l-4', tone)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 font-semibold">
                <UserIcon className="h-3.5 w-3.5" />{req.patient_name_snapshot}
              </span>
              <Badge variant="outline" className="text-[10px]">{req.status}</Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              <a href={`tel:${req.patient_phone_snapshot}`} className="inline-flex items-center gap-1 hover:underline">
                <Phone className="h-3 w-3" />{req.patient_phone_snapshot}
              </a>
              {req.doctor_name && (
                <> {' · '}<span className="inline-flex items-center gap-1"><Stethoscope className="h-3 w-3" />Dr. {req.doctor_name}</span></>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtTime(req.created_at)}</div>
          </div>
        </div>

        <div className="rounded-md bg-muted/40 p-2 text-xs space-y-1">
          {req.preferred_note && <div>🕒 Qulay vaqt: <span className="font-medium text-foreground">{req.preferred_note}</span></div>}
          {req.preferred_at && <div>📅 So'ralgan: <span className="font-medium text-foreground">{fmtTime(req.preferred_at)}</span></div>}
          {req.reason && <div>📝 {req.reason}</div>}
        </div>

        {req.scheduled_at && (
          <div className="text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />Belgilangan: {fmtTime(req.scheduled_at)}
          </div>
        )}
        {req.response_note && <div className="text-xs text-muted-foreground">Javob: {req.response_note}</div>}

        {req.status === 'pending' && (
          <div className="flex gap-2">
            <Button size="sm" onClick={onConfirm}>
              <CheckCircle2 className="mr-1 h-3 w-3" /> Tasdiqlash
            </Button>
            <Button size="sm" variant="outline" onClick={onReject}>
              <XCircle className="mr-1 h-3 w-3" /> Rad etish
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmDialog({ req, onClose }: { req: Req; onClose: () => void }) {
  const qc = useQueryClient();
  const [scheduledAt, setScheduledAt] = useState('');
  const [note, setNote] = useState('');

  const mut = useMutation({
    mutationFn: () => api.clinicAppointments.respond(req.id, {
      action: 'confirm',
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      response_note: note.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-appt-reqs'] });
      qc.invalidateQueries({ queryKey: ['clinic-appt-reqs-counts'] });
      toast.success('Navbat tasdiqlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Navbatni tasdiqlash</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm">{req.patient_name_snapshot} · {req.patient_phone_snapshot}</div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Belgilangan vaqt</label>
            <input
              type="datetime-local"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Bemorga izoh (ixtiyoriy)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: 2-qavat, 5-xona" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>Tasdiqlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ req, onClose }: { req: Req; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const mut = useMutation({
    mutationFn: () => api.clinicAppointments.respond(req.id, { action: 'reject', response_note: note.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-appt-reqs'] });
      qc.invalidateQueries({ queryKey: ['clinic-appt-reqs-counts'] });
      toast.success('So\'rov rad etildi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>So'rovni rad etish</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm">{req.patient_name_snapshot} · {req.patient_phone_snapshot}</div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Sabab (ixtiyoriy)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: bu vaqtda band" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button variant="destructive" disabled={mut.isPending} onClick={() => mut.mutate()}>Rad etish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
