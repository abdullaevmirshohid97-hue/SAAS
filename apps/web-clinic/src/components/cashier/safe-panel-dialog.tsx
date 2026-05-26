import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Edit3,
  Plus,
  Trash2,
  X,
  Eye,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString('uz-UZ');
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const REF_TYPE_LABEL: Record<string, string> = {
  encashment: 'Inkasatsiya',
  manual_deposit: 'Qo\'lda qo\'shildi',
  safe_refund: 'Vozvrat (seyfdan)',
  safe_expense: 'Rasxot (seyfdan)',
  safe_adjustment: 'Tuzatish (seyfdan)',
  safe_payroll: 'Maosh (seyfdan)',
};

type Entry = {
  id: string;
  ref_type:
    | 'encashment'
    | 'manual_deposit'
    | 'safe_refund'
    | 'safe_expense'
    | 'safe_adjustment'
    | 'safe_payroll';
  ref_id: string;
  direction: 'in' | 'out';
  amount_uzs: number;
  reason: string;
  created_at: string;
  author: string | null;
  editable: boolean;
};

export function SafePanelDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === 'clinic_admin' || role === 'clinic_owner' || role === 'super_admin';

  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [viewEntry, setViewEntry] = useState<Entry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Entry | null>(null);

  const { data: balance, isLoading: balLoading } = useQuery({
    queryKey: ['cashier', 'safe-balance'],
    queryFn: () => api.cashier.safeBalance(),
    refetchInterval: 30_000,
  });

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ['cashier', 'safe-entries'],
    queryFn: () => api.cashier.safeEntries(200),
    refetchInterval: 30_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'cashier' });
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-amber-600" />
              Seyf
            </DialogTitle>
            <DialogDescription>
              Kassadan inkasatsiya qilingan va qo'lda qo'shilgan pul. Maosh,
              vozvrat va rasxotlar shu yerdan olinishi mumkin.
            </DialogDescription>
          </DialogHeader>

          {/* Balans kartochkasi */}
          <Card className="border-amber-300 bg-amber-50/50">
            <CardContent className="p-4">
              {balLoading || !balance ? (
                <div className="text-sm text-muted-foreground">Yuklanmoqda…</div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Joriy balans
                    </div>
                    <div
                      className={cn(
                        'font-mono text-2xl font-bold tabular-nums',
                        balance.safe_balance_uzs < 0 ? 'text-rose-700' : 'text-amber-700',
                      )}
                    >
                      {fmt(balance.safe_balance_uzs)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">so'm</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <ArrowDown className="h-3 w-3 text-emerald-600" /> Jami kirim
                    </div>
                    <div className="font-mono text-lg font-semibold tabular-nums text-emerald-700">
                      {fmt(balance.total_in_uzs)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Inkasatsiya {fmt(balance.encashed_total_uzs)} + qo'lda{' '}
                      {fmt(balance.manual_deposited_uzs)}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <ArrowUp className="h-3 w-3 text-rose-600" /> Jami chiqim
                    </div>
                    <div className="font-mono text-lg font-semibold tabular-nums text-rose-700">
                      {fmt(balance.withdrawn_from_safe_uzs)}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* "Pul qo'shish" tugmasi */}
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              Amaliyotlar ({entries?.length ?? 0})
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Pul qo'shish
            </Button>
          </div>

          {/* Yozuvlar ro'yxati */}
          <div className="overflow-x-auto rounded-md border">
            {entriesLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Yuklanmoqda…
              </div>
            ) : !entries || entries.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Seyfda hali amaliyot yo'q
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Sana</th>
                    <th className="px-3 py-2 text-left font-medium">Turi</th>
                    <th className="px-3 py-2 text-left font-medium">Sabab / Izoh</th>
                    <th className="px-3 py-2 text-left font-medium">Kim</th>
                    <th className="px-3 py-2 text-right font-medium">Summa</th>
                    <th className="px-3 py-2 text-right font-medium">Amallar</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {fmtDate(e.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                            e.direction === 'in'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700',
                          )}
                        >
                          {e.direction === 'in' ? '↓' : '↑'} {REF_TYPE_LABEL[e.ref_type] ?? e.ref_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[260px] truncate">{e.reason}</td>
                      <td className="px-3 py-2 text-xs">{e.author ?? '—'}</td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-mono font-semibold tabular-nums',
                          e.direction === 'in' ? 'text-emerald-700' : 'text-rose-700',
                        )}
                      >
                        {e.direction === 'in' ? '+' : '−'}{fmt(e.amount_uzs)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Batafsil"
                            onClick={() => setViewEntry(e)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && e.ref_type === 'manual_deposit' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50"
                                title="Tahrirlash"
                                onClick={() => setEditEntry(e)}
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50"
                                title="O'chirish"
                                onClick={() => setConfirmDelete(e)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Yopish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {addOpen && <AddSafeDepositDialog onClose={() => setAddOpen(false)} onSuccess={refresh} />}
      {editEntry && (
        <EditSafeDepositDialog
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSuccess={refresh}
        />
      )}
      {viewEntry && <ViewEntryDialog entry={viewEntry} onClose={() => setViewEntry(null)} />}
      {confirmDelete && (
        <DeleteSafeDepositConfirm
          entry={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}

// =============== Yangi yozuv qo'shish ===============
function AddSafeDepositDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const amountNum = Math.max(0, Number.parseInt(amount, 10) || 0);

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.addSafeDeposit({ amount_uzs: amountNum, reason }),
    onSuccess: () => {
      toast.success(`${fmt(amountNum)} so'm seyfga qo'shildi`);
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Seyfga pul qo'shish</DialogTitle>
          <DialogDescription>
            Inkasatsiya'dan tashqari qo'lda pul kiritish (masalan, eski naqd
            yoki egasidan).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Summa (so'm)</label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500000"
              className="text-lg font-mono"
            />
            {amountNum > 0 && (
              <div className="text-xs text-emerald-700 font-semibold">
                +{fmt(amountNum)} so'm
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Sabab (majburiy, kamida 3 belgi)
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Masalan: klinika egasidan yangi qo'shildi"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={amountNum <= 0 || reason.trim().length < 3 || mut.isPending}
          >
            Qo'shish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============== Tahrirlash ===============
function EditSafeDepositDialog({
  entry,
  onClose,
  onSuccess,
}: {
  entry: Entry;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState(String(entry.amount_uzs));
  const [reason, setReason] = useState(entry.reason);
  const amountNum = Math.max(0, Number.parseInt(amount, 10) || 0);

  const mut = useMutation({
    mutationFn: () =>
      api.cashier.updateSafeDeposit(entry.ref_id, {
        amount_uzs: amountNum,
        reason,
      }),
    onSuccess: () => {
      toast.success('Yozuv yangilandi');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yozuvni tahrirlash</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Summa (so'm)</label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Sabab</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={amountNum <= 0 || reason.trim().length < 3 || mut.isPending}
          >
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============== Batafsil ko'rish ===============
function ViewEntryDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {entry.direction === 'in' ? (
              <ArrowDown className="h-5 w-5 text-emerald-600" />
            ) : (
              <ArrowUp className="h-5 w-5 text-rose-600" />
            )}
            {REF_TYPE_LABEL[entry.ref_type] ?? entry.ref_type}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Row label="Summa" value={
            <span className={cn(
              'font-mono text-lg font-semibold',
              entry.direction === 'in' ? 'text-emerald-700' : 'text-rose-700',
            )}>
              {entry.direction === 'in' ? '+' : '−'}{fmt(entry.amount_uzs)} so'm
            </span>
          } />
          <Row label="Sana / Vaqt" value={fmtDate(entry.created_at)} />
          <Row label="Yo'nalish" value={entry.direction === 'in' ? 'Kirim (qo\'shildi)' : 'Chiqim (olindi)'} />
          <Row label="Kim" value={entry.author ?? '—'} />
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-medium text-muted-foreground mb-1">Sabab / Izoh</div>
            <div className="whitespace-pre-wrap">{entry.reason}</div>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">ID: {entry.ref_id}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Yopish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="col-span-2 font-medium">{value ?? '—'}</div>
    </div>
  );
}

// =============== O'chirish tasdiqlash ===============
function DeleteSafeDepositConfirm({
  entry,
  onClose,
  onSuccess,
}: {
  entry: Entry;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const mut = useMutation({
    mutationFn: () => api.cashier.deleteSafeDeposit(entry.ref_id),
    onSuccess: () => {
      toast.success('Yozuv o\'chirildi');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <X className="h-5 w-5" />
            Yozuvni o'chirish?
          </DialogTitle>
          <DialogDescription>
            Bu yozuv soft-delete bo'ladi (audit izi saqlanadi). Seyf balansi
            shunga ko'ra yangilanadi.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <div className="font-semibold">
                {fmt(entry.amount_uzs)} so'm — {entry.reason}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {fmtDate(entry.created_at)} · {entry.author ?? '—'}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
          <Button
            variant="destructive"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
          >
            Ha, o'chirish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
