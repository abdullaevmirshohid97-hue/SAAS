import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarRange,
  Coins,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  Lock,
  PiggyBank,
  Plus,
  Printer,
  Receipt,
  Search,
  Settings,
  TrendingUp,
  Trash2,
  Wallet,
  AlertCircle,
  X,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
} from '@clary/ui-web';

import { toast } from 'sonner';

import { api } from '@/lib/api';
import { paymentReceiptHtml, printReceiptHybrid } from '@/lib/print-receipt';
import { useAuth } from '@/providers/auth-provider';
import { CashFlowWidget } from '@/components/cashier/cash-flow-widget';
import { EncashDialog } from '@/components/cashier/encash-dialog';
import { DrawerPanelDialog } from '@/components/cashier/drawer-panel-dialog';
import { AdjustmentDialog } from '@/components/cashier/adjustment-dialog';
import { SourcePicker } from '@/components/cashier/source-picker';
import { SafePanelDialog } from '@/components/cashier/safe-panel-dialog';

// Daromad maydonlari yashirin — PIN orqali ochiladi. 5 daqiqa davomida
// ochiq qoladi, keyin yana yashiriladi.
const REVEAL_KEY = 'cashier_revenue_revealed_until';
const REVEAL_TTL_MS = 5 * 60_000;
function isRevenueRevealed() {
  const v = sessionStorage.getItem(REVEAL_KEY);
  return v ? Number(v) > Date.now() : false;
}
function setRevenueRevealed() {
  sessionStorage.setItem(REVEAL_KEY, String(Date.now() + REVEAL_TTL_MS));
}
function lockRevenue() {
  sessionStorage.removeItem(REVEAL_KEY);
}

type FilterPreset = 'today' | 'week' | 'month' | 'custom';
type TabId = 'transactions' | 'expenses' | 'debtors';

const PAYMENT_METHODS = [
  { v: 'cash', label: 'Naqd' },
  { v: 'card', label: 'Karta' },
  { v: 'transfer', label: "O'tkazma" },
  { v: 'click', label: 'Click' },
  { v: 'payme', label: 'Payme' },
  { v: 'humo', label: 'Humo' },
  { v: 'uzcard', label: 'Uzcard' },
] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number]['v'];

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function rangeFor(preset: FilterPreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  // Custom oraliq — ikkala sana to'lganda
  if (preset === 'custom' && customFrom && customTo) {
    return {
      from: new Date(`${customFrom}T00:00:00`).toISOString(),
      to: new Date(`${customTo}T23:59:59`).toISOString(),
    };
  }
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  if (preset === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'week') {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

// Tanlangan davr to'lovlarini CSV qilib yuklab beradi
async function exportCashierCsv(from: string, to: string, method: string) {
  try {
    const data = await api.cashier.transactions({
      from,
      to,
      method: method === 'all' ? undefined : method,
      include_void: true,
      limit: 1000,
    });
    const txs = (data as Array<{
      created_at: string;
      amount_uzs: number;
      kind: string;
      payment_method: string;
      is_void?: boolean;
      patient?: { full_name?: string; phone?: string | null } | null;
      items?: Array<{ service_name_snapshot: string; quantity: number }>;
    }>) ?? [];
    const header = ['Sana/Vaqt', 'Bemor', 'Telefon', 'Xizmatlar', "To'lov usuli", 'Tur', 'Summa', 'Holat'];
    const rows = txs.map((t) => [
      new Date(t.created_at).toLocaleString('uz-UZ'),
      t.patient?.full_name ?? '',
      t.patient?.phone ?? '',
      (t.items ?? []).map((i) => `${i.service_name_snapshot} ×${i.quantity}`).join('; '),
      t.payment_method,
      t.kind,
      String(t.amount_uzs),
      t.is_void ? 'Bekor qilingan' : '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kassa-${from.slice(0, 10)}_${to.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${txs.length} ta yozuv eksport qilindi`);
  } catch (e) {
    toast.error((e as Error).message || 'Eksport xatosi');
  }
}

export function CashierPage() {
  const [tab, setTab] = useState<TabId>('transactions');
  const [preset, setPreset] = useState<FilterPreset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [method, setMethod] = useState<string>('all');
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [encashOpen, setEncashOpen] = useState(false);
  // Inkasatsiya oldindan to'ldirilgan summa (seyfga o'tmagan naqddan bir bosishda).
  const [encashPrefill, setEncashPrefill] = useState<{ amount?: number; destination?: string } | null>(null);
  // "Seyfga o'tmagan naqd" paneli (ro'yxat + seyfga olish).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // KPI karta drill-down — endi alohida SAHIFA (/cashier/detail/:metric).
  const navigate = useNavigate();
  const goDetail = (metric: string, params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
    navigate(`/cashier/detail/${metric}?${qs.toString()}`);
  };
  const kpiNow = new Date();
  const kpiToday = new Date(kpiNow.getFullYear(), kpiNow.getMonth(), kpiNow.getDate()).toISOString();
  const kpiMonth = new Date(kpiNow.getFullYear(), kpiNow.getMonth(), 1).toISOString();
  const kpiNowIso = kpiNow.toISOString();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [safePanelOpen, setSafePanelOpen] = useState(false);
  const { role: userRole } = useAuth();
  const isAdminRole = userRole === 'clinic_admin' || userRole === 'clinic_owner' || userRole === 'super_admin';
  const [refundOpen, setRefundOpen] = useState(false);
  const [depositWdOpen, setDepositWdOpen] = useState(false);
  const [debtPayOpen, setDebtPayOpen] = useState<null | { patient_id: string; full_name: string; debt_uzs: number }>(null);
  const [revealed, setRevealed] = useState(isRevenueRevealed());
  const [pinDialog, setPinDialog] = useState(false);

  const { from, to } = rangeFor(preset, customFrom, customTo);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['cashier', 'kpis'],
    queryFn: () => api.cashier.kpis(),
    refetchInterval: 30_000,
  });

  // Seyfga o'tmagan naqd (drawer cash on hand)
  const { data: cashOnHand } = useQuery({
    queryKey: ['cashier', 'cash-on-hand'],
    queryFn: () => api.cashier.cashOnHand(),
    refetchInterval: 30_000,
  });
  const cashNotInSafe = cashOnHand?.cash_on_hand_uzs ?? 0;

  // Seyf balansi (seyfdagi pul)
  const { data: safeBal } = useQuery({
    queryKey: ['cashier', 'safe-balance', 'reception'],
    queryFn: () => api.cashier.safeBalance(),
    refetchInterval: 30_000,
  });

  return (
    // Jurnaldagidek qat'iy balandlikdagi ustun: yuqori bloklar (KPI, kartlar,
    // tab+filtr) tepada qotadi, faqat ro'yxat (pastda) scroll bo'ladi.
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 90px)' }}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kassa</h1>
          <p className="text-sm text-muted-foreground">
            Barcha tushum, rasxot va naqdlik bo‘yicha yaxlit boshqaruv
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PresetFilter
            value={preset}
            onChange={setPreset}
            customFrom={customFrom}
            customTo={customTo}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
          />
          <Button variant="outline" onClick={() => exportCashierCsv(from, to, method)}>
            <Download className="mr-1 h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" onClick={() => navigate('/cashier/salaries')}>
            <Coins className="mr-1 h-4 w-4" />
            Maoshlar
          </Button>
          <Button variant="outline" onClick={() => setSafePanelOpen(true)} className="border-amber-400 text-amber-700 hover:bg-amber-50">
            <Archive className="mr-1 h-4 w-4" />
            Seyf
          </Button>
          <Button variant="outline" onClick={() => { setEncashPrefill(null); setEncashOpen(true); }}>
            <Banknote className="mr-1 h-4 w-4" />
            Pulni olish
          </Button>
          {isAdminRole && (
            <Button variant="outline" onClick={() => setAdjustmentOpen(true)}>
              <Settings className="mr-1 h-4 w-4" />
              Tuzatish
            </Button>
          )}
          <Button onClick={() => setExpenseOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Rasxot qo‘shish
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bugungi tushum"
          value={kpisLoading ? '…' : `${fmt(kpis?.today ?? 0)} UZS`}
          icon={<Wallet className="h-4 w-4" />}
          tone="success"
          onClick={() => goDetail('revenue', { from: kpiToday, to: kpiNowIso, label: 'Bugun' })}
          trend={
            kpisLoading || !kpis
              ? undefined
              : {
                  value:
                    kpis.yesterday === 0
                      ? 100
                      : ((kpis.today - kpis.yesterday) / Math.max(1, kpis.yesterday)) * 100,
                  label: 'vs kecha',
                }
          }
        />
        <StatCard
          label="Oylik tushum"
          value={
            kpisLoading
              ? '…'
              : revealed
                ? `${fmt(kpis?.month_revenue ?? 0)} UZS`
                : '••••••• UZS'
          }
          icon={
            revealed ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )
          }
          tone="info"
          onClick={
            revealed
              ? () => goDetail('revenue', { from: kpiMonth, to: kpiNowIso, label: 'Joriy oy' })
              : () => setPinDialog(true)
          }
        />
        <StatCard
          label="Oylik rasxot"
          value={kpisLoading ? '…' : `${fmt(kpis?.month_expenses ?? 0)} UZS`}
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="warning"
          onClick={() => goDetail('expenses', { from: kpiMonth, to: kpiNowIso, label: 'Joriy oy' })}
        />
        <StatCard
          label="Oylik sof foyda"
          value={
            kpisLoading
              ? '…'
              : revealed
                ? `${fmt(kpis?.month_profit ?? 0)} UZS`
                : '••••••• UZS'
          }
          icon={
            revealed ? (
              <PiggyBank className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )
          }
          tone={revealed && (kpis?.month_profit ?? 0) >= 0 ? 'success' : 'danger'}
          onClick={
            revealed
              ? () => goDetail('profit', { from: kpiMonth, to: kpiNowIso, label: 'Joriy oy' })
              : () => setPinDialog(true)
          }
        />
      </div>

      {/* Reveal/Lock boshqaruvi */}
      <div className="flex shrink-0 items-center justify-end gap-2 text-xs">
        {revealed ? (
          <button
            type="button"
            onClick={() => {
              lockRevenue();
              setRevealed(false);
              toast.success('Daromad maydonlari yashirildi');
            }}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-muted-foreground hover:bg-accent"
          >
            <EyeOff className="h-3.5 w-3.5" /> Yashirish
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPinDialog(true)}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-muted-foreground hover:bg-accent"
          >
            <Eye className="h-3.5 w-3.5" /> Daromadni ko'rsatish (PIN)
          </button>
        )}
      </div>

      {pinDialog && (
        <RevenuePinDialog
          onClose={() => setPinDialog(false)}
          onVerified={() => {
            setRevenueRevealed();
            setRevealed(true);
            setPinDialog(false);
            toast.success('Daromad maydonlari ochildi (5 daqiqa)');
          }}
        />
      )}

      <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Seyfga o'tmagan naqd"
          value={`${fmt(cashNotInSafe)} UZS`}
          icon={<Banknote className="h-4 w-4" />}
          tone={cashNotInSafe > 0 ? 'warning' : undefined}
          onClick={() => setDrawerOpen(true)}
        />
        <StatCard
          label="Seyfdagi pul"
          value={`${fmt(safeBal?.safe_balance_uzs ?? 0)} UZS`}
          icon={<Archive className="h-4 w-4" />}
          tone="info"
          onClick={() => setSafePanelOpen(true)}
        />
        <StatCard
          label="Ochiq smenalar"
          value={kpisLoading ? '…' : String(kpis?.open_shifts ?? 0)}
          icon={<Coins className="h-4 w-4" />}
        />
        <StatCard
          label="Dorixona qarzi"
          value={kpisLoading ? '…' : `${fmt(kpis?.pharmacy_debt ?? 0)} UZS`}
          icon={<AlertCircle className="h-4 w-4" />}
          tone={(kpis?.pharmacy_debt ?? 0) > 0 ? 'danger' : undefined}
          onClick={() => goDetail('pharmacy_debt', { label: 'Dorixona qarzdorlari' })}
        />
        <StatCard
          label="Statsionar qarzi"
          value={kpisLoading ? '…' : `${fmt(kpis?.inpatient_debt ?? 0)} UZS`}
          icon={<AlertCircle className="h-4 w-4" />}
          tone={(kpis?.inpatient_debt ?? 0) > 0 ? 'danger' : undefined}
          onClick={() => goDetail('inpatient_debt', { label: 'Qarzdor bemorlar' })}
        />
      </div>

      <Card className="shrink-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bugungi to‘lov usullari</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(kpis?.by_payment_method_today ?? {}).map(([m, v]) => (
              <button
                key={m}
                type="button"
                onClick={() => goDetail('method', { method: m, from: kpiToday, to: kpiNowIso, label: m })}
                title="Shu usul bo'yicha to'lovlar"
              >
                <Badge variant="secondary" className="cursor-pointer text-sm hover:bg-accent">
                  {m}: {fmt(v)}
                </Badge>
              </button>
            ))}
            {Object.keys(kpis?.by_payment_method_today ?? {}).length === 0 && (
              <span className="text-xs text-muted-foreground">Hali to‘lovlar yo‘q</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cash flow widget — har to'lov usuli bo'yicha kirim/chiqim */}
      <div className="shrink-0">
        <CashFlowWidget />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border bg-muted/30 p-1">
          <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')}>
            <Receipt className="mr-1 h-4 w-4" /> To‘lovlar
          </TabButton>
          <TabButton active={tab === 'expenses'} onClick={() => setTab('expenses')}>
            <ArrowDownRight className="mr-1 h-4 w-4" /> Rasxotlar
          </TabButton>
          <TabButton active={tab === 'debtors'} onClick={() => setTab('debtors')}>
            <AlertCircle className="mr-1 h-4 w-4" /> Qarzdorlar
          </TabButton>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setRefundOpen(true)} className="gap-1">
            <ArrowUpRight className="h-4 w-4 rotate-180" />
            Vozvrat
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDepositWdOpen(true)} className="gap-1">
            <PiggyBank className="h-4 w-4" />
            Depozit qaytarish
          </Button>
        </div>

        {tab === 'transactions' && (
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="To‘lov usuli" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barchasi</SelectItem>
              <SelectItem value="cash">Naqd</SelectItem>
              <SelectItem value="card">Plastik</SelectItem>
              <SelectItem value="click">Click</SelectItem>
              <SelectItem value="payme">Payme</SelectItem>
              <SelectItem value="transfer">O‘tkazma</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Ro'yxat — faqat shu qism scroll bo'ladi (flex-1). */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'transactions' ? (
          <TransactionsList from={from} to={to} method={method === 'all' ? undefined : method} />
        ) : tab === 'expenses' ? (
          <ExpensesList from={from.slice(0, 10)} to={to.slice(0, 10)} />
        ) : (
          <DebtorsList onPay={(d) => setDebtPayOpen(d)} />
        )}
      </div>

      <ExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} />
      {encashOpen && (
        <EncashDialog
          onClose={() => { setEncashOpen(false); setEncashPrefill(null); }}
          defaultAmount={encashPrefill?.amount}
          defaultDestination={encashPrefill?.destination}
        />
      )}
      {drawerOpen && <DrawerPanelDialog onClose={() => setDrawerOpen(false)} />}
      {adjustmentOpen && <AdjustmentDialog onClose={() => setAdjustmentOpen(false)} />}
      {safePanelOpen && <SafePanelDialog onClose={() => setSafePanelOpen(false)} />}
      <RefundDialog open={refundOpen} onOpenChange={setRefundOpen} />
      <DepositWithdrawDialog open={depositWdOpen} onOpenChange={setDepositWdOpen} />
      <DebtPaymentDialog
        debtor={debtPayOpen}
        onClose={() => setDebtPayOpen(null)}
      />
    </div>
  );
}

// ============================================================================
// PATIENT PICKER — qidiruv orqali bemor tanlash (refund/deposit/debt uchun)
// ============================================================================
function PatientPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (p: { id: string; full_name: string } | null) => void;
}) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['cashier-patient-search', q],
    queryFn: () => api.patients.list({ q, pageSize: 10 }),
    enabled: q.length > 1,
  });
  const items = ((data as { items?: Array<{ id: string; full_name: string }> } | undefined)?.items) ?? [];
  return (
    <div className="space-y-1.5">
      <Input
        placeholder="Bemor F.I.O. yoki telefon..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.length > 1 && items.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-md border">
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p);
                setQ(p.full_name);
              }}
              className={
                'block w-full px-3 py-1.5 text-left text-sm hover:bg-accent ' +
                (selectedId === p.id ? 'bg-primary/10 text-primary' : '')
              }
            >
              {p.full_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VOZVRAT DIALOG
// ============================================================================
function RefundDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [patient, setPatient] = useState<{ id: string; full_name: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<'cash_drawer' | 'safe'>('cash_drawer');
  const [pin, setPin] = useState('');

  const mut = useMutation({
    // Avval navbatchi PIN tasdiqlanadi, keyin vozvrat
    mutationFn: async () => {
      await api.shifts.verifyActivePin(pin);
      return api.cashier.refund({
        patient_id: patient!.id,
        amount_uzs: Number(amount) || 0,
        payment_method: method,
        reason,
        source,
      });
    },
    onSuccess: () => {
      toast.success('Vozvrat amalga oshirildi');
      qc.invalidateQueries({ queryKey: ['cashier'] });
      setPatient(null);
      setAmount('');
      setReason('');
      setPin('');
      setSource('cash_drawer');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Noto'g'ri PIN"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 rotate-180 text-amber-600" />
            Vozvrat — pul qaytarish
          </DialogTitle>
          <DialogDescription>
            Mijozga pul qaytarish (xizmat berilmaganda yoki sifatsiz bo'lganda).
            Kassadan chiqim sifatida yoziladi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <div className="mb-1 text-xs font-medium">Bemor *</div>
            <PatientPicker selectedId={patient?.id ?? null} onSelect={setPatient} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs font-medium">Summa (so'm) *</div>
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100000"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">To'lov turi *</div>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((p) => (
                    <SelectItem key={p.v} value={p.v}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium">Sabab *</div>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Masalan: xizmat sifatsiz, mijoz noroziligi"
            />
          </div>
          <SourcePicker value={source} onChange={setSource} amount={Number(amount) || undefined} />
          <div>
            <div className="mb-1 text-xs font-medium">Navbatchi PIN *</div>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="••••"
              className="text-center font-mono tracking-[0.3em]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Bekor
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!patient || !amount || !reason || pin.length < 4 || mut.isPending}
            className="gap-1"
          >
            <ArrowUpRight className="h-4 w-4 rotate-180" />
            {mut.isPending ? "Bajarilmoqda..." : "Qaytarish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DEPOZIT QAYTARISH DIALOG (statsionar/bemor depozitidan naqd chiqarish)
// ============================================================================
function DepositWithdrawDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [patient, setPatient] = useState<{ id: string; full_name: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState<'cash_drawer' | 'safe'>('cash_drawer');

  // Tanlangan bemorning depozit balansini ko'rsatish
  const { data: balance } = useQuery({
    queryKey: ['cashier-patient-balance', patient?.id],
    queryFn: () => api.cashier.patientBalance(patient!.id),
    enabled: !!patient,
  });
  const balanceNum = Number(balance?.balance_uzs ?? 0);
  const amountNum = Math.max(0, Number(amount) || 0);
  const overBalance = amountNum > balanceNum;

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.depositWithdraw({
        patient_id: patient!.id,
        amount_uzs: amountNum,
        payment_method: method,
        reason: reason || undefined,
        source,
      }),
    onSuccess: (r) => {
      toast.success(`Qaytarildi. Yangi balans: ${fmt(r.new_balance_uzs)} so'm`);
      qc.invalidateQueries({ queryKey: ['cashier'] });
      qc.invalidateQueries({ queryKey: ['cashier-patient-balance', patient?.id] });
      setPatient(null);
      setAmount('');
      setReason('');
      setSource('cash_drawer');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-sky-600" />
            Depozit qaytarish
          </DialogTitle>
          <DialogDescription>
            Bemor depozit hisobidan naqd pul chiqarish. Bemor balansi kamayadi va
            kassadan chiqim qilinadi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <div className="mb-1 text-xs font-medium">Bemor *</div>
            <PatientPicker selectedId={patient?.id ?? null} onSelect={setPatient} />
          </div>
          {patient && (
            <div
              className={
                'rounded-md border p-2 text-sm ' +
                (balanceNum > 0
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-red-300 bg-red-50 text-red-900')
              }
            >
              Joriy balans:{' '}
              <strong className="font-mono">{fmt(balanceNum)} so'm</strong>
              {balanceNum <= 0 && (
                <div className="mt-1 text-xs">Bemor depozit hisobi bo'sh yoki qarzdor.</div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs font-medium">Summa (so'm) *</div>
              <Input
                type="number"
                min={0}
                max={balanceNum}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50000"
              />
              {overBalance && (
                <div className="mt-1 text-[11px] text-red-600">
                  Balansdan oshib ketdi (maks {fmt(balanceNum)} so'm)
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">To'lov turi *</div>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((p) => (
                    <SelectItem key={p.v} value={p.v}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium">Sabab (ixtiyoriy)</div>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Masalan: bemor chiqib ketdi, qoldiq qaytarildi"
            />
          </div>
          <SourcePicker value={source} onChange={setSource} amount={amountNum} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Bekor
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!patient || !amount || overBalance || balanceNum <= 0 || mut.isPending}
            className="gap-1"
          >
            <PiggyBank className="h-4 w-4" />
            {mut.isPending ? "Bajarilmoqda..." : "Qaytarish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// QARZDORLAR RO'YXATI
// ============================================================================
function DebtorsList({
  onPay,
}: {
  onPay: (d: { patient_id: string; full_name: string; debt_uzs: number }) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['cashier', 'debtors'],
    queryFn: () => api.cashier.debtors(),
  });
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.debt_uzs), 0);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Qarzdor bemorlar ({rows.length})</CardTitle>
        <div className="text-sm">
          Jami qarz:{' '}
          <strong className="font-mono text-red-600">{fmt(total)} so'm</strong>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto p-0">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<AlertCircle className="h-8 w-8" />}
            title="Qarzdor bemor yo'q"
            description="Barcha bemor hisoblari yopiq"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/95 text-left text-xs uppercase text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-2.5">Bemor</th>
                  <th className="px-4 py-2.5">Telefon</th>
                  <th className="px-4 py-2.5 text-right">Qarz</th>
                  <th className="px-4 py-2.5 text-right">Amal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{r.full_name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {r.phone ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-600">
                      {fmt(r.debt_uzs)} so'm
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        onClick={() =>
                          onPay({
                            patient_id: r.id,
                            full_name: r.full_name,
                            debt_uzs: r.debt_uzs,
                          })
                        }
                        className="gap-1"
                      >
                        <Coins className="h-3.5 w-3.5" />
                        Qarz to'lash
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// QARZ TO'LASH DIALOG
// ============================================================================
function DebtPaymentDialog({
  debtor,
  onClose,
}: {
  debtor: null | { patient_id: string; full_name: string; debt_uzs: number };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');

  // Dialog ochilganda default summa = qarz
  useMemo(() => {
    if (debtor) setAmount(String(debtor.debt_uzs));
  }, [debtor]);

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.debtPayment({
        patient_id: debtor!.patient_id,
        amount_uzs: Number(amount) || 0,
        payment_method: method,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success("Qarz to'landi");
      qc.invalidateQueries({ queryKey: ['cashier'] });
      setAmount('');
      setNotes('');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!debtor) return null;
  const amtNum = Math.max(0, Number(amount) || 0);
  const remaining = Math.max(0, debtor.debt_uzs - amtNum);

  return (
    <Dialog open={!!debtor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-600" />
            Qarz to'lash — {debtor.full_name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
            Joriy qarz:{' '}
            <strong className="font-mono">{fmt(debtor.debt_uzs)} so'm</strong>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs font-medium">To'lanadigan summa *</div>
              <div className="flex gap-1">
                <Input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAmount(String(debtor.debt_uzs))}
                  className="px-2 text-xs"
                >
                  To'liq
                </Button>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">To'lov turi *</div>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((p) => (
                    <SelectItem key={p.v} value={p.v}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {remaining > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              Qisman to'lov. Qoldiq qarz: <strong>{fmt(remaining)} so'm</strong>
            </div>
          )}
          {amtNum > debtor.debt_uzs && (
            <div className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
              Ortiqcha to'lov. Bemor depozitiga{' '}
              <strong>+{fmt(amtNum - debtor.debt_uzs)} so'm</strong> qo'shiladi.
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-medium">Izoh</div>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ixtiyoriy"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!amount || amtNum <= 0 || mut.isPending}
            className="gap-1"
          >
            <Coins className="h-4 w-4" />
            {mut.isPending ? 'Saqlanmoqda...' : "To'lash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function PresetFilter({
  value,
  onChange,
  customFrom,
  customTo,
  onFromChange,
  onToChange,
}: {
  value: FilterPreset;
  onChange: (v: FilterPreset) => void;
  customFrom: string;
  customTo: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const items: Array<{ id: FilterPreset; label: string }> = [
    { id: 'today', label: 'Bugun' },
    { id: 'week', label: 'Hafta' },
    { id: 'month', label: 'Oy' },
    { id: 'custom', label: 'Oraliq' },
  ];
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => onChange(i.id)}
            className={
              'rounded px-3 py-1.5 text-xs font-medium transition ' +
              (value === i.id ? 'bg-background shadow-elevation-1' : 'text-muted-foreground')
            }
          >
            {i.label}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <div className="inline-flex items-center gap-1.5">
          <Input
            type="date"
            className="h-8 w-[150px]"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => onFromChange(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <Input
            type="date"
            className="h-8 w-[150px]"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => onToChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition ' +
        (active ? 'bg-background shadow-elevation-1' : 'text-muted-foreground')
      }
    >
      {children}
    </button>
  );
}

function TransactionsList({
  from,
  to,
  method,
}: {
  from: string;
  to: string;
  method?: string;
}) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === 'clinic_admin' || role === 'clinic_owner' || role === 'super_admin';
  const [search, setSearch] = useState('');
  const [includeVoid, setIncludeVoid] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ id: string; amount: number; patient?: string } | null>(null);

  // Chek qayta chop etish uchun klinika nomi
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicName = (me as { clinic?: { name?: string } } | undefined)?.clinic?.name ?? 'Klinika';

  const { data, isLoading } = useQuery({
    queryKey: ['cashier', 'transactions', from, to, method, search, includeVoid],
    queryFn: () =>
      api.cashier.transactions({
        from,
        to,
        method,
        search: search || undefined,
        include_void: includeVoid,
      }),
    refetchInterval: 20_000,
  });
  const rows = (data as Array<{
    id: string;
    created_at: string;
    amount_uzs: number;
    kind: string;
    payment_method: string;
    notes?: string | null;
    is_void?: boolean;
    ticket_no?: string | null;
    paid_amount_uzs?: number | null;
    debt_uzs?: number | null;
    patient?: { full_name?: string; phone?: string | null } | null;
    items?: Array<{ service_name_snapshot: string; quantity: number; final_amount_uzs?: number | null }>;
  }>) ?? [];

  // Chekni qayta chop etish — reception checkout bilan bir xil chek shabloni
  const reprint = (t: (typeof rows)[number]) => {
    const dateStr = new Date(t.created_at).toLocaleString('uz-UZ');
    const patientName = t.patient?.full_name ?? 'Mijoz';
    const items = (t.items ?? []).map((it) => ({
      name: it.service_name_snapshot,
      qty: it.quantity,
      amount: Number(it.final_amount_uzs ?? 0),
    }));
    const totalUzs = Number(t.amount_uzs ?? 0);
    const paidUzs = Number(t.paid_amount_uzs ?? t.amount_uzs ?? 0);
    const debtUzs = Number(t.debt_uzs ?? 0);
    const fallbackHtml = paymentReceiptHtml({
      clinicName,
      ticketNo: t.ticket_no ?? null,
      date: dateStr,
      patientName,
      items,
      totalUzs,
      paidUzs,
      debtUzs,
      paymentMethod: t.payment_method,
      transactionId: t.id,
    });
    void printReceiptHybrid(
      {
        header: clinicName,
        title: "TO'LOV CHEKI",
        lines: [
          { text: `Sana: ${dateStr}` },
          { text: `Bemor: ${patientName || '—'}` },
          ...(t.ticket_no ? [{ text: `Navbat: ${t.ticket_no}`, bold: true }] : []),
        ],
        items: items.map((i) => ({ name: i.name, qty: i.qty, amount: i.amount })),
        total_uzs: totalUzs,
        paid_uzs: paidUzs,
        debt_uzs: debtUzs > 0 ? debtUzs : undefined,
        footer: "Rahmat! Sog'ligingizga shifo tilaymiz!",
        cut: true,
      },
      fallbackHtml,
      'receipt',
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="shrink-0">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Bemor ismi / telefon / ID boshi"
                className="h-9 pl-8 text-sm"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeVoid}
                onChange={(e) => setIncludeVoid(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Bekor qilinganlarni ko'rsatish
            </label>
            <span className="text-xs text-muted-foreground">
              Topildi: <b>{rows.length}</b>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardContent className="min-h-0 flex-1 overflow-auto p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Bo‘lim bo‘sh" description="Ushbu filter uchun to‘lovlar yo‘q" />
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((t) => (
                <div
                  key={t.id}
                  className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 ${
                    t.is_void ? 'opacity-50 line-through' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {t.patient?.full_name ?? 'Mijoz yoʻq'} · {t.items?.length ?? 0} xizmat
                      {t.is_void && (
                        <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 no-underline">
                          Bekor qilingan
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString('uz-UZ')} · {t.payment_method} · {t.kind}
                    </div>
                  </div>
                  <div
                    className={
                      'text-right font-semibold ' +
                      (t.kind === 'refund' ? 'text-destructive' : 'text-foreground')
                    }
                  >
                    {t.kind === 'refund' ? '-' : '+'}
                    {fmt(t.amount_uzs)} UZS
                  </div>
                  <div className="inline-flex items-center gap-1">
                    {!t.is_void && t.kind !== 'refund' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:bg-muted"
                        title="Chekni qayta chop etish"
                        onClick={() => reprint(t)}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isAdmin && !t.is_void && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50"
                        title="Bekor qilish"
                        onClick={() =>
                          setVoidTarget({
                            id: t.id,
                            amount: t.amount_uzs,
                            patient: t.patient?.full_name ?? undefined,
                          })
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {voidTarget && (
        <VoidTransactionDialog
          target={voidTarget}
          onClose={() => setVoidTarget(null)}
          onSuccess={() => {
            qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cashier' });
            // 'journal', 'journal-feed', 'journal-summary' — barchasini yangilash
            qc.invalidateQueries({
              predicate: (q) => String(q.queryKey[0]).startsWith('journal'),
            });
            setVoidTarget(null);
          }}
        />
      )}
    </div>
  );
}

// Tx void dialog — admin only, sabab majburiy
function VoidTransactionDialog({
  target,
  onClose,
  onSuccess,
}: {
  target: { id: string; amount: number; patient?: string };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const mut = useMutation({
    // Avval navbatchi PIN tasdiqlanadi, keyin void bajariladi
    mutationFn: async () => {
      await api.shifts.verifyActivePin(pin);
      return api.transactions.void(target.id, { reason });
    },
    onSuccess: () => {
      toast.success(`Tranzaksiya bekor qilindi (${fmt(target.amount)} UZS)`);
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message || "Noto'g'ri PIN"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tranzaksiyani bekor qilish</DialogTitle>
          <DialogDescription>
            Bu amal qaytariladi: doctor_commissions reversed, qarz qaytadi.
            Audit izi saqlanadi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div>
              <b>{target.patient ?? 'Mijoz yo\'q'}</b> — {fmt(target.amount)} UZS
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              ID: {target.id.slice(0, 8)}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Sabab (majburiy, kamida 3 belgi)
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Masalan: bemor xizmat olmadi"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Navbatchi PIN (majburiy)
            </label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="••••"
              className="text-center font-mono tracking-[0.3em]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3 || pin.length < 4 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Tekshirilmoqda…' : 'Ha, bekor qilish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpensesList({ from, to }: { from: string; to: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['cashier', 'expenses', from, to],
    queryFn: () => api.cashier.expenses({ from, to }),
  });
  const rows = (data as Array<{
    id: string;
    amount_uzs: number;
    description?: string | null;
    expense_date: string;
    payment_method?: string | null;
    category?: { name_i18n: Record<string, string>; color?: string | null; icon?: string | null } | null;
  }>) ?? [];

  const [confirmVoid, setConfirmVoid] = useState<{ id: string; label: string } | null>(null);
  const voidMut = useMutation({
    mutationFn: (id: string) => api.cashier.voidExpense(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashier'] });
      setConfirmVoid(null);
    },
  });

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="min-h-0 flex-1 overflow-auto p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Rasxotlar yo‘q" description="Yuqoridagi tugma orqali qo‘shing" />
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((e) => (
              <div key={e.id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3">
                <div>
                  <div className="font-medium">
                    {e.category?.name_i18n?.['uz-Latn'] ??
                      e.category?.name_i18n?.['uz'] ??
                      'Umumiy'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.expense_date} · {e.payment_method ?? 'naqd'}
                    {e.description ? ` · ${e.description}` : ''}
                  </div>
                </div>
                <div className="text-right font-semibold text-destructive">-{fmt(e.amount_uzs)} UZS</div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    setConfirmVoid({
                      id: e.id,
                      label:
                        (e.category?.name_i18n?.['uz-Latn'] ??
                          e.category?.name_i18n?.['uz'] ??
                          'Umumiy') + ` — ${fmt(e.amount_uzs)} UZS`,
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!confirmVoid} onOpenChange={(v) => !v && setConfirmVoid(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rasxotni bekor qilish</DialogTitle>
            <DialogDescription>
              {confirmVoid?.label} — rasxotni bekor qilmoqchimisiz? Yozuv audit uchun
              bazada saqlanadi, lekin ro‘yxatdan olib tashlanadi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmVoid(null)}>
              Yo‘q
            </Button>
            <Button
              variant="destructive"
              disabled={voidMut.isPending}
              onClick={() => confirmVoid && voidMut.mutate(confirmVoid.id)}
            >
              Ha, bekor qilish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ExpenseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [method, setMethod] = useState<string>('cash');
  const [source, setSource] = useState<'cash_drawer' | 'safe'>('cash_drawer');

  const { data: categoriesRes } = useQuery({
    queryKey: ['catalog', 'expense-categories'],
    queryFn: () =>
      api.get<{ items: Array<{ id: string; name_i18n: Record<string, string> }>; total: number }>(
        '/api/v1/catalog/expense-categories',
      ),
    enabled: open,
  });
  const categories = categoriesRes?.items ?? [];

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.createExpense({
        amount_uzs: amount,
        description: description || undefined,
        category_id: category,
        payment_method: method,
        source,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashier'] });
      setAmount(0);
      setDescription('');
      setCategory(undefined);
      setSource('cash_drawer');
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yangi rasxot</DialogTitle>
          <DialogDescription>Rasxot summasi, turi va izohini kiriting.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Summa (UZS)</label>
            <Input
              type="number"
              value={amount || ''}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Kategoriya</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_i18n['uz-Latn'] ?? c.name_i18n['uz'] ?? c.name_i18n['en'] ?? 'Kategoriya'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">To‘lov usuli</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Plastik</SelectItem>
                <SelectItem value="transfer">O‘tkazma</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Izoh</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Sabab, kontragent va h.k."
            />
          </div>
          <SourcePicker value={source} onChange={setSource} amount={amount || undefined} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!amount || mut.isPending}>
            {mut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </Button>
        </DialogFooter>
        {mut.isError && <p className="text-xs text-destructive">{(mut.error as Error).message}</p>}
      </DialogContent>
    </Dialog>
  );
}

// Daromad maydonlarini ochish uchun PIN dialogi.
// Smenani kim ochgan bo'lsa o'sha operatorning PIN'i ishlatiladi.
function RevenuePinDialog({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: () => void;
}) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);

  const verifyMut = useMutation({
    mutationFn: () => api.shifts.verifyActivePin(pin),
    onSuccess: () => onVerified(),
    onError: (e: Error) => toast.error(e.message || "Noto'g'ri PIN"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Daromadni ko'rsatish
          </DialogTitle>
          <DialogDescription>
            Smenani ochgan navbatchining PIN kodini kiriting. 5 daqiqa
            davomida daromad maydonlari ochiq bo'ladi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="relative">
            <Input
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              placeholder="••••"
              autoFocus
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pin.length >= 4 && !verifyMut.isPending) {
                  verifyMut.mutate();
                }
              }}
              className="pr-10 text-center font-mono text-lg tracking-[0.4em]"
            />
            <button
              type="button"
              onClick={() => setShowPin((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={pin.length < 4 || verifyMut.isPending}
            onClick={() => verifyMut.mutate()}
          >
            {verifyMut.isPending ? "Tekshirilmoqda..." : "Ochish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
