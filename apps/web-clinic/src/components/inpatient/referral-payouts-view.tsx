import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
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
  cn,
} from '@clary/ui-web';
import type { ReferralPayout, ReferralPayoutInput, ReferralStayRow } from '@clary/api-client';
import { AlertTriangle, CircleDollarSign, Handshake, Printer, Undo2, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { printReceipt, referralPayoutReceiptHtml } from '@/lib/print-receipt';

// =============================================================================
// Statsionar → "Agentlar hisobi": yo'llagan shifokor va agentlarning xona
// to'lovidan hisoblangan ulushi, to'langan / qoldiq va to'lash (statsionar
// kassasidan xarajat). Faqat admin / egasi.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('uz-UZ') : '—';

const METHODS: Array<{ v: ReferralPayoutInput['method']; label: string }> = [
  { v: 'cash', label: 'Naqd' },
  { v: 'card', label: 'Plastik' },
  { v: 'transfer', label: "O'tkazma" },
  { v: 'click', label: 'Click' },
  { v: 'payme', label: 'Payme' },
  { v: 'humo', label: 'Humo' },
  { v: 'uzcard', label: 'Uzcard' },
];
const methodLabel = (m: string) => METHODS.find((x) => x.v === m)?.label ?? m;

const STATUS: Record<string, string> = {
  admitted: 'Davolanmoqda',
  discharged: 'Chiqarilgan',
};

function useClinicName() {
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ clinic?: { name?: string } }>('/api/v1/auth/me'),
  });
  return me?.clinic?.name ?? 'Klinika';
}

export function ReferralPayoutsView() {
  const [type, setType] = useState<'all' | 'doctor' | 'agent'>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['referral-summary'],
    queryFn: () => api.referralPartners.summary(),
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.partners ?? []).filter(
      (p) =>
        (type === 'all' || p.type === type) &&
        (!needle ||
          [p.name, p.specialty, p.phone, p.phone2]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle)),
    );
  }, [data, type, q]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-6 text-sm">Yuklanmoqda…</CardContent>
      </Card>
    );
  }

  if ((data?.partners ?? []).length === 0) {
    return (
      <EmptyState
        title="Agentlar ro‘yxati bo‘sh"
        description="Yo‘llanma bergan shifokorlar va agentlarni Sozlamalar → Agentlar bo‘limida qo‘shing va foizini belgilang. Bemorni yotqizishda “Shifokor yo‘llanmasi”ni tanlang."
        action={
          <Link to="/settings/agents">
            <Button>Agentlarni sozlash</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Hisoblangan ulush"
          value={`${fmt(data?.totals.accrued_uzs ?? 0)} so‘m`}
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="info"
        />
        <StatCard
          label="To‘langan"
          value={`${fmt(data?.totals.paid_uzs ?? 0)} so‘m`}
          icon={<Wallet className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="To‘lanmagan (qoldiq)"
          value={`${fmt(data?.totals.unpaid_uzs ?? 0)} so‘m`}
          icon={<Handshake className="h-4 w-4" />}
          tone={(data?.totals.unpaid_uzs ?? 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            {(
              [
                { id: 'all', label: 'Hammasi' },
                { id: 'doctor', label: 'Shifokorlar' },
                { id: 'agent', label: 'Agentlar' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setType(f.id)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition',
                  type === f.id
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {f.label}
              </button>
            ))}
            <Input
              className="h-8 w-full sm:ml-auto sm:w-64"
              placeholder="Ism yoki telefon…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Link to="/settings/agents" className="text-primary text-xs hover:underline">
              Ro‘yxatni tahrirlash
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
                <tr>
                  <th className="px-3 py-2.5">F.I.O.</th>
                  <th className="px-3 py-2.5">Telefon</th>
                  <th className="px-3 py-2.5 text-right">Foiz</th>
                  <th className="px-3 py-2.5 text-right">Bemorlar</th>
                  <th className="px-3 py-2.5 text-right">Hisoblangan</th>
                  <th className="px-3 py-2.5 text-right">To‘langan</th>
                  <th className="px-3 py-2.5 text-right">Qoldiq</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-accent/30 cursor-pointer border-b last:border-b-0"
                    onClick={() => setOpenId(p.id)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium">
                        {p.name}
                        <Badge variant="outline" className="text-[10px]">
                          {p.type === 'doctor' ? 'Shifokor' : 'Agent'}
                        </Badge>
                        {p.is_archived && (
                          <Badge variant="secondary" className="text-[10px]">
                            arxiv
                          </Badge>
                        )}
                      </div>
                      {p.specialty && (
                        <div className="text-muted-foreground text-xs">{p.specialty}</div>
                      )}
                    </td>
                    <td className="text-muted-foreground px-3 py-2.5 text-xs">
                      {[p.phone, p.phone2].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">{p.commission_percent}%</td>
                    <td className="px-3 py-2.5 text-right">
                      {p.stays}
                      {p.active_stays > 0 && (
                        <span className="text-muted-foreground text-xs">
                          {' '}
                          ({p.active_stays} yotibdi)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmt(p.accrued_uzs)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-700">{fmt(p.paid_uzs)}</td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right font-semibold',
                        p.unpaid_uzs > 0 ? 'text-amber-700' : 'text-muted-foreground',
                      )}
                    >
                      {fmt(p.unpaid_uzs)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="sm" variant="outline">
                        {p.unpaid_uzs > 0 ? 'To‘lash' : 'Batafsil'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-muted-foreground px-3 py-6 text-center text-sm">
                      Topilmadi
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {openId && <PartnerDetailDialog partnerId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PartnerDetailDialog({ partnerId, onClose }: { partnerId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const clinicName = useClinicName();
  const { data, isLoading } = useQuery({
    queryKey: ['referral-detail', partnerId],
    queryFn: () => api.referralPartners.detail(partnerId),
  });

  const unpaidRows = (data?.stays ?? []).filter((s) => s.unpaid_uzs > 0);
  // null — barcha to'lanmagan bemorlar tanlangan.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set(unpaidRows.map((s) => s.stay_id));
  const selectedRows = unpaidRows.filter((s) => selected.has(s.stay_id));
  const amount = selectedRows.reduce((a, s) => a + s.unpaid_uzs, 0);
  const withDebt = selectedRows.filter((s) => s.patient_debt_uzs > 0).length;

  const [method, setMethod] = useState<ReferralPayoutInput['method']>('cash');
  const [source, setSource] = useState<'cash_drawer' | 'safe'>('cash_drawer');
  const [notes, setNotes] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['referral-detail', partnerId] });
    qc.invalidateQueries({ queryKey: ['referral-summary'] });
    qc.invalidateQueries({ queryKey: ['stay-referral'] });
    qc.invalidateQueries({ queryKey: ['cashier'] });
  };

  const printPayout = (
    p: { amount_uzs: number; method: string; paid_at: string; paid_by_name?: string | null },
    stays?: number,
  ) => {
    if (!data) return;
    printReceipt(
      referralPayoutReceiptHtml({
        clinicName,
        date: new Date(p.paid_at).toLocaleString('uz-UZ'),
        partnerName: data.partner.name,
        partnerRole: data.partner.type,
        partnerPhone: data.partner.phone,
        amountUzs: p.amount_uzs,
        stays,
        method: methodLabel(p.method),
        paidBy: p.paid_by_name ?? null,
      }),
    );
  };

  const payMut = useMutation({
    mutationFn: () =>
      api.referralPartners.pay(partnerId, {
        stay_ids: [...selected],
        method,
        source: method === 'cash' ? source : 'cash_drawer',
        notes: notes.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`${r.partner.name}ga ${fmt(r.amount_uzs)} so‘m to‘landi`, {
        action: { label: 'Chek', onClick: () => printPayout(r, r.stays) },
      });
      setPicked(null);
      setNotes('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.referralPartners.cancelPayout(id),
    onSuccess: () => {
      toast.success('To‘lov bekor qilindi — ulush yana to‘lanmagan');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data?.partner.name ?? '…'}{' '}
            <span className="text-muted-foreground text-sm font-normal">
              {data?.partner.type === 'doctor' ? '· yo‘llagan shifokor' : '· agent'}
            </span>
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="text-muted-foreground p-4 text-sm">Yuklanmoqda…</div>
        ) : (
          <div className="space-y-4">
            <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {data.partner.specialty && <span>{data.partner.specialty}</span>}
              {data.partner.workplace && <span>{data.partner.workplace}</span>}
              {[data.partner.phone, data.partner.phone2].filter(Boolean).length > 0 && (
                <span>{[data.partner.phone, data.partner.phone2].filter(Boolean).join(', ')}</span>
              )}
              <span>Kartadagi foiz: {data.partner.commission_percent}%</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground text-xs">Hisoblangan</div>
                <div className="font-semibold">{fmt(data.totals.accrued_uzs)}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground text-xs">To‘langan</div>
                <div className="font-semibold text-emerald-700">{fmt(data.totals.paid_uzs)}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground text-xs">Qoldiq</div>
                <div className="font-semibold text-amber-700">{fmt(data.totals.unpaid_uzs)}</div>
              </div>
            </div>

            <StaysTable rows={data.stays} selected={selected} onToggle={toggle} />

            {unpaidRows.length > 0 && (
              <div className="bg-muted/20 space-y-3 rounded-lg border p-3">
                <div className="text-sm font-semibold">To‘lash</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="space-y-1 text-sm">
                    <div className="text-muted-foreground text-xs font-medium">To‘lov usuli</div>
                    <Select
                      value={method}
                      onValueChange={(v) => setMethod(v as ReferralPayoutInput['method'])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {METHODS.map((m) => (
                          <SelectItem key={m.v} value={m.v}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {method === 'cash' && (
                    <label className="space-y-1 text-sm">
                      <div className="text-muted-foreground text-xs font-medium">Pul manbai</div>
                      <Select
                        value={source}
                        onValueChange={(v) => setSource(v as 'cash_drawer' | 'safe')}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash_drawer">Statsionar kassasi</SelectItem>
                          <SelectItem value="safe">Seyf</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                  <label className="space-y-1 text-sm">
                    <div className="text-muted-foreground text-xs font-medium">
                      Izoh (ixtiyoriy)
                    </div>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </label>
                </div>
                {withDebt > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Tanlangan bemorlardan {withDebt} tasi hali to‘liq to‘lamagan. To‘lash mumkin,
                    lekin avval bemor to‘lovini tekshiring.
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-muted-foreground text-xs">
                    Statsionar kassasidan xarajat sifatida yoziladi (smena ochiq bo‘lishi kerak).
                  </div>
                  <Button
                    disabled={amount <= 0 || payMut.isPending}
                    onClick={() => payMut.mutate()}
                    className="gap-1"
                  >
                    <Wallet className="h-4 w-4" />
                    {payMut.isPending ? 'To‘lanmoqda…' : `To‘lash: ${fmt(amount)} so‘m`}
                  </Button>
                </div>
              </div>
            )}

            <PayoutHistory
              payouts={data.payouts}
              onPrint={(p) => printPayout(p)}
              onCancel={(id) => {
                if (confirm('To‘lovni bekor qilasizmi? Kassadagi xarajat ham bekor bo‘ladi.')) {
                  cancelMut.mutate(id);
                }
              }}
              cancelling={cancelMut.isPending}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StaysTable({
  rows,
  selected,
  onToggle,
}: {
  rows: ReferralStayRow[];
  selected: Set<string>;
  onToggle: (stayId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border p-4 text-center text-sm">
        Hali ulush hisoblanmagan
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs uppercase">
          <tr>
            <th className="w-8 px-2 py-2" />
            <th className="px-2 py-2">Bemor</th>
            <th className="px-2 py-2">Yotgan</th>
            <th className="px-2 py-2 text-right">%</th>
            <th className="px-2 py-2 text-right">Kun</th>
            <th className="px-2 py-2 text-right">Hisoblangan</th>
            <th className="px-2 py-2 text-right">To‘langan</th>
            <th className="px-2 py-2 text-right">Qoldiq</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={`${s.stay_id}:${s.role}`} className="border-b last:border-b-0">
              <td className="px-2 py-2">
                {s.unpaid_uzs > 0 && (
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selected.has(s.stay_id)}
                    onChange={() => onToggle(s.stay_id)}
                  />
                )}
              </td>
              <td className="px-2 py-2">
                <Link to={`/inpatient/stays/${s.stay_id}`} className="font-medium hover:underline">
                  {s.patient_name}
                </Link>
                <div className="text-muted-foreground text-xs">
                  {[s.room_number && `№${s.room_number}`, STATUS[s.status] ?? s.status]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {s.patient_debt_uzs > 0 && (
                  <div className="text-xs font-medium text-amber-700">
                    Bemor to‘lamagan: {fmt(s.patient_debt_uzs)}
                  </div>
                )}
              </td>
              <td className="text-muted-foreground px-2 py-2 text-xs">
                {fmtDate(s.admitted_at)} — {s.discharged_at ? fmtDate(s.discharged_at) : 'hozir'}
              </td>
              <td className="px-2 py-2 text-right">{s.percent}%</td>
              <td className="px-2 py-2 text-right">{s.days}</td>
              <td className="px-2 py-2 text-right">{fmt(s.accrued_uzs)}</td>
              <td className="px-2 py-2 text-right text-emerald-700">{fmt(s.paid_uzs)}</td>
              <td
                className={cn(
                  'px-2 py-2 text-right font-semibold',
                  s.unpaid_uzs > 0 ? 'text-amber-700' : 'text-muted-foreground',
                )}
              >
                {fmt(s.unpaid_uzs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PayoutHistory({
  payouts,
  onPrint,
  onCancel,
  cancelling,
}: {
  payouts: ReferralPayout[];
  onPrint: (p: ReferralPayout) => void;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  if (payouts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold">To‘lovlar tarixi</div>
      <div className="divide-y rounded-md border">
        {payouts.map((p) => (
          <div
            key={p.id}
            className={cn(
              'flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm',
              p.status !== 'paid' && 'text-muted-foreground line-through',
            )}
          >
            <div>
              <span className="font-medium">{fmt(p.amount_uzs)} so‘m</span>{' '}
              <span className="text-muted-foreground text-xs">
                · {methodLabel(p.method)}
                {p.method === 'cash' && p.source === 'safe' ? ' (seyf)' : ''} ·{' '}
                {new Date(p.paid_at).toLocaleString('uz-UZ', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
                {p.paid_by_name ? ` · ${p.paid_by_name}` : ''}
                {p.notes ? ` · ${p.notes}` : ''}
              </span>
            </div>
            {p.status === 'paid' ? (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => onPrint(p)}>
                  <Printer className="h-3.5 w-3.5" /> Chek
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-red-600"
                  disabled={cancelling}
                  onClick={() => onCancel(p.id)}
                >
                  <Undo2 className="h-3.5 w-3.5" /> Bekor qilish
                </Button>
              </div>
            ) : (
              <Badge variant="secondary" className="text-[10px] no-underline">
                bekor qilingan
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
