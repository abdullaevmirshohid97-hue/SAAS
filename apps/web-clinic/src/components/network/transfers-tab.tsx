import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Check,
  ChevronDown,
  ChevronRight,
  Package,
  Plus,
  Search,
  Trash2,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
} from '@clary/ui-web';
import type { NetworkBranch, NetworkCashTransfer, NetworkStockTransfer } from '@clary/api-client';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { STATUS_LABEL, fmt } from './shared';

const STOCK_ROLES = new Set(['clinic_owner', 'clinic_admin', 'pharmacist']);
const CASH_ROLES = new Set(['clinic_owner', 'clinic_admin', 'cashier']);

function statusBadge(s: string) {
  const variant = s === 'received' ? 'success' : s === 'canceled' ? 'outline' : 'warning';
  return <Badge variant={variant}>{STATUS_LABEL[s] ?? s}</Badge>;
}

/** Filiallararo: dorixona zaxirasi va seyfdan HQ'ga pul */
export function TransfersTab({
  branches,
  activeClinicId,
  canManage,
}: {
  branches: NetworkBranch[];
  activeClinicId: string;
  canManage: boolean;
}) {
  const { role } = useAuth();
  const stock = STOCK_ROLES.has(role);
  const cash = CASH_ROLES.has(role);
  if (!stock && !cash) {
    return (
      <EmptyState
        title="Ruxsat yo'q"
        description="Transferlar klinika rahbariyati, farmatsevt va kassir uchun."
      />
    );
  }
  return (
    <div className="space-y-6">
      {stock && (
        <StockSection branches={branches} activeClinicId={activeClinicId} canManage={canManage} />
      )}
      {cash && (
        <CashSection branches={branches} activeClinicId={activeClinicId} canManage={canManage} />
      )}
    </div>
  );
}

// ── Dorixona zaxirasi ────────────────────────────────────────────────────────
function StockSection({
  branches,
  activeClinicId,
  canManage,
}: {
  branches: NetworkBranch[];
  activeClinicId: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ['company-stock-transfers'],
    queryFn: () => api.company.stockTransfers(),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['company-stock-transfers'] });
  const receive = useMutation({
    mutationFn: (id: string) => api.company.receiveStock(id),
    onSuccess: () => {
      toast.success('Qabul qilindi — dorilar omborga kirdi');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const incoming = data.filter(
    (t) => t.to_clinic_id === activeClinicId && t.status === 'in_transit',
  );

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <Package className="h-4 w-4" /> Dori transferi
            {incoming.length > 0 && <Badge>{incoming.length} ta kutilmoqda</Badge>}
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Boshqa filialga jo'natish
          </Button>
        </div>
        {!isLoading && data.length === 0 ? (
          <p className="text-muted-foreground text-sm">Hali transfer bo'lmagan.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {data.map((t) => (
              <StockRow
                key={t.id}
                t={t}
                activeClinicId={activeClinicId}
                canManage={canManage}
                expanded={expanded === t.id}
                onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
                onReceive={() => receive.mutate(t.id)}
                onCancel={() => setCancelId(t.id)}
                busy={receive.isPending}
              />
            ))}
          </div>
        )}
      </CardContent>
      {open && (
        <StockSendDialog
          branches={branches.filter((b) => b.id !== activeClinicId)}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            invalidate();
          }}
        />
      )}
      {cancelId && (
        <CancelDialog
          title="Transferni bekor qilish"
          description="Dorilar jo'natgan filial omboriga (o'sha partiyalarga) qaytadi."
          onClose={() => setCancelId(null)}
          onConfirm={async (reason) => {
            await api.company.cancelStock(cancelId, reason);
            toast.success('Bekor qilindi');
            setCancelId(null);
            invalidate();
          }}
        />
      )}
    </Card>
  );
}

function StockRow({
  t,
  activeClinicId,
  canManage,
  expanded,
  onToggle,
  onReceive,
  onCancel,
  busy,
}: {
  t: NetworkStockTransfer;
  activeClinicId: string;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onReceive: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const outgoing = t.from_clinic_id === activeClinicId;
  const { data } = useQuery({
    queryKey: ['company-stock-transfer', t.id],
    queryFn: () => api.company.stockTransfer(t.id),
    enabled: expanded,
  });
  return (
    <div className="p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onToggle} className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {outgoing ? (
          <ArrowUpRight className="h-4 w-4 text-rose-500" />
        ) : (
          <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
        )}
        <span className="font-medium">
          {t.from_clinic?.name} → {t.to_clinic?.name}
        </span>
        {statusBadge(t.status)}
        <span className="text-muted-foreground text-xs">
          {new Date(t.sent_at).toLocaleString('uz-UZ')} · {t.items_count} qator · tannarx{' '}
          {fmt(t.total_cost_uzs)}
        </span>
        <div className="ml-auto flex gap-2">
          {t.status === 'in_transit' && t.to_clinic_id === activeClinicId && (
            <Button size="sm" onClick={onReceive} disabled={busy}>
              <Check className="mr-1 h-3.5 w-3.5" /> Qabul qilish
            </Button>
          )}
          {t.status === 'in_transit' && (outgoing || canManage) && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <X className="mr-1 h-3.5 w-3.5" /> Bekor
            </Button>
          )}
        </div>
      </div>
      {t.notes && <div className="text-muted-foreground mt-1 pl-6 text-xs">{t.notes}</div>}
      {t.cancel_reason && (
        <div className="mt-1 pl-6 text-xs text-rose-600">Sabab: {t.cancel_reason}</div>
      )}
      {expanded && (
        <div className="mt-2 overflow-x-auto pl-6">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-1">Dori</th>
                <th>Partiya</th>
                <th>Yaroqlilik</th>
                <th className="text-right">Soni</th>
                <th className="text-right">Tannarx</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="py-1">
                    {i.name} {i.strength ?? ''}
                  </td>
                  <td>{i.batch_no ?? '—'}</td>
                  <td>{i.expiry_date ?? '—'}</td>
                  <td className="text-right">{i.quantity}</td>
                  <td className="text-right">{fmt(i.unit_cost_uzs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Line = { medication_id: string; name: string; available: number; quantity: number };

function StockSendDialog({
  branches,
  onClose,
  onSent,
}: {
  branches: NetworkBranch[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(branches.find((b) => b.is_hq)?.id ?? branches[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const { data: found = [] } = useQuery({
    queryKey: ['transfer-med-search', q],
    queryFn: () => api.pharmacy.searchMedications(q),
    enabled: q.trim().length >= 2,
  });
  const send = useMutation({
    mutationFn: () =>
      api.company.sendStock({
        to_clinic_id: to,
        items: lines.map((l) => ({ medication_id: l.medication_id, quantity: l.quantity })),
        notes: notes || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Jo'natildi: ${r.lines} partiya qatori. Qabul qiluvchi filial tasdiqlaydi.`);
      onSent();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const invalid = lines.some((l) => l.quantity <= 0 || l.quantity > l.available);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dori jo'natish</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground text-xs">Qaysi filialga</span>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.is_hq ? ' (HQ)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="relative">
            <Search className="text-muted-foreground absolute left-2 top-2.5 h-4 w-4" />
            <Input
              placeholder="Dori nomi yoki shtrix-kod (kamida 2 harf)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
          {q.trim().length >= 2 && (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {found
                .filter((m) => !lines.some((l) => l.medication_id === m.medication_id))
                .slice(0, 30)
                .map((m) => {
                  const avail = m.qty_sellable ?? m.qty_in_stock;
                  return (
                    <button
                      key={m.medication_id}
                      type="button"
                      disabled={avail <= 0}
                      onClick={() => {
                        setLines([
                          ...lines,
                          {
                            medication_id: m.medication_id,
                            name: `${m.name} ${m.strength ?? ''}`.trim(),
                            available: avail,
                            quantity: Math.min(1, avail),
                          },
                        ]);
                        setQ('');
                      }}
                      className="hover:bg-muted flex w-full items-center justify-between px-3 py-1.5 text-left text-sm disabled:opacity-40"
                    >
                      <span>
                        {m.name} {m.strength ?? ''} {m.form ? `· ${m.form}` : ''}
                      </span>
                      <span className="text-muted-foreground text-xs">qoldiq {avail}</span>
                    </button>
                  );
                })}
              {found.length === 0 && (
                <div className="text-muted-foreground px-3 py-2 text-sm">Topilmadi</div>
              )}
            </div>
          )}
          {lines.length > 0 && (
            <div className="divide-y rounded-md border">
              {lines.map((l, idx) => (
                <div key={l.medication_id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="text-muted-foreground text-xs">/{l.available}</span>
                  <Input
                    type="number"
                    min={1}
                    max={l.available}
                    value={l.quantity}
                    onChange={(e) => {
                      const v = Math.floor(Number(e.target.value) || 0);
                      setLines(lines.map((x, i) => (i === idx ? { ...x, quantity: v } : x)));
                    }}
                    className={`h-8 w-24 ${l.quantity > l.available ? 'border-rose-500' : ''}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Input
            placeholder="Izoh (ixtiyoriy)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Dori muddati yaqin partiyadan boshlab (FEFO) olinadi, muddati o'tgani jo'natilmaydi.
            Qabul qiluvchi filial "Qabul qilish" bosgach, dorilar uning omboriga prixod bo'lib
            kiradi.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            disabled={!to || lines.length === 0 || invalid || send.isPending}
            onClick={() => send.mutate()}
          >
            Jo'natish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pul (seyfdan HQ'ga) ──────────────────────────────────────────────────────
function CashSection({
  branches,
  activeClinicId,
  canManage,
}: {
  branches: NetworkBranch[];
  activeClinicId: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const hq = branches.find((b) => b.is_hq) ?? null;
  const [to, setTo] = useState(hq && hq.id !== activeClinicId ? hq.id : '');
  const [amount, setAmount] = useState('');
  const [register, setRegister] = useState<'reception' | 'inpatient'>('reception');
  const [notes, setNotes] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ['company-cash-transfers'],
    queryFn: () => api.company.cashTransfers(),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['company-cash-transfers'] });
  const targets = useMemo(
    () => branches.filter((b) => b.id !== activeClinicId),
    [branches, activeClinicId],
  );
  const send = useMutation({
    mutationFn: () =>
      api.company.sendCash({
        to_clinic_id: to || undefined,
        amount_uzs: Math.round(Number(amount.replace(/\s/g, ''))),
        register,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success("Pul jo'natildi — qabul qiluvchi filial seyfiga olganini tasdiqlaydi");
      setAmount('');
      setNotes('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const receive = useMutation({
    mutationFn: (id: string) => api.company.receiveCash(id),
    onSuccess: () => {
      toast.success('Seyfga kirim qilindi');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const amountNum = Number(amount.replace(/\s/g, ''));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Banknote className="h-4 w-4" /> Seyfdan pul o'tkazish (filial → HQ)
        </div>
        {targets.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Qayerga</span>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-background block h-9 rounded-md border px-2 text-sm"
              >
                {!hq || hq.id === activeClinicId ? <option value="">— tanlang —</option> : null}
                {targets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.is_hq ? ' (HQ)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Summa (so'm)</span>
              <Input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ''))}
                className="h-9 w-40"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Kassa</span>
              <select
                value={register}
                onChange={(e) => setRegister(e.target.value as 'reception' | 'inpatient')}
                className="bg-background block h-9 rounded-md border px-2 text-sm"
              >
                <option value="reception">Qabulxona seyfi</option>
                <option value="inpatient">Statsionar seyfi</option>
              </select>
            </label>
            <Input
              placeholder="Izoh"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9 w-48"
            />
            <Button
              disabled={!to || !(amountNum > 0) || send.isPending}
              onClick={() => send.mutate()}
            >
              Jo'natish
            </Button>
          </div>
        )}
        {!isLoading && data.length === 0 ? (
          <p className="text-muted-foreground text-sm">Hali pul o'tkazmasi bo'lmagan.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {data.map((t: NetworkCashTransfer) => {
              const outgoing = t.from_clinic_id === activeClinicId;
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  {outgoing ? (
                    <ArrowUpRight className="h-4 w-4 text-rose-500" />
                  ) : (
                    <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                  )}
                  <span className="font-medium">
                    {t.from_clinic?.name} → {t.to_clinic?.name}
                  </span>
                  <span className="font-semibold">{fmt(t.amount_uzs)} so'm</span>
                  {statusBadge(t.status)}
                  <span className="text-muted-foreground text-xs">
                    {new Date(t.sent_at).toLocaleString('uz-UZ')}
                    {t.notes ? ` · ${t.notes}` : ''}
                    {t.cancel_reason ? ` · sabab: ${t.cancel_reason}` : ''}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {t.status === 'in_transit' && t.to_clinic_id === activeClinicId && (
                      <Button
                        size="sm"
                        onClick={() => receive.mutate(t.id)}
                        disabled={receive.isPending}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Seyfga oldim
                      </Button>
                    )}
                    {t.status === 'in_transit' && (outgoing || canManage) && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelId(t.id)}>
                        <X className="mr-1 h-3.5 w-3.5" /> Bekor
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          Jo'natilganda pul filial seyfidan chiqadi; HQ "Seyfga oldim" bosgach uning seyfiga kiradi.
          Bekor qilinsa pul filial seyfiga qaytadi. Foyda/zararga ta'sir qilmaydi.
        </p>
      </CardContent>
      {cancelId && (
        <CancelDialog
          title="Pul o'tkazmasini bekor qilish"
          description="Pul jo'natgan filial seyfiga qaytadi."
          onClose={() => setCancelId(null)}
          onConfirm={async (reason) => {
            await api.company.cancelCash(cancelId, reason);
            toast.success('Bekor qilindi');
            setCancelId(null);
            invalidate();
          }}
        />
      )}
    </Card>
  );
}

function CancelDialog({
  title,
  description,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{description}</p>
        <Input
          placeholder="Sabab (majburiy)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 2 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
              } catch (e) {
                toast.error((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Bekor qilish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
