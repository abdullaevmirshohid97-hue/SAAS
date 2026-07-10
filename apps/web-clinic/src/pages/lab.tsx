import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Beaker,
  ChevronRight,
  Coins,
  FileText,
  FlaskConical,
  Loader2,
  Plus,
  Printer,
  ScanLine,
  Search,
  Send,
  TestTube,
  Trash2,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { PatientPicker } from '@/components/reception/patient-picker';
import { printLabel, labSampleLabelHtml, LAB_LABEL_SIZE } from '@/lib/labels';
import { PAYMENT_METHODS, methodLabel } from '@/components/cashier/payment-split-editor';
import { QRCodeCanvas } from 'qrcode.react';

// Bemor portali — QR skaner qilinganda public natija shu yerda ochiladi.
const PATIENT_PORTAL_URL =
  (import.meta.env.VITE_PATIENT_URL as string | undefined) ?? 'https://patient.clary.uz';

type LabOrder = {
  id: string;
  status:
    | 'pending'
    | 'collected'
    | 'running'
    | 'completed'
    | 'reported'
    | 'delivered'
    | 'canceled';
  urgency: 'routine' | 'urgent' | 'stat';
  total_uzs: number;
  created_at: string;
  patient?: { id: string; full_name: string; phone?: string | null } | null;
  items?: Array<{
    id: string;
    name_snapshot: string;
    status: string;
    results?: Array<{ id: string; value: string; is_final: boolean; is_abnormal: boolean }>;
  }>;
};

type LabKanban = { date: string; by_status: Record<string, LabOrder[]> };

const COLUMNS: Array<{ id: LabOrder['status']; label: string; color: string }> = [
  { id: 'pending', label: 'Kutilmoqda', color: 'bg-slate-500' },
  { id: 'collected', label: 'Qabul qilindi', color: 'bg-sky-500' },
  { id: 'running', label: 'Jarayonda', color: 'bg-amber-500' },
  { id: 'completed', label: 'Tugallangan', color: 'bg-violet-500' },
  { id: 'reported', label: 'Yuborildi', color: 'bg-emerald-500' },
  { id: 'delivered', label: 'Topshirildi', color: 'bg-zinc-500' },
];

const URGENCY: Record<LabOrder['urgency'], string> = {
  routine: 'Oddiy',
  urgent: 'Shoshilinch',
  stat: 'CITO',
};

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

export function LabPage() {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [newOpen, setNewOpen] = useState(false);
  const [drawer, setDrawer] = useState<LabOrder | null>(null);
  const [tab, setTab] = useState('sale');

  const { data, isLoading } = useQuery({
    queryKey: ['lab-kanban', date],
    queryFn: () => api.lab.kanban(date),
    refetchInterval: 8_000,
  });
  const kanban = data as LabKanban | undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Laboratoriya"
        description="Mustaqil modul — sotuv, navbat, jurnal, kassa"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sale">Sotuv</TabsTrigger>
          <TabsTrigger value="queue">Navbat / Ish stoli</TabsTrigger>
          <TabsTrigger value="journal">Jurnal</TabsTrigger>
          <TabsTrigger value="cashier">Kassa</TabsTrigger>
        </TabsList>

        {/* SOTUV — mustaqil POS (bemor + kategoriya + savat + to'lov) */}
        <TabsContent value="sale" className="mt-4">
          <LabSalePanel />
        </TabsContent>

        {/* NAVBAT / ISH STOLI — kanban + natija kiritish (OrderDrawer) */}
        <TabsContent value="queue" className="mt-4 space-y-4">
          <div className="flex items-center justify-end gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Yangi tahlil
            </Button>
          </div>
          <LabDashboardStrip />
          {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-6">
          {COLUMNS.map((col) => {
            const rows = (kanban?.by_status[col.id] ?? []) as LabOrder[];
            return (
              <Card key={col.id} className="flex flex-col">
                <CardHeader className="py-3">
                  <CardTitle className="flex items-center justify-between text-xs font-medium uppercase tracking-wide">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${col.color}`} />
                      {col.label}
                    </span>
                    <span className="text-muted-foreground">{rows.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex min-h-[200px] flex-col gap-2 p-2">
                  {rows.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                      —
                    </div>
                  ) : (
                    rows.map((row) => (
                      <button
                        key={row.id}
                        onClick={() => setDrawer(row)}
                        className="rounded-md border bg-card p-2 text-left shadow-elevation-1 transition hover:shadow-elevation-2"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          <UserRound className="h-3 w-3" />
                          <span className="truncate">{row.patient?.full_name ?? 'Mijoz'}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {row.items?.length ?? 0} ta tahlil · {fmt(row.total_uzs)} UZS
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <Badge
                            variant={
                              row.urgency === 'stat'
                                ? 'destructive'
                                : row.urgency === 'urgent'
                                ? 'warning'
                                : 'secondary'
                            }
                          >
                            {URGENCY[row.urgency]}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(row.created_at).toLocaleTimeString('uz-UZ', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
        </TabsContent>

        {/* JURNAL — lab sotuvlar tarixi (o'z jurnali) */}
        <TabsContent value="journal" className="mt-4">
          <LabJournalPanel onOpen={setDrawer} />
        </TabsContent>

        {/* KASSA — lab daromadi + qarzdorlar (o'z kassasi) */}
        <TabsContent value="cashier" className="mt-4">
          <LabCashierPanel />
        </TabsContent>
      </Tabs>

      <NewOrderDialog open={newOpen} onOpenChange={setNewOpen} />
      {drawer && <OrderDrawer orderId={drawer.id} onClose={() => setDrawer(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAZA 3 — realtime dashboard kartalari
// ---------------------------------------------------------------------------
function LabDashboardStrip() {
  const { data } = useQuery({
    queryKey: ['lab-dashboard'],
    queryFn: () => api.lab.dashboard(),
    refetchInterval: 15_000,
  });
  if (!data) return null;

  const cards: Array<{ label: string; value: number | string; tone: string }> = [
    { label: 'Kutilmoqda', value: data.pending ?? 0, tone: 'text-slate-600' },
    { label: 'Jarayonda', value: data.running ?? 0, tone: 'text-amber-600' },
    { label: 'Shoshilinch', value: data.urgent ?? 0, tone: 'text-red-600' },
    { label: 'Shifokor kutmoqda', value: data.doctor_waiting ?? 0, tone: 'text-violet-600' },
    { label: 'Bugun tugatildi', value: data.completed_today ?? 0, tone: 'text-emerald-600' },
    {
      label: 'O‘rt. turnaround',
      value: `${Math.round(Number(data.avg_turnaround_min ?? 0))} daq`,
      tone: 'text-sky-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border bg-card p-3">
          <div className="text-[11px] text-muted-foreground">{c.label}</div>
          <div className={'text-xl font-semibold ' + c.tone}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New order dialog
// ---------------------------------------------------------------------------
const LAB_STATUS_LABEL: Record<string, string> = {
  pending: 'Kutilmoqda',
  collected: 'Namuna olindi',
  running: 'Jarayonda',
  completed: 'Tugallandi',
  reported: 'Tayyor',
  delivered: 'Topshirildi',
  canceled: 'Bekor',
};

type LabJournalRow = LabOrder & {
  payment_method?: string | null;
  debt_uzs?: number;
  paid_uzs?: number;
};

// Lab JURNAL — barcha lab sotuvlar tarixi (lab'ning O'Z jurnali, umumiy jurnal
// EMAS). Bemor ismi bo'yicha server-side qidiruv. Qatorga bosilsa OrderDrawer
// (ko'rish / natija / PDF / QR).
function LabJournalPanel({ onOpen }: { onOpen: (row: LabOrder) => void }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const { data, isLoading } = useQuery({
    queryKey: ['lab-journal', term],
    queryFn: () => api.lab.list(term ? { q: term } : undefined),
  });
  const rows = (data as LabJournalRow[] | undefined) ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Bemor ismi bo'yicha qidirish…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-sm"
          />
        </div>
        <div className="max-h-[65vh] space-y-1.5 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {term ? 'Topilmadi' : 'Hozircha lab sotuv yo‘q'}
            </div>
          ) : (
            rows.map((o) => (
              <button
                key={o.id}
                onClick={() => onOpen(o)}
                className="flex w-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-left transition hover:shadow-elevation-1"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <UserRound className="h-3.5 w-3.5" />
                    <span className="truncate">{o.patient?.full_name ?? 'Mijoz'}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    № {o.id.slice(0, 8).toUpperCase()} · {o.items?.length ?? 0} ta ·{' '}
                    {new Date(o.created_at).toLocaleDateString('uz-UZ')} · {methodLabel(o.payment_method)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-semibold tabular-nums">{fmt(o.total_uzs)}</div>
                  {Number(o.debt_uzs ?? 0) > 0 && (
                    <div className="text-[11px] text-rose-600">qarz {fmt(Number(o.debt_uzs))}</div>
                  )}
                  <Badge variant={o.status === 'delivered' ? 'secondary' : 'outline'} className="mt-0.5">
                    {LAB_STATUS_LABEL[o.status] ?? o.status}
                  </Badge>
                </div>
              </button>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lab SOTUV (POS) + KASSA — mustaqil, umumiy kassa/jurnalga tegmaydi.
// ---------------------------------------------------------------------------
type LabTestRow = {
  id: string;
  code: string | null;
  name_i18n: Record<string, string>;
  price_uzs: number;
  unit: string | null;
  category_id: string | null;
};
type LabCatRow = { id: string; name_i18n: Record<string, string> };

const nameOf = (n: Record<string, string>) =>
  n['uz-Latn'] ?? n['uz'] ?? n['ru'] ?? n['en'] ?? Object.values(n)[0] ?? '—';

function Row2({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={'font-mono tabular-nums ' + (strong ? 'text-base font-bold text-emerald-700' : 'font-semibold')}>
        {value}
      </span>
    </div>
  );
}

// Bemor (majburiy) → kategoriya → test (qidiruv/scroll) → savat → to'lov.
function LabSalePanel() {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Array<{ id: string; name: string; price: number }>>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [discount, setDiscount] = useState(0);
  const [debt, setDebt] = useState(0);

  const { data: catsRes } = useQuery({
    queryKey: ['lab-cats'],
    queryFn: () => api.catalog.list('lab-test-categories', { pageSize: 100 }),
  });
  const { data: testsRes, isLoading } = useQuery({
    queryKey: ['lab-tests-sale', q],
    queryFn: () => api.catalog.list('lab-tests', { pageSize: 300, q: q || undefined }),
  });
  const cats = (catsRes?.items ?? []) as LabCatRow[];
  const tests = (testsRes?.items ?? []) as LabTestRow[];
  const filtered = cat === 'all' ? tests : tests.filter((t) => t.category_id === cat);

  const total = cart.reduce((a, c) => a + c.price, 0);
  const net = Math.max(0, total - discount);
  const paid = Math.max(0, net - debt);

  const add = (t: LabTestRow) =>
    setCart((prev) =>
      prev.some((c) => c.id === t.id)
        ? prev
        : [...prev, { id: t.id, name: nameOf(t.name_i18n), price: Number(t.price_uzs) }],
    );
  const removeItem = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  const sellMut = useMutation({
    mutationFn: () =>
      api.lab.create({
        patient_id: patientId as string,
        test_ids: cart.map((c) => c.id),
        payment_method: paymentMethod,
        discount_uzs: discount || undefined,
        paid_uzs: paid,
        debt_uzs: debt || undefined,
      }),
    onSuccess: () => {
      toast.success('Lab sotuv amalga oshirildi — navbatga qo‘shildi');
      setCart([]);
      setDiscount(0);
      setDebt(0);
      setPatientId(null);
      setPatientLabel('');
      qc.invalidateQueries({ queryKey: ['lab-kanban'] });
      qc.invalidateQueries({ queryKey: ['lab-journal'] });
      qc.invalidateQueries({ queryKey: ['lab-revenue'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* Chap — bemor + kategoriya + testlar */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Bemor *</div>
            <PatientPicker
              value={patientId}
              label={patientLabel}
              onChange={(id, label) => {
                setPatientId(id);
                setPatientLabel(label);
              }}
              placeholder="Bemorni qidiring yoki yangi qo‘shing…"
            />
          </div>

          {/* Kategoriya tablari */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCat('all')}
              className={
                'rounded-full border px-3 py-1 text-xs ' +
                (cat === 'all' ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/40')
              }
            >
              Barchasi
            </button>
            {cats.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={
                  'rounded-full border px-3 py-1 text-xs ' +
                  (cat === c.id ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/40')
                }
              >
                {nameOf(c.name_i18n)}
              </button>
            ))}
          </div>

          {/* Qidiruv */}
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Tahlil nomi bo'yicha qidirish…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {/* Testlar ro'yxati (scroll) */}
          <div className="max-h-[52vh] space-y-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Tahlil topilmadi. Sozlamalar &gt; Laboratoriya tahlillari&apos;da qo‘shing.
              </div>
            ) : (
              filtered.map((t) => {
                const inCart = cart.some((c) => c.id === t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => add(t)}
                    disabled={inCart}
                    className={
                      'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition ' +
                      (inCart ? 'border-emerald-300 bg-emerald-50' : 'hover:bg-muted/40')
                    }
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{nameOf(t.name_i18n)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {t.code ? `${t.code} · ` : ''}
                        {t.unit ?? ''}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-xs tabular-nums">{fmt(Number(t.price_uzs))}</div>
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* O'ng — savat + to'lov */}
      <Card className="h-fit">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-1.5 font-semibold">
            <TestTube className="h-4 w-4 text-primary" /> Savat ({cart.length})
          </div>
          <div className="max-h-[38vh] space-y-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">Tahlil tanlanmagan</div>
            ) : (
              cart.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs tabular-nums">{fmt(c.price)}</span>
                    <button onClick={() => removeItem(c.id)} className="text-rose-500 hover:text-rose-700">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2 border-t pt-2">
            <Row2 label="Jami" value={fmt(total)} />
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Chegirma</span>
              <Input
                type="number"
                value={discount || ''}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                className="h-8 w-28 text-right font-mono"
                placeholder="0"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Qarz</span>
              <Input
                type="number"
                value={debt || ''}
                onChange={(e) => setDebt(Math.max(0, Number(e.target.value) || 0))}
                className="h-8 w-28 text-right font-mono"
                placeholder="0"
              />
            </label>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">To&apos;lov usuli</span>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.v} value={m.v}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Row2 label="To'lanadi" value={fmt(paid)} strong />
          </div>

          <Button
            className="w-full gap-1"
            disabled={!patientId || cart.length === 0 || sellMut.isPending}
            onClick={() => sellMut.mutate()}
          >
            <Wallet className="h-4 w-4" />
            {sellMut.isPending ? 'Saqlanmoqda…' : `Sotish — ${fmt(paid)} so'm`}
          </Button>
          {!patientId && cart.length > 0 && (
            <div className="text-center text-[11px] text-rose-600">Avval bemorni tanlang</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Lab KASSA — lab'ning o'z daromadi (umumiy kassaga TEGMAYDI).
function LabCashierPanel() {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data: rev } = useQuery({
    queryKey: ['lab-revenue', from, to],
    queryFn: () => api.lab.revenue({ from, to }),
  });
  const { data: debtorsData } = useQuery({
    queryKey: ['lab-debtors'],
    queryFn: () => api.lab.debtors(),
  });
  const debtors = (debtorsData as LabJournalRow[] | undefined) ?? [];
  const byMethod = rev?.by_method ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-muted-foreground">—</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">To&apos;langan (davr)</div>
            <div className="mt-1 text-xl font-bold text-emerald-700">{fmt(rev?.total_paid_uzs ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Qarz</div>
            <div className="mt-1 text-xl font-bold text-rose-600">{fmt(rev?.total_debt_uzs ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Sotuvlar</div>
            <div className="mt-1 text-xl font-bold">{rev?.count ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Coins className="h-4 w-4 text-primary" /> To&apos;lov usuli bo&apos;yicha
          </div>
          {Object.keys(byMethod).length === 0 ? (
            <div className="text-xs text-muted-foreground">Ma&apos;lumot yo&apos;q</div>
          ) : (
            Object.entries(byMethod).map(([m, v]) => (
              <div key={m} className="flex items-center justify-between text-sm">
                <span>{methodLabel(m)}</span>
                <span className="font-mono font-semibold tabular-nums">{fmt(Number(v))}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Wallet className="h-4 w-4 text-rose-600" /> Qarzdorlar ({debtors.length})
          </div>
          {debtors.length === 0 ? (
            <div className="text-xs text-muted-foreground">Qarzdor yo&apos;q</div>
          ) : (
            debtors.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {d.patient?.full_name ?? 'Mijoz'} · {new Date(d.created_at).toLocaleDateString('uz-UZ')}
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums text-rose-600">
                  {fmt(Number(d.debt_uzs ?? 0))}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [notes, setNotes] = useState('');
  const [testSearch, setTestSearch] = useState('');
  const [selectedTests, setSelectedTests] = useState<Array<{ id: string; name: string; price: number }>>([]);
  const [notifySms, setNotifySms] = useState(true);

  const { data: labTestsResp } = useQuery({
    queryKey: ['catalog', 'lab-tests'],
    queryFn: () =>
      api.get<{
        items: Array<{
          id: string;
          name_i18n: Record<string, string>;
          price_uzs: number;
        }>;
        total: number;
      }>('/api/v1/catalog/lab-tests?pageSize=500'),
    enabled: open,
  });

  const filtered = useMemo(() => {
    const list = labTestsResp?.items ?? [];
    if (!testSearch.trim()) return list.slice(0, 30);
    const q = testSearch.trim().toLowerCase();
    return list
      .filter((t) =>
        Object.values(t.name_i18n ?? {})
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 30);
  }, [labTestsResp, testSearch]);

  // FAZA 1 — panellar
  const { data: panels } = useQuery({
    queryKey: ['lab-panels'],
    queryFn: () => api.lab.panels(),
    enabled: open,
  });

  // FAZA 1 — ICD-10 bo'yicha tavsiya etilgan analizlar
  const [icd10, setIcd10] = useState('');
  const { data: recommendations } = useQuery({
    queryKey: ['lab-recommend', icd10],
    queryFn: () => api.lab.recommend(icd10),
    enabled: open && icd10.trim().length >= 2,
  });

  const labTestName = (t: { name_i18n: Record<string, string> }) =>
    t.name_i18n['uz-Latn'] ?? t.name_i18n['uz'] ?? t.name_i18n['en'] ?? 'Test';

  // Bir testni tanlangan ro'yxatga qo'shadi (takror qo'shmaydi)
  const addTest = (id: string, name: string, price: number) => {
    setSelectedTests((prev) =>
      prev.some((x) => x.id === id) ? prev : [...prev, { id, name, price }],
    );
  };

  // Panelni qo'llaydi — barcha testlarini tanlangan ro'yxatga qo'shadi
  const applyPanel = (panel: NonNullable<typeof panels>[number]) => {
    let added = 0;
    for (const it of panel.items) {
      if (!it.test) continue;
      addTest(it.test.id, labTestName(it.test), Number(it.test.price_uzs));
      added += 1;
    }
    toast.success(
      `«${panel.name_i18n['uz-Latn'] ?? panel.code}» — ${added} ta analiz qo‘shildi`,
    );
  };

  const total = selectedTests.reduce((s, t) => s + t.price, 0);

  const mut = useMutation({
    mutationFn: () => {
      if (!patientId) throw new Error('Mijoz tanlang');
      if (selectedTests.length === 0) throw new Error('Kamida bitta tahlil tanlang');
      return api.lab.create({
        patient_id: patientId,
        test_ids: selectedTests.map((t) => t.id),
        urgency,
        clinical_notes: notes || undefined,
        notify_sms: notifySms,
      });
    },
    onSuccess: () => {
      toast.success(
        `Tahlil buyurtmasi yaratildi${notifySms ? ' • SMS yuboriladi' : ''}`,
      );
      qc.invalidateQueries({ queryKey: ['lab-kanban'] });
      setPatientId(null);
      setPatientLabel('');
      setSelectedTests([]);
      setNotes('');
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(e.message ?? 'Xatolik: buyurtma yaratilmadi');
    },
  });

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      // dialog yopilganda state'ni tozalaymiz, qayta ochilganda eski draft qolmaydi
      setPatientId(null);
      setPatientLabel('');
      setSelectedTests([]);
      setNotes('');
      setTestSearch('');
      setUrgency('routine');
      setIcd10('');
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Yangi tahlil buyurtma</DialogTitle>
          <DialogDescription>Mijoz, tahlil va favqulodlik darajasini tanlang.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Mijoz</label>
              <PatientPicker
                value={patientId}
                label={patientLabel}
                onChange={(id, label) => {
                  setPatientId(id);
                  setPatientLabel(label);
                }}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Favqulodlik</label>
              <div className="flex gap-1.5">
                {(['routine', 'urgent', 'stat'] as const).map((u) => (
                  <Button
                    key={u}
                    type="button"
                    size="sm"
                    variant={urgency === u ? 'default' : 'outline'}
                    onClick={() => setUrgency(u)}
                  >
                    {URGENCY[u]}
                  </Button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notifySms}
                onChange={(e) => setNotifySms(e.target.checked)}
              />
              Natija tayyor bo‘lganda mijozga SMS yuborilsin
            </label>

            <div>
              <label className="mb-1 block text-xs font-medium">Klinik izoh</label>
              <Input
                placeholder="Izoh (shart emas)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            {/* FAZA 1 — panellar (bir klikda ko'p analiz) */}
            {(panels ?? []).length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Panellar — bir klikda
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(panels ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPanel(p)}
                      className="rounded-full border bg-card px-2.5 py-0.5 text-xs hover:border-primary hover:bg-primary/5"
                      title={p.description ?? undefined}
                    >
                      {p.name_i18n['uz-Latn'] ?? p.name_i18n['uz'] ?? p.code}
                      <span className="ml-1 text-muted-foreground">
                        ({p.items.length})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* FAZA 1 — ICD-10 bo'yicha tavsiya etilgan analizlar */}
            <div>
              <label className="mb-1 block text-xs font-medium">
                ICD-10 tashxis bo‘yicha tavsiya
              </label>
              <Input
                placeholder="Tashxis kodi (masalan E11.9)…"
                value={icd10}
                onChange={(e) => setIcd10(e.target.value.toUpperCase())}
              />
              {(recommendations ?? []).length > 0 && (
                <div className="mt-1.5 space-y-1 rounded border p-2">
                  <div className="text-[11px] text-muted-foreground">
                    Tavsiya etilgan analizlar:
                  </div>
                  {(recommendations ?? []).map((r) => (
                    <button
                      key={r.loinc_code}
                      type="button"
                      disabled={!r.available}
                      onClick={() =>
                        r.available &&
                        r.test_id &&
                        addTest(r.test_id, r.name, Number(r.price_uzs ?? 0))
                      }
                      className={
                        'flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs ' +
                        (r.available
                          ? 'hover:bg-primary/10'
                          : 'cursor-not-allowed opacity-50')
                      }
                      title={r.rationale ?? undefined}
                    >
                      <span className="truncate">
                        {r.name}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                          {r.loinc_code}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {r.available ? '+ qo‘shish' : 'klinikada yo‘q'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className="block text-xs font-medium">Tahlillar</label>
            <Input
              placeholder="Tahlil qidirish…"
              value={testSearch}
              onChange={(e) => setTestSearch(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto divide-y rounded border">
              {filtered.map((t) => {
                const name = t.name_i18n['uz-Latn'] ?? t.name_i18n['uz'] ?? t.name_i18n['en'] ?? 'Test';
                const picked = selectedTests.some((x) => x.id === t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setSelectedTests((prev) =>
                        picked
                          ? prev.filter((x) => x.id !== t.id)
                          : [...prev, { id: t.id, name, price: Number(t.price_uzs) }],
                      )
                    }
                    className={
                      'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ' +
                      (picked ? 'bg-primary/10' : 'hover:bg-muted/40')
                    }
                  >
                    <span className="truncate">{name}</span>
                    <span className="text-xs text-muted-foreground">{fmt(Number(t.price_uzs))}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">Topilmadi</div>
              )}
            </div>

            {selectedTests.length > 0 && (
              <div className="rounded border p-2">
                <div className="mb-1 text-xs text-muted-foreground">Tanlangan:</div>
                <div className="flex flex-wrap gap-1">
                  {selectedTests.map((t) => (
                    <Badge key={t.id} variant="secondary" className="flex items-center gap-1">
                      {t.name}
                      <X
                        className="h-3 w-3 cursor-pointer"
                        onClick={() =>
                          setSelectedTests((prev) => prev.filter((x) => x.id !== t.id))
                        }
                      />
                    </Badge>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Jami</span>
                  <span className="font-semibold">{fmt(total)} UZS</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Yuborilmoqda…' : 'Buyurtmani ochish'}
          </Button>
        </DialogFooter>
        {mut.isError && (
          <p className="text-xs text-destructive">{(mut.error as Error).message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Order drawer with state transitions + result entry
// ---------------------------------------------------------------------------
function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ['lab-order', orderId],
    queryFn: () => api.lab.get(orderId),
  });
  const order = data as
    | (LabOrder & {
        clinical_notes?: string;
        public_token?: string;
        patient?: {
          id: string;
          full_name: string;
          first_name?: string | null;
          last_name?: string | null;
          patronymic?: string | null;
          dob?: string | null;
          gender?: 'male' | 'female' | 'other' | 'unknown' | null;
          phone?: string | null;
        } | null;
        clinic?: {
          id: string;
          name: string;
          slug: string;
          logo_url?: string | null;
          primary_color?: string | null;
          phone?: string | null;
          address?: string | null;
          city?: string | null;
          region?: string | null;
        } | null;
        items?: Array<{
          id: string;
          name_snapshot: string;
          status: string;
          test?: {
            name_i18n: Record<string, string>;
            unit?: string | null;
            reference_range_male?: string | null;
            reference_range_female?: string | null;
          } | null;
          results?: Array<{
            id: string;
            value: string;
            unit?: string;
            is_abnormal?: boolean;
            is_final?: boolean;
            interpretation?: string;
            flag?: string | null;
            validation_status?: string | null;
          }>;
        }>;
      })
    | undefined;

  type LabAction =
    | 'collect'
    | 'start'
    | 'complete'
    | 'report:sms'
    | 'report:telegram'
    | 'deliver'
    | 'cancel';

  const transition = useMutation({
    mutationFn: async (action: LabAction) => {
      if (action === 'cancel') await api.lab.cancel(orderId);
      else if (action === 'collect') await api.lab.collect(orderId);
      else if (action === 'start') await api.lab.start(orderId);
      else if (action === 'complete') await api.lab.complete(orderId);
      else if (action === 'report:sms') await api.lab.report(orderId, 'sms');
      else if (action === 'report:telegram') await api.lab.report(orderId, 'telegram');
      else if (action === 'deliver') await api.lab.deliver(orderId);
      return action;
    },
    onSuccess: (action) => {
      const labels: Record<string, string> = {
        collect: 'Namuna qabul qilindi',
        start: 'Jarayon boshlandi',
        complete: 'Tugallandi',
        'report:sms': 'SMS yuborildi',
        'report:telegram': 'Telegram orqali yuborildi',
        deliver: 'Mijozga topshirildi',
        cancel: 'Bekor qilindi',
      };
      toast.success(labels[action] ?? 'Yangilandi');
      refetch();
      qc.invalidateQueries({ queryKey: ['lab-kanban'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nextActions: Record<LabOrder['status'], Array<{ id: LabAction; label: string; primary?: boolean }>> = {
    pending: [{ id: 'collect', label: 'Namuna olindi', primary: true }, { id: 'cancel', label: 'Bekor' }],
    collected: [{ id: 'start', label: 'Jarayonga olish', primary: true }],
    running: [{ id: 'complete', label: 'Tugallash', primary: true }],
    completed: [
      { id: 'report:sms', label: 'SMS yuborish', primary: true },
      { id: 'report:telegram', label: 'Telegram yuborish' },
    ],
    reported: [{ id: 'deliver', label: 'Topshirildi', primary: true }],
    delivered: [],
    canceled: [],
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Laboratoriya buyurtma
          </DialogTitle>
          <DialogDescription>
            {order?.patient?.full_name} · {order?.items?.length ?? 0} ta tahlil
          </DialogDescription>
        </DialogHeader>

        {!order ? (
          <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{order.status}</Badge>
              <Badge
                variant={
                  order.urgency === 'stat'
                    ? 'destructive'
                    : order.urgency === 'urgent'
                    ? 'warning'
                    : 'outline'
                }
              >
                {URGENCY[order.urgency]}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Jami: {fmt(order.total_uzs)} UZS
              </span>
            </div>

            {/* FAZA 2 — namuna (tube) kuzatuvi */}
            <SamplePanel orderId={orderId} patientName={order.patient?.full_name ?? 'Bemor'} />

            <div className="divide-y rounded-md border">
              {(order.items ?? []).map((it) => (
                <OrderItemRow
                  key={it.id}
                  item={it}
                  orderStatus={order.status}
                  onRecorded={() => {
                    refetch();
                    qc.invalidateQueries({ queryKey: ['lab-kanban'] });
                  }}
                />
              ))}
            </div>

            {(order.clinical_notes ?? '') && (
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> Klinik izoh
                </div>
                <p className="mt-1">{order.clinical_notes}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {(nextActions[order.status] ?? []).map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant={a.primary ? 'default' : 'outline'}
                  onClick={() => transition.mutate(a.id)}
                  disabled={transition.isPending}
                >
                  {a.id.startsWith('report:') && <Send className="mr-1 h-3 w-3" />}
                  {a.label}
                  {a.primary && <ChevronRight className="ml-1 h-3 w-3" />}
                </Button>
              ))}
              {['running', 'completed', 'reported', 'delivered'].includes(order.status) && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.print()}
                    className="ml-auto gap-1"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Chop etish
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const { exportLabResultPdf } = await import('@/lib/pdf');
                      await exportLabResultPdf(`lab-${order.id.slice(0, 8)}.pdf`);
                    }}
                    className="gap-1"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    PDF
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Print-only view: full lab result report */}
      {order && <LabResultPrintView order={order} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FAZA 2 — Namuna (tube) paneli: probirka yaratish, barkod, holat
// ---------------------------------------------------------------------------
const SAMPLE_TYPE_LABEL: Record<string, string> = {
  blood: 'Qon',
  urine: 'Siydik',
  stool: 'Najas',
  swab: 'Surtma',
  tissue: 'To‘qima',
  other: 'Boshqa',
};

const SAMPLE_STATUS_LABEL: Record<string, string> = {
  pending: 'Kutilmoqda',
  collected: 'Yig‘ildi',
  received: 'Qabul qilindi',
  rejected: 'Rad etildi',
};

function SamplePanel({ orderId, patientName }: { orderId: string; patientName: string }) {
  const qc = useQueryClient();
  const [sampleType, setSampleType] =
    useState<'blood' | 'urine' | 'stool' | 'swab' | 'tissue' | 'other'>('blood');

  const { data: samples } = useQuery({
    queryKey: ['lab-samples', orderId],
    queryFn: () => api.lab.orderSamples(orderId),
  });

  const createMut = useMutation({
    mutationFn: () => api.lab.createSample({ order_id: orderId, sample_type: sampleType }),
    onSuccess: () => {
      toast.success('Probirka yaratildi');
      qc.invalidateQueries({ queryKey: ['lab-samples', orderId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'collected' | 'received' }) =>
      api.lab.updateSampleStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-samples', orderId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <TestTube className="h-3.5 w-3.5" /> Namunalar (probirka)
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(['blood', 'urine', 'stool', 'swab', 'tissue', 'other'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSampleType(t)}
            className={
              'rounded-full border px-2 py-0.5 text-xs ' +
              (sampleType === t ? 'border-primary bg-primary/10' : 'hover:bg-muted/40')
            }
          >
            {SAMPLE_TYPE_LABEL[t]}
          </button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
        >
          <Plus className="mr-1 h-3 w-3" /> Probirka
        </Button>
      </div>

      {(samples ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Probirka yaratilmagan. Yuqoridan namuna turini tanlab «Probirka» bosing.
        </p>
      ) : (
        <div className="space-y-1.5">
          {(samples ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 rounded border bg-card px-2 py-1.5"
            >
              <div className="min-w-0">
                {/* Barkod — chop etilganda skaner o'qiy oladigan tube_id */}
                <div className="font-mono text-sm font-bold tracking-wider">
                  {s.tube_id}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {SAMPLE_TYPE_LABEL[s.sample_type] ?? s.sample_type} ·{' '}
                  {SAMPLE_STATUS_LABEL[s.status] ?? s.status}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  title="Namuna yorlig'ini chop etish"
                  onClick={() =>
                    printLabel(
                      labSampleLabelHtml({
                        patientName,
                        sampleId: s.tube_id,
                        testName: SAMPLE_TYPE_LABEL[s.sample_type] ?? s.sample_type,
                        date: new Date().toLocaleDateString('uz-UZ'),
                      }),
                      LAB_LABEL_SIZE,
                    )
                  }
                >
                  <Printer className="mr-1 h-3 w-3" /> Yorliq
                </Button>
                {s.status === 'pending' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => statusMut.mutate({ id: s.id, status: 'collected' })}
                  >
                    Yig‘ildi
                  </Button>
                )}
                {s.status === 'collected' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => statusMut.mutate({ id: s.id, status: 'received' })}
                  >
                    <ScanLine className="mr-1 h-3 w-3" /> Qabul
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Print-only template — visible only when window.print() is called.
// Brauzer 'Save as PDF' bilan PDF eksport ham shu shablonni ishlatadi.
// =============================================================================

const GENDER_LABEL: Record<string, string> = {
  male: 'Erkak',
  female: 'Ayol',
  other: 'Boshqa',
  unknown: '—',
};

function ageYears(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

function calcAge(dob?: string | null): string {
  const y = ageYears(dob);
  return y === null ? '—' : `${y} yosh`;
}

// Bola = 18 yoshgacha (bola normasi mavjud bo'lsa ishlatiladi).
const CHILD_AGE_MAX = 18;

// Sana + vaqt (topshirilgan / tayyor bo'lgan) formatlash.
function fmtDateTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uz-UZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fullName(p?: {
  full_name?: string;
  last_name?: string | null;
  first_name?: string | null;
  patronymic?: string | null;
} | null): string {
  if (!p) return '—';
  const parts = [p.last_name, p.first_name, p.patronymic].filter(Boolean).join(' ');
  return parts.length > 0 ? parts : (p.full_name ?? '—');
}

function LabResultPrintView({
  order,
}: {
  order: {
    id: string;
    status: string;
    urgency: 'routine' | 'urgent' | 'stat';
    total_uzs: number;
    created_at: string;
    completed_at?: string | null;
    reported_at?: string | null;
    delivered_at?: string | null;
    clinical_notes?: string;
    public_token?: string;
    patient?: {
      id: string;
      full_name: string;
      first_name?: string | null;
      last_name?: string | null;
      patronymic?: string | null;
      dob?: string | null;
      gender?: 'male' | 'female' | 'other' | 'unknown' | null;
      phone?: string | null;
    } | null;
    clinic?: {
      id: string;
      name: string;
      slug: string;
      logo_url?: string | null;
      primary_color?: string | null;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      region?: string | null;
    } | null;
    items?: Array<{
      id: string;
      name_snapshot: string;
      status: string;
      test?: {
        name_i18n: Record<string, string>;
        unit?: string | null;
        reference_range_male?: string | null;
        reference_range_female?: string | null;
        reference_range_child?: string | null;
      } | null;
      results?: Array<{
        id: string;
        value: string;
        unit?: string;
        is_abnormal?: boolean;
        is_final?: boolean;
        interpretation?: string;
      }>;
    }>;
  };
}) {
  const registeredAt = fmtDateTime(order.created_at);
  const readyAt = fmtDateTime(order.completed_at ?? order.reported_at ?? order.delivered_at);
  const clinic = order.clinic;
  const patient = order.patient;
  const gender = patient?.gender ?? 'unknown';
  // Bemor bola bo'lsa (18 yoshgacha) va bola normasi mavjud bo'lsa — o'sha ko'rsatiladi.
  const isChildPatient = (ageYears(patient?.dob) ?? 99) < CHILD_AGE_MAX;
  const normaLabel = isChildPatient ? 'bola' : (GENDER_LABEL[gender] ?? '—');
  const brandColor = clinic?.primary_color ?? '#2563EB';
  const clinicAddress = [clinic?.address, clinic?.city, clinic?.region].filter(Boolean).join(', ');

  return (
    <div className="lab-print-area">
      {/* Brand header */}
      <header style={{ borderBottom: `3px solid ${brandColor}`, paddingBottom: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {clinic?.logo_url ? (
              <img
                src={clinic.logo_url}
                alt={clinic.name}
                style={{ height: 56, width: 'auto', objectFit: 'contain' }}
              />
            ) : (
              <div
                style={{
                  height: 56,
                  width: 56,
                  borderRadius: 8,
                  background: brandColor,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: 24,
                }}
              >
                {(clinic?.name ?? 'C').charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: brandColor }}>
                {clinic?.name ?? 'Klinika'}
              </div>
              {clinicAddress && (
                <div style={{ fontSize: 10, color: '#555' }}>{clinicAddress}</div>
              )}
              {clinic?.phone && (
                <div style={{ fontSize: 10, color: '#555' }}>Tel: {clinic.phone}</div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ textAlign: 'right', fontSize: 10 }}>
            <div style={{ fontWeight: 'bold', fontSize: 12, color: '#000' }}>
              LABORATORIYA TAHLIL NATIJASI
            </div>
            <div style={{ marginTop: 2 }}>Buyurtma № <strong>{order.id.slice(0, 8).toUpperCase()}</strong></div>
            <div>Topshirilgan: <strong>{registeredAt}</strong></div>
            <div>Tayyor: <strong>{readyAt}</strong></div>
            <div style={{ marginTop: 2 }}>
              Holat: <strong>{order.status}</strong>
              {order.urgency !== 'routine' && (
                <span style={{ marginLeft: 6, color: order.urgency === 'stat' ? '#b00' : '#c80' }}>
                  ({URGENCY[order.urgency]})
                </span>
              )}
            </div>
          </div>
          {order.public_token && (
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <QRCodeCanvas value={`${PATIENT_PORTAL_URL}/r/${order.public_token}`} size={72} level="M" />
              <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>Natijani bilish</div>
            </div>
          )}
          </div>
        </div>
      </header>

      {/* Patient block */}
      <section style={{ marginBottom: 14, fontSize: 11 }}>
        <div
          style={{
            background: '#f7f7f7',
            border: '1px solid #ddd',
            borderRadius: 4,
            padding: 10,
          }}
        >
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Bemor ma&apos;lumotlari
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.5fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: '#888' }}>F.I.SH.</div>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{fullName(patient)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#888' }}>Yoshi</div>
              <div style={{ fontWeight: 600 }}>{calcAge(patient?.dob)}</div>
              {patient?.dob && (
                <div style={{ fontSize: 9, color: '#888' }}>
                  {new Date(patient.dob).toLocaleDateString('uz-UZ')}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#888' }}>Jinsi</div>
              <div style={{ fontWeight: 600 }}>{GENDER_LABEL[gender] ?? '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#888' }}>Telefon</div>
              <div style={{ fontWeight: 600 }}>{patient?.phone ?? '—'}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Clinical notes */}
      {order.clinical_notes && (
        <section style={{ marginBottom: 12, fontSize: 11 }}>
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
            Klinik izoh
          </div>
          <div style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4, background: '#fafafa' }}>
            {order.clinical_notes}
          </div>
        </section>
      )}

      {/* Results table */}
      <section>
        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          Tahlil natijalari ({(order.items ?? []).length} ta)
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderTop: `2px solid ${brandColor}`, borderBottom: `2px solid ${brandColor}`, background: '#fafafa' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '38%' }}>Tahlil nomi</th>
              <th style={{ textAlign: 'right', padding: '6px 4px', width: '15%' }}>Natija</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '10%' }}>Birlik</th>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '22%' }}>
                Norma ({normaLabel})
              </th>
              <th style={{ textAlign: 'left', padding: '6px 4px', width: '15%' }}>Holati</th>
            </tr>
          </thead>
          <tbody>
            {(order.items ?? []).map((it) => {
              const result = it.results?.[0];
              // Yosh/jins bo'yicha referens: bola (18-) → bola normasi, aks holda jins.
              const refMale = it.test?.reference_range_male;
              const refFemale = it.test?.reference_range_female;
              const refChild = it.test?.reference_range_child;
              const ref =
                isChildPatient && refChild
                  ? refChild
                  : gender === 'female'
                  ? refFemale ?? refMale ?? '—'
                  : refMale ?? refFemale ?? '—';
              const value = result?.value;
              let statusLabel = '—';
              let statusColor = '#666';
              if (value != null) {
                if (result?.is_abnormal) {
                  statusLabel = 'Normadan tashqari';
                  statusColor = '#b00';
                } else if (result?.is_final) {
                  statusLabel = 'Norma';
                  statusColor = '#0a7';
                } else {
                  statusLabel = 'Dastlabki';
                  statusColor = '#c80';
                }
              } else {
                statusLabel = 'Kutilmoqda';
                statusColor = '#888';
              }
              return (
                <tr key={it.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 4px' }}>{it.name_snapshot}</td>
                  <td
                    style={{
                      padding: '6px 4px',
                      textAlign: 'right',
                      fontWeight: result?.is_abnormal ? 'bold' : 600,
                      color: result?.is_abnormal ? '#b00' : '#000',
                    }}
                  >
                    {value ?? '—'}
                    {result?.is_abnormal ? ' ⚠' : ''}
                  </td>
                  <td style={{ padding: '6px 4px', color: '#555' }}>
                    {result?.unit ?? it.test?.unit ?? ''}
                  </td>
                  <td style={{ padding: '6px 4px', color: '#555', fontSize: 10 }}>{ref}</td>
                  <td style={{ padding: '6px 4px', color: statusColor, fontWeight: 600, fontSize: 10 }}>
                    {statusLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Footer */}
      <footer style={{ marginTop: 30, paddingTop: 10, borderTop: '1px solid #ddd', fontSize: 10, color: '#666' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 30 }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 18 }}>Laborant imzosi:</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: 2 }}>F.I.SH. va imzo</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 18 }}>Shifokor imzosi:</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: 2 }}>F.I.SH. va imzo</div>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <div style={{ fontWeight: 600, color: brandColor }}>{clinic?.name ?? 'Clary Care'}</div>
            <div>Chop etilgan: {new Date().toLocaleString('uz-UZ')}</div>
            <div>Natijani onlayn ko&apos;rish: QR kodni skaner qiling</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontStyle: 'italic', fontSize: 9, textAlign: 'center', color: '#888' }}>
          ⚠ ushbu natijalarni faqat shifokoringiz bilan birga sharhlang. Bu sahifa tibbiy maslahat emas.
        </div>
      </footer>
    </div>
  );
}

// FAZA 2 — smart entry: referens diapazon + qiymatdan natija darajasi.
// Backend `detectFlag` bilan bir xil mantiq — laborant yozayotganda jonli ko'rsatish.
type ResultFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

function clientDetectFlag(raw: string, refRange: string): ResultFlag | null {
  const numeric = Number(raw);
  if (!raw.trim() || !Number.isFinite(numeric) || !refRange) return null;
  const m = refRange.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return null;
  const span = high - low;
  if (numeric < low) return numeric < low - span * 0.5 ? 'critical_low' : 'low';
  if (numeric > high) return numeric > high + span * 0.5 ? 'critical_high' : 'high';
  return 'normal';
}

const FLAG_META: Record<ResultFlag, { label: string; cls: string }> = {
  normal: { label: 'Normal', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  low: { label: 'Past', cls: 'border-amber-400 bg-amber-50 text-amber-700' },
  high: { label: 'Yuqori', cls: 'border-amber-400 bg-amber-50 text-amber-700' },
  critical_low: { label: 'KRITIK PAST', cls: 'border-red-500 bg-red-50 text-red-700' },
  critical_high: { label: 'KRITIK YUQORI', cls: 'border-red-500 bg-red-50 text-red-700' },
};

function OrderItemRow({
  item,
  orderStatus,
  onRecorded,
}: {
  item: {
    id: string;
    name_snapshot: string;
    status: string;
    test?: {
      unit?: string | null;
      reference_range_male?: string | null;
      reference_range_female?: string | null;
    } | null;
    results?: Array<{
      id: string;
      value: string;
      is_final?: boolean;
      is_abnormal?: boolean;
      flag?: string | null;
      validation_status?: string | null;
    }>;
  };
  orderStatus: string;
  onRecorded: () => void;
}) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(item.test?.unit ?? '');
  const [refRange, setRefRange] = useState(item.test?.reference_range_male ?? '');
  const [isAbnormal, setIsAbnormal] = useState(false);
  const [attachment, setAttachment] = useState('');
  const [expanded, setExpanded] = useState(false);

  const canRecord = ['running', 'completed'].includes(orderStatus) && !item.results?.some((r) => r.is_final);

  // Jonli daraja — laborant yozayotganda
  const liveFlag = clientDetectFlag(value, refRange);

  const mut = useMutation({
    mutationFn: () =>
      api.lab.recordResult({
        order_item_id: item.id,
        value,
        unit: unit || undefined,
        reference_range: refRange || undefined,
        // Daraja aniqlangan bo'lsa is_abnormal'ni avtomatik to'ldiramiz; aks holda
        // laborant qo'lda belgilagan qiymat ishlatiladi.
        is_abnormal: liveFlag ? liveFlag !== 'normal' : isAbnormal,
        is_final: true,
        attachment_url: attachment || undefined,
      }),
    onSuccess: () => {
      toast.success('Natija saqlandi');
      onRecorded();
      setExpanded(false);
      setValue('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // FAZA 3 — draft natijani tasdiqlash/rad etish (validatsiya oqimi)
  const validateMut = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'validate' | 'reject' }) =>
      decision === 'validate' ? api.lab.validateResult(id) : api.lab.rejectResult(id),
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'validate' ? 'Natija tasdiqlandi' : 'Natija rad etildi');
      onRecorded();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const latest = item.results?.[0];
  // Validatsiyani kutayotgan draft natija
  const draftResult = item.results?.find(
    (r) => r.validation_status === 'draft' || r.validation_status === 'review_pending',
  );

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <Beaker className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">{item.name_snapshot}</span>
          </div>
          {latest ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
              <span className="font-mono">{latest.value}</span>
              {latest.flag && latest.flag in FLAG_META ? (
                <span
                  className={
                    'rounded border px-1.5 text-[10px] font-medium ' +
                    FLAG_META[latest.flag as ResultFlag].cls
                  }
                >
                  {FLAG_META[latest.flag as ResultFlag].label}
                </span>
              ) : (
                latest.is_abnormal && <Badge variant="destructive">Norma tashqari</Badge>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {item.test?.reference_range_male ? `Norm: ${item.test.reference_range_male}` : '—'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={item.status === 'completed' ? 'success' : 'secondary'}>
            {item.status}
          </Badge>
          {canRecord && (
            <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Yopish' : 'Natija'}
            </Button>
          )}
        </div>
      </div>

      {/* FAZA 3 — validatsiyani kutayotgan draft natija */}
      {draftResult && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
          <div>
            <span className="font-medium text-amber-800">Tasdiqlanmagan natija:</span>{' '}
            <span className="font-mono">{draftResult.value}</span>
            <span className="ml-1 text-amber-700">— validator tekshiruvini kutmoqda</span>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() =>
                validateMut.mutate({ id: draftResult.id, decision: 'validate' })
              }
              disabled={validateMut.isPending}
            >
              Tasdiqlash
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() =>
                validateMut.mutate({ id: draftResult.id, decision: 'reject' })
              }
              disabled={validateMut.isPending}
            >
              Rad etish
            </Button>
          </div>
        </div>
      )}

      {expanded && canRecord && (
        <div className="mt-2 grid gap-2 rounded-md border bg-muted/30 p-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            placeholder="Natija qiymati"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Input placeholder="O'lchov birligi" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input
            placeholder="Normal oraliq"
            value={refRange}
            onChange={(e) => setRefRange(e.target.value)}
          />
          {/* Smart entry — daraja avtomatik aniqlanadi; aniqlanmasa qo'lda */}
          {liveFlag ? (
            <span
              className={
                'flex items-center justify-center rounded-md border px-2 text-xs font-medium ' +
                FLAG_META[liveFlag].cls
              }
            >
              {FLAG_META[liveFlag].label}
            </span>
          ) : (
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={isAbnormal}
                onChange={(e) => setIsAbnormal(e.target.checked)}
              />
              Abnormal
            </label>
          )}
          <Input
            className="md:col-span-4"
            placeholder="PDF/rasm URL (ixtiyoriy)"
            value={attachment}
            onChange={(e) => setAttachment(e.target.value)}
          />
          <div className="md:col-span-4 flex justify-end">
            <Button size="sm" onClick={() => mut.mutate()} disabled={!value || mut.isPending}>
              {mut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
