import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, MapPin, Phone, Clock, User as UserIcon, Send,
  CheckCircle2, MessageSquare, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Badge, Button, Card, CardContent, Dialog, DialogContent, DialogFooter, DialogHeader,
  DialogTitle, EmptyState, Input, PageHeader, cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';

const STATUS_TABS = [
  { value: 'pending',     label: 'Yangi',         tone: 'border-amber-400' },
  { value: 'assigned',    label: 'Tayinlangan',   tone: 'border-blue-500' },
  { value: 'on_the_way',  label: 'Yo‘lda',        tone: 'border-indigo-500' },
  { value: 'in_progress', label: 'Bajarilmoqda',  tone: 'border-purple-500' },
  { value: 'completed',   label: 'Tugagan',       tone: 'border-emerald-500' },
  { value: 'canceled',    label: 'Bekor',         tone: 'border-rose-500' },
] as const;

type Tab = typeof STATUS_TABS[number]['value'];
type Req = Awaited<ReturnType<typeof api.nursePortalClinic.listRequests>>[number];

function fmtTime(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('uz-UZ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtUZS(n?: number | null) {
  if (n == null) return '—';
  return `${n.toLocaleString('uz-UZ')} so'm`;
}

export function NurseRequestsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [assigning, setAssigning] = useState<Req | null>(null);
  const [chatting, setChatting] = useState<Req | null>(null);

  const requests = useQuery({
    queryKey: ['clinic-nurse-reqs', tab],
    queryFn: () => api.nursePortalClinic.listRequests(tab),
    refetchInterval: 30_000,
  });

  const counts = useQuery({
    queryKey: ['clinic-nurse-reqs-counts'],
    queryFn: () => api.nursePortalClinic.listRequests(),
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
        title="Hamshira so'rovlari"
        description="Bemorlardan kelgan uyga chaqiruv so'rovlari, hamshira tayinlash va chat"
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
              onAssign={() => setAssigning(r)}
              onChat={() => setChatting(r)}
            />
          ))}
        </div>
      )}

      {assigning && <AssignDialog req={assigning} onClose={() => setAssigning(null)} />}
      {chatting && <ChatDialog req={chatting} onClose={() => setChatting(null)} />}
    </div>
  );
}

function RequestCard({
  req, tone, onAssign, onChat,
}: { req: Req; tone: string; onAssign: () => void; onChat: () => void }) {
  return (
    <Card className={cn('border-l-4', tone)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{req.service}</span>
              {req.is_urgent && <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Shoshilinch</Badge>}
              <Badge variant="outline" className="text-[10px]">{req.status}</Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{req.requester_name}</span>
              {' · '}
              <a href={`tel:${req.requester_phone}`} className="inline-flex items-center gap-1 hover:underline">
                <Phone className="h-3 w-3" />{req.requester_phone}
              </a>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtTime(req.created_at)}</div>
            {req.preferred_at && (
              <div className="mt-0.5 inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtTime(req.preferred_at)}</div>
            )}
          </div>
        </div>

        <div className="rounded-md bg-muted/40 p-2 text-xs">
          <div className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <div>{req.address}</div>
              {req.address_notes && <div className="mt-0.5 text-muted-foreground">{req.address_notes}</div>}
              {(req.geo_lat && req.geo_lng) && (
                <a
                  href={`https://maps.google.com/?q=${req.geo_lat},${req.geo_lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >Xaritada ko'rish ↗</a>
              )}
            </div>
          </div>
        </div>

        {req.notes && <div className="text-xs text-muted-foreground">📝 {req.notes}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-muted-foreground">
            Taxminiy: <span className="font-medium text-foreground">{fmtUZS(req.estimate_total_uzs)}</span>
            {req.quoted_price_uzs != null && (
              <> · Belgilangan: <span className="font-medium text-foreground">{fmtUZS(req.quoted_price_uzs)}</span></>
            )}
          </div>
          {req.assigned_nurse && (
            <div className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-blue-700 dark:text-blue-300">
              <CheckCircle2 className="h-3 w-3" /> {req.assigned_nurse.full_name}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {req.status === 'pending' && (
            <Button size="sm" onClick={onAssign}>Hamshira tayinlash</Button>
          )}
          {(['assigned', 'on_the_way', 'in_progress'] as string[]).includes(req.status) && (
            <Button size="sm" variant="outline" onClick={onAssign}>Qayta tayinlash</Button>
          )}
          <Button size="sm" variant="outline" onClick={onChat}>
            <MessageSquare className="mr-1 h-3 w-3" /> Chat
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AssignDialog({ req, onClose }: { req: Req; onClose: () => void }) {
  const qc = useQueryClient();
  const nurses = useQuery({
    queryKey: ['clinic-nurses'],
    queryFn: () => api.nursePortalClinic.listNurses(),
  });
  const [nurseId, setNurseId] = useState<string>(req.assigned_nurse?.id ?? '');
  const [price, setPrice] = useState<string>(String(req.quoted_price_uzs ?? req.estimate_total_uzs ?? ''));
  const [sessions, setSessions] = useState('1');
  const [days, setDays] = useState('1');

  const mut = useMutation({
    mutationFn: () => api.nursePortalClinic.assign({
      request_id: req.id,
      nurse_profile_id: nurseId,
      quoted_price_uzs: price ? Number(price) : undefined,
      sessions_per_day: Number(sessions) || 1,
      days_count: Number(days) || 1,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-nurse-reqs'] });
      qc.invalidateQueries({ queryKey: ['clinic-nurse-reqs-counts'] });
      toast.success('Hamshira tayinlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Hamshira tayinlash</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium">Bemor</div>
            <div className="text-sm">{req.requester_name} · {req.service}</div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Hamshira *</label>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={nurseId}
              onChange={(e) => setNurseId(e.target.value)}
            >
              <option value="">— tanlang —</option>
              {(nurses.data ?? []).map((n) => (
                <option key={n.id} value={n.id}>{n.full_name}{n.phone ? ` (${n.phone})` : ''}</option>
              ))}
            </select>
            {nurses.data && nurses.data.length === 0 && (
              <p className="text-xs text-muted-foreground">Klinikada hamshira xodim yo'q. Avval xodim qo'shing.</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Narx (UZS)</label>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="100000" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Kuniga marta</label>
              <Input type="number" min="1" max="6" value={sessions} onChange={(e) => setSessions(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Kun</label>
              <Input type="number" min="1" max="60" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={!nurseId || mut.isPending} onClick={() => mut.mutate()}>Tayinlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChatDialog({ req, onClose }: { req: Req; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const messages = useQuery({
    queryKey: ['nurse-req-chat', req.id],
    queryFn: () => api.nursePortalClinic.listMessages(req.id),
    refetchInterval: 5_000,
  });
  const send = useMutation({
    mutationFn: () => api.nursePortalClinic.sendMessage(req.id, { body: text }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['nurse-req-chat', req.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Chat — {req.requester_name}</DialogTitle></DialogHeader>
        <div className="flex h-80 flex-col rounded-md border bg-muted/20">
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {(messages.data ?? []).map((m) => (
              <div key={m.id} className={cn(
                'max-w-[80%] rounded-lg px-3 py-1.5 text-sm',
                m.sender_kind === 'clinic' ? 'ml-auto bg-primary text-primary-foreground' :
                m.sender_kind === 'system' ? 'mx-auto bg-muted text-muted-foreground text-xs' :
                'bg-card border',
              )}>
                {m.body}
                <div className="mt-0.5 text-[10px] opacity-70">{fmtTime(m.created_at)}</div>
              </div>
            ))}
            {messages.data?.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">Hali xabar yo'q</div>
            )}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}
            className="flex gap-2 border-t bg-background p-2"
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Xabar yozing…" />
            <Button type="submit" size="icon" disabled={!text.trim() || send.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
