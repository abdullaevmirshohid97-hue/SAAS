import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Banknote,
  Landmark,
  QrCode,
  Plus,
  Minus,
  Search,
  Trash2,
  UserPlus,
  Printer,
  CheckCircle2,
  Loader2,
  Stethoscope,
} from 'lucide-react';
import { toast } from 'sonner';

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
  EmptyState,
  Input,
  Kbd,
  PageHeader,
  Section,
  cn,
} from '@clary/ui-web';

import { QrPaymentDialog } from '@/components/reception/qr-payment-dialog';
import { ReferralsInbox } from '@/components/reception/referrals-inbox';
import { ShiftBar } from '@/components/reception/shift-bar';
import { api } from '@/lib/api';

interface Patient {
  id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  patronymic?: string | null;
  phone?: string | null;
  dob?: string | null;
  gender?: string | null;
  address?: string | null;
  referral_source?: string | null;
}

interface Service {
  id: string;
  name_i18n: Record<string, string>;
  price_uzs: number;
  duration_min: number;
  doctor_required: boolean;
  category_id?: string | null;
  sort_order: number;
}

interface Doctor {
  id: string;
  full_name: string;
  role: string;
}

interface CartItem {
  service: Service;
  quantity: number;
  discount_uzs: number;
}

const REFERRAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'google', label: 'Google' },
  { value: 'billboard', label: 'Reklama' },
  { value: 'word_of_mouth', label: 'Tanishlar' },
  { value: 'doctor', label: 'Shifokor tavsiyasi' },
  { value: 'returning', label: 'Qayta murojaat' },
  { value: 'other', label: 'Boshqa' },
];

const PAYMENT_METHODS: Array<{ value: string; label: string; icon: typeof Banknote; color: string }> = [
  { value: 'cash', label: 'Naqd', icon: Banknote, color: 'hsl(142 70% 45%)' },
  { value: 'card', label: 'Plastik', icon: CreditCard, color: 'hsl(221 83% 53%)' },
  { value: 'transfer', label: 'O\u2018tkazma', icon: Landmark, color: 'hsl(262 83% 58%)' },
  { value: 'click', label: 'Click QR', icon: QrCode, color: 'hsl(199 89% 48%)' },
  { value: 'payme', label: 'Payme QR', icon: QrCode, color: 'hsl(160 84% 39%)' },
];

function currency(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(Math.max(0, Math.round(n))) + ' so\u2018m';
}

function pickName(i18n: Record<string, string>): string {
  return i18n['uz-Latn'] ?? i18n.ru ?? Object.values(i18n)[0] ?? '';
}

export function ReceptionPage() {
  const qc = useQueryClient();
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paid, setPaid] = useState<string>('');
  const [debt, setDebt] = useState<string>('0');
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState<{
    ticket_no: string | null;
    total_uzs: number;
    transaction_id: string;
  } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrReference, setQrReference] = useState<string | null>(null);

  const { data: doctors } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => api.doctors.list(),
  });
  const { data: services } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.services.list(),
  });
  const { data: activeShift } = useQuery({
    queryKey: ['shifts', 'active'],
    queryFn: () => api.shifts.active(),
  });

  const total = useMemo(
    () => cart.reduce((sum, it) => sum + Math.max(0, it.service.price_uzs * it.quantity - it.discount_uzs), 0),
    [cart],
  );

  useEffect(() => {
    if (!paid) setPaid(String(total));
    else if (Number(paid) > total) setPaid(String(total));
    const nextDebt = Math.max(0, total - (Number(paid) || 0));
    setDebt(String(nextDebt));
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (ev.key === '+' || ev.key === '=') {
        ev.preventDefault();
        setCart((prev) => (prev.length ? prev.map((it, i) => (i === prev.length - 1 ? { ...it, quantity: it.quantity + 1 } : it)) : prev));
      } else if (ev.key === '-' || ev.key === '_') {
        ev.preventDefault();
        setCart((prev) =>
          prev.length
            ? prev
                .map((it, i) => (i === prev.length - 1 ? { ...it, quantity: Math.max(0, it.quantity - 1) } : it))
                .filter((it) => it.quantity > 0)
            : prev,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addToCart = (svc: Service) => {
    setCart((prev) => {
      const exist = prev.find((c) => c.service.id === svc.id);
      if (exist) {
        return prev.map((c) => (c.service.id === svc.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { service: svc, quantity: 1, discount_uzs: 0 }];
    });
  };

  const updateQty = (id: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((c) => (c.service.id === id ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c))
        .filter((c) => c.quantity > 0),
    );
  const removeItem = (id: string) => setCart((prev) => prev.filter((c) => c.service.id !== id));

  const checkoutMut = useMutation({
    mutationFn: async () => {
      if (!selectedPatient) throw new Error('Bemor tanlanmagan');
      if (cart.length === 0) throw new Error('Xizmat tanlanmagan');
      return api.reception.checkout({
        patient: { id: selectedPatient.id },
        doctor_id: doctorId,
        items: cart.map((c) => ({
          service_id: c.service.id,
          quantity: c.quantity,
          unit_price_uzs: c.service.price_uzs,
          discount_uzs: c.discount_uzs || 0,
        })),
        payment_method: paymentMethod,
        paid_amount_uzs: Number(paid) || 0,
        debt_uzs: Number(debt) || 0,
        notes: notes || undefined,
        add_to_queue: Boolean(doctorId),
        provider_reference: qrReference ?? undefined,
      });
    },
    onSuccess: (data) => {
      toast.success('Qabul yakunlandi');
      setReceipt({ ticket_no: data.ticket_no, total_uzs: data.total_uzs, transaction_id: data.transaction_id });
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['queues'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => {
    setCart([]);
    setSelectedPatient(null);
    setDoctorId(null);
    setPaid('');
    setDebt('0');
    setNotes('');
    setReceipt(null);
    setQrReference(null);
  };

  const handleCheckoutClick = () => {
    if (!selectedPatient || cart.length === 0) return;
    if ((paymentMethod === 'click' || paymentMethod === 'payme') && !qrReference) {
      setQrOpen(true);
      return;
    }
    checkoutMut.mutate();
  };

  const shiftOpen = Boolean(activeShift && (activeShift as { id?: string }).id);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Qabulxona"
        title="Bemor qabul qilish"
        description="Bemor ma'lumoti, xizmatlar, to\u2018lov va navbat — bitta oynada."
        actions={<ShiftBar />}
      />

      <ReferralsInbox
        onDirect={(ref) => {
          if (ref.patient) {
            setSelectedPatient({
              id: ref.patient.id,
              full_name: ref.patient.full_name,
              phone: ref.patient.phone ?? null,
            } as unknown as Patient);
          }
          const s = ref.service;
          if (s && typeof s.id === 'string') {
            const svc = (services as Service[] | undefined)?.find((x) => x.id === s.id);
            if (svc) addToCart(svc);
          }
        }}
      />

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT: Patient + Doctor + Services */}
        <div className="col-span-12 space-y-4 lg:col-span-8">
          <Section title="1. Bemor" padded>
            <PatientPicker
              selected={selectedPatient}
              onSelect={setSelectedPatient}
              onAddNew={() => setNewPatientOpen(true)}
            />
          </Section>

          <Section title="2. Shifokor (ixtiyoriy)" padded>
            <DoctorPicker doctors={(doctors as Doctor[] | undefined) ?? []} selected={doctorId} onChange={setDoctorId} />
          </Section>

          <Section
            title={
              <span className="flex items-center gap-2">
                <span>3. Xizmatlar</span>
                <span className="text-xs font-normal text-muted-foreground">
                  <Kbd>+</Kbd> / <Kbd>\u2212</Kbd> miqdorni o&lsquo;zgartiradi
                </span>
              </span>
            }
            padded
          >
            <ServicePicker services={(services as Service[] | undefined) ?? []} onAdd={addToCart} />
          </Section>
        </div>

        {/* RIGHT: Cart + Payment */}
        <aside className="col-span-12 space-y-4 lg:col-span-4">
          <Card className="sticky top-4">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Savatcha</h3>
                <Badge variant="outline">{cart.length} xizmat</Badge>
              </div>

              {cart.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Xizmatlarni tanlang
                </div>
              ) : (
                <div className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin pr-1">
                  {cart.map((c) => (
                    <div key={c.service.id} className="flex items-center gap-2 rounded-lg border bg-background/50 p-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{pickName(c.service.name_i18n)}</div>
                        <div className="text-xs text-muted-foreground">{currency(c.service.price_uzs)}</div>
                      </div>
                      <div className="flex items-center gap-1 rounded-md border bg-background">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateQty(c.service.id, -1)}>
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold">{c.quantity}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateQty(c.service.id, 1)}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(c.service.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg bg-muted/40 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Jami</span>
                  <span className="text-lg font-semibold">{currency(total)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">To&lsquo;lov usuli</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {PAYMENT_METHODS.map((pm) => (
                    <button
                      key={pm.value}
                      type="button"
                      onClick={() => setPaymentMethod(pm.value)}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-[11px] font-medium transition',
                        paymentMethod === pm.value ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                      )}
                      style={paymentMethod === pm.value ? { color: pm.color } : undefined}
                    >
                      <pm.icon className="h-4 w-4" />
                      <span>{pm.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">To&lsquo;langan</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={paid}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPaid(v);
                      setDebt(String(Math.max(0, total - (Number(v) || 0))));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Qarz</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={debt}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDebt(v);
                      setPaid(String(Math.max(0, total - (Number(v) || 0))));
                    }}
                    className={cn(Number(debt) > 0 && 'border-warning text-warning')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Izoh</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Masalan: ertaga kelishi aytildi" />
              </div>

              {!shiftOpen && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  Smena yopiq. Avval yuqoridan smenani oching.
                </div>
              )}

              <Button
                className="w-full gap-2"
                size="lg"
                disabled={!selectedPatient || cart.length === 0 || !shiftOpen || checkoutMut.isPending}
                onClick={handleCheckoutClick}
              >
                {checkoutMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (paymentMethod === 'click' || paymentMethod === 'payme') && !qrReference ? (
                  <QrCode className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {(paymentMethod === 'click' || paymentMethod === 'payme') && !qrReference
                  ? 'QR orqali to\u2018lov'
                  : 'Qabulni yakunlash'}
              </Button>
              {qrReference && (
                <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-2 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  QR to&lsquo;lov tasdiqlandi. Qabulni yakunlashingiz mumkin.
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {newPatientOpen && (
        <NewPatientDialog
          onClose={() => setNewPatientOpen(false)}
          onCreated={(p) => {
            setSelectedPatient(p);
            setNewPatientOpen(false);
            qc.invalidateQueries({ queryKey: ['patients'] });
          }}
        />
      )}

      {receipt && (
        <ReceiptDialog
          receipt={receipt}
          patientName={selectedPatient?.full_name ?? ''}
          onClose={resetForm}
        />
      )}

      <QrPaymentDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onSuccess={(ref) => {
          setQrReference(ref);
          setQrOpen(false);
          setTimeout(() => checkoutMut.mutate(), 200);
        }}
        provider={paymentMethod === 'payme' ? 'payme' : 'click'}
        amountUzs={Number(paid) || total}
        patientId={selectedPatient?.id}
        shiftId={(activeShift as { id?: string } | null)?.id ?? null}
      />
    </div>
  );
}

function PatientPicker({
  selected,
  onSelect,
  onAddNew,
}: {
  selected: Patient | null;
  onSelect: (p: Patient) => void;
  onAddNew: () => void;
}) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['patients', q],
    queryFn: () => api.patients.list({ q, page: 1, pageSize: 20 }),
    enabled: q.length > 1 || selected === null,
  });
  const items = (data as { items?: Patient[] } | undefined)?.items ?? [];

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border bg-primary/5 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {(selected.last_name?.[0] ?? selected.full_name[0] ?? '?').toUpperCase()}
          </div>
          <div>
            <div className="font-semibold">{selected.full_name}</div>
            <div className="text-xs text-muted-foreground">
              {selected.phone ?? '—'}
              {selected.dob && ` · ${selected.dob}`}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onSelect(null as never)}>
          O&lsquo;zgartirish
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Ism, familiya yoki telefon..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="outline" onClick={onAddNew} className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Yangi bemor
        </Button>
      </div>

      {q.length >= 2 && (
        <div className="max-h-64 overflow-y-auto rounded-lg border scrollbar-thin">
          {isFetching ? (
            <div className="p-4 text-sm text-muted-foreground">Qidirilmoqda…</div>
          ) : items.length === 0 ? (
            <EmptyState
              title="Bemor topilmadi"
              description="Yangi bemor yarating"
              action={<Button onClick={onAddNew}>Yangi bemor qo&lsquo;shish</Button>}
            />
          ) : (
            items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className="flex w-full items-center gap-3 border-b p-3 text-left last:border-0 hover:bg-accent"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {(p.last_name?.[0] ?? p.full_name[0] ?? '?').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.full_name}</div>
                  <div className="text-xs text-muted-foreground">{p.phone ?? '—'}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DoctorPicker({
  doctors,
  selected,
  onChange,
}: {
  doctors: Doctor[];
  selected: string | null;
  onChange: (id: string | null) => void;
}) {
  if (doctors.length === 0) {
    return <div className="text-sm text-muted-foreground">Shifokorlar ro&lsquo;yxati bo&lsquo;sh. Xodimlar sozlamalaridan qo&lsquo;shing.</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
          !selected ? 'border-primary bg-primary/10' : 'hover:bg-accent',
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">—</div>
        <span>Shifokorsiz</span>
      </button>
      {doctors.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onChange(d.id)}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
            selected === d.id ? 'border-primary bg-primary/10' : 'hover:bg-accent',
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Stethoscope className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{d.full_name}</div>
            <div className="text-[11px] text-muted-foreground">{d.role}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ServicePicker({ services, onAdd }: { services: Service[]; onAdd: (s: Service) => void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q) return services.slice(0, 30);
    const needle = q.toLowerCase();
    return services.filter((s) => Object.values(s.name_i18n).some((v) => v.toLowerCase().includes(needle))).slice(0, 60);
  }, [q, services]);

  if (services.length === 0) {
    return <div className="text-sm text-muted-foreground">Xizmatlar sozlamalardan qo&lsquo;shilmagan.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Xizmat nomini yozing..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onAdd(s)}
            className="flex flex-col rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:shadow-elevation-1"
          >
            <div className="line-clamp-2 text-sm font-medium">{pickName(s.name_i18n)}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-sm font-semibold text-primary">{currency(s.price_uzs)}</span>
              {s.doctor_required && <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NewPatientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Patient) => void }) {
  const [form, setForm] = useState({
    last_name: '',
    first_name: '',
    patronymic: '',
    phone: '',
    dob: '',
    gender: '' as '' | 'male' | 'female' | 'other',
    address: '',
    referral_source: '' as string,
    referral_notes: '',
  });

  const mut = useMutation({
    mutationFn: () =>
      api.patients.create({
        last_name: form.last_name,
        first_name: form.first_name,
        patronymic: form.patronymic || undefined,
        phone: form.phone || undefined,
        dob: form.dob || undefined,
        gender: form.gender || undefined,
        address: form.address || undefined,
        referral_source: form.referral_source || undefined,
        referral_notes: form.referral_notes || undefined,
      }),
    onSuccess: (p) => {
      toast.success('Bemor qo\u2018shildi');
      onCreated(p as Patient);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = form.first_name.length > 0 && form.last_name.length > 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Yangi bemor</DialogTitle>
          <DialogDescription>Bemorning asosiy ma&lsquo;lumotlarini kiriting.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Familiya *</label>
            <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Ism *</label>
            <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Otasining ismi</label>
            <Input value={form.patronymic} onChange={(e) => setForm({ ...form, patronymic: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Telefon</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998 ..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tug&lsquo;ilgan sana</label>
            <Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Jins</label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value as typeof form.gender })}
            >
              <option value="">Tanlang</option>
              <option value="male">Erkak</option>
              <option value="female">Ayol</option>
              <option value="other">Boshqa</option>
            </select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Manzil</label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Qayerdan eshitdi?</label>
            <div className="flex flex-wrap gap-1.5">
              {REFERRAL_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm({ ...form, referral_source: r.value })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition',
                    form.referral_source === r.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {(form.referral_source === 'doctor' || form.referral_source === 'other' || form.referral_source === 'word_of_mouth') && (
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Izoh (shifokor ismi yoki boshqa)</label>
              <Input value={form.referral_notes} onChange={(e) => setForm({ ...form, referral_notes: e.target.value })} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="gap-1.5">
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({
  receipt,
  patientName,
  onClose,
}: {
  receipt: { ticket_no: string | null; total_uzs: number; transaction_id: string };
  patientName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" /> Chek tayyor
          </DialogTitle>
          <DialogDescription>Bemorga chek berish va navbat raqamini ko&lsquo;rsating.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bemor</span>
            <span className="font-medium">{patientName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Jami</span>
            <span className="font-semibold">{currency(receipt.total_uzs)}</span>
          </div>
          {receipt.ticket_no && (
            <div className="rounded-lg bg-primary/10 p-3 text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Navbat raqami</div>
              <div className="mt-1 font-mono text-3xl font-bold text-primary">{receipt.ticket_no}</div>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Tranzaksiya ID: <span className="font-mono">{receipt.transaction_id.slice(0, 8)}</span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
            <Printer className="h-4 w-4" /> Chop etish
          </Button>
          <Button onClick={onClose}>Yangi qabul</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
