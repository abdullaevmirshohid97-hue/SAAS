import { useEffect, useMemo, useRef, useState } from 'react';

import { usePersistedState } from '@/hooks/use-persisted-state';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  AlertCircle,
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
  X,
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
import { ReceptionJournal } from '@/pages/journal';
import { api } from '@/lib/api';
import {
  paymentReceiptHtml,
  printReceiptHybrid,
  setReceiptSettingsCache,
  type ReceiptSettings,
} from '@/lib/print-receipt';

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
  position?: string;
}

const POSITION_LABELS_UZ: Record<string, string> = {
  doctor: 'Shifokor',
  nurse: 'Hamshira',
  administrator: 'Administrator',
  pharmacist: 'Dorixonachi',
  lab_tech: 'Lab xodimi',
  manager: 'Menejer',
  cleaner: 'Farrosh',
  clinic_admin: 'Administrator',
  clinic_owner: 'Klinika egasi',
};

function labelForPosition(p: string): string {
  return POSITION_LABELS_UZ[p] ?? p;
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
  // To'liq qarz \u2014 bemor hozir to'lamaydi, butun summa qarzga yoziladi
  { value: 'debt', label: 'Qarz', icon: AlertCircle, color: 'hsl(0 84% 60%)' },
];

function currency(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(Math.max(0, Math.round(n))) + ' so\u2018m';
}

function pickName(i18n: Record<string, string>): string {
  return i18n['uz-Latn'] ?? i18n.ru ?? Object.values(i18n)[0] ?? '';
}

const RECEPTION_DRAFT_KEY = 'clary.receptionDraft.v1';

export function ReceptionPage() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api.get<{
        clinic?: { name?: string; receipt_settings?: Partial<ReceiptSettings> };
      }>('/api/v1/auth/me'),
  });
  const clinicName = (me as { clinic?: { name?: string } } | undefined)?.clinic?.name ?? 'Klinika';

  // me kelganda chek printer sozlamalarini localStorage'ga cache qilamiz —
  // print qilish paytida darhol o'qish uchun.
  useEffect(() => {
    const settings = (me as { clinic?: { receipt_settings?: Partial<ReceiptSettings> } } | undefined)
      ?.clinic?.receipt_settings;
    if (settings) setReceiptSettingsCache(settings);
  }, [me]);
  const [selectedPatient, setSelectedPatient, clearPatient] = usePersistedState<Patient | null>(
    `${RECEPTION_DRAFT_KEY}.patient`,
    null,
  );
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [doctorId, setDoctorId, clearDoctor] = usePersistedState<string | null>(
    `${RECEPTION_DRAFT_KEY}.doctor`,
    null,
  );
  const [cart, setCart, clearCart] = usePersistedState<CartItem[]>(
    `${RECEPTION_DRAFT_KEY}.cart`,
    [],
  );
  const [paymentMethod, setPaymentMethod, clearPm] = usePersistedState<string>(
    `${RECEPTION_DRAFT_KEY}.paymentMethod`,
    'cash',
  );
  const [paid, setPaid, clearPaid] = usePersistedState<string>(
    `${RECEPTION_DRAFT_KEY}.paid`,
    '',
  );
  const [debt, setDebt, clearDebt] = usePersistedState<string>(
    `${RECEPTION_DRAFT_KEY}.debt`,
    '0',
  );
  const [notes, setNotes, clearNotes] = usePersistedState<string>(
    `${RECEPTION_DRAFT_KEY}.notes`,
    '',
  );
  const [receipt, setReceipt] = useState<{
    ticket_no: string | null;
    total_uzs: number;
    transaction_id: string;
    paid_uzs: number;
    debt_uzs: number;
    payment_method: string;
    items: Array<{ name: string; qty: number; amount: number }>;
    doctor_name?: string | null;
    doctor_specialty?: string | null;
    cashier_name?: string | null;
  } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrReference, setQrReference] = useState<string | null>(null);
  // Qabulni yakunlash tasdiq oynasi (chek bilan / cheksiz / ortga)
  const [confirmCheckoutOpen, setConfirmCheckoutOpen] = useState(false);
  // Cheksiz yakunlanganda chek oynasi ko'rsatilmaydi — to'g'ridan reset
  const skipReceiptRef = useRef(false);
  // Sprint 2D: bemorning ochiq appointmentini topib, "yangi" yoki "qo'shish"
  const [existingApptId, setExistingApptId] = useState<string | null>(null);

  // Bemor o'zgarsa default tanlov: HAR DOIM "yangi qabul" (existingApptId=null).
  // Foydalanuvchi xohlasa qo'lda "qo'shish" radio'sini bosadi.
  // Avval default "qo'shish" edi va qabulxonachilar bilmasdan eski appointment'ga
  // to'lov qo'shib yuborardi → yangi navbat qo'shilmasdi (kritik bug).
  useEffect(() => {
    setExistingApptId(null);
  }, [selectedPatient?.id]);

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

  // Savatchada ko'rsatish uchun tanlangan shifokor
  const selectedDoctor = useMemo(
    () => ((doctors as Doctor[] | undefined) ?? []).find((d) => d.id === doctorId) ?? null,
    [doctors, doctorId],
  );

  useEffect(() => {
    if (!paid) setPaid(String(total));
    else if (Number(paid) > total) setPaid(String(total));
    const nextDebt = Math.max(0, total - (Number(paid) || 0));
    setDebt(String(nextDebt));
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Qarz" to'lov turi tanlansa — to'liq summa qarzga, paid 0
  useEffect(() => {
    if (paymentMethod === 'debt') {
      setPaid('0');
      setDebt(String(total));
    }
  }, [paymentMethod, total]); // eslint-disable-line react-hooks/exhaustive-deps

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
        add_to_queue: Boolean(doctorId) && !existingApptId,
        provider_reference: qrReference ?? undefined,
        existing_appointment_id: existingApptId ?? undefined,
      });
    },
    onSuccess: (data) => {
      toast.success('Qabul yakunlandi');
      // Cheksiz yakunlash — chek oynasini ko'rsatmasdan formani tozalaymiz
      if (skipReceiptRef.current) {
        skipReceiptRef.current = false;
        qc.invalidateQueries({ queryKey: ['patients'] });
        qc.invalidateQueries({ queryKey: ['queues'] });
        resetForm();
        return;
      }
      setReceipt({
        ticket_no: data.ticket_no,
        total_uzs: data.total_uzs,
        transaction_id: data.transaction_id,
        paid_uzs: data.paid_uzs ?? (Number(paid) || 0),
        debt_uzs: data.debt_uzs ?? (Number(debt) || 0),
        payment_method: paymentMethod,
        items: cart.map((c) => ({
          name: pickName(c.service.name_i18n),
          qty: c.quantity,
          amount: Math.max(0, c.service.price_uzs * c.quantity - c.discount_uzs),
        })),
        doctor_name: data.doctor_name,
        doctor_specialty: data.doctor_specialty,
        cashier_name: data.cashier_name,
      });
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
    setExistingApptId(null);
    clearCart();
    clearPatient();
    clearDoctor();
    clearPaid();
    clearDebt();
    clearNotes();
    clearPm();
    setQrReference(null);
  };

  const handleCheckoutClick = () => {
    if (!selectedPatient || cart.length === 0) return;
    if ((paymentMethod === 'click' || paymentMethod === 'payme') && !qrReference) {
      setQrOpen(true);
      return;
    }
    // To'g'ridan yakunlamaymiz — avval tasdiq oynasini ochamiz
    setConfirmCheckoutOpen(true);
  };

  // Tasdiq oynasidan chaqiriladi: chek bilan (false) yoki cheksiz (true)
  const confirmCheckout = (skipReceipt: boolean) => {
    skipReceiptRef.current = skipReceipt;
    setConfirmCheckoutOpen(false);
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
            {/* Ochiq appointment ("yangi qabul / qayta ko'ruv") tanlovi olib
                tashlandi — har doim yangi qabul yaratiladi (existingApptId=null). */}
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

              {/* Tanlangan shifokor — savatchada ko'rinib turadi */}
              {selectedDoctor && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <Stethoscope className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{selectedDoctor.full_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {POSITION_LABELS_UZ[selectedDoctor.position ?? ''] ?? 'Shifokor'}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground"
                    title="Shifokorni bekor qilish"
                    onClick={() => setDoctorId(null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

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
                  <div className="flex gap-1">
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
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 whitespace-nowrap text-xs"
                      title="Jami summa to'liq to'lov sifatida kiritish"
                      onClick={() => {
                        setPaid(String(total));
                        setDebt('0');
                      }}
                      disabled={total === 0}
                    >
                      = Jami
                    </Button>
                  </div>
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

      {/* Pastda — to'liq jurnal (Moliya): bugungi kassa/dorixona/statsionar/qabul */}
      <ReceptionJournal />

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

      {/* Qabulni yakunlash tasdiq oynasi — chek bilan / cheksiz / ortga.
          Ortga yoki X bosilganda forma (bemor/shifokor/xizmatlar) saqlanadi. */}
      <Dialog open={confirmCheckoutOpen} onOpenChange={(o) => !o && setConfirmCheckoutOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Qabulni yakunlash
            </DialogTitle>
            <DialogDescription>
              {selectedPatient?.full_name ? <><b>{selectedPatient.full_name}</b> — </> : null}
              {cart.length} ta xizmat, jami <b>{currency(total)}</b>.
              Yakunlash usulini tanlang.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            <Button
              size="lg"
              className="w-full justify-start gap-2"
              disabled={checkoutMut.isPending}
              onClick={() => confirmCheckout(false)}
            >
              <Printer className="h-4 w-4" />
              Chek bilan yakunlash
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={checkoutMut.isPending}
              onClick={() => confirmCheckout(true)}
            >
              <CheckCircle2 className="h-4 w-4" />
              Cheksiz yakunlash
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCheckoutOpen(false)}>
              Ortga
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {receipt && (
        <ReceiptDialog
          receipt={receipt}
          patientName={selectedPatient?.full_name ?? ''}
          clinicName={clinicName}
          onClose={resetForm}
        />
      )}

      <QrPaymentDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onSuccess={(ref) => {
          setQrReference(ref);
          setQrOpen(false);
          // QR tasdiqlangach ham yakunlash usulini (chek/cheksiz) so'raymiz
          setTimeout(() => setConfirmCheckoutOpen(true), 200);
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
            <div className="text-[11px] text-muted-foreground">
              {d.position ? labelForPosition(d.position) : d.role}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// Xizmat tanlash hisoblagichi (eng ko'p ishlatilgan saralash uchun)
const SERVICE_USAGE_KEY = 'reception_service_usage';
function bumpServiceUsage(serviceId: string) {
  try {
    const raw = localStorage.getItem(SERVICE_USAGE_KEY);
    const usage = (raw ? JSON.parse(raw) : {}) as Record<string, number>;
    usage[serviceId] = (usage[serviceId] ?? 0) + 1;
    localStorage.setItem(SERVICE_USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* ignore */
  }
}
function readServiceUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SERVICE_USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

type SortMode = 'popular' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

function ServicePicker({ services, onAdd }: { services: Service[]; onAdd: (s: Service) => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortMode>('popular');
  const [usage, setUsage] = useState<Record<string, number>>(() => readServiceUsage());

  const filtered = useMemo(() => {
    let list = services;
    if (q) {
      const needle = q.toLowerCase();
      list = services.filter((s) =>
        Object.values(s.name_i18n).some((v) => v.toLowerCase().includes(needle)),
      );
    }
    const sorted = [...list];
    if (sort === 'popular') {
      sorted.sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0));
    } else if (sort === 'name-asc') {
      sorted.sort((a, b) => pickName(a.name_i18n).localeCompare(pickName(b.name_i18n)));
    } else if (sort === 'name-desc') {
      sorted.sort((a, b) => pickName(b.name_i18n).localeCompare(pickName(a.name_i18n)));
    } else if (sort === 'price-asc') {
      sorted.sort((a, b) => a.price_uzs - b.price_uzs);
    } else if (sort === 'price-desc') {
      sorted.sort((a, b) => b.price_uzs - a.price_uzs);
    }
    return sorted.slice(0, q ? 60 : 30);
  }, [q, services, sort, usage]);

  const handleAdd = (s: Service) => {
    bumpServiceUsage(s.id);
    setUsage((u) => ({ ...u, [s.id]: (u[s.id] ?? 0) + 1 }));
    onAdd(s);
  };

  if (services.length === 0) {
    return <div className="text-sm text-muted-foreground">Xizmatlar sozlamalardan qo&lsquo;shilmagan.</div>;
  }

  const SORT_LABELS: Record<SortMode, string> = {
    popular: '🔥 Eng ko‘p',
    'name-asc': 'A → Z',
    'name-desc': 'Z → A',
    'price-asc': 'Arzon',
    'price-desc': 'Qimmat',
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Xizmat nomini yozing..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="inline-flex flex-wrap gap-0.5 rounded-md border bg-muted/30 p-0.5">
          {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSort(m)}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium transition',
                sort === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {SORT_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {filtered.map((s) => {
          const count = usage[s.id] ?? 0;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleAdd(s)}
              className="relative flex flex-col rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:shadow-elevation-1"
            >
              {sort === 'popular' && count > 0 && (
                <span className="absolute right-1 top-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  {count}
                </span>
              )}
              <div className="line-clamp-2 text-sm font-medium">{pickName(s.name_i18n)}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-primary">{currency(s.price_uzs)}</span>
                {s.doctor_required && <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
            </button>
          );
        })}
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
  clinicName,
  onClose,
}: {
  receipt: {
    ticket_no: string | null;
    total_uzs: number;
    transaction_id: string;
    paid_uzs: number;
    debt_uzs: number;
    payment_method: string;
    items: Array<{ name: string; qty: number; amount: number }>;
    doctor_name?: string | null;
    doctor_specialty?: string | null;
    cashier_name?: string | null;
  };
  patientName: string;
  clinicName: string;
  onClose: () => void;
}) {
  // Qog'oz kengligi va boshqa sozlamalar Sozlamalar > Chek printer'dan keladi.
  // Bu yerda dialog so'ramaydi — "Chop etish" bir bosishda darhol chiqaradi.
  function handlePrint() {
    const dateStr = new Date().toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const fallbackHtml = paymentReceiptHtml({
      clinicName,
      ticketNo: receipt.ticket_no,
      date: dateStr,
      patientName,
      items: receipt.items,
      totalUzs: receipt.total_uzs,
      paidUzs: receipt.paid_uzs,
      debtUzs: receipt.debt_uzs,
      paymentMethod: receipt.payment_method,
      transactionId: receipt.transaction_id,
      doctorName: receipt.doctor_name ?? null,
      doctorSpecialty: receipt.doctor_specialty ?? null,
      cashierName: receipt.cashier_name ?? null,
    });
    // LAN printer sozlangan bo'lsa silent print, aks holda brauzer dialog
    void printReceiptHybrid(
      {
        header: clinicName,
        title: "TO'LOV CHEKI",
        lines: [
          { text: `Sana: ${dateStr}` },
          { text: `Bemor: ${patientName || '—'}` },
          ...(receipt.ticket_no ? [{ text: `Navbat: ${receipt.ticket_no}`, bold: true }] : []),
        ],
        items: receipt.items.map((i) => ({ name: i.name, qty: i.qty, amount: i.amount })),
        total_uzs: receipt.total_uzs,
        paid_uzs: receipt.paid_uzs,
        debt_uzs: receipt.debt_uzs > 0 ? receipt.debt_uzs : undefined,
        footer: "Rahmat! Sog'ligingizga shifo tilaymiz!",
        cut: true,
      },
      fallbackHtml,
      'receipt',
    );
  }

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
          {receipt.debt_uzs > 0 && (
            <div className="flex justify-between text-rose-600">
              <span>Qarz</span>
              <span className="font-semibold">{currency(receipt.debt_uzs)}</span>
            </div>
          )}
          {receipt.ticket_no && (
            <div className="rounded-lg bg-primary/10 p-3 text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Navbat raqami</div>
              <div className="mt-1 font-mono text-3xl font-bold text-primary">{receipt.ticket_no}</div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" /> Chop etish
          </Button>
          <Button onClick={onClose}>Yangi qabul</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
