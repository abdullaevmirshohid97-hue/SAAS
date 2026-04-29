import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Coins,
  CreditCard,
  PiggyBank,
  Plus,
  Receipt,
  Search,
  TrendingUp,
  Trash2,
  Wallet,
  AlertCircle,
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

import { api } from '@/lib/api';

type FilterPreset = 'today' | 'week' | 'month' | 'custom';
type TabId = 'transactions' | 'expenses';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function rangeFor(preset: FilterPreset): { from: string; to: string } {
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

export function CashierPage() {
  const [tab, setTab] = useState<TabId>('transactions');
  const [preset, setPreset] = useState<FilterPreset>('today');
  const [method, setMethod] = useState<string>('all');
  const [expenseOpen, setExpenseOpen] = useState(false);

  const { from, to } = rangeFor(preset);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['cashier', 'kpis'],
    queryFn: () => api.cashier.kpis(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kassa</h1>
          <p className="text-sm text-muted-foreground">
            Barcha tushum, rasxot va naqdlik bo‘yicha yaxlit boshqaruv
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PresetFilter value={preset} onChange={setPreset} />
          <Button onClick={() => setExpenseOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Rasxot qo‘shish
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bugungi tushum"
          value={kpisLoading ? '…' : `${fmt(kpis?.today ?? 0)} UZS`}
          icon={<Wallet className="h-4 w-4" />}
          tone="success"
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
          value={kpisLoading ? '…' : `${fmt(kpis?.month_revenue ?? 0)} UZS`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="Oylik rasxot"
          value={kpisLoading ? '…' : `${fmt(kpis?.month_expenses ?? 0)} UZS`}
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Oylik sof foyda"
          value={kpisLoading ? '…' : `${fmt(kpis?.month_profit ?? 0)} UZS`}
          icon={<PiggyBank className="h-4 w-4" />}
          tone={(kpis?.month_profit ?? 0) >= 0 ? 'success' : 'danger'}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
        />
        <StatCard
          label="Statsionar qarzi"
          value={kpisLoading ? '…' : `${fmt(kpis?.inpatient_debt ?? 0)} UZS`}
          icon={<AlertCircle className="h-4 w-4" />}
          tone={(kpis?.inpatient_debt ?? 0) > 0 ? 'danger' : undefined}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bugungi to‘lov usullari</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(kpis?.by_payment_method_today ?? {}).map(([m, v]) => (
              <Badge key={m} variant="secondary" className="text-sm">
                {m}: {fmt(v)}
              </Badge>
            ))}
            {Object.keys(kpis?.by_payment_method_today ?? {}).length === 0 && (
              <span className="text-xs text-muted-foreground">Hali to‘lovlar yo‘q</span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border bg-muted/30 p-1">
          <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')}>
            <Receipt className="mr-1 h-4 w-4" /> To‘lovlar
          </TabButton>
          <TabButton active={tab === 'expenses'} onClick={() => setTab('expenses')}>
            <ArrowDownRight className="mr-1 h-4 w-4" /> Rasxotlar
          </TabButton>
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

      {tab === 'transactions' ? (
        <TransactionsList from={from} to={to} method={method === 'all' ? undefined : method} />
      ) : (
        <ExpensesList from={from.slice(0, 10)} to={to.slice(0, 10)} />
      )}

      <ExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function PresetFilter({
  value,
  onChange,
}: {
  value: FilterPreset;
  onChange: (v: FilterPreset) => void;
}) {
  const items: Array<{ id: FilterPreset; label: string }> = [
    { id: 'today', label: 'Bugun' },
    { id: 'week', label: 'Hafta' },
    { id: 'month', label: 'Oy' },
  ];
  return (
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
  const { data, isLoading } = useQuery({
    queryKey: ['cashier', 'transactions', from, to, method],
    queryFn: () => api.cashier.transactions({ from, to, method }),
    refetchInterval: 20_000,
  });
  const rows = (data as Array<{
    id: string;
    created_at: string;
    amount_uzs: number;
    kind: string;
    payment_method: string;
    notes?: string | null;
    patient?: { full_name?: string } | null;
    items?: Array<{ service_name_snapshot: string; quantity: number }>;
  }>) ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Bo‘lim bo‘sh" description="Ushbu davr uchun to‘lovlar yo‘q" />
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((t) => (
              <div key={t.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                <div>
                  <div className="font-medium">
                    {t.patient?.full_name ?? 'Mijoz yoʻq'} · {t.items?.length ?? 0} xizmat
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
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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

  const voidMut = useMutation({
    mutationFn: (id: string) => api.cashier.voidExpense(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cashier'] }),
  });

  return (
    <Card>
      <CardContent className="p-0">
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
                  onClick={() => voidMut.mutate(e.id)}
                  disabled={voidMut.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
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

  const { data: categories } = useQuery({
    queryKey: ['catalog', 'expense-categories'],
    queryFn: () =>
      api.get<Array<{ id: string; name_i18n: Record<string, string> }>>(
        '/api/v1/catalog/expense-categories',
      ),
    enabled: open,
  });

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.createExpense({
        amount_uzs: amount,
        description: description || undefined,
        category_id: category,
        payment_method: method,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashier'] });
      setAmount(0);
      setDescription('');
      setCategory(undefined);
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
