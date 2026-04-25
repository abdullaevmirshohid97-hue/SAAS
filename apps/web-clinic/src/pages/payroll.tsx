import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  FileSpreadsheet,
  Percent,
  Plus,
  ReceiptText,
  Stethoscope,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  Textarea,
} from '@clary/ui-web';

import { api } from '@/lib/api';

type Tab = 'overview' | 'rates' | 'ledger' | 'payouts';

type Doctor = { id: string; full_name: string };
type ServiceRow = { id: string; name: string };

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

type BadgeTone = 'success' | 'warning' | 'destructive' | 'info' | 'default';

const KIND_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  advance: { label: 'Avans', tone: 'warning' },
  bonus: { label: 'Bonus', tone: 'success' },
  penalty: { label: 'Jarima', tone: 'destructive' },
  adjustment: { label: 'Tuzatish', tone: 'info' },
  debt_write_off: { label: 'Qarz hisobdan chiqarish', tone: 'default' },
};

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Qoralama', tone: 'info' },
  approved: { label: 'Tasdiqlandi', tone: 'warning' },
  paid: { label: 'To‘langan', tone: 'success' },
  canceled: { label: 'Bekor qilindi', tone: 'destructive' },
};

export function PayrollPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const balances = useQuery({
    queryKey: ['payroll', 'balances'],
    queryFn: () => api.payroll.balances(),
  });

  const doctors = useMemo<Doctor[]>(() => {
    return (balances.data ?? []).map((b) => ({ id: b.doctor_id, full_name: b.full_name }));
  }, [balances.data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hisob-kitob</h1>
          <p className="text-sm text-muted-foreground">
            Shifokor ulushlari, avanslar, bonuslar va oylik to‘lovlar
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {[
            { id: 'overview', label: 'Umumiy', icon: Coins },
            { id: 'rates', label: 'Foizlar', icon: Percent },
            { id: 'ledger', label: 'Avans/Bonus', icon: ReceiptText },
            { id: 'payouts', label: 'To‘lovlar', icon: Wallet },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={
                'flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors ' +
                (tab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <OverviewTab balances={balances.data ?? []} />}
      {tab === 'rates' && <RatesTab doctors={doctors} />}
      {tab === 'ledger' && <LedgerTab doctors={doctors} />}
      {tab === 'payouts' && <PayoutsTab doctors={doctors} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewTab({ balances }: { balances: Awaited<ReturnType<typeof api.payroll.balances>> }) {
  const totals = useMemo(() => {
    return balances.reduce(
      (acc, b) => {
        acc.accrued += Number(b.accrued_uzs);
        acc.paid += Number(b.paid_uzs);
        acc.balance += Number(b.balance_uzs);
        acc.ledger += Number(b.ledger_uzs);
        return acc;
      },
      { accrued: 0, paid: 0, balance: 0, ledger: 0 },
    );
  }, [balances]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Jami hisoblangan"
          value={`${fmt(totals.accrued)} so‘m`}
          icon={<Stethoscope className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Avans/bonus/jarima"
          value={`${fmt(totals.ledger)} so‘m`}
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone={totals.ledger >= 0 ? 'success' : 'warning'}
        />
        <StatCard
          label="To‘langan"
          value={`${fmt(totals.paid)} so‘m`}
          icon={<ArrowUpRight className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Qoldiq"
          value={`${fmt(totals.balance)} so‘m`}
          icon={<Wallet className="h-4 w-4" />}
          tone={totals.balance >= 0 ? 'default' : 'danger'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shifokorlar balansi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {balances.length === 0 ? (
            <EmptyState
              icon={<Coins className="h-8 w-8" />}
              title="Ma'lumot yo‘q"
              description="Shifokor ulushlari hali hisoblangan emas"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Shifokor</th>
                    <th className="px-4 py-2.5 text-right">Hisoblangan</th>
                    <th className="px-4 py-2.5 text-right">Avans/Bonus</th>
                    <th className="px-4 py-2.5 text-right">To‘langan</th>
                    <th className="px-4 py-2.5 text-right">Qoldiq</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.doctor_id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{b.full_name}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(b.accrued_uzs)}</td>
                      <td className={'px-4 py-2.5 text-right ' + (b.ledger_uzs < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {fmt(b.ledger_uzs)}
                      </td>
                      <td className="px-4 py-2.5 text-right">{fmt(b.paid_uzs)}</td>
                      <td className={'px-4 py-2.5 text-right font-semibold ' + (b.balance_uzs < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {fmt(b.balance_uzs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------
function RatesTab({ doctors }: { doctors: Doctor[] }) {
  const qc = useQueryClient();
  const rates = useQuery({ queryKey: ['payroll', 'rates'], queryFn: () => api.payroll.listRates() });
  const services = useQuery({
    queryKey: ['catalog', 'services'],
    queryFn: () => api.catalog.list('services', { pageSize: 500 }),
  });
  const servicesList: ServiceRow[] = useMemo(() => {
    return ((services.data?.items as Array<Record<string, unknown>>) ?? []).map((s) => ({
      id: String(s.id),
      name: String(s.name),
    }));
  }, [services.data]);

  const [open, setOpen] = useState(false);

  const archive = useMutation({
    mutationFn: (id: string) => api.payroll.archiveRate(id),
    onSuccess: () => {
      toast.success('Arxivlandi');
      qc.invalidateQueries({ queryKey: ['payroll', 'rates'] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Yangi foiz
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {(rates.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Percent className="h-8 w-8" />}
              title="Foizlar kiritilmagan"
              description="Har bir shifokorga umumiy yoki xizmat bo‘yicha ulush foizini belgilang"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Shifokor</th>
                    <th className="px-4 py-2.5">Xizmat</th>
                    <th className="px-4 py-2.5 text-right">Foiz</th>
                    <th className="px-4 py-2.5 text-right">Fixed (so‘m)</th>
                    <th className="px-4 py-2.5">Davr</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(rates.data ?? []).map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{r.doctor?.full_name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {r.service?.name ?? <span className="italic">Barcha xizmatlar</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">{r.percent}%</td>
                      <td className="px-4 py-2.5 text-right">{fmt(r.fixed_uzs)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {r.valid_from}
                        {r.valid_to ? ` → ${r.valid_to}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => archive.mutate(r.id)}
                          disabled={archive.isPending}
                        >
                          Arxivla
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

      {open && (
        <RateDialog
          doctors={doctors}
          services={servicesList}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'rates'] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RateDialog({
  doctors,
  services,
  onClose,
  onSaved,
}: {
  doctors: Doctor[];
  services: ServiceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState<string>('__all__');
  const [percent, setPercent] = useState('30');
  const [fixed, setFixed] = useState('0');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));

  const save = useMutation({
    mutationFn: () =>
      api.payroll.setRate({
        doctor_id: doctorId,
        service_id: serviceId === '__all__' ? null : serviceId,
        percent: Number(percent) || 0,
        fixed_uzs: Number(fixed) || 0,
        valid_from: from,
      }),
    onSuccess: () => {
      toast.success('Foiz saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ulush foizi</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label>Shifokor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Xizmat (ixtiyoriy)</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Barcha xizmatlar</SelectItem>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Foiz (%)</Label>
              <Input value={percent} onChange={(e) => setPercent(e.target.value)} type="number" />
            </div>
            <div>
              <Label>Fixed (so‘m)</Label>
              <Input value={fixed} onChange={(e) => setFixed(e.target.value)} type="number" />
            </div>
          </div>
          <div>
            <Label>Amal qila boshlash</Label>
            <Input value={from} onChange={(e) => setFrom(e.target.value)} type="date" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => save.mutate()} disabled={!doctorId || save.isPending}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Ledger (advance / bonus / penalty)
// ---------------------------------------------------------------------------
function LedgerTab({ doctors }: { doctors: Doctor[] }) {
  const qc = useQueryClient();
  const ledger = useQuery({ queryKey: ['payroll', 'ledger'], queryFn: () => api.payroll.listLedger() });
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Yangi yozuv
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {(ledger.data ?? []).length === 0 ? (
            <EmptyState
              icon={<ReceiptText className="h-8 w-8" />}
              title="Yozuvlar yo‘q"
              description="Avans, bonus yoki jarima qo‘shing"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Sana</th>
                    <th className="px-4 py-2.5">Shifokor</th>
                    <th className="px-4 py-2.5">Tur</th>
                    <th className="px-4 py-2.5 text-right">Summa</th>
                    <th className="px-4 py-2.5">Izoh</th>
                    <th className="px-4 py-2.5">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data ?? []).map((row) => {
                    const kind = KIND_LABEL[row.kind] ?? { label: row.kind, tone: 'default' as const };
                    return (
                      <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {new Date(row.created_at).toLocaleString('uz-UZ')}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{row.doctor?.full_name ?? '-'}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={kind.tone}>{kind.label}</Badge>
                        </td>
                        <td className={'px-4 py-2.5 text-right font-medium ' + (row.amount_uzs < 0 ? 'text-red-600' : 'text-emerald-600')}>
                          {fmt(row.amount_uzs)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.notes ?? '-'}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={row.status === 'open' ? 'info' : 'default'}>
                            {row.status === 'open' ? 'Ochiq' : 'Qo‘llanildi'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <LedgerDialog
          doctors={doctors}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'ledger'] });
            qc.invalidateQueries({ queryKey: ['payroll', 'balances'] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function LedgerDialog({
  doctors,
  onClose,
  onSaved,
}: {
  doctors: Doctor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const [kind, setKind] = useState<'advance' | 'bonus' | 'penalty' | 'adjustment' | 'debt_write_off'>('advance');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.payroll.createLedger({
        doctor_id: doctorId,
        kind,
        amount_uzs: Number(amount) || 0,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Saqlandi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi yozuv</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Shifokor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tur</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="advance">Avans</SelectItem>
                <SelectItem value="bonus">Bonus</SelectItem>
                <SelectItem value="penalty">Jarima</SelectItem>
                <SelectItem value="adjustment">Tuzatish</SelectItem>
                <SelectItem value="debt_write_off">Qarz hisobdan chiqarish</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Summa (so‘m)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100000"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {kind === 'advance' || kind === 'penalty' || kind === 'debt_write_off'
                ? 'Shifokor qoldig‘idan ayriladi'
                : 'Shifokor qoldig‘iga qo‘shiladi'}
            </p>
          </div>
          <div>
            <Label>Izoh</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => save.mutate()} disabled={!doctorId || !amount || save.isPending}>
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------
function PayoutsTab({ doctors }: { doctors: Doctor[] }) {
  const qc = useQueryClient();
  const payouts = useQuery({ queryKey: ['payroll', 'payouts'], queryFn: () => api.payroll.listPayouts() });
  const [open, setOpen] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Yangi to‘lov
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {(payouts.data ?? []).length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="h-8 w-8" />}
              title="To‘lovlar yo‘q"
              description="Shifokorlarga haftalik yoki oylik ulush hisoblang"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Shifokor</th>
                    <th className="px-4 py-2.5">Davr</th>
                    <th className="px-4 py-2.5 text-right">Hisoblangan</th>
                    <th className="px-4 py-2.5 text-right">Avans</th>
                    <th className="px-4 py-2.5 text-right">Tuzatish</th>
                    <th className="px-4 py-2.5 text-right">To‘lanadi</th>
                    <th className="px-4 py-2.5">Holat</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {(payouts.data ?? []).map((p) => {
                    const s = STATUS_LABEL[p.status] ?? { label: p.status, tone: 'default' as const };
                    return (
                      <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium">{p.doctor?.full_name ?? '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {p.period_label ?? `${p.period_start} → ${p.period_end}`}
                        </td>
                        <td className="px-4 py-2.5 text-right">{fmt(p.gross_commission_uzs)}</td>
                        <td className="px-4 py-2.5 text-right text-red-600">{fmt(p.advances_uzs)}</td>
                        <td className="px-4 py-2.5 text-right">{fmt(p.adjustments_uzs)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmt(p.net_uzs)}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={s.tone}>{s.label}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {p.status === 'draft' && (
                            <Button size="sm" onClick={() => setPayingId(p.id)}>
                              To‘lash
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <PayoutDialog
          doctors={doctors}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'payouts'] });
            qc.invalidateQueries({ queryKey: ['payroll', 'balances'] });
            setOpen(false);
          }}
        />
      )}
      {payingId && (
        <PayDialog
          id={payingId}
          onClose={() => setPayingId(null)}
          onPaid={() => {
            qc.invalidateQueries({ queryKey: ['payroll', 'payouts'] });
            qc.invalidateQueries({ queryKey: ['payroll', 'balances'] });
            setPayingId(null);
          }}
        />
      )}
    </div>
  );
}

function PayoutDialog({
  doctors,
  onClose,
  onSaved,
}: {
  doctors: Doctor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(lastDay);
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.payroll.createPayout({
        doctor_id: doctorId,
        period_start: from,
        period_end: to,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('To‘lov qoralamasi yaratildi');
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi to‘lov</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Shifokor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Boshlanish</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>Tugash</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Izoh</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Davrdagi barcha hisoblangan ulushlar va ochiq avans/bonuslar avtomatik yig‘iladi
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => save.mutate()} disabled={!doctorId || save.isPending}>
            Yaratish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ id, onClose, onPaid }: { id: string; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState<'cash' | 'card' | 'humo' | 'uzcard' | 'click' | 'payme' | 'bank_transfer'>('cash');
  const [reference, setReference] = useState('');
  const details = useQuery({ queryKey: ['payroll', 'payout', id], queryFn: () => api.payroll.getPayout(id) });
  const payout = details.data?.payout as { net_uzs?: number; doctor?: { full_name?: string } } | undefined;

  const pay = useMutation({
    mutationFn: () => api.payroll.pay(id, { method, reference: reference || undefined }),
    onSuccess: () => {
      toast.success('To‘landi');
      onPaid();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>To‘lov amalga oshirish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shifokor</span>
              <span className="font-medium">{payout?.doctor?.full_name ?? '-'}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">Summa</span>
              <span className="font-semibold">{fmt(Number(payout?.net_uzs ?? 0))} so‘m</span>
            </div>
          </div>
          <div>
            <Label>Usul</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Naqd</SelectItem>
                <SelectItem value="card">Plastik</SelectItem>
                <SelectItem value="humo">Humo</SelectItem>
                <SelectItem value="uzcard">Uzcard</SelectItem>
                <SelectItem value="click">Click</SelectItem>
                <SelectItem value="payme">Payme</SelectItem>
                <SelectItem value="bank_transfer">Bank o‘tkazma</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reference (ixtiyoriy)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => pay.mutate()} disabled={pay.isPending}>
            Tasdiqlash va to‘lash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
