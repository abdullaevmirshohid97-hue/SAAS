import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Plus, Upload, Link2, CheckCircle2, AlertCircle } from 'lucide-react';

import {
  PageHeader, Card, CardContent, Badge, Button, Input, EmptyState,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@clary/ui-web';

import { api } from '@/lib/api';

// =============================================================================
// QISM 2 / E4 — Bank Integration: hisoblar + statement import + reconciliation.
// =============================================================================
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const ST: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Kutilmoqda', cls: 'bg-amber-500/15 text-amber-700' },
  matched: { label: 'Moslangan', cls: 'bg-emerald-500/15 text-emerald-600' },
  ignored: { label: 'E’tiborsiz', cls: 'bg-slate-500/15 text-slate-600' },
};

export function BankPage() {
  const qc = useQueryClient();
  const { data: accounts } = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.bank.accounts() });
  const [accId, setAccId] = useState<string>('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { if (!accId && accounts && accounts.length) setAccId(accounts[0]!.id); }, [accounts, accId]);

  const { data: recon } = useQuery({ queryKey: ['bank-recon', accId], queryFn: () => api.bank.reconciliation(accId), enabled: !!accId });
  const { data: txns } = useQuery({ queryKey: ['bank-txns', accId], queryFn: () => api.bank.transactions(accId), enabled: !!accId });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['bank-recon', accId] }); qc.invalidateQueries({ queryKey: ['bank-txns', accId] }); };
  const matchMut = useMutation({ mutationFn: () => api.bank.autoMatch(accId), onSuccess: (r) => { toast.success(`${r.matched} ta avto-moslandi`); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const statusMut = useMutation({ mutationFn: (v: { id: string; status: 'pending' | 'matched' | 'ignored' }) => api.bank.setStatus(v.id, v.status), onSuccess: invalidate });

  const balanced = recon && recon.difference === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Bank integratsiyasi" description="Bank hisoblari + statement import + GL kassa bilan reconciliation (avto-match)." />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select value={accId} onChange={(e) => setAccId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {(accounts ?? []).length === 0 && <option value="">— hisob yo'q —</option>}
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.bank_name ? ` (${a.bank_name})` : ''}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Hisob</Button>
        </div>
        {accId && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-1 h-3.5 w-3.5" /> Statement import</Button>
            <Button size="sm" onClick={() => matchMut.mutate()} disabled={matchMut.isPending}><Link2 className="mr-1 h-3.5 w-3.5" /> Avto-match</Button>
          </div>
        )}
      </div>

      {/* Reconciliation */}
      {accId && recon && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Bank qoldiq</div><div className="text-lg font-bold">{fmt(recon.bank_balance)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">GL kassa ({recon.gl_code})</div><div className="text-lg font-bold">{fmt(recon.gl_balance)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Farq</div><div className={`flex items-center gap-1 text-lg font-bold ${balanced ? 'text-emerald-600' : 'text-rose-600'}`}>{balanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{fmt(recon.difference)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Kutilayotgan</div><div className="text-lg font-bold">{recon.pending_count} / {recon.total}</div></CardContent></Card>
        </div>
      )}

      {/* Transactions */}
      {accId && (
        (txns ?? []).length === 0 ? (
          <EmptyState title="Tranzaksiya yo'q" description="«Statement import» bilan bank vyderjkasini yuklang." />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr><th className="p-3">Sana</th><th>Izoh</th><th className="text-right">Summa</th><th>Holat</th><th className="p-3"></th></tr>
                </thead>
                <tbody>
                  {txns?.map((t) => {
                    const st = ST[t.status] ?? { label: t.status, cls: '' };
                    return (
                      <tr key={t.id} className="border-b last:border-0">
                        <td className="p-3 tabular-nums">{t.txn_date}</td>
                        <td className="text-muted-foreground">{t.description ?? '—'}</td>
                        <td className={`text-right tabular-nums font-medium ${t.amount_uzs >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{t.amount_uzs >= 0 ? '+' : ''}{fmt(t.amount_uzs)}</td>
                        <td><Badge variant="secondary" className={`text-[10px] ${st.cls}`}>{st.label}</Badge></td>
                        <td className="p-3 text-right">
                          {t.status === 'pending' && <button className="text-xs text-muted-foreground hover:underline" onClick={() => statusMut.mutate({ id: t.id, status: 'ignored' })}>e'tiborsiz</button>}
                          {t.status !== 'pending' && <button className="text-xs text-muted-foreground hover:underline" onClick={() => statusMut.mutate({ id: t.id, status: 'pending' })}>qaytarish</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )
      )}

      {addOpen && <AddAccountDialog onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['bank-accounts'] }); }} />}
      {importOpen && accId && <ImportDialog accountId={accId} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); invalidate(); }} />}
    </div>
  );
}

function AddAccountDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [acc, setAcc] = useState('');
  const [glCode, setGlCode] = useState('1030');
  const mut = useMutation({
    mutationFn: () => api.bank.createAccount({ name: name.trim(), bank_name: bank || undefined, account_number: acc || undefined, gl_code: glCode }),
    onSuccess: () => { toast.success('Hisob qo\'shildi'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Bank hisobi</DialogTitle><DialogDescription>GL kassa hisobi (gl_code) bilan bog'lanadi.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs">Nomi<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asosiy hisob" /></label>
          <label className="flex flex-col gap-1 text-xs">Bank<Input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Kapitalbank" /></label>
          <label className="flex flex-col gap-1 text-xs">Hisob raqami<Input value={acc} onChange={(e) => setAcc(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">GL hisob kodi<Input value={glCode} onChange={(e) => setGlCode(e.target.value)} /></label>
          <Button className="w-full" disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ accountId, onClose, onDone }: { accountId: string; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const mut = useMutation({
    mutationFn: () => {
      const lines = csv.split('\n').map((row) => row.trim()).filter(Boolean).map((row) => {
        const [date, amount, ...desc] = row.split(',');
        return { txn_date: (date ?? '').trim(), amount_uzs: Math.round(Number((amount ?? '0').replace(/\s/g, '')) || 0), description: desc.join(',').trim() || undefined };
      }).filter((l) => l.txn_date && l.amount_uzs !== 0);
      if (lines.length === 0) throw new Error('To\'g\'ri qator topilmadi');
      return api.bank.import({ bank_account_id: accountId, lines });
    },
    onSuccess: (r) => { toast.success(`${r.imported} ta import qilindi`); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Statement import (CSV)</DialogTitle>
          <DialogDescription>Har qator: <code>sana, summa, izoh</code> — summa + kirim / − chiqim. Masalan: <code>2026-06-01, 500000, Click tushum</code></DialogDescription>
        </DialogHeader>
        <textarea className="min-h-[160px] w-full rounded-md border bg-background p-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)}
          placeholder={'2026-06-01, 500000, Click tushum\n2026-06-02, -120000, Ijara to\'lovi'} />
        <Button disabled={!csv.trim() || mut.isPending} onClick={() => mut.mutate()}>Import qilish</Button>
      </DialogContent>
    </Dialog>
  );
}
