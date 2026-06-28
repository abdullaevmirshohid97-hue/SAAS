import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label, Textarea,
} from '@clary/ui-web';
import { Send, Building2, ShieldCheck, Bell, Pencil, Check, Link2, Unlink, Lock } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// =============================================================================
// Super-admin klinika "Batafsil" boshqaruvi: xabar / filial / sug'urta / eslatma / tahrir.
// Filial + sug'urta faqat Enterprise (120pro).
// =============================================================================
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
type Tab = 'message' | 'branches' | 'insurance' | 'reminders' | 'edit';

export function ClinicManageDialog({ clinic, onClose }: { clinic: { id: string; name: string; current_plan: string | null }; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('message');
  const isEnterprise = clinic.current_plan === '120pro';
  const tabs: Array<{ key: Tab; label: string; icon: typeof Send; ent?: boolean }> = [
    { key: 'message', label: 'Xabar', icon: Send },
    { key: 'branches', label: 'Filiallar', icon: Building2, ent: true },
    { key: 'insurance', label: "Sug'urta", icon: ShieldCheck, ent: true },
    { key: 'reminders', label: 'Eslatma', icon: Bell },
    { key: 'edit', label: 'Tahrir', icon: Pencil },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {clinic.name}
            <Badge variant={isEnterprise ? 'success' : 'outline'}>{clinic.current_plan ?? '—'}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-1 border-b pb-2">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm ${tab === t.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
              <t.icon className="h-3.5 w-3.5" />{t.label}{t.ent && !isEnterprise && <Lock className="h-3 w-3 opacity-60" />}
            </button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto pt-1">
          {tab === 'message' && <MessageTab clinic={clinic} />}
          {tab === 'branches' && (isEnterprise ? <BranchesTab clinicId={clinic.id} /> : <EntNotice />)}
          {tab === 'insurance' && (isEnterprise ? <InsuranceTab clinicId={clinic.id} /> : <EntNotice />)}
          {tab === 'reminders' && <RemindersTab clinicId={clinic.id} />}
          {tab === 'edit' && <EditTab clinic={clinic} onSaved={onClose} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EntNotice() {
  return <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">Bu funksiya faqat <b>Enterprise (120pro)</b> tarifda mavjud. Avval "Tahrir" tabidan tarifni o'zgartiring.</div>;
}

function MessageTab({ clinic }: { clinic: { id: string; name: string; current_plan: string | null } }) {
  const [inApp, setInApp] = useState(true);
  const [tg, setTg] = useState(false);
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [contact, setContact] = useState('+998770414020');
  const [note, setNote] = useState('');
  const mut = useMutation({
    mutationFn: () => {
      const channels: ('in_app' | 'telegram')[] = [];
      if (inApp) channels.push('in_app');
      if (tg) channels.push('telegram');
      if (channels.length === 0) throw new Error('Kanal tanlang');
      return api.admin.sendTenantMessage(clinic.id, {
        channels, plan_snapshot: clinic.current_plan ?? undefined,
        amount_uzs: amount ? Number(amount) : undefined, pay_date: payDate || undefined,
        contact_phone: contact || undefined, note: note || undefined,
      });
    },
    onSuccess: (r) => toast.success(`Yuborildi — in-app: ${r.in_app ? '✓' : '—'}, telegram: ${r.telegram ? '✓' : '—'}`),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} /> Ilova ichida (bloklovchi modal)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={tg} onChange={(e) => setTg(e.target.checked)} /> Telegram (owner)</label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>To'lov summasi (so'm)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>To'lov sanasi</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5"><Label>Aloqa raqami</Label><Input value={contact} onChange={(e) => setContact(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Qo'shimcha izoh</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
        Klinikaga: tarif <b>{clinic.current_plan ?? '—'}</b>{amount ? `, ${fmt(Number(amount))} so'm` : ''}{payDate ? `, ${payDate}` : ''} + aloqa {contact}
      </div>
      <Button className="w-full gap-1.5" disabled={mut.isPending} onClick={() => mut.mutate()}><Send className="h-4 w-4" /> Yuborish</Button>
    </div>
  );
}

function BranchesTab({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['adm-branches', clinicId], queryFn: () => api.admin.tenantBranches(clinicId) });
  const { data: tenants } = useQuery({ queryKey: ['adm-tenants-all'], queryFn: () => api.admin.listTenants() });
  const [pick, setPick] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['adm-branches', clinicId] });
  const linkMut = useMutation({ mutationFn: () => api.admin.linkBranch(clinicId, pick), onSuccess: () => { toast.success('Filial qo\'shildi'); setPick(''); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const unlinkMut = useMutation({ mutationFn: (bid: string) => api.admin.unlinkBranch(clinicId, bid), onSuccess: () => { toast.success('Ajratildi'); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const branchIds = new Set((data?.branches ?? []).map((b) => b.id));
  const candidates = ((tenants ?? []) as Array<{ id: string; name: string }>).filter((t) => !branchIds.has(t.id));

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label>Filial sifatida qo'shish (boshqa klinika)</Label>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
            <option value="">— klinika tanlang —</option>
            {candidates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <Button disabled={!pick || linkMut.isPending} onClick={() => linkMut.mutate()}><Link2 className="mr-1 h-4 w-4" /> Bog'lash</Button>
      </div>
      <div className="space-y-1">
        {(data?.branches ?? []).map((b) => (
          <div key={b.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
            <span>{b.name}{b.is_hq && <Badge variant="secondary" className="ml-2 text-[10px]">HQ</Badge>}</span>
            {!b.is_hq && <button className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline" onClick={() => unlinkMut.mutate(b.id)}><Unlink className="h-3 w-3" /> ajratish</button>}
          </div>
        ))}
        {(data?.branches ?? []).length === 0 && <p className="text-sm text-muted-foreground">Filial yo'q.</p>}
      </div>
    </div>
  );
}

function InsuranceTab({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['adm-insurance', clinicId], queryFn: () => api.admin.tenantInsurance(clinicId) });
  const { data: providers } = useQuery({ queryKey: ['adm-ins-providers'], queryFn: () => api.admin.listInsuranceProviders() });
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState('');
  const [copay, setCopay] = useState('0');
  const mut = useMutation({
    mutationFn: () => api.admin.linkInsurance(clinicId, { name: name.trim(), provider_id: providerId || undefined, copay_percent: Number(copay) || 0 }),
    onSuccess: () => { toast.success('Sug\'urta bog\'landi'); setName(''); setProviderId(''); qc.invalidateQueries({ queryKey: ['adm-insurance', clinicId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5"><Label>Nomi</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apex paket" /></div>
        <div className="space-y-1.5"><Label>Provider</Label>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
            <option value="">—</option>
            {(providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5"><Label>Copay %</Label><Input value={copay} onChange={(e) => setCopay(e.target.value)} /></div>
      </div>
      <Button disabled={!name.trim() || mut.isPending} onClick={() => mut.mutate()}><Link2 className="mr-1 h-4 w-4" /> Bog'lash</Button>
      <div className="space-y-1">
        {(data ?? []).map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
            <span>{c.name}{c.provider ? <span className="ml-1 text-xs text-muted-foreground">· {c.provider.name}</span> : null}</span>
            <span className="text-xs text-muted-foreground">copay {c.copay_percent}%</span>
          </div>
        ))}
        {(data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Shartnoma yo'q.</p>}
      </div>
    </div>
  );
}

function RemindersTab({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['adm-reminders', clinicId], queryFn: () => api.admin.tenantReminders(clinicId) });
  const [note, setNote] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['adm-reminders', clinicId] });
  const addMut = useMutation({ mutationFn: () => api.admin.addReminder(clinicId, note.trim()), onSuccess: () => { setNote(''); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const doneMut = useMutation({ mutationFn: (rid: string) => api.admin.doneReminder(clinicId, rid), onSuccess: invalidate });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Eslatma matni" />
        <Button disabled={!note.trim() || addMut.isPending} onClick={() => addMut.mutate()}>Qo'shish</Button>
      </div>
      <div className="space-y-1">
        {(data ?? []).map((r) => (
          <div key={r.id} className={`flex items-center justify-between rounded border px-2 py-1.5 text-sm ${r.is_done ? 'opacity-50' : ''}`}>
            <span className={r.is_done ? 'line-through' : ''}>{r.note}</span>
            {!r.is_done && <button className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline" onClick={() => doneMut.mutate(r.id)}><Check className="h-3 w-3" /> bajarildi</button>}
          </div>
        ))}
        {(data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Eslatma yo'q.</p>}
      </div>
    </div>
  );
}

function EditTab({ clinic, onSaved }: { clinic: { id: string; name: string; current_plan: string | null }; onSaved: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(clinic.name);
  const [plan, setPlan] = useState(clinic.current_plan ?? 'demo');
  const mut = useMutation({
    mutationFn: async () => {
      if (name.trim() && name.trim() !== clinic.name) await api.admin.updateTenant(clinic.id, { name: name.trim() });
      if (plan !== clinic.current_plan) await api.admin.changePlan(clinic.id, plan);
    },
    onSuccess: () => { toast.success('Saqlandi'); qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] }); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="space-y-1.5"><Label>Nomi</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Tarif</Label>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          <option value="demo">Demo</option><option value="25pro">Base (25pro)</option><option value="50pro">Pro (50pro)</option><option value="120pro">Enterprise (120pro)</option>
        </select>
      </div>
      <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>
    </div>
  );
}
