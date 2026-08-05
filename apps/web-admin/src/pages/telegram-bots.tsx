import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Label,
} from '@clary/ui-web';
import { Bot, Check, Crown, DatabaseBackup, ExternalLink, Power, PowerOff, X } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type TgTab = 'bots' | 'requests';

export function TelegramBotsPage() {
  const [tab, setTab] = useState<TgTab>('bots');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Telegram botlar</h1>
          <p className="text-muted-foreground text-sm">
            Klinika botlari va egalarning hisobot bot so‘rovlari.
          </p>
        </div>
        <AppBotSetupButton />
        <AdminBindButton />
        <BackupNowButton />
        <div className="bg-muted/30 inline-flex rounded-md border p-0.5">
          {(
            [
              { id: 'bots', label: 'Bemor botlari' },
              { id: 'requests', label: "Hisobot so'rovlari" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                'rounded-sm px-3 py-1.5 text-sm transition-colors ' +
                (tab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'bots' && <PatientBotsTab />}
      {tab === 'requests' && <OwnerRequestsTab />}
    </div>
  );
}

/**
 * Umumiy hisobot boti (@claryappbot) webhook'ini o'rnatadi — TELEGRAM_APP_BOT_TOKEN
 * qo'yilgandan keyin BIR MARTA bosiladi. Shundan keyin klinikalar o'z panelidan
 * kod olib botga ulana oladi.
 */
function AppBotSetupButton() {
  const mut = useMutation({
    mutationFn: () => api.admin.setupAppBot(),
    onSuccess: (r) => toast.success(`@${r.bot ?? 'bot'} yoqildi — klinikalar ulanishi mumkin`),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={mut.isPending}
      onClick={() => {
        if (
          window.confirm(
            'Bot webhook’i shu serverga yo‘naltiriladi.\n\n' +
              'DIQQAT: bir botda faqat BITTA webhook bo‘ladi — bu token boshqa oqimda ' +
              'ishlatilayotgan bo‘lsa, o‘sha oqim ishlamay qoladi.\n\nDavom etilsinmi?',
          )
        )
          mut.mutate();
      }}
    >
      <Bot className="h-4 w-4" />
      Hisobot botini yoqish
    </Button>
  );
}

/**
 * Super-admin sifatida botga ulanish. Ulangach har bir yangi ro'yxatdan o'tish
 * (landing formasi, demo, bot) darhol shu chatga tushadi.
 */
function AdminBindButton() {
  const mut = useMutation({
    mutationFn: () => api.admin.appAdminCode(),
    onSuccess: (r) => {
      if (r.deep_link) window.open(r.deep_link, '_blank');
      toast.success(`Kod: /start ${r.code} — 10 daqiqa amal qiladi`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={mut.isPending}
      onClick={() => mut.mutate()}
      title="Botga super-admin sifatida ulanish — yangi lidlar real vaqtda"
    >
      <Crown className="h-4 w-4" />
      Botga super-admin ulanish
    </Button>
  );
}

/**
 * Platforma backup'i har kuni 23:50 da avtomatik yuboriladi. Bu tugma — jadvalni
 * kutmasdan tekshirish uchun.
 */
function BackupNowButton() {
  const mut = useMutation({
    mutationFn: () => api.admin.sendPlatformBackup(),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Backup yuborildi — ${r.day} (${r.files} fayl)`)
        : toast.error('Leads bot tokeni/chat ID sozlanmagan'),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={mut.isPending}
      onClick={() => mut.mutate()}
    >
      <DatabaseBackup className="h-4 w-4" />
      Backup’ni hozir yuborish
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Bemor botlari (mavjud funksionallik)
// ---------------------------------------------------------------------------
function PatientBotsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'telegram-bots'],
    queryFn: () => api.admin.listTelegramBots(),
  });
  const bots = data ?? [];

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.admin.toggleTelegramBot(id, isActive),
    onSuccess: () => {
      toast.success('Holat yangilandi');
      qc.invalidateQueries({ queryKey: ['admin', 'telegram-bots'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b text-left">
            <tr>
              <th className="p-3">Klinika</th>
              <th className="p-3">Bot</th>
              <th className="p-3">Ro‘yxatdan o‘tilgan</th>
              <th className="p-3">Holat</th>
              <th className="p-3 text-right">Amal</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground p-8 text-center text-sm">
                  Yuklanmoqda…
                </td>
              </tr>
            ) : bots.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground p-8 text-center text-sm">
                  <Bot className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Hech bir klinika hali Telegram bot ro‘yxatdan o‘tkazmagan
                </td>
              </tr>
            ) : (
              bots.map((b) => (
                <tr key={b.id} className="hover:bg-accent/50 border-b last:border-0">
                  <td className="p-3 font-medium">{b.clinic?.name ?? '—'}</td>
                  <td className="p-3">
                    <a
                      href={`https://t.me/${b.bot_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 font-mono text-sm hover:underline"
                    >
                      @{b.bot_username}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="text-muted-foreground p-3 text-xs">
                    {new Date(b.registered_at).toLocaleString('uz-UZ')}
                  </td>
                  <td className="p-3">
                    {b.is_active ? (
                      <Badge variant="success">Faol</Badge>
                    ) : (
                      <Badge variant="destructive">O‘chirilgan</Badge>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={toggleMut.isPending}
                      onClick={() => toggleMut.mutate({ id: b.id, isActive: !b.is_active })}
                    >
                      {b.is_active ? (
                        <>
                          <PowerOff className="h-3.5 w-3.5" />
                          O‘chirish
                        </>
                      ) : (
                        <>
                          <Power className="h-3.5 w-3.5" />
                          Yoqish
                        </>
                      )}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Hisobot bot so'rovlari — markaziy botdan kelgan ega ro'yxat so'rovlari.
// Tasdiqlash: ixtiyoriy klinikaga biriktirish, keyin BotFather'da bot yaratib
// tokenni klinikaga berish kerak (ko'rsatma dialogda).
// ---------------------------------------------------------------------------
type OwnerRequest = Awaited<ReturnType<typeof api.admin.listOwnerRequests>>[number];

function OwnerRequestsTab() {
  const qc = useQueryClient();
  const [approving, setApproving] = useState<OwnerRequest | null>(null);

  const { data } = useQuery({
    queryKey: ['admin', 'owner-requests'],
    queryFn: () => api.admin.listOwnerRequests(),
  });
  const items = data ?? [];

  const rejectMut = useMutation({
    mutationFn: (id: string) => api.admin.rejectOwnerRequest(id),
    onSuccess: () => {
      toast.success('Rad etildi — egaga bot orqali xabar ketdi');
      qc.invalidateQueries({ queryKey: ['admin', 'owner-requests'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setupMut = useMutation({
    mutationFn: () => api.admin.setupCentralBot(),
    onSuccess: (d) => toast.success(`Markaziy bot webhook o'rnatildi: @${d.bot ?? ''}`),
    onError: (e: Error) => toast.error(e.message),
  });

  const statusBadge = (s: string) =>
    s === 'pending' ? (
      <Badge variant="warning">Kutilmoqda</Badge>
    ) : s === 'approved' ? (
      <Badge variant="success">Tasdiqlangan</Badge>
    ) : (
      <Badge variant="destructive">Rad etilgan</Badge>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Egalar markaziy bot (@ClaryHisobotBot) orqali ro‘yxatdan o‘tadi. Tasdiqlagach BotFather’da
          klinika uchun bot yaratib, tokenni klinikaga bering.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setupMut.mutate()}
          disabled={setupMut.isPending}
        >
          Markaziy bot webhook o‘rnatish
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="p-3">Ega</th>
                <th className="p-3">Klinika nomi</th>
                <th className="p-3">Telefon</th>
                <th className="p-3">Sana</th>
                <th className="p-3">Holat</th>
                <th className="p-3 text-right">Amal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="font-medium">{r.full_name ?? '—'}</div>
                    {r.telegram_username && (
                      <a
                        href={`https://t.me/${r.telegram_username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary text-xs hover:underline"
                      >
                        @{r.telegram_username}
                      </a>
                    )}
                  </td>
                  <td className="p-3">{r.clinic_name ?? '—'}</td>
                  <td className="p-3 text-xs">{r.phone ?? '—'}</td>
                  <td className="text-muted-foreground p-3 text-xs">
                    {new Date(r.created_at).toLocaleString('uz-UZ', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="p-3">{statusBadge(r.status)}</td>
                  <td className="p-3 text-right">
                    {r.status === 'pending' && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => setApproving(r)}>
                          <Check className="mr-1 h-3.5 w-3.5" /> Tasdiqlash
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-rose-600"
                          disabled={rejectMut.isPending}
                          onClick={() => rejectMut.mutate(r.id)}
                        >
                          <X className="mr-1 h-3.5 w-3.5" /> Rad
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground p-8 text-center text-sm">
                    So‘rovlar yo‘q
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {approving && (
        <ApproveDialog
          request={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            qc.invalidateQueries({ queryKey: ['admin', 'owner-requests'] });
          }}
        />
      )}
    </div>
  );
}

function ApproveDialog({
  request,
  onClose,
  onDone,
}: {
  request: OwnerRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const [clinicId, setClinicId] = useState('');
  const { data: tenants } = useQuery({
    queryKey: ['tenants', { q: '', includeDeleted: false }],
    queryFn: () => api.admin.listTenants({}),
  });

  const approveMut = useMutation({
    mutationFn: () => api.admin.approveOwnerRequest(request.id, clinicId || undefined),
    onSuccess: () => {
      toast.success('Tasdiqlandi — egaga bot orqali xabar ketdi');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>So‘rovni tasdiqlash</DialogTitle>
          <DialogDescription>
            {request.full_name ?? '—'} · {request.clinic_name ?? '—'} · {request.phone ?? '—'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Klinikaga biriktirish (ixtiyoriy)</Label>
            <select
              value={clinicId}
              onChange={(e) => setClinicId(e.target.value)}
              className="bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="">— Tanlanmagan —</option>
              {(tenants ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            Tasdiqlagandan keyin: @BotFather’da klinika uchun yangi bot yarating (masalan{' '}
            <span className="font-mono">klinika_hisobot_bot</span>) va token + username’ni klinikaga
            bering — ular Sozlamalar → Integratsiyalar → Hisobot bot bo‘limiga kiritadi.
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button disabled={approveMut.isPending} onClick={() => approveMut.mutate()}>
            {approveMut.isPending ? 'Tasdiqlanmoqda…' : 'Tasdiqlash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
