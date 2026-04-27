import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@clary/ui-web';
import {
  Bell,
  CheckCircle2,
  Clock3,
  Loader2,
  MonitorPlay,
  PhoneIncoming,
  Printer,
  SkipForward,
  Stethoscope,
  UserCheck,
  UserPlus,
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

type Doctor = { id: string; full_name: string; role: string; phone?: string };
type Service = { id: string; name_i18n: Record<string, string>; price_uzs: number };

type ReceiptData = {
  ticketNo: string;
  doctorName: string;
  doctorRole: string;
  patientName: string;
  serviceName: string;
  clinicName: string;
  date: string;
  time: string;
};

const STATUS_COLUMNS: Array<{ key: QueueRow['status']; title: string; icon: typeof Clock3; tone: string }> = [
  { key: 'waiting', title: 'Kutmoqda', icon: Clock3, tone: 'text-warning' },
  { key: 'called', title: 'Chaqirildi', icon: Bell, tone: 'text-primary' },
  { key: 'serving', title: 'Qabulda', icon: Stethoscope, tone: 'text-success' },
  { key: 'served', title: 'Yakunlangan', icon: CheckCircle2, tone: 'text-muted-foreground' },
];

const GENDER_LABELS: Record<string, string> = { male: 'Erkak', female: 'Ayol' };
const ROLE_LABELS: Record<string, string> = {
  doctor: 'Shifokor',
  clinic_admin: 'Bosh shifokor',
  clinic_owner: 'Klinika mudiri',
};

export function QueuePage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [doctorFilter, setDoctorFilter] = useState<string>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
  });

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

  const clinicName = (me as { clinic?: { name?: string } } | undefined)?.clinic?.name ?? 'Klinika';

  return (
    <div className="space-y-5">
      {/* Print styles — faqat chek ko'rinadi */}
      <style>{`
        @media print {
          body > *:not(#queue-receipt-root) { display: none !important; }
          #queue-receipt-root { display: block !important; }
        }
      `}</style>

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
              {((doctors as Doctor[]) ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            Navbat qo&lsquo;shish
          </Button>
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
          description="Qabulxonadan bemor qo'shilishini kuting yoki navbat qo'shish tugmasini bosing."
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

      <AddQueueDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        doctors={(doctors as Doctor[]) ?? []}
        clinicName={clinicName}
        onSuccess={(r) => {
          setShowAdd(false);
          setReceipt(r);
          qc.invalidateQueries({ queryKey: ['queue-kanban'] });
          toast.success(`Navbat qo'shildi: ${r.ticketNo}`);
        }}
      />

      {receipt && (
        <ReceiptModal
          data={receipt}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}

// ─── Add Queue Dialog ────────────────────────────────────────────────────────

function AddQueueDialog({
  open,
  onClose,
  doctors,
  clinicName,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  doctors: Doctor[];
  clinicName: string;
  onSuccess: (r: ReceiptData) => void;
}) {
  const [step, setStep] = useState(0);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [patient, setPatient] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    age: '',
    gender: 'male',
  });

  const { data: services } = useQuery({
    queryKey: ['services-list'],
    queryFn: () => api.services.list(),
    enabled: open,
  });

  const checkoutMut = useMutation({
    mutationFn: () => {
      const year = new Date().getFullYear();
      const age = parseInt(patient.age, 10);
      const dob = age > 0 ? `${year - age}-01-01` : undefined;

      return api.reception.checkout({
        patient: {
          first_name: patient.firstName.trim(),
          last_name: patient.lastName.trim(),
          phone: patient.phone.trim() || undefined,
          dob,
          gender: patient.gender,
        },
        doctor_id: selectedDoctor?.id ?? null,
        items: selectedService
          ? [{ service_id: selectedService.id, quantity: 1, unit_price_uzs: 0, discount_uzs: 0 }]
          : [],
        payment_method: 'cash',
        paid_amount_uzs: 0,
        debt_uzs: 0,
        add_to_queue: true,
      });
    },
    onSuccess: (res) => {
      const now = new Date();
      onSuccess({
        ticketNo: res.ticket_no ?? `Q-${Date.now()}`,
        doctorName: selectedDoctor?.full_name ?? '—',
        doctorRole: ROLE_LABELS[selectedDoctor?.role ?? ''] ?? 'Shifokor',
        patientName: `${patient.lastName} ${patient.firstName}`.trim(),
        serviceName: selectedService ? (selectedService.name_i18n['uz-Latn'] ?? selectedService.name_i18n['ru'] ?? 'Xizmat') : '—',
        clinicName,
        date: now.toLocaleDateString('uz-Latn'),
        time: now.toLocaleTimeString('uz-Latn', { hour: '2-digit', minute: '2-digit' }),
      });
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetForm() {
    setStep(0);
    setSelectedDoctor(null);
    setSelectedService(null);
    setPatient({ firstName: '', lastName: '', phone: '', age: '', gender: 'male' });
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  const steps = ['Shifokor', 'Xizmat', 'Bemor'];
  const canNext =
    step === 0 ? !!selectedDoctor :
    step === 1 ? true : // xizmat ixtiyoriy
    patient.firstName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Navbat qo&lsquo;shish</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-2 mb-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                i < step ? 'bg-success text-white' :
                i === step ? 'bg-primary text-white' :
                'bg-muted text-muted-foreground'
              )}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={cn('text-sm', i === step ? 'font-semibold' : 'text-muted-foreground')}>{s}</span>
              {i < steps.length - 1 && <div className="h-px w-4 bg-border" />}
            </div>
          ))}
        </div>

        {/* Step 0: Shifokor */}
        {step === 0 && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {doctors.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">Shifokorlar topilmadi</div>
            )}
            {doctors.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedDoctor(d)}
                className={cn(
                  'w-full rounded-lg border px-4 py-3 text-left transition',
                  selectedDoctor?.id === d.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-accent',
                )}
              >
                <div className="font-semibold">{d.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {ROLE_LABELS[d.role] ?? 'Shifokor'}
                  {d.phone ? ` • ${d.phone}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 1: Xizmat */}
        {step === 1 && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            <button
              type="button"
              onClick={() => setSelectedService(null)}
              className={cn(
                'w-full rounded-lg border px-4 py-3 text-left transition',
                selectedService === null ? 'border-primary bg-primary/5' : 'hover:bg-accent',
              )}
            >
              <div className="font-semibold">Xizmatsiz (oddiy qabul)</div>
            </button>
            {((services as Service[]) ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedService(s)}
                className={cn(
                  'w-full rounded-lg border px-4 py-3 text-left transition',
                  selectedService?.id === s.id ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <div className="font-semibold">
                  {s.name_i18n['uz-Latn'] ?? s.name_i18n['ru'] ?? 'Xizmat'}
                </div>
                {s.price_uzs > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {s.price_uzs.toLocaleString()} so&lsquo;m
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Bemor */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Familiya *</div>
                <Input
                  value={patient.lastName}
                  onChange={(e) => setPatient({ ...patient, lastName: e.target.value })}
                  placeholder="Aliyev"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Ism *</div>
                <Input
                  value={patient.firstName}
                  onChange={(e) => setPatient({ ...patient, firstName: e.target.value })}
                  placeholder="Sardor"
                />
              </label>
            </div>
            <label className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Telefon raqam</div>
              <Input
                value={patient.phone}
                onChange={(e) => setPatient({ ...patient, phone: e.target.value })}
                placeholder="+998 90 123 45 67"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Yoshi</div>
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={patient.age}
                  onChange={(e) => setPatient({ ...patient, age: e.target.value })}
                  placeholder="35"
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Jins</div>
                <Select value={patient.gender} onValueChange={(v) => setPatient({ ...patient, gender: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Erkak</SelectItem>
                    <SelectItem value="female">Ayol</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Orqaga
            </Button>
          )}
          <Button variant="ghost" onClick={handleClose}>Bekor</Button>
          {step < steps.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
              Keyingi
            </Button>
          ) : (
            <Button
              onClick={() => checkoutMut.mutate()}
              disabled={!canNext || checkoutMut.isPending}
            >
              {checkoutMut.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-1.5 h-4 w-4" />
              )}
              Navbat qo&lsquo;shish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Receipt Modal ───────────────────────────────────────────────────────────

function ReceiptModal({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  function handlePrint() {
    const w = window.open('', '_blank', 'width=320,height=480');
    if (!w) return;
    w.document.write(`
      <html><head><title>Navbat cheki</title>
      <style>
        body { font-family: monospace; font-size: 13px; margin: 0; padding: 16px; width: 280px; }
        .center { text-align: center; }
        .big { font-size: 28px; font-weight: 900; }
        .line { border-top: 1px dashed #000; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; margin: 3px 0; }
        .label { color: #555; }
      </style></head><body>
      <div class="center"><strong>${data.clinicName}</strong></div>
      <div class="line"></div>
      <div class="center big">${data.ticketNo}</div>
      <div class="center" style="font-size:11px; color:#555">NAVBAT RAQAMI</div>
      <div class="line"></div>
      <div class="row"><span class="label">Sana:</span><span>${data.date}</span></div>
      <div class="row"><span class="label">Vaqt:</span><span>${data.time}</span></div>
      <div class="line"></div>
      <div class="row"><span class="label">Bemor:</span><span>${data.patientName || '—'}</span></div>
      <div class="line"></div>
      <div class="row"><span class="label">Shifokor:</span><span>${data.doctorName}</span></div>
      <div class="row"><span class="label">Soha:</span><span>${data.doctorRole}</span></div>
      ${data.serviceName !== '—' ? `<div class="row"><span class="label">Xizmat:</span><span>${data.serviceName}</span></div>` : ''}
      <div class="line"></div>
      <div class="center" style="font-size:11px; color:#555">Sog'liqingizga shifo tilaymiz!</div>
      </body></html>
    `);
    w.document.close();
    w.print();
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Navbat cheki</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border border-dashed p-4 font-mono text-sm space-y-1 bg-muted/30">
          <div className="text-center font-bold">{data.clinicName}</div>
          <div className="border-t border-dashed my-2" />
          <div className="text-center text-4xl font-black tracking-wider text-primary">{data.ticketNo}</div>
          <div className="text-center text-xs text-muted-foreground">NAVBAT RAQAMI</div>
          <div className="border-t border-dashed my-2" />
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Sana:</span><span>{data.date}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Vaqt:</span><span>{data.time}</span></div>
          <div className="border-t border-dashed my-2" />
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Bemor:</span><span>{data.patientName || '—'}</span></div>
          <div className="border-t border-dashed my-2" />
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Shifokor:</span><span>{data.doctorName}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Soha:</span><span>{data.doctorRole}</span></div>
          {data.serviceName !== '—' && (
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Xizmat:</span><span>{data.serviceName}</span></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Yopish</Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-1.5 h-4 w-4" />
            Chop etish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Queue Card ──────────────────────────────────────────────────────────────

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
          <div className="truncate text-sm font-medium">{row.patient?.full_name ?? 'Noma’lum'}</div>
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
