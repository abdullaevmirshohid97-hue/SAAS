import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  DollarSign,
  Download,
  Minus,
  Package,
  PackagePlus,
  Pill,
  Plus,
  Printer,
  QrCode,
  Receipt,
  ScanBarcode,
  Search,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
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
  StatCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';

type TabId = 'dashboard' | 'pos' | 'sales' | 'receipt' | 'prescriptions' | 'import' | 'clinics';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

type MedOption = {
  medication_id: string;
  name: string;
  form: string | null;
  price_uzs: number;
  qty_in_stock: number;
  reorder_level: number | null;
};

type CartItem = {
  medication_id: string;
  name: string;
  unit_price_uzs: number;
  quantity: number;
  max_stock: number;
};

export function PharmacyPage() {
  const [tab, setTab] = useState<TabId>('dashboard');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dorixona</h1>
          <p className="text-sm text-muted-foreground">
            Ombor, FIFO sotuv, retsept bo'yicha berish va yangi prihot
          </p>
        </div>
        <TabBar tab={tab} setTab={setTab} />
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'pos' && <POSTab />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'receipt' && <ReceiptTab />}
      {tab === 'prescriptions' && <PrescriptionsTab onDispense={() => setTab('pos')} />}
      {tab === 'import' && <ImportTab />}
      {tab === 'clinics' && <ClinicsTab />}
    </div>
  );
}

function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const tabs: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: 'Dashboard', icon: Package },
    { id: 'pos', label: 'Yangi savdo', icon: Receipt },
    { id: 'sales', label: 'Savdo tarixi', icon: Wallet },
    { id: 'clinics', label: 'Mijoz klinikalar', icon: Boxes },
    { id: 'prescriptions', label: 'Retseptlar', icon: Pill },
    { id: 'receipt', label: 'Prihot', icon: PackagePlus },
    { id: 'import', label: 'Import', icon: Upload },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-muted/30 p-1 flex-wrap gap-1">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ' +
              (active ? 'bg-background shadow-elevation-1' : 'text-muted-foreground hover:text-foreground')
            }
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function DashboardTab() {
  const [qrMed, setQrMed] = useState<{ name: string; barcode: string; price_uzs: number; strength?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'dashboard'],
    queryFn: () => api.pharmacy.dashboard(),
  });

  const handleExportInventory = async () => {
    setExporting(true);
    try {
      const meds = await api.pharmacy.searchMedications('');
      const { exportMedications } = await import('@/lib/xlsx');
      await exportMedications(
        (meds ?? []).map((m) => ({
          name: m.name,
          strength: (m as { strength?: string }).strength ?? null,
          unit: (m as { unit?: string }).unit ?? null,
          price_uzs: (m as { price_uzs?: number }).price_uzs ?? null,
          stock: (m as { qty_in_stock?: number }).qty_in_stock ?? null,
          barcode: (m as { barcode?: string | null }).barcode ?? null,
          batch_no: (m as { batch_no?: string | null }).batch_no ?? null,
          expiry_date: (m as { expiry_date?: string | null }).expiry_date ?? null,
        })),
        `dorilar-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success("Ombor Excel'ga eksport qilindi");
    } catch (err) {
      toast.error(`Eksport xatosi: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const totals = data?.totals;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleExportInventory()}
          disabled={exporting}
        >
          <Download className="mr-1 h-4 w-4" />
          {exporting ? "Eksport qilinmoqda..." : "Excel'ga eksport"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Jami stok"
          value={isLoading ? '…' : fmt(totals?.qty_in_stock ?? 0)}
          icon={<Boxes className="h-4 w-4" />}
          hint="dona"
        />
        <StatCard
          label="Stok qiymati"
          value={isLoading ? '…' : fmt(totals?.stock_value_uzs ?? 0)}
          icon={<DollarSign className="h-4 w-4" />}
          hint="UZS"
          tone="info"
        />
        <StatCard
          label="Bugungi savdo"
          value={isLoading ? '…' : fmt(totals?.today_revenue_uzs ?? 0)}
          icon={<Receipt className="h-4 w-4" />}
          hint="UZS"
          tone="success"
        />
        <StatCard
          label="Bugungi qarz"
          value={isLoading ? '…' : fmt(totals?.today_debt_uzs ?? 0)}
          icon={<Wallet className="h-4 w-4" />}
          hint="UZS"
          tone={(totals?.today_debt_uzs ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Kam qolgan"
          value={isLoading ? '…' : String(totals?.low_stock_count ?? 0)}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={(totals?.low_stock_count ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Muddati yaqin"
          value={isLoading ? '…' : String(totals?.expiring_count ?? 0)}
          icon={<CalendarClock className="h-4 w-4" />}
          tone={(totals?.expiring_count ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kam qolgan dorilar</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(data?.low_stock ?? []).length === 0 ? (
              <div className="p-6">
                <EmptyState title="Hammasi yetarli" description="Kam qolgan dorilar yo'q" />
              </div>
            ) : (
              <div className="divide-y">
                {(data?.low_stock ?? []).map((row) => (
                  <div key={row.medication_id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="font-medium">{row.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">{row.qty_in_stock} dona</Badge>
                      <span className="text-xs text-muted-foreground">
                        min: {row.reorder_level ?? 10}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="QR label chop etish"
                        onClick={() =>
                          setQrMed({ name: row.name, barcode: row.medication_id, price_uzs: 0 })
                        }
                      >
                        <QrCode className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Muddati yaqin partiyalar (90 kun)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(data?.expiring ?? []).length === 0 ? (
              <div className="p-6">
                <EmptyState title="Muddati yaqin yo'q" />
              </div>
            ) : (
              <div className="divide-y">
                {(data?.expiring ?? []).map((row) => (
                  <div key={row.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <div className="font-medium">{row.medication?.name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.batch_no ? `Partiya: ${row.batch_no}` : 'Partiya: —'} ·{' '}
                        {row.qty_remaining} dona
                      </div>
                    </div>
                    <Badge variant="destructive">{row.expiry_date ?? '—'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* QR Label Modal */}
      <QrLabelModal
        open={!!qrMed}
        med={qrMed}
        onClose={() => setQrMed(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// QR Label Modal
// ---------------------------------------------------------------------------
function QrLabelModal({
  open,
  med,
  onClose,
}: {
  open: boolean;
  med: { name: string; barcode: string; price_uzs: number; strength?: string } | null;
  onClose: () => void;
}) {
  if (!med) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>QR Label</DialogTitle>
        </DialogHeader>
        <div id="qr-label-print" className="flex flex-col items-center gap-3 p-4 border rounded-lg">
          {/* Simple QR via Google Charts API (no extra dep) */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(med.barcode)}`}
            alt="QR"
            className="h-36 w-36"
          />
          <div className="text-center">
            <div className="font-semibold text-sm">{med.name}</div>
            {med.strength && <div className="text-xs text-muted-foreground">{med.strength}</div>}
            <div className="text-xs font-mono mt-1">{med.barcode}</div>
            {med.price_uzs > 0 && (
              <div className="text-sm font-bold mt-1">{fmt(med.price_uzs)} so'm</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Yopish</Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Chop etish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Barcode scan hook
// ---------------------------------------------------------------------------
function useBarcodeScanner(onScan: (code: string) => void) {
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (code.length > 3) onScan(code);
        return;
      }
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { bufferRef.current = ''; }, 200);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onScan]);
}

// ---------------------------------------------------------------------------
// POS
// ---------------------------------------------------------------------------
function POSTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pharmacyClinicId, setPharmacyClinicId] = useState<string>('');
  const [pharmacyDoctorId, setPharmacyDoctorId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [discount, setDiscount] = useState(0);
  const [debt, setDebt] = useState(0);
  const [notes, setNotes] = useState('');
  const [scanInput, setScanInput] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  const { data: options } = useQuery({
    queryKey: ['pharmacy', 'search', q],
    queryFn: () => api.pharmacy.searchMedications(q),
  });
  const { data: clinics } = useQuery({
    queryKey: ['pharmacy', 'clinics'],
    queryFn: () => api.pharmacy.listClinics(),
  });
  const clinicList = clinics ?? [];
  const selectedClinic = clinicList.find((c) => c.id === pharmacyClinicId) ?? null;
  const clinicDoctors = selectedClinic?.doctors ?? [];

  const total = useMemo(
    () => Math.max(0, cart.reduce((a, c) => a + c.quantity * c.unit_price_uzs, 0) - discount),
    [cart, discount],
  );
  const paid = Math.max(0, total - debt);

  const addToCart = (m: { medication_id: string; name: string; price_uzs: number; qty_in_stock: number }) => {
    setCart((prev) => {
      const ix = prev.findIndex((p) => p.medication_id === m.medication_id);
      if (ix >= 0) {
        const next = [...prev];
        const cur = next[ix]!;
        next[ix] = { ...cur, quantity: Math.min(cur.max_stock, cur.quantity + 1) };
        return next;
      }
      if (Number(m.qty_in_stock) <= 0) return prev;
      return [
        ...prev,
        {
          medication_id: m.medication_id,
          name: m.name,
          unit_price_uzs: Number(m.price_uzs),
          quantity: 1,
          max_stock: Number(m.qty_in_stock),
        },
      ];
    });
  };

  const handleBarcodeScan = async (code: string) => {
    try {
      const med = await api.pharmacy.findByBarcode(code);
      addToCart({
        medication_id: med.id,
        name: med.name,
        price_uzs: med.price_uzs,
        qty_in_stock: med.stock,
      });
      toast.success(`${med.name} savatga qo'shildi`);
    } catch {
      toast.error(`Barcode topilmadi: ${code}`);
    }
    setScanInput('');
  };

  useBarcodeScanner(handleBarcodeScan);

  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.createSale({
        pharmacy_clinic_id: pharmacyClinicId || undefined,
        pharmacy_doctor_id: pharmacyDoctorId || undefined,
        items: cart.map((c) => ({
          medication_id: c.medication_id,
          quantity: c.quantity,
          unit_price_override_uzs: c.unit_price_uzs,
        })),
        payment_method: paymentMethod,
        paid_uzs: paid,
        debt_uzs: debt,
        discount_uzs: discount,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      setCart([]);
      setDebt(0);
      setDiscount(0);
      setNotes('');
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success('Sotuv amalga oshirildi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader className="space-y-2">
          {/* Barcode scan input */}
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <ScanBarcode className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={scanRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && scanInput.trim()) {
                  handleBarcodeScan(scanInput.trim());
                }
              }}
              placeholder="Barcode skaner yoki qo'lda kiriting → Enter"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {/* Name search */}
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Dori nomini qidiring…"
              className="max-w-xl"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-y-auto divide-y">
            {(options ?? []).map((m) => {
              const low = Number(m.qty_in_stock) <= (m.reorder_level ?? 10);
              const out = Number(m.qty_in_stock) <= 0;
              return (
                <button
                  key={m.medication_id}
                  onClick={() => addToCart(m)}
                  disabled={out}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.form ?? ''} · {fmt(m.price_uzs)} UZS
                    </div>
                  </div>
                  <Badge variant={out ? 'destructive' : low ? 'warning' : 'secondary'}>
                    {m.qty_in_stock} dona
                  </Badge>
                </button>
              );
            })}
            {(options ?? []).length === 0 && (
              <div className="p-6">
                <EmptyState title="Natija yo'q" description="Boshqa nom bilan qidiring" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Savat · {fmt(total)} UZS</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Klinika (mijoz)</label>
              <Select
                value={pharmacyClinicId}
                onValueChange={(v) => {
                  setPharmacyClinicId(v);
                  setPharmacyDoctorId('');
                }}
              >
                <SelectTrigger><SelectValue placeholder="Klinika tanlang…" /></SelectTrigger>
                <SelectContent>
                  {clinicList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Shifokor</label>
              <Select value={pharmacyDoctorId} onValueChange={setPharmacyDoctorId} disabled={!pharmacyClinicId}>
                <SelectTrigger>
                  <SelectValue placeholder={pharmacyClinicId ? 'Shifokor tanlang…' : 'Avval klinika tanlang'} />
                </SelectTrigger>
                <SelectContent>
                  {clinicDoctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedClinic && selectedClinic.debt_uzs > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                Bu klinika qarzi: <b>{fmt(selectedClinic.debt_uzs)}</b> so'm
              </div>
            )}
          </div>

          {cart.length === 0 ? (
            <EmptyState title="Savat bo'sh" description="Chapdan dori tanlang yoki skaner bilan qo'shing" />
          ) : (
            <div className="divide-y rounded-md border">
              {cart.map((c, i) => (
                <div key={c.medication_id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmt(c.unit_price_uzs)} × {c.quantity} = {fmt(c.quantity * c.unit_price_uzs)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() =>
                        setCart((p) =>
                          p.map((x, ix) =>
                            ix === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x,
                          ),
                        )
                      }
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm">{c.quantity}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() =>
                        setCart((p) =>
                          p.map((x, ix) =>
                            ix === i ? { ...x, quantity: Math.min(x.max_stock, x.quantity + 1) } : x,
                          ),
                        )
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setCart((p) => p.filter((_, ix) => ix !== i))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Chegirma (UZS)</label>
              <Input
                type="number"
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Qarz (UZS)</label>
              <Input
                type="number"
                value={debt}
                onChange={(e) => setDebt(Math.max(0, Number(e.target.value) || 0))}
                disabled={!pharmacyClinicId}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">To'lov turi</label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Plastik (HUMO/UzCard)</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="transfer">O'tkazma</SelectItem>
                <SelectItem value="debt">Qarzga (klinika)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Input
            placeholder="Izoh (shart emas)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">To'lanadi</span>
              <span className="font-semibold">{fmt(paid)} UZS</span>
            </div>
            {debt > 0 && (
              <div className="flex justify-between text-warning">
                <span>Qarz</span>
                <span className="font-semibold">{fmt(debt)} UZS</span>
              </div>
            )}
          </div>

          <Button
            className="w-full"
            disabled={cart.length === 0 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Yuborilmoqda…' : `Chekni yopish · ${fmt(total)} UZS`}
          </Button>
          {mut.isError && (
            <p className="text-xs text-destructive">{(mut.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales history + filtrlar + agregatlar
// ---------------------------------------------------------------------------
type PharmPeriod = 'today' | 'week' | 'month' | 'year' | 'all';
function pharmRange(p: PharmPeriod): { from?: string; to?: string } {
  if (p === 'all') return {};
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (p === 'today') start.setHours(0, 0, 0, 0);
  else if (p === 'week') { start.setDate(now.getDate() - 6); start.setHours(0, 0, 0, 0); }
  else if (p === 'month') { start.setDate(1); start.setHours(0, 0, 0, 0); }
  else if (p === 'year') { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); }
  return { from: start.toISOString(), to: end.toISOString() };
}

function SalesTab() {
  const [period, setPeriod] = useState<PharmPeriod>('month');
  const [clinicId, setClinicId] = useState('');
  const range = useMemo(() => pharmRange(period), [period]);

  const { data: clinics } = useQuery({
    queryKey: ['pharmacy', 'clinics'],
    queryFn: () => api.pharmacy.listClinics(),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'sales-report', period, clinicId],
    queryFn: () => api.pharmacy.salesReport({ from: range.from, to: range.to, pharmacy_clinic_id: clinicId || undefined }),
  });
  const totals = data?.totals;
  const byDoctor = data?.by_doctor ?? [];
  const sales = data?.sales ?? [];

  const PERIODS: Array<{ id: PharmPeriod; label: string }> = [
    { id: 'today', label: 'Bugun' },
    { id: 'week', label: 'Hafta' },
    { id: 'month', label: 'Oy' },
    { id: 'year', label: 'Yil' },
    { id: 'all', label: 'Hammasi' },
  ];

  return (
    <div className="space-y-4">
      {/* Filtrlar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-muted/30 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={'rounded-md px-3 py-1 text-sm font-medium transition ' + (period === p.id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground hover:text-foreground')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Select value={clinicId || 'all'} onValueChange={(v) => setClinicId(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Barcha klinikalar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha klinikalar</SelectItem>
            {(clinics ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary kartalar */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Daromad" value={`${fmt(totals?.revenue ?? 0)} so'm`} tone="primary" />
        <SummaryCard label="Foyda" value={`${fmt(totals?.profit ?? 0)} so'm`} tone="success" />
        <SummaryCard label="Sotilgan dori" value={`${fmt(totals?.qty ?? 0)} dona`} />
        <SummaryCard label="Sotuvlar" value={`${fmt(totals?.sales_count ?? 0)} ta`} />
      </div>

      {/* Shifokorlar bo'yicha */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Shifokorlar bo'yicha</CardTitle></CardHeader>
        <CardContent className="p-0">
          {byDoctor.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Ma'lumot yo'q</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Shifokor</th>
                    <th className="px-3 py-2 text-right">Sotuvlar</th>
                    <th className="px-3 py-2 text-right">Dori (dona)</th>
                    <th className="px-3 py-2 text-right">Daromad</th>
                    <th className="px-3 py-2 text-right">Foyda</th>
                    <th className="px-3 py-2 text-right">Doktor ulushi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byDoctor.map((d) => (
                    <tr key={d.doctor_id ?? 'none'}>
                      <td className="px-3 py-2 font-medium">{d.doctor_name}</td>
                      <td className="px-3 py-2 text-right">{d.sales_count}</td>
                      <td className="px-3 py-2 text-right">{fmt(d.qty)}</td>
                      <td className="px-3 py-2 text-right">{fmt(d.revenue)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{fmt(d.profit)}</td>
                      <td className="px-3 py-2 text-right">{fmt(d.doctor_share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sotuvlar ro'yxati */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Sotuvlar ({sales.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
          ) : sales.length === 0 ? (
            <div className="p-6"><EmptyState title="Savdolar yo'q" /></div>
          ) : (
            <div className="divide-y">
              {sales.map((s) => (
                <div key={s.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                  <div>
                    <div className="font-medium">
                      {s.clinic_name ?? 'Klinikasiz'}
                      {s.doctor_name ? ` · ${s.doctor_name}` : ''}
                      {' · '}{s.items_count} dori ({fmt(s.qty)} dona)
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleString('uz-UZ')} · {s.payment_method}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{fmt(s.total_uzs)} so'm</div>
                    {s.debt_uzs > 0 && <div className="text-xs text-amber-600">Qarz: {fmt(s.debt_uzs)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'primary' | 'success' }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={'mt-1 text-lg font-semibold ' + (tone === 'success' ? 'text-emerald-600' : tone === 'primary' ? 'text-primary' : '')}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prescriptions waiting for dispense
// ---------------------------------------------------------------------------
function PrescriptionsTab({ onDispense }: { onDispense: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'prescriptions', 'pending'],
    queryFn: () => api.pharmacy.prescriptionsPending(),
  });
  const items = (data as Array<{
    id: string;
    rx_number: string;
    status: string;
    created_at: string;
    patient?: { full_name: string; phone?: string } | null;
    doctor?: { full_name: string } | null;
    items?: Array<{ medication_name_snapshot: string; quantity: number; dispensed_qty: number }>;
  }>) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Berilishi kutilayotgan retseptlar</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Retseptlar yo'q" />
          </div>
        ) : (
          <div className="divide-y">
            {items.map((rx) => (
              <div key={rx.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {rx.rx_number} · {rx.patient?.full_name ?? 'Mijoz'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Shifokor: {rx.doctor?.full_name ?? '—'} ·{' '}
                      {new Date(rx.created_at).toLocaleString('uz-UZ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={rx.status === 'partially_dispensed' ? 'warning' : 'secondary'}>
                      {rx.status}
                    </Badge>
                    <Button size="sm" onClick={onDispense}>
                      Berish
                    </Button>
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {(rx.items ?? []).map((it, ix) => (
                    <li key={ix}>
                      · {it.medication_name_snapshot} — {it.dispensed_qty}/{it.quantity}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Receipt (Prihot) — goods-in wizard
// ---------------------------------------------------------------------------
type ReceiptLine = {
  medication_id: string;
  name: string;
  quantity: number;
  unit_cost_uzs: number;
  profit_percent: number;
  doctor_share_kind: 'percent' | 'bonus';
  doctor_share_value: number;
  manufacturer: string;
  manufacture_date: string;
  batch_no: string;
  expiry_date: string;
};

// Sotuv narxi = tannarx * (1 + foyda%/100)
const salePriceOf = (l: { unit_cost_uzs: number; profit_percent: number }) =>
  Math.round((l.unit_cost_uzs || 0) * (1 + (l.profit_percent || 0) / 100));

function ReceiptTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [paidUzs, setPaidUzs] = useState('');
  const [notes, setNotes] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Yetkazib beruvchi firmalar (catalog) — prixotda tanlanadi
  const { data: suppliersRes } = useQuery({
    queryKey: ['catalog', 'suppliers'],
    queryFn: () => api.catalog.list('suppliers', { pageSize: 200 }),
  });
  const suppliers = ((suppliersRes?.items ?? []) as Array<{
    id: string;
    name: string;
    contact_person?: string | null;
    phone?: string | null;
  }>);
  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;

  // Yangi qator uchun standart maydonlar (foyda/doktor ulushi/ishlab chiqaruvchi)
  const blankLineExtras = {
    profit_percent: 0,
    doctor_share_kind: 'percent' as const,
    doctor_share_value: 0,
    manufacturer: '',
    manufacture_date: '',
  };

  const handleExcelImport = async (file: File) => {
    try {
      const { parseReceiptFile } = await import('@/lib/xlsx');
      const rows = await parseReceiptFile(file);
      if (rows.length === 0) {
        toast.error("Faylda ma'lumot topilmadi yoki ustun nomlari noto'g'ri");
        return;
      }
      let matched = 0;
      let unmatched = 0;
      const newLines: ReceiptLine[] = [];
      for (const row of rows) {
        try {
          const found = await api.pharmacy.searchMedications(row.name);
          const match =
            found?.find((m) => m.name.toLowerCase() === row.name.toLowerCase()) ?? found?.[0];
          if (match) {
            matched++;
            newLines.push({
              ...blankLineExtras,
              medication_id: match.medication_id,
              name: match.name,
              quantity: row.quantity,
              unit_cost_uzs: row.unit_cost_uzs,
              batch_no: row.batch_no ?? '',
              expiry_date: row.expiry_date ?? '',
            });
          } else {
            unmatched++;
          }
        } catch {
          unmatched++;
        }
      }
      if (newLines.length > 0) setLines((prev) => [...prev, ...newLines]);
      toast.success(
        `Import: ${matched} ta dori qo'shildi${unmatched > 0 ? `, ${unmatched} topilmadi` : ''}`,
      );
    } catch (err) {
      toast.error(`Import xatosi: ${(err as Error).message}`);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const { exportReceiptTemplate } = await import('@/lib/xlsx');
      await exportReceiptTemplate();
    } catch (err) {
      toast.error(`Shablon yuklashda xatolik: ${(err as Error).message}`);
    }
  };

  const { data: options } = useQuery({
    queryKey: ['pharmacy', 'search-recv', q],
    queryFn: () => api.pharmacy.searchMedications(q),
    enabled: pickerOpen,
  });

  const total = useMemo(
    () => lines.reduce((a, l) => a + l.quantity * l.unit_cost_uzs, 0),
    [lines],
  );
  const updateLine = (i: number, patch: Partial<ReceiptLine>) =>
    setLines((prev) => prev.map((x, ix) => (ix === i ? { ...x, ...patch } : x)));

  const handleReceiptBarcodeScan = async (code: string) => {
    try {
      const med = await api.pharmacy.findByBarcode(code);
      setLines((prev) => {
        const ix = prev.findIndex((l) => l.medication_id === med.id);
        if (ix >= 0) {
          const next = [...prev];
          next[ix] = { ...next[ix]!, quantity: next[ix]!.quantity + 1 };
          return next;
        }
        return [...prev, { ...blankLineExtras, medication_id: med.id, name: med.name, quantity: 1, unit_cost_uzs: 0, batch_no: '', expiry_date: '' }];
      });
      toast.success(`${med.name} ro'yxatga qo'shildi`);
    } catch {
      toast.error(`Barcode topilmadi: ${code}`);
    }
    setScanInput('');
  };

  const mut = useMutation({
    mutationFn: () =>
      api.pharmacy.receipt({
        supplier_id: supplierId || undefined,
        receipt_no: receiptNo || undefined,
        received_at: receivedAt ? new Date(`${receivedAt}T12:00:00`).toISOString() : undefined,
        paid_uzs: paidUzs ? Number(paidUzs) || 0 : undefined,
        notes: notes || undefined,
        items: lines.map((l) => ({
          medication_id: l.medication_id,
          quantity: l.quantity,
          unit_cost_uzs: l.unit_cost_uzs,
          profit_percent: l.profit_percent || 0,
          doctor_share_percent: l.doctor_share_kind === 'percent' ? l.doctor_share_value || 0 : 0,
          doctor_share_bonus_uzs: l.doctor_share_kind === 'bonus' ? l.doctor_share_value || 0 : 0,
          manufacturer: l.manufacturer || undefined,
          manufacture_date: l.manufacture_date || undefined,
          batch_no: l.batch_no || undefined,
          expiry_date: l.expiry_date || undefined,
        })),
      }),
    onSuccess: () => {
      setLines([]);
      setSupplierId('');
      setReceiptNo('');
      setPaidUzs('');
      setReceivedAt(new Date().toLocaleDateString('en-CA'));
      setNotes('');
      qc.invalidateQueries({ queryKey: ['pharmacy'] });
      toast.success('Prixot saqlandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Dorilar ro'yxati</CardTitle>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleExcelImport(file);
                    e.target.value = '';
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                title="Excel fayldan dorilarni import qilish (nom, mg, soni, narx, seriya, sana)"
              >
                <Upload className="mr-1 h-4 w-4" />
                Excel'dan import
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleDownloadTemplate()}
                title="Excel shabloni yuklab olish"
              >
                <Download className="mr-1 h-4 w-4" />
                Shablon
              </Button>
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Dori qo'shish
              </Button>
            </div>
          </div>
          {/* Barcode scan for receipt */}
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <ScanBarcode className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && scanInput.trim()) {
                  handleReceiptBarcodeScan(scanInput.trim());
                }
              }}
              placeholder="Barcode skaner yoki qo'lda kiriting → Enter"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Hali dori yo'q" description="Yuqoridan qo'shing yoki skaner bilan skanerlang" />
            </div>
          ) : (
            <div className="divide-y">
              {lines.map((l, i) => (
                <div key={l.medication_id + i} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{l.name}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Sotuv narxi: <b className="text-foreground">{fmt(salePriceOf(l))}</b> so'm
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setLines((prev) => prev.filter((_, ix) => ix !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <LineField label="Soni">
                      <Input type="number" value={l.quantity}
                        onChange={(e) => updateLine(i, { quantity: Math.max(0, Number(e.target.value) || 0) })} />
                    </LineField>
                    <LineField label="Tannarx (so'm)">
                      <Input type="number" value={l.unit_cost_uzs}
                        onChange={(e) => updateLine(i, { unit_cost_uzs: Math.max(0, Number(e.target.value) || 0) })} />
                    </LineField>
                    <LineField label="Foyda %">
                      <Input type="number" value={l.profit_percent}
                        onChange={(e) => updateLine(i, { profit_percent: Math.max(0, Number(e.target.value) || 0) })} />
                    </LineField>
                    <LineField label="Ishlab chiqaruvchi">
                      <Input value={l.manufacturer} placeholder="firma"
                        onChange={(e) => updateLine(i, { manufacturer: e.target.value })} />
                    </LineField>
                    <LineField label={`Doktor ulushi (${l.doctor_share_kind === 'percent' ? '%' : "so'm"})`}>
                      <div className="flex gap-1">
                        <Input type="number" className="flex-1" value={l.doctor_share_value}
                          onChange={(e) => updateLine(i, { doctor_share_value: Math.max(0, Number(e.target.value) || 0) })} />
                        <Select value={l.doctor_share_kind}
                          onValueChange={(v: 'percent' | 'bonus') => updateLine(i, { doctor_share_kind: v })}>
                          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percent">%</SelectItem>
                            <SelectItem value="bonus">so'm</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </LineField>
                    <LineField label="Seriya (partiya)">
                      <Input value={l.batch_no} onChange={(e) => updateLine(i, { batch_no: e.target.value })} />
                    </LineField>
                    <LineField label="Ishlab chiqarilgan">
                      <Input type="date" value={l.manufacture_date}
                        onChange={(e) => updateLine(i, { manufacture_date: e.target.value })} />
                    </LineField>
                    <LineField label="Yaroqlilik (tugash)">
                      <Input type="date" value={l.expiry_date}
                        onChange={(e) => updateLine(i, { expiry_date: e.target.value })} />
                    </LineField>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prihot ma'lumotlari</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LineField label="Yetkazib beruvchi firma">
            <div className="flex gap-1">
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Firma tanlang…" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" title="Yangi firma qo'shish" onClick={() => setNewSupplierOpen(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </LineField>
          {selectedSupplier && (selectedSupplier.contact_person || selectedSupplier.phone) && (
            <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {selectedSupplier.contact_person && <div>Olib keluvchi: {selectedSupplier.contact_person}</div>}
              {selectedSupplier.phone && <div>Tel: {selectedSupplier.phone}</div>}
            </div>
          )}

          <LineField label="Olib kelingan sana">
            <Input type="date" value={receivedAt} max={new Date().toLocaleDateString('en-CA')}
              onChange={(e) => setReceivedAt(e.target.value)} />
          </LineField>
          <Input
            placeholder="Prixot raqami (shart emas)"
            value={receiptNo}
            onChange={(e) => setReceiptNo(e.target.value)}
          />
          <Input placeholder="Izoh" value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Jami qiymati (tannarx)</span>
              <span className="font-semibold">{fmt(total)} so'm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pozitsiyalar</span>
              <span>{lines.length}</span>
            </div>
          </div>

          <LineField label="Firmaga to'langan summa">
            <Input type="number" placeholder="0" value={paidUzs}
              onChange={(e) => setPaidUzs(e.target.value)} />
          </LineField>
          <div className="flex justify-between rounded-md bg-amber-50 px-3 py-2 text-sm">
            <span className="text-amber-700">Firmaga qarz</span>
            <span className="font-semibold text-amber-800">{fmt(Math.max(0, total - (Number(paidUzs) || 0)))} so'm</span>
          </div>

          <Button
            className="w-full"
            disabled={lines.length === 0 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Saqlanmoqda…' : 'Omborga kirim qilish'}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dori tanlash</DialogTitle>
            <DialogDescription>Prihotga qo'shish uchun dori tanlang</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Qidiring…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="max-h-[40vh] overflow-y-auto divide-y rounded border">
            {(options ?? []).map((m) => (
              <button
                key={m.medication_id}
                onClick={() => {
                  setLines((prev) => [
                    ...prev,
                    {
                      ...blankLineExtras,
                      medication_id: m.medication_id,
                      name: m.name,
                      quantity: 1,
                      unit_cost_uzs: 0,
                      batch_no: '',
                      expiry_date: '',
                    },
                  ]);
                  setPickerOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
              >
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground">
                  Omborda: {m.qty_in_stock}
                </span>
              </button>
            ))}
            {(options ?? []).length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">Natija yo'q</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewSupplierDialog
        open={newSupplierOpen}
        onClose={() => setNewSupplierOpen(false)}
        onCreated={(id) => {
          setSupplierId(id);
          setNewSupplierOpen(false);
        }}
      />
    </div>
  );
}

// Prixot qatori/panel uchun yorliqli maydon
function LineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

// Yangi yetkazib beruvchi firma qo'shish (catalog suppliers)
function NewSupplierDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      api.catalog.create('suppliers', {
        name,
        contact_person: contact || undefined,
        phone: phone || undefined,
      }),
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ['catalog', 'suppliers'] });
      const id = (created as { id?: string })?.id;
      toast.success('Firma qo‘shildi');
      setName('');
      setContact('');
      setPhone('');
      if (id) onCreated(id);
      else onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi yetkazib beruvchi firma</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LineField label="Firma nomi *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Dori-Darmon" />
          </LineField>
          <LineField label="Olib keluvchi (F.I.O.)">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </LineField>
          <LineField label="Telefon">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998..." />
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={!name || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? 'Saqlanmoqda…' : 'Qo‘shish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CSV Import Tab
// ---------------------------------------------------------------------------
type CsvRow = {
  name: string;
  barcode?: string;
  manufacturer?: string;
  strength?: string;
  form?: string;
  price_uzs: number;
  cost_uzs?: number;
  reorder_level?: number;
};

const CSV_TEMPLATE =
  'name,barcode,manufacturer,strength,form,price_uzs,cost_uzs,reorder_level\n' +
  'Paracetamol 500mg,4780000001234,Pharmstandard,500mg,Tablet,5000,2500,20\n' +
  'Ibuprofen 200mg,,Acino,200mg,Capsule,8000,4000,10\n';

function parseSimpleCsv(text: string): CsvRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = line.split(',').map((v) => v.trim());
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
      return {
        name: obj['name'] ?? '',
        barcode: obj['barcode'] || undefined,
        manufacturer: obj['manufacturer'] || undefined,
        strength: obj['strength'] || undefined,
        form: obj['form'] || undefined,
        price_uzs: Number(obj['price_uzs']) || 0,
        cost_uzs: obj['cost_uzs'] ? Number(obj['cost_uzs']) : undefined,
        reorder_level: obj['reorder_level'] ? Number(obj['reorder_level']) : undefined,
      };
    })
    .filter((r) => r.name && r.price_uzs > 0);
}

function ImportTab() {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{ inserted: number; updated: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = useMutation({
    mutationFn: () => api.pharmacy.importCsv(rows),
    onSuccess: (data) => {
      setResult(data as typeof result);
      setRows([]);
      setFileName('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRows(parseSimpleCsv(text));
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(CSV_TEMPLATE);
    a.download = 'dorilar_shablon.csv';
    a.click();
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CSV orqali dorilarni import qilish</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-1 h-4 w-4" />
              Shablon CSV yuklab olish
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />
              CSV fayl yuklash
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          {fileName && (
            <p className="text-sm text-muted-foreground">
              Fayl: <span className="font-medium">{fileName}</span> — {rows.length} ta dori topildi
            </p>
          )}

          {/* Preview */}
          {rows.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">Ko'rinish (birinchi 10 ta):</div>
              <div className="overflow-x-auto rounded border text-xs">
                <table className="w-full">
                  <thead className="bg-muted/40">
                    <tr>
                      {['Nomi', 'Barcode', 'Ishlab chiqaruvchi', 'Kuch', 'Shakl', 'Narx', 'Tannarx', 'Min stok'].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5">{r.barcode ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.manufacturer ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.strength ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.form ?? '—'}</td>
                        <td className="px-2 py-1.5">{fmt(r.price_uzs)}</td>
                        <td className="px-2 py-1.5">{r.cost_uzs ? fmt(r.cost_uzs) : '—'}</td>
                        <td className="px-2 py-1.5">{r.reorder_level ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 10 && (
                <p className="mt-1 text-xs text-muted-foreground">… va yana {rows.length - 10} ta</p>
              )}

              <Button
                className="mt-3 w-full"
                disabled={importMut.isPending}
                onClick={() => importMut.mutate()}
              >
                {importMut.isPending ? 'Import qilinmoqda…' : `${rows.length} ta dorini import qilish`}
              </Button>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="rounded-md border p-4 space-y-2">
              <div className="text-sm font-medium text-success">Import yakunlandi</div>
              <div className="text-sm">
                ✅ Yangi: <strong>{result.inserted}</strong> ta · 🔄 Yangilandi: <strong>{result.updated}</strong> ta
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium text-destructive">
                    ⚠️ {result.errors.length} ta xato:
                  </div>
                  {result.errors.map((e) => (
                    <div key={e.row} className="text-xs text-muted-foreground">
                      {e.row}-qator: {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground space-y-1">
          <div className="font-medium text-foreground">CSV format:</div>
          <div>· <code>name</code>, <code>price_uzs</code> — majburiy</div>
          <div>· <code>barcode</code> — mavjud bo'lsa, bir xil barcodelar yangilanadi</div>
          <div>· <code>manufacturer, strength, form, cost_uzs, reorder_level</code> — ixtiyoriy</div>
          <div>· Kalit ustun ajratuvchi: vergul (,)</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mijoz-klinikalar (B2B)
// ---------------------------------------------------------------------------
type PharmClinic = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  notes: string | null;
  debt_uzs: number;
  doctors: Array<{ id: string; full_name: string; phone: string | null }>;
};

function ClinicsTab() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PharmClinic | null>(null);
  const [payTarget, setPayTarget] = useState<PharmClinic | null>(null);
  const [doctorTarget, setDoctorTarget] = useState<PharmClinic | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy', 'clinics'],
    queryFn: () => api.pharmacy.listClinics(),
  });
  const clinics = (data ?? []) as PharmClinic[];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pharmacy', 'clinics'] });

  const archiveClinic = useMutation({
    mutationFn: (id: string) => api.pharmacy.archiveClinic(id),
    onSuccess: () => { invalidate(); toast.success('Arxivlandi'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const archiveDoctor = useMutation({
    mutationFn: (id: string) => api.pharmacy.archiveClinicDoctor(id),
    onSuccess: () => { invalidate(); toast.success("Shifokor o'chirildi"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mijoz klinikalar</h2>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Klinika qo'shish
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Yuklanmoqda…</div>
      ) : clinics.length === 0 ? (
        <EmptyState title="Mijoz klinika yo'q" description="Dorixona sotadigan klinikalarni qo'shing" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {clinics.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{c.name}</div>
                    {c.contact_person && <div className="text-xs text-muted-foreground">{c.contact_person}</div>}
                    {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditing(c); setFormOpen(true); }}>
                      Tahrir
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (window.confirm('Klinikani arxivlash?')) archiveClinic.mutate(c.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className={'flex items-center justify-between rounded-md px-2 py-1.5 text-sm ' + (c.debt_uzs > 0 ? 'bg-amber-50 text-amber-800' : 'bg-muted/40 text-muted-foreground')}>
                  <span>Qarzi</span>
                  <span className="font-semibold">{fmt(c.debt_uzs)} so'm</span>
                </div>
                {c.debt_uzs > 0 && (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setPayTarget(c)}>
                    <Wallet className="mr-1 h-4 w-4" /> Qarz to'lash
                  </Button>
                )}

                <div className="border-t pt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Shifokorlar</span>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setDoctorTarget(c)}>
                      <Plus className="mr-0.5 h-3 w-3" /> qo'shish
                    </Button>
                  </div>
                  {c.doctors.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Shifokor yo'q</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.doctors.map((d) => (
                        <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                          {d.full_name}
                          <button
                            className="text-muted-foreground hover:text-rose-600"
                            onClick={() => { if (window.confirm(`${d.full_name} o'chirilsinmi?`)) archiveDoctor.mutate(d.id); }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <ClinicFormDialog initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={invalidate} />
      )}
      {payTarget && <PayDebtDialog clinic={payTarget} onClose={() => setPayTarget(null)} onSaved={invalidate} />}
      {doctorTarget && <AddDoctorDialog clinic={doctorTarget} onClose={() => setDoctorTarget(null)} onSaved={invalidate} />}
    </div>
  );
}

function ClinicFormDialog({ initial, onClose, onSaved }: { initial: PharmClinic | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [contact, setContact] = useState(initial?.contact_person ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const mut = useMutation({
    mutationFn: () => {
      const body = { name, contact_person: contact || undefined, phone: phone || undefined, notes: notes || undefined };
      return initial ? api.pharmacy.updateClinic(initial.id, body) : api.pharmacy.createClinic(body);
    },
    onSuccess: () => { toast.success('Saqlandi'); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{initial ? 'Klinikani tahrirlash' : 'Yangi mijoz klinika'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <LineField label="Klinika nomi *"><Input value={name} onChange={(e) => setName(e.target.value)} /></LineField>
          <LineField label="Mas'ul shaxs"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></LineField>
          <LineField label="Telefon"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998..." /></LineField>
          <LineField label="Izoh"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={!name || mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDoctorDialog({ clinic, onClose, onSaved }: { clinic: PharmClinic; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const mut = useMutation({
    mutationFn: () => api.pharmacy.addClinicDoctor(clinic.id, { full_name: fullName, phone: phone || undefined }),
    onSuccess: () => { toast.success("Shifokor qo'shildi"); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{clinic.name} — shifokor qo'shish</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <LineField label="F.I.O. *"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></LineField>
          <LineField label="Telefon"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={!fullName || mut.isPending} onClick={() => mut.mutate()}>Qo'shish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDebtDialog({ clinic, onClose, onSaved }: { clinic: PharmClinic; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(clinic.debt_uzs));
  const [method, setMethod] = useState('cash');
  const mut = useMutation({
    mutationFn: () => api.pharmacy.payClinicDebt(clinic.id, { amount_uzs: Number(amount) || 0, payment_method: method }),
    onSuccess: () => { toast.success("Qarz to'lovi qabul qilindi"); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{clinic.name} — qarz to'lash</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Joriy qarz: <b>{fmt(clinic.debt_uzs)}</b> so'm
          </div>
          <LineField label="To'lov summasi (so'm)"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></LineField>
          <LineField label="To'lov turi">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Plastik</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="transfer">O'tkazma</SelectItem>
              </SelectContent>
            </Select>
          </LineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={!amount || Number(amount) <= 0 || mut.isPending} onClick={() => mut.mutate()}>To'lash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
