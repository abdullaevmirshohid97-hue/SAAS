import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Coins, History, Printer, Users } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  cn,
} from '@clary/ui-web';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { paymentReceiptHtml, printReceiptHybrid } from '@/lib/print-receipt';

// To'lov turlari — Naqd/Plastik/O'tkazma birinchi (eng ko'p ishlatiladi).
const PAYMENT_METHODS = [
  { v: 'cash', label: 'Naqd' },
  { v: 'card', label: 'Plastik' },
  { v: 'transfer', label: "O'tkazma" },
  { v: 'humo', label: 'Humo' },
  { v: 'uzcard', label: 'Uzcard' },
  { v: 'click', label: 'Click' },
  { v: 'payme', label: 'Payme' },
] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number]['v'];

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const methodLabel = (m: string) => PAYMENT_METHODS.find((p) => p.v === m)?.label ?? m;

// Qarz to'lov cheki (yangi to'lov + reprint uchun bir xil).
function printDebtReceipt(a: {
  clinicName: string;
  patientName: string;
  amount: number;
  method: string;
  remaining: number;
  trxId: string;
  dateStr?: string;
}) {
  const dateStr = a.dateStr ?? new Date().toLocaleString('uz-UZ');
  const items = [{ name: "Qarz to'lovi", qty: 1, amount: a.amount }];
  const fallbackHtml = paymentReceiptHtml({
    clinicName: a.clinicName,
    ticketNo: null,
    date: dateStr,
    patientName: a.patientName,
    items,
    totalUzs: a.amount,
    paidUzs: a.amount,
    debtUzs: a.remaining,
    paymentMethod: methodLabel(a.method),
    transactionId: a.trxId,
  });
  void printReceiptHybrid(
    {
      header: a.clinicName,
      title: "QARZ TO'LOV CHEKI",
      lines: [
        { text: `Sana: ${dateStr}` },
        { text: `Bemor: ${a.patientName || '—'}` },
        { text: `To'lov: ${methodLabel(a.method)}` },
      ],
      items,
      total_uzs: a.amount,
      paid_uzs: a.amount,
      debt_uzs: a.remaining > 0 ? a.remaining : undefined,
      footer: "Rahmat! Sog'ligingizga shifo tilaymiz!",
      cut: true,
    },
    fallbackHtml,
    'receipt',
    undefined,
    // Chek QR — bemor skaner qilib chekni onlayn tekshiradi (fail-soft).
    { transactionId: a.trxId },
  );
}

type Debtor = { patient_id: string; full_name: string; debt_uzs: number };

export function CashierDebtorsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [payDebtor, setPayDebtor] = useState<Debtor | null>(null);

  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const clinicName = me?.clinic?.name ?? 'Klinika';

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/cashier')} className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Kassa
          </Button>
          <h1 className="text-xl font-semibold">Qarzdorlar</h1>
        </div>
        <div className="inline-flex rounded-lg border bg-muted/30 p-1">
          <button
            onClick={() => setTab('current')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              tab === 'current' ? 'bg-background shadow-elevation-1' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Users className="h-4 w-4" /> Qarzdorlar
          </button>
          <button
            onClick={() => setTab('history')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              tab === 'history' ? 'bg-background shadow-elevation-1' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <History className="h-4 w-4" /> Qarzini berganlar
          </button>
        </div>
      </div>

      {tab === 'current' ? (
        <CurrentDebtors onPay={setPayDebtor} />
      ) : (
        <DebtPaymentsHistory clinicName={clinicName} />
      )}

      {payDebtor && (
        <DebtPaymentDialog debtor={payDebtor} clinicName={clinicName} onClose={() => setPayDebtor(null)} />
      )}
    </div>
  );
}

// ─── Joriy qarzdorlar ────────────────────────────────────────────────────────
function CurrentDebtors({ onPay }: { onPay: (d: Debtor) => void }) {
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
          Jami qarz: <strong className="font-mono text-red-600">{fmt(total)} so'm</strong>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto p-0">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<AlertCircle className="h-8 w-8" />} title="Qarzdor bemor yo'q" description="Barcha bemor hisoblari yopiq" />
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
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.phone ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-600">{fmt(r.debt_uzs)} so'm</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        onClick={() => onPay({ patient_id: r.id, full_name: r.full_name, debt_uzs: r.debt_uzs })}
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

// ─── Qarzini berganlar (tarix) ───────────────────────────────────────────────
function DebtPaymentsHistory({ clinicName }: { clinicName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cashier', 'debt-payments'],
    queryFn: () => api.cashier.debtPayments({ limit: 200 }),
  });
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.amount_uzs), 0);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Qarzini berganlar ({rows.length})</CardTitle>
        <div className="text-sm">
          Jami: <strong className="font-mono text-emerald-600">{fmt(total)} so'm</strong>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto p-0">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<History className="h-8 w-8" />} title="Hali to'lov yo'q" description="Qarz to'lovlari shu yerda ko'rinadi" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/95 text-left text-xs uppercase text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-2.5">Bemor</th>
                  <th className="px-4 py-2.5">Usul</th>
                  <th className="px-4 py-2.5">Sana</th>
                  <th className="px-4 py-2.5 text-right">Summa</th>
                  <th className="px-4 py-2.5 text-right">Chek</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.transaction_id} className="border-b last:border-b-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{r.full_name ?? 'Mijoz'}</td>
                    <td className="px-4 py-2.5 text-xs">{methodLabel(r.payment_method)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('uz-UZ')}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-600">{fmt(r.amount_uzs)} so'm</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() =>
                          printDebtReceipt({
                            clinicName,
                            patientName: r.full_name ?? 'Mijoz',
                            amount: Number(r.amount_uzs),
                            method: r.payment_method,
                            remaining: 0,
                            trxId: r.transaction_id,
                            dateStr: new Date(r.created_at).toLocaleString('uz-UZ'),
                          })
                        }
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Rep chek
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

// ─── Qarz to'lash dialogi ────────────────────────────────────────────────────
function DebtPaymentDialog({
  debtor,
  clinicName,
  onClose,
}: {
  debtor: Debtor;
  clinicName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');

  // Ochilganda default = to'liq qarz.
  useEffect(() => {
    setAmount(String(debtor.debt_uzs));
  }, [debtor]);

  const amtNum = Math.max(0, Number(amount) || 0);
  const remaining = Math.max(0, debtor.debt_uzs - amtNum);

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.debtPayment({
        patient_id: debtor.patient_id,
        amount_uzs: amtNum,
        payment_method: method,
        notes: notes || undefined,
      }),
    onSuccess: (res) => {
      toast.success("Qarz to'landi");
      const remainingDebt = res.balance_after_uzs < 0 ? -res.balance_after_uzs : 0;
      printDebtReceipt({
        clinicName,
        patientName: debtor.full_name,
        amount: amtNum,
        method,
        remaining: remainingDebt,
        trxId: res.id,
      });
      qc.invalidateQueries({ queryKey: ['cashier'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-600" />
            Qarz to'lash — {debtor.full_name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
            Joriy qarz: <strong className="font-mono">{fmt(debtor.debt_uzs)} so'm</strong>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium">To'lov turi *</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {PAYMENT_METHODS.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setMethod(p.v)}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-sm transition',
                    method === p.v
                      ? 'border-primary bg-primary/5 font-medium ring-1 ring-primary'
                      : 'hover:bg-accent/60',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium">To'lanadigan summa *</div>
            <div className="flex gap-1">
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Summa" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAmount(String(debtor.debt_uzs))}
                className="px-3 text-xs"
                title="To'liq qarzni to'lash"
              >
                Jami
              </Button>
            </div>
          </div>

          {remaining > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              Qisman to'lov. Qoldiq qarz: <strong>{fmt(remaining)} so'm</strong>
            </div>
          )}
          {amtNum > debtor.debt_uzs && (
            <div className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
              Ortiqcha to'lov. Bemor depozitiga <strong>+{fmt(amtNum - debtor.debt_uzs)} so'm</strong> qo'shiladi.
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-medium">Izoh</div>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ixtiyoriy" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={amtNum <= 0 || mut.isPending} className="gap-1">
            <Coins className="h-4 w-4" />
            {mut.isPending ? 'Saqlanmoqda...' : "To'lash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
