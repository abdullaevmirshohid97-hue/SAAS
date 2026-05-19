import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Search, Send, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Textarea,
} from '@clary/ui-web';

import { api } from '@/lib/api';

const STATUSES = ['open', 'pending', 'in_progress', 'resolved', 'closed'] as const;
const CATEGORIES = ['onboarding', 'billing', 'bug', 'feature_request', 'integration', 'other'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'open' || status === 'pending'
    ? 'destructive'
    : status === 'resolved' || status === 'closed'
      ? 'success'
      : 'secondary';
  return <Badge variant={variant as 'destructive' | 'success' | 'secondary'}>{status}</Badge>;
}

type ChatThread = { id: string; subject: string; clinic?: { name?: string } | null };

export function SupportPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [clinicId, setClinicId] = useState<string>('');
  const [chatting, setChatting] = useState<ChatThread | null>(null);

  const clinics = useQuery({
    queryKey: ['admin', 'tenants', 'support'],
    queryFn: () => api.admin.listTenants(),
  });

  const threads = useQuery({
    queryKey: ['admin', 'support-threads', q, status, category, clinicId],
    queryFn: () =>
      api.admin.listSupport({
        q: q || undefined,
        status: status || undefined,
        category: category || undefined,
        clinic_id: clinicId || undefined,
        limit: 100,
      }),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { status?: string; priority?: string } }) =>
      api.admin.patchSupport(id, body),
    onSuccess: () => {
      toast.success('Yangilandi');
      qc.invalidateQueries({ queryKey: ['admin', 'support-threads'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const impersonate = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      api.admin.impersonate(userId, reason),
    onSuccess: (r) => {
      toast.success('Impersonatsiya sessiyasi yaratildi');
      if (r.action_link) window.open(r.action_link, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = threads.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support console</h1>
        <p className="text-sm text-muted-foreground">
          Barcha klinikalar murojaatlari — kategoriyalar, filtrlar va bir tugmali impersonatsiya.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            placeholder="Mavzu bo‘yicha qidirish…"
          />
        </div>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Barcha statuslar</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Barcha kategoriyalar</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
          <option value="">Barcha klinikalar</option>
          {(clinics.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={<MessageCircle className="h-8 w-8" />}
              title="Murojaatlar topilmadi"
              description="Filtrni o‘zgartiring yoki keyinroq qaytib tekshiring"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Mavzu</th>
                    <th className="px-4 py-2.5">Klinika</th>
                    <th className="px-4 py-2.5">Kategoriya</th>
                    <th className="px-4 py-2.5">Ustuvorlik</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Oxirgi yangilanish</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{t.subject}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{t.clinic?.name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <Badge variant="outline">{t.category ?? '-'}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <select
                          className="h-7 rounded border bg-background px-2 text-xs"
                          value={t.priority}
                          onChange={(e) => patchMut.mutate({ id: t.id, body: { priority: e.target.value } })}
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={t.status} />
                          <select
                            className="h-7 rounded border bg-background px-2 text-xs"
                            value={t.status}
                            onChange={(e) => patchMut.mutate({ id: t.id, body: { status: e.target.value } })}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {new Date(t.updated_at).toLocaleString('uz-UZ')}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setChatting({ id: t.id, subject: t.subject, clinic: t.clinic })
                            }
                          >
                            <MessageCircle className="mr-1 h-3 w-3" />
                            Chat
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={impersonate.isPending || !t.clinic_id}
                            onClick={async () => {
                              const reason = window.prompt(
                                `"${t.subject}" bo'yicha impersonatsiya sababi (kamida 10 ta belgi):`,
                              );
                              if (!reason) return;
                              if (reason.length < 10) {
                                toast.error('Sabab kamida 10 ta belgi bo‘lishi kerak');
                                return;
                              }
                              const clinicAdminId = window.prompt(
                                'Qaysi foydalanuvchi sifatida kirish kerak? (profile UUID)',
                              );
                              if (!clinicAdminId) return;
                              impersonate.mutate({ userId: clinicAdminId, reason });
                            }}
                          >
                            <Zap className="mr-1 h-3 w-3" />
                            Impersonate
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {chatting && (
        <SupportChatDialog thread={chatting} onClose={() => setChatting(null)} />
      )}
    </div>
  );
}

// Support chat — admin xabarlarni ko'radi va javob beradi.
function SupportChatDialog({
  thread,
  onClose,
}: {
  thread: ChatThread;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data: messages } = useQuery({
    queryKey: ['admin', 'support', thread.id, 'messages'],
    queryFn: () => api.admin.listSupportMessages(thread.id),
    refetchInterval: 10_000,
  });

  // Yangi xabar kelganda pastga skroll qilish.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  const sendMut = useMutation({
    mutationFn: () => api.admin.sendSupportMessage(thread.id, body.trim()),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['admin', 'support', thread.id, 'messages'] });
      qc.invalidateQueries({ queryKey: ['admin', 'support-threads'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = messages ?? [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[80vh] max-h-[700px] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{thread.subject}</DialogTitle>
          <p className="text-xs text-muted-foreground">{thread.clinic?.name ?? '—'}</p>
        </DialogHeader>

        <div className="flex-1 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3">
          {list.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Hali xabar yo'q
            </p>
          ) : (
            list.map((m) => {
              const isAdmin = m.sender_role === 'admin' || m.sender_role === 'super_admin';
              return (
                <div
                  key={m.id}
                  className={
                    'flex ' + (isAdmin ? 'justify-end' : 'justify-start')
                  }
                >
                  <div
                    className={
                      'max-w-[75%] rounded-lg px-3 py-2 text-sm ' +
                      (isAdmin
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background border')
                    }
                  >
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div
                      className={
                        'mt-1 text-[10px] ' +
                        (isAdmin ? 'opacity-80' : 'text-muted-foreground')
                      }
                    >
                      {isAdmin ? 'Admin' : m.sender_role} ·{' '}
                      {new Date(m.created_at).toLocaleString('uz-UZ', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Javob yozing... (Ctrl+Enter — yuborish)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) {
                e.preventDefault();
                sendMut.mutate();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Yopish
            </Button>
            <Button
              disabled={!body.trim() || sendMut.isPending}
              onClick={() => sendMut.mutate()}
            >
              <Send className="mr-1.5 h-4 w-4" />
              Yuborish
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
