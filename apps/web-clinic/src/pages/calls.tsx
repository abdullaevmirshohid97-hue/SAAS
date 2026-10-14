import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  cn,
} from '@clary/ui-web';
import type {
  AiCallListItem,
  AiCallOutcome,
  BookedAppointment,
  BookingSource,
} from '@clary/api-client';
import {
  Bot,
  CalendarPlus,
  CheckCircle2,
  MessageCircle,
  Phone,
  PhoneCall,
  PhoneMissed,
  Settings2,
  Voicemail,
  XCircle,
} from 'lucide-react';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

// =============================================================================
// Qo'ng'iroqlar — AI qabulxona: qayta qo'ng'iroq navbati, oldindan
// yozilganlar va barcha suhbatlar (yozuv + matn).
// =============================================================================

type Tab = 'callback' | 'booked' | 'all';

const OUTCOME: Record<
  AiCallOutcome,
  { label: string; tone: 'success' | 'warning' | 'info' | 'outline' | 'destructive' }
> = {
  booked: { label: 'Yozildi', tone: 'success' },
  cancelled: { label: 'Bekor qildi', tone: 'outline' },
  info: { label: 'Ma’lumot oldi', tone: 'info' },
  callback: { label: 'Qayta qo‘ng‘iroq', tone: 'warning' },
  transferred: { label: 'Xodimga ulandi', tone: 'info' },
  voicemail: { label: 'Ovozli xabar', tone: 'warning' },
  abandoned: { label: 'Uzildi', tone: 'outline' },
  failed: { label: 'Xato', tone: 'destructive' },
};

const SOURCE: Record<BookingSource, string> = {
  staff: 'Qabulxona',
  ai_phone: 'AI telefon',
  telegram: 'Telegram',
  ai_chat: 'Telegram AI',
  portal: 'Portal',
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const fmtDur = (s: number | null) =>
  s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—';

export function CallsPage() {
  const [tab, setTab] = useState<Tab>('callback');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ phone?: string | null; callId?: string } | null>(null);
  const { can, role } = useAuth();
  const isAdmin = role === 'clinic_owner' || role === 'clinic_admin';

  const stats = useQuery({
    queryKey: ['ai-calls', 'stats'],
    queryFn: () => api.aiReception.stats(),
    refetchInterval: 60_000,
  });

  const s = stats.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Qo‘ng‘iroqlar va online navbat"
        description="AI qabulxona va Telegram bot: kim qo‘ng‘iroq qildi, kim yozildi, kimga qayta qo‘ng‘iroq qilish kerak."
        actions={
          <div className="flex gap-2">
            {can('appointments.create') && (
              <Button onClick={() => setBooking({})}>
                <CalendarPlus className="mr-1.5 h-4 w-4" />
                Navbatga yozish
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" asChild>
                <Link to="/settings/ai-reception">
                  <Settings2 className="mr-1.5 h-4 w-4" />
                  Sozlamalar
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {stats.error ? (
        <Card>
          <CardContent className="text-destructive p-4 text-sm">
            {(stats.error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MiniStat
            icon={PhoneCall}
            label="Qo‘ng‘iroqlar (oy)"
            value={s ? `${s.phone_calls}` : '…'}
          />
          <MiniStat icon={Bot} label="AI javob berdi" value={s ? `${s.phone_ai}` : '…'} />
          <MiniStat
            icon={CalendarPlus}
            label="Online yozilganlar (oy)"
            value={s ? `${s.bookings_total}` : '…'}
          />
          <MiniStat
            icon={PhoneMissed}
            label="Qayta qo‘ng‘iroq kutmoqda"
            value={s ? `${s.pending_callbacks}` : '…'}
            warn={!!s?.pending_callbacks}
          />
          <MiniStat
            icon={XCircle}
            label="Kelmadi / bekor"
            value={s ? `${s.bookings_no_show} / ${s.bookings_canceled}` : '…'}
          />
        </div>
      )}

      <div className="bg-card flex flex-wrap gap-1 rounded-lg border p-1">
        {(
          [
            ['callback', 'Qayta qo‘ng‘iroq kerak'],
            ['booked', 'Oldindan yozilganlar'],
            ['all', 'Barcha qo‘ng‘iroqlar'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition',
              tab === k
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'booked' ? (
        <UpcomingList />
      ) : (
        <CallsList
          filter={tab === 'callback' ? 'callback' : 'all'}
          onOpen={setDetailId}
          onBook={(c) => setBooking({ phone: c.caller_phone, callId: c.id })}
        />
      )}

      {detailId && (
        <CallDetailDialog
          id={detailId}
          onClose={() => setDetailId(null)}
          onBook={(phone) => {
            setBooking({ phone, callId: detailId });
            setDetailId(null);
          }}
        />
      )}
      {booking && (
        <BookDialog
          phone={booking.phone ?? null}
          callId={booking.callId}
          onClose={() => setBooking(null)}
        />
      )}
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className={cn('bg-card rounded-xl border p-3', warn && 'border-amber-400 bg-amber-50/40')}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function ChannelBadge({ c }: { c: Pick<AiCallListItem, 'channel' | 'mode'> }) {
  if (c.channel === 'telegram')
    return (
      <Badge variant="info">
        <MessageCircle className="mr-1 h-3 w-3" />
        Telegram
      </Badge>
    );
  if (c.mode === 'voicemail')
    return (
      <Badge variant="warning">
        <Voicemail className="mr-1 h-3 w-3" />
        Ovozli xabar
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <Bot className="mr-1 h-3 w-3" />
      AI telefon
    </Badge>
  );
}

function CallsList({
  filter,
  onOpen,
  onBook,
}: {
  filter: 'callback' | 'all';
  onOpen: (id: string) => void;
  onBook: (c: AiCallListItem) => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const calls = useQuery({
    queryKey: ['ai-calls', filter, page],
    queryFn: () => api.aiReception.calls({ filter, page }),
    refetchInterval: 30_000,
  });
  const done = useMutation({
    mutationFn: (id: string) => api.aiReception.callbackDone(id),
    onSuccess: () => {
      toast.success('Belgilandi');
      qc.invalidateQueries({ queryKey: ['ai-calls'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (calls.isLoading) return <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>;
  if (calls.error)
    return (
      <Card>
        <CardContent className="text-destructive p-4 text-sm">
          {(calls.error as Error).message}
        </CardContent>
      </Card>
    );
  const items = calls.data?.items ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        title={filter === 'callback' ? 'Qayta qo‘ng‘iroq kutayotgan yo‘q' : 'Hali qo‘ng‘iroq yo‘q'}
        description={
          filter === 'callback'
            ? 'AI hal qila olmagan yoki ovozli xabar qoldirgan bemorlar shu yerda chiqadi.'
            : 'AI liniyasi ulangach qo‘ng‘iroqlar shu yerda ko‘rinadi.'
        }
      />
    );

  const totalPages = Math.max(
    1,
    Math.ceil((calls.data?.total ?? 0) / (calls.data?.pageSize ?? 50)),
  );
  return (
    <div className="space-y-2">
      {items.map((c) => (
        <Card
          key={c.id}
          className={cn(c.needs_callback && !c.callback_done_at && 'border-amber-400')}
        >
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="w-28 text-sm">
              <div className="font-medium">{fmtTime(c.started_at)}</div>
              <div className="text-muted-foreground text-xs">{fmtDur(c.duration_sec)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {c.caller_phone ? (
                  <a href={`tel:${c.caller_phone}`} className="font-semibold hover:underline">
                    {c.caller_phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">raqam aniqlanmadi</span>
                )}
                {c.patient && <span className="text-sm">· {c.patient.full_name}</span>}
                <ChannelBadge c={c} />
                {c.outcome && (
                  <Badge variant={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Badge>
                )}
                {c.callback_done_at && (
                  <Badge variant="success">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Qo‘ng‘iroq qilindi
                  </Badge>
                )}
              </div>
              {c.callback_note && (
                <div className="text-muted-foreground mt-0.5 text-sm">📝 {c.callback_note}</div>
              )}
              {c.appointment && (
                <div className="mt-0.5 text-xs text-emerald-700">
                  🗓 Navbat: {fmtTime(c.appointment.scheduled_at)} ({c.appointment.status})
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => onOpen(c.id)}>
                {c.has_recording ? 'Tinglash' : 'Batafsil'}
              </Button>
              {c.needs_callback && !c.callback_done_at && (
                <>
                  <Button size="sm" variant="outline" onClick={() => onBook(c)}>
                    Yozish
                  </Button>
                  <Button size="sm" onClick={() => done.mutate(c.id)} disabled={done.isPending}>
                    Qo‘ng‘iroq qilindi
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ←
          </Button>
          {page} / {totalPages}
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </Button>
        </div>
      )}
    </div>
  );
}

function UpcomingList() {
  const qc = useQueryClient();
  const [source, setSource] = useState<string>('all');
  const list = useQuery({
    queryKey: ['booking-upcoming', source],
    queryFn: () => api.aiReception.upcoming({ source }),
    refetchInterval: 60_000,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.aiReception.cancelAppointment(id, 'Klinika bekor qildi'),
    onSuccess: () => {
      toast.success('Bekor qilindi');
      qc.invalidateQueries({ queryKey: ['booking-upcoming'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const byDate = useMemo(() => {
    const m = new Map<string, BookedAppointment[]>();
    for (const a of list.data ?? []) {
      const d = new Date(a.scheduled_at).toLocaleDateString('uz-UZ', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      m.set(d, [...(m.get(d) ?? []), a]);
    }
    return [...m.entries()];
  }, [list.data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {['all', 'ai_phone', 'telegram', 'ai_chat', 'staff'].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={source === s ? 'default' : 'outline'}
            onClick={() => setSource(s)}
          >
            {s === 'all' ? 'Hammasi' : SOURCE[s as BookingSource]}
          </Button>
        ))}
      </div>
      {list.isLoading ? (
        <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>
      ) : list.error ? (
        <Card>
          <CardContent className="text-destructive p-4 text-sm">
            {(list.error as Error).message}
          </CardContent>
        </Card>
      ) : byDate.length === 0 ? (
        <EmptyState title="Oldindan yozilgan bemor yo‘q" description="Keyingi 30 kun ichida." />
      ) : (
        byDate.map(([day, rows]) => (
          <Card key={day}>
            <CardContent className="p-3">
              <div className="mb-2 text-sm font-semibold capitalize">{day}</div>
              <div className="divide-y">
                {rows.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <div className="w-14 font-mono font-semibold">
                      {new Date(a.scheduled_at).toLocaleTimeString('uz-UZ', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {a.patient ? (
                          <Link to={`/patient/${a.patient.id}`} className="hover:underline">
                            {a.patient.full_name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        {a.patient?.phone && (
                          <a
                            href={`tel:${a.patient.phone}`}
                            className="text-muted-foreground ml-2 text-xs"
                          >
                            {a.patient.phone}
                          </a>
                        )}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {a.doctor?.full_name ?? '—'}
                        {a.reason ? ` · ${a.reason}` : ''}
                      </div>
                    </div>
                    <Badge variant="outline">{SOURCE[a.source] ?? a.source}</Badge>
                    {a.patient_confirmed_at ? (
                      <Badge variant="success">Kelishini tasdiqladi</Badge>
                    ) : a.reminder_sent_at ? (
                      <Badge variant="info">Eslatma yuborildi</Badge>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm('Navbatni bekor qilasizmi?')) cancel.mutate(a.id);
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
      <p className="text-muted-foreground text-xs">
        Bemor kelganda qabulxonada odatdagidek rasmiylashtiring — shu shifokorga bugungi oldindan
        yozuv avtomatik “keldi” bo‘ladi (dublikat ochilmaydi).
      </p>
    </div>
  );
}

function CallDetailDialog({
  id,
  onClose,
  onBook,
}: {
  id: string;
  onClose: () => void;
  onBook: (phone: string | null) => void;
}) {
  const call = useQuery({ queryKey: ['ai-call', id], queryFn: () => api.aiReception.call(id) });
  const c = call.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {c?.caller_phone ?? 'Qo‘ng‘iroq'}{' '}
            {c && (
              <span className="text-muted-foreground text-sm font-normal">
                · {fmtTime(c.started_at)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {!c ? (
          <div className="text-muted-foreground text-sm">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <ChannelBadge c={c} />
              {c.outcome && (
                <Badge variant={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Badge>
              )}
              <Badge variant="outline">Davomiyligi: {fmtDur(c.duration_sec)}</Badge>
              <Badge variant="outline">
                Xarajat: ~{Math.round(c.est_cost_uzs).toLocaleString('ru-RU')} so‘m
              </Badge>
              {c.patient && (
                <Link to={`/patient/${c.patient.id}`}>
                  <Badge variant="info">{c.patient.full_name}</Badge>
                </Link>
              )}
            </div>
            {c.recording_url && (
              <audio controls src={c.recording_url} className="w-full">
                <track kind="captions" />
              </audio>
            )}
            {c.callback_note && (
              <div className="rounded-md border bg-amber-50/40 p-2 text-sm">
                📝 {c.callback_note}
              </div>
            )}
            <div className="space-y-2">
              {c.transcript.length === 0 && (
                <div className="text-muted-foreground text-sm">Matn yo‘q.</div>
              )}
              {c.transcript.map((t, i) =>
                t.role === 'system' ? (
                  <div key={i} className="text-muted-foreground text-center text-xs">
                    {t.text}
                  </div>
                ) : (
                  <div
                    key={i}
                    className={cn('flex', t.role === 'caller' ? 'justify-start' : 'justify-end')}
                  >
                    <div
                      className={cn(
                        'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                        t.role === 'caller' ? 'bg-muted' : 'bg-primary/10',
                      )}
                    >
                      <div className="text-muted-foreground mb-0.5 text-[10px]">
                        {t.role === 'caller' ? 'Bemor' : 'AI'}
                      </div>
                      {t.text}
                    </div>
                  </div>
                ),
              )}
            </div>
            {c.error && <div className="text-destructive text-xs">Xato: {c.error}</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
          {c && !c.appointment && (
            <Button onClick={() => onBook(c.caller_phone)}>
              <CalendarPlus className="mr-1.5 h-4 w-4" />
              Navbatga yozish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BookDialog({
  phone,
  callId,
  onClose,
}: {
  phone: string | null;
  callId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tel, setTel] = useState(phone ?? '');
  const [reason, setReason] = useState('');

  const doctors = useQuery({
    queryKey: ['booking-doctors'],
    queryFn: () => api.aiReception.doctors(),
  });
  const withSchedule = (doctors.data ?? []).filter((d) => d.rules.length > 0);
  const slots = useQuery({
    queryKey: ['booking-slots', staffId, date],
    queryFn: () => api.aiReception.slots({ staff_id: staffId, from: date, days: 1 }),
    enabled: !!staffId,
  });

  const book = useMutation({
    mutationFn: () =>
      api.aiReception.book({
        staff_id: staffId,
        starts_at: start!,
        patient: { full_name: name.trim(), phone: tel.trim() },
        reason: reason.trim() || undefined,
        call_id: callId,
      }),
    onSuccess: (r) => {
      toast.success(`${r.patient_name} yozildi${r.new_patient ? ' (yangi karta ochildi)' : ''}`);
      qc.invalidateQueries({ queryKey: ['booking-upcoming'] });
      qc.invalidateQueries({ queryKey: ['ai-calls'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Navbatga yozish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">Shifokor</label>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={staffId}
                onChange={(e) => {
                  setStaffId(e.target.value);
                  setStart(null);
                }}
              >
                <option value="">— tanlang —</option>
                {withSchedule.map((d) => (
                  <option key={d.staff_id} value={d.staff_id}>
                    {d.full_name} — {d.specialty_label}
                  </option>
                ))}
              </select>
              {doctors.data && withSchedule.length === 0 && (
                <div className="text-xs text-amber-600">
                  Jadvali kiritilgan shifokor yo‘q —{' '}
                  <Link to="/settings/doctor-schedules" className="underline">
                    jadvalni kiriting
                  </Link>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">Kun</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setStart(null);
                }}
              />
            </div>
          </div>
          {staffId && (
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">Bo‘sh vaqt</label>
              {slots.isLoading ? (
                <div className="text-muted-foreground text-xs">Yuklanmoqda…</div>
              ) : (slots.data?.slots ?? []).length === 0 ? (
                <div className="text-muted-foreground text-xs">Bu kunda bo‘sh vaqt yo‘q.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {slots.data!.slots.map((s) => (
                    <Button
                      key={s.start}
                      size="sm"
                      variant={start === s.start ? 'default' : 'outline'}
                      onClick={() => setStart(s.start)}
                    >
                      {s.time}
                      {s.capacity > 1 ? ` (${s.capacity - s.taken})` : ''}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">Familiya Ism</label>
              <Input
                placeholder="Abdullayev Jasur"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs font-medium">Telefon</label>
              <Input
                placeholder="90 123 45 67"
                value={tel}
                onChange={(e) => setTel(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs font-medium">Sabab (ixtiyoriy)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="text-muted-foreground text-[11px]">
            Familiya + ism + telefon mos kelsa — mavjud bemor kartasi ishlatiladi (yangi karta
            ochilmaydi).
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            onClick={() => book.mutate()}
            disabled={
              !staffId ||
              !start ||
              name.trim().split(/\s+/).length < 2 ||
              tel.replace(/\D/g, '').length < 9 ||
              book.isPending
            }
          >
            Yozish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
