import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, FlaskConical, Pill, Receipt, Bed, KeyRound, Copy, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  PageHeader,
  StatCard,
  Card,
  CardContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  EmptyState,
  DataTable,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { PatientTimeline, type TimelineEvent } from '@/components/patient/patient-timeline';

// =============================================================================
// Bemor profili — /patient/:id. Bitta sahifada bemor tarixi: tashriflar,
// tahlillar, retseptlar, to'lovlar, statsionar. patients.timeline endpoint'idan.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function fmtDate(v: unknown): string {
  if (!v || typeof v !== 'string') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'short', day: 'numeric' });
}

function calcAge(dob: string | null): string {
  if (!dob) return '—';
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '—';
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  return `${age} yosh`;
}

export function PatientProfilePage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['patient-profile', id],
    queryFn: () => api.patients.timeline(id!),
    enabled: !!id,
  });

  const patient = data?.patient;
  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title={patient?.full_name ?? 'Bemor'}
        description={
          patient
            ? `${calcAge(patient.dob)} · ${patient.gender === 'male' ? 'Erkak' : patient.gender === 'female' ? 'Ayol' : '—'} · ${patient.phone ?? '—'}`
            : 'Yuklanmoqda…'
        }
        breadcrumbs={[
          { label: 'Bemorlar', href: '/reception' },
          { label: patient?.full_name ?? 'Bemor' },
        ]}
        actions={
          <Link
            to="/reception"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" /> Orqaga
          </Link>
        }
      />

      {/* Summary KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Tashriflar"
          value={String(summary?.visits ?? 0)}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <StatCard
          label="Tahlillar"
          value={String(summary?.lab_orders ?? 0)}
          icon={<FlaskConical className="h-4 w-4" />}
        />
        <StatCard
          label="Retseptlar"
          value={String(summary?.prescriptions ?? 0)}
          icon={<Pill className="h-4 w-4" />}
        />
        <StatCard
          label="Statsionar"
          value={String(summary?.stays ?? 0)}
          icon={<Bed className="h-4 w-4" />}
        />
        <StatCard
          label="Jami to'lov"
          value={`${fmt(summary?.total_spent_uzs ?? 0)} so'm`}
          icon={<Receipt className="h-4 w-4" />}
          tone="success"
        />
      </div>

      {id && <PatientLoginCard patientId={id} />}

      <Card>
        <CardContent className="p-4">
          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">⭐ Timeline</TabsTrigger>
              <TabsTrigger value="visits">Tashriflar</TabsTrigger>
              <TabsTrigger value="labs">Tahlillar</TabsTrigger>
              <TabsTrigger value="prescriptions">Retseptlar</TabsTrigger>
              <TabsTrigger value="payments">To'lovlar</TabsTrigger>
              <TabsTrigger value="inpatient">Statsionar</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline">
              {isLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />)}
                </div>
              ) : (
                <PatientTimeline events={(data?.events ?? []) as TimelineEvent[]} />
              )}
            </TabsContent>

            <TabsContent value="visits">
              <DataTable
                isLoading={isLoading}
                rows={data?.appointments ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Tashrif yo'q" description="Bemorda tashrif yozuvi yo'q" />}
                columns={[
                  {
                    key: 'scheduled_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).scheduled_at),
                  },
                  {
                    key: 'service_name_snapshot',
                    header: 'Xizmat',
                    render: (r) => String((r as Record<string, unknown>).service_name_snapshot ?? '—'),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="labs">
              <DataTable
                isLoading={isLoading}
                rows={data?.lab_orders ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Tahlil yo'q" description="Bemorda tahlil buyurtmasi yo'q" />}
                columns={[
                  {
                    key: 'created_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).created_at),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                  {
                    key: 'total_uzs',
                    header: 'Summa',
                    align: 'right',
                    render: (r) =>
                      `${fmt(Number((r as Record<string, unknown>).total_uzs ?? 0))} so'm`,
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="prescriptions">
              <DataTable
                isLoading={isLoading}
                rows={data?.prescriptions ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Retsept yo'q" description="Bemorda retsept yozuvi yo'q" />}
                columns={[
                  {
                    key: 'created_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).created_at),
                  },
                  {
                    key: 'rx_number',
                    header: 'Retsept №',
                    render: (r) => String((r as Record<string, unknown>).rx_number ?? '—'),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="payments">
              <DataTable
                isLoading={isLoading}
                rows={data?.transactions ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="To'lov yo'q" description="Bemorda to'lov yozuvi yo'q" />}
                columns={[
                  {
                    key: 'created_at',
                    header: 'Sana',
                    render: (r) => fmtDate((r as Record<string, unknown>).created_at),
                  },
                  {
                    key: 'kind',
                    header: 'Turi',
                    render: (r) => String((r as Record<string, unknown>).kind ?? '—'),
                  },
                  {
                    key: 'amount_uzs',
                    header: 'Summa',
                    align: 'right',
                    render: (r) =>
                      `${fmt(Number((r as Record<string, unknown>).amount_uzs ?? 0))} so'm`,
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="inpatient">
              <DataTable
                isLoading={isLoading}
                rows={data?.inpatient_stays ?? []}
                rowKey={(r) => String((r as { id?: string }).id ?? Math.random())}
                emptyState={<EmptyState title="Statsionar yo'q" description="Bemorda statsionar yozuvi yo'q" />}
                columns={[
                  {
                    key: 'admitted_at',
                    header: 'Yotqizilgan',
                    render: (r) => fmtDate((r as Record<string, unknown>).admitted_at),
                  },
                  {
                    key: 'discharged_at',
                    header: 'Chiqarilgan',
                    render: (r) => fmtDate((r as Record<string, unknown>).discharged_at),
                  },
                  {
                    key: 'status',
                    header: 'Holat',
                    render: (r) => (
                      <Badge variant="secondary">
                        {String((r as Record<string, unknown>).status ?? '—')}
                      </Badge>
                    ),
                  },
                ]}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bemor uchun umumiy Clary bot login akkaunti — bemorga username/parol
// yaratish/yangilash/o'chirish.
// ---------------------------------------------------------------------------
function PatientLoginCard({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const login = useQuery({
    queryKey: ['patient-login', patientId],
    queryFn: () => api.patients.getLogin(patientId),
  });
  const [open, setOpen] = useState<false | 'create' | 'reset'>(false);

  const deleteMut = useMutation({
    mutationFn: () => api.patients.deleteLogin(patientId),
    onSuccess: () => {
      toast.success("Login akkaunt o'chirildi");
      qc.invalidateQueries({ queryKey: ['patient-login', patientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const row = login.data;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-blue-100 p-2 text-blue-700">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Telegram bot kirishi</div>
              <div className="text-xs text-muted-foreground">
                Bemor @ClaryAppBot orqali kirib, klinikangizdan ma'lumotlarni ko'rishi mumkin
              </div>
              {row ? (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Username:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{row.username}</code>
                  <Badge variant={row.is_active ? 'success' : 'destructive'}>
                    {row.is_active ? 'Faol' : 'Nofaol'}
                  </Badge>
                  {row.last_login_at && (
                    <span className="text-[11px] text-muted-foreground">
                      Oxirgi kirish: {fmtDate(row.last_login_at)}
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-xs italic text-muted-foreground">Akkaunt yaratilmagan</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {row ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setOpen('reset')}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Parolni yangilash
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (window.confirm("Login akkauntni o'chirishni tasdiqlaysizmi?")) deleteMut.mutate();
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  O'chirish
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setOpen('create')}>
                Akkaunt yaratish
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      {open && (
        <PatientLoginDialog
          patientId={patientId}
          mode={open}
          existingUsername={row?.username}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ['patient-login', patientId] });
          }}
        />
      )}
    </Card>
  );
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

function PatientLoginDialog({
  patientId,
  mode,
  existingUsername,
  onClose,
  onSaved,
}: {
  patientId: string;
  mode: 'create' | 'reset';
  existingUsername?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(existingUsername ?? '');
  const [password, setPassword] = useState(generatePassword());

  const mut = useMutation({
    mutationFn: () => {
      if (mode === 'create') return api.patients.createLogin(patientId, { username, password });
      return api.patients.resetLoginPassword(patientId, password);
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? 'Akkaunt yaratildi' : 'Parol yangilandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyAll = async () => {
    const text = `Username: ${username}\nParol: ${password}\nBot: @ClaryAppBot`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Nusxalandi — bemorga yuboring');
    } catch {
      toast.error('Nusxalashda xato');
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Yangi login akkaunt' : 'Parolni yangilash'}</DialogTitle>
          <DialogDescription>
            Bemor @ClaryAppBot ga ushbu ma'lumotlar bilan kirishi mumkin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="masalan: alisher2026"
              />
              <p className="text-[11px] text-muted-foreground">
                Faqat lotin harflari, raqamlar va _ . - ruxsat. 3-60 belgi.
              </p>
            </div>
          )}
          {mode === 'reset' && existingUsername && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              Username: <code className="font-mono">{existingUsername}</code>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Parol</Label>
            <div className="flex gap-1.5">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={() => setPassword(generatePassword())}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              ⚠ Parolni hozir ko'chirib oling — keyin u faqat shifrlangan holda saqlanadi.
            </p>
          </div>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="outline" type="button" onClick={copyAll}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Nusxalash
          </Button>
          <div className="flex gap-1.5">
            <Button variant="ghost" onClick={onClose}>
              Bekor
            </Button>
            <Button
              disabled={(mode === 'create' && !username) || !password || mut.isPending}
              onClick={() => mut.mutate()}
            >
              Saqlash
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
