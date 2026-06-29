import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input, Label, Textarea } from '@clary/ui-web';
import { Send, Building2, ShieldCheck, Bell, Pencil, Check, Link2, Unlink, Lock, ArrowLeft, Plug, RefreshCw, Zap, ZapOff, TestTube2, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';

// =============================================================================
// Super-admin klinika "Batafsil" — alohida sahifa: xabar / filial / sug'urta /
// eslatma / tahrir. Filial + sug'urta faqat Enterprise (120pro).
// =============================================================================
const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
type Tab = 'message' | 'branches' | 'insurance' | 'reminders' | 'edit' | 'dmed';
type Clinic = { id: string; name: string; current_plan: string | null };

export function ClinicManagePage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('message');

  const { data, isLoading } = useQuery<{ clinic: Clinic }>({
    queryKey: ['tenant-detail', id],
    queryFn: () => api.get(`/api/v1/admin/tenants/${id}/detail`),
    enabled: !!id,
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</div>;
  }
  const clinic = data.clinic;
  const isEnterprise = clinic.current_plan === '120pro';
  const tabs: Array<{ key: Tab; label: string; icon: typeof Send; ent?: boolean }> = [
    { key: 'message', label: 'Xabar', icon: Send },
    { key: 'branches', label: 'Filiallar', icon: Building2, ent: true },
    { key: 'insurance', label: "Sug'urta", icon: ShieldCheck, ent: true },
    { key: 'reminders', label: 'Eslatma', icon: Bell },
    { key: 'edit', label: 'Tahrir', icon: Pencil },
    { key: 'dmed', label: 'DMED', icon: Plug },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/subscriptions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Obunalar
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{clinic.name}</h1>
        <Badge variant={isEnterprise ? 'success' : 'outline'}>{clinic.current_plan ?? '—'}</Badge>
        <Link to={`/tenants/${clinic.id}`} className="ml-auto text-xs font-medium text-primary hover:underline">To'liq tafsilot →</Link>
      </div>

      <div className="flex flex-wrap gap-1 border-b pb-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm ${tab === t.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}{t.ent && !isEnterprise && <Lock className="h-3 w-3 opacity-60" />}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-4">
        {tab === 'message' && <MessageTab clinic={clinic} />}
        {tab === 'branches' && (isEnterprise ? <BranchesTab clinicId={clinic.id} /> : <EntNotice />)}
        {tab === 'insurance' && (isEnterprise ? <InsuranceTab clinicId={clinic.id} /> : <EntNotice />)}
        {tab === 'reminders' && <RemindersTab clinicId={clinic.id} />}
        {tab === 'edit' && <EditTab clinic={clinic} />}
        {tab === 'dmed' && <DmedTab clinicId={clinic.id} />}
      </div>
    </div>
  );
}

function EntNotice() {
  return <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">Bu funksiya faqat <b>Enterprise (120pro)</b> tarifda mavjud. Avval "Tahrir" tabidan tarifni o'zgartiring.</div>;
}

function MessageTab({ clinic }: { clinic: Clinic }) {
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
  const candidates = ((tenants ?? []) as Array<{ id: string; name: string }>).filter((t) => !branchIds.has(t.id) && t.id !== clinicId);

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

const HARD_DELETE_CODE = '4020';

function EditTab({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(clinic.name);
  const [plan, setPlan] = useState(clinic.current_plan ?? 'demo');
  const [delCode, setDelCode] = useState('');
  const mut = useMutation({
    mutationFn: async () => {
      if (name.trim() && name.trim() !== clinic.name) await api.admin.updateTenant(clinic.id, { name: name.trim() });
      if (plan !== clinic.current_plan) await api.admin.changePlan(clinic.id, plan);
    },
    onSuccess: () => {
      toast.success('Saqlandi');
      qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      qc.invalidateQueries({ queryKey: ['tenant-detail', clinic.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: () => api.admin.hardDeleteClinicByCode(clinic.id, delCode.trim()),
    onSuccess: (r) => {
      toast.success(`"${r?.deleted_name ?? clinic.name}" butunlay o'chirildi`);
      qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      navigate('/subscriptions');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const codeOk = delCode.trim() === HARD_DELETE_CODE;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5"><Label>Nomi</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Tarif</Label>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
          <option value="demo">Demo</option><option value="25pro">Base (25pro)</option><option value="50pro">Pro (50pro)</option><option value="120pro">Enterprise (120pro)</option>
        </select>
      </div>
      <Button className="w-full" disabled={mut.isPending} onClick={() => mut.mutate()}>Saqlash</Button>

      {/* ── Xavfli zona — klinikani butunlay o'chirish ──────────────────────── */}
      <div className="mt-6 space-y-3 rounded-lg border border-rose-300 bg-rose-50/50 p-4 dark:border-rose-900 dark:bg-rose-950/20">
        <div className="flex items-center gap-2 text-sm font-semibold text-rose-600">
          <AlertTriangle className="h-4 w-4" /> Xavfli zona
        </div>
        <p className="text-xs text-muted-foreground">
          Klinikani <b>butunlay</b> o'chiradi: barcha bemorlar, moliyaviy yozuvlar, xodimlar,
          smenalar va fayllar bilan birga. Bu amal <b>QAYTARIB BO'LMAYDI</b>. Tasdiqlash uchun{' '}
          <b className="text-rose-600">{HARD_DELETE_CODE}</b> kodini kiriting.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={delCode}
            onChange={(e) => setDelCode(e.target.value)}
            placeholder="Kod"
            inputMode="numeric"
            className="max-w-[120px]"
          />
          <Button
            className="bg-rose-600 text-white hover:bg-rose-700"
            disabled={!codeOk || delMut.isPending}
            onClick={() => {
              if (window.confirm(`"${clinic.name}" klinikasini BUTUNLAY o'chirmoqchimisiz?\nBu amalni ortga qaytarib bo'lmaydi!`)) {
                delMut.mutate();
              }
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {delMut.isPending ? "O'chirilmoqda…" : "Butunlay o'chirish"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── DMED Tab ─────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  not_configured: { label: 'Sozlanmagan', color: 'text-muted-foreground' },
  draft:    { label: 'Qoralama', color: 'text-amber-600' },
  invited:  { label: 'Taklif yuborilgan', color: 'text-blue-600' },
  active:   { label: 'Faol (ulangan)', color: 'text-emerald-600' },
  declined: { label: 'Rad etilgan', color: 'text-rose-600' },
  disabled: { label: 'O\'chirilgan', color: 'text-muted-foreground' },
};

function DmedTab({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  type ConnData = {
    status: string; has_secret: boolean; client_id: string | null; fhir_base_url: string | null;
    facility_code: string | null; scopes: string[]; invited_at: string | null; accepted_at: string | null;
    declined_at: string | null; force_activated: boolean; last_sync_at: string | null; last_error: string | null;
  };
  const { data, isLoading } = useQuery<ConnData>({
    queryKey: ['adm-dmed', clinicId],
    queryFn: () => api.admin.getDmedConnection(clinicId) as Promise<ConnData>,
  });

  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [fhirBase, setFhirBase] = useState('');
  const [facilityCode, setFacilityCode] = useState('');

  // Populate form when data loads
  const loaded = data as ConnData | undefined;
  const formInit = (d: ConnData) => {
    if (d.client_id && !clientId) setClientId(d.client_id);
    if (d.fhir_base_url && !fhirBase) setFhirBase(d.fhir_base_url);
    if (d.facility_code && !facilityCode) setFacilityCode(d.facility_code);
  };
  if (loaded && loaded.status !== 'not_configured' && !clientId && loaded.client_id) formInit(loaded);

  const inv = () => qc.invalidateQueries({ queryKey: ['adm-dmed', clinicId] });

  const saveMut = useMutation({
    mutationFn: () => {
      if (!clientId.trim() || !fhirBase.trim() || !facilityCode.trim()) throw new Error('client_id, FHIR URL va muassasa kodi majburiy');
      return api.admin.saveDmedConnection(clinicId, {
        client_id: clientId.trim(), fhir_base_url: fhirBase.trim(),
        facility_code: facilityCode.trim(), secret: secret || undefined, scopes: ['openid', 'fhir'],
      });
    },
    onSuccess: () => { toast.success('DMED ma\'lumotlari saqlandi'); setSecret(''); inv(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const inviteMut = useMutation({ mutationFn: () => api.admin.inviteDmed(clinicId), onSuccess: () => { toast.success('So\'rov yuborildi'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const activateMut = useMutation({ mutationFn: () => api.admin.activateDmed(clinicId), onSuccess: () => { toast.success('Darhol faollashtirildi'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const disconnectMut = useMutation({ mutationFn: () => api.admin.disconnectDmed(clinicId), onSuccess: () => { toast.success('Uzildi'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const testMut = useMutation({ mutationFn: () => api.admin.testDmed(clinicId), onSuccess: (r) => toast.success(r.message ?? 'Test muvaffaqiyatli'), onError: (e: Error) => toast.error(e.message) });

  const { data: auditLog } = useQuery({
    queryKey: ['adm-dmed-audit', clinicId],
    queryFn: () => api.admin.getDmedAuditLog(clinicId),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Yuklanmoqda…</p>;

  const st = loaded?.status ?? 'not_configured';
  const stInfo = STATUS_LABELS[st] ?? { label: st, color: '' };
  const canInvite = ['draft', 'declined', 'disabled'].includes(st);
  const canActivate = ['draft', 'invited', 'declined'].includes(st);
  const canDisconnect = st === 'active';

  return (
    <div className="space-y-4">
      {/* Holat */}
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">DMED holati:</span>
        <span className={`text-sm font-semibold ${stInfo.color}`}>{stInfo.label}</span>
        {loaded?.force_activated && <span className="text-[11px] text-amber-600">(majburiy)</span>}
      </div>

      {/* Meta */}
      {loaded && loaded.status !== 'not_configured' && (
        <div className="rounded-md bg-muted/30 p-3 text-xs space-y-1 text-muted-foreground">
          {loaded.invited_at && <div>So'rov: {new Date(loaded.invited_at).toLocaleString('uz-UZ')}</div>}
          {loaded.accepted_at && <div>Qabul: {new Date(loaded.accepted_at).toLocaleString('uz-UZ')}</div>}
          {loaded.declined_at && <div>Rad: {new Date(loaded.declined_at).toLocaleString('uz-UZ')}</div>}
          {loaded.last_sync_at && <div>Oxirgi sinx: {new Date(loaded.last_sync_at).toLocaleString('uz-UZ')}</div>}
          {loaded.last_error && <div className="text-rose-600">Xato: {loaded.last_error}</div>}
        </div>
      )}

      {/* Forma */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Client ID</Label><Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="dmed_client_..." /></div>
        <div className="space-y-1.5">
          <Label>Secret {loaded?.has_secret && <span className="text-[10px] text-emerald-600 ml-1">saqlangan ✓</span>}</Label>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={loaded?.has_secret ? '••••• (o\'zgartirish uchun kiriting)' : 'Client secret'} />
        </div>
        <div className="space-y-1.5 col-span-2"><Label>FHIR Base URL</Label><Input value={fhirBase} onChange={(e) => setFhirBase(e.target.value)} placeholder="https://dmed.health.gov.uz/fhir" /></div>
        <div className="space-y-1.5"><Label>Muassasa kodi (MoH)</Label><Input value={facilityCode} onChange={(e) => setFacilityCode(e.target.value)} placeholder="UZ-12345" /></div>
      </div>
      <Button className="w-full" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
        <RefreshCw className="mr-1.5 h-4 w-4" /> Saqlash
      </Button>

      {/* Amallar */}
      <div className="flex flex-wrap gap-2">
        {canInvite && (
          <Button variant="outline" disabled={inviteMut.isPending} onClick={() => inviteMut.mutate()}>
            <Send className="mr-1 h-4 w-4" /> Klinikaga so'rov yuborish
          </Button>
        )}
        {canActivate && (
          <Button variant="outline" disabled={activateMut.isPending} onClick={() => activateMut.mutate()}>
            <Zap className="mr-1 h-4 w-4" /> Darhol faollashtirish
          </Button>
        )}
        {canDisconnect && (
          <Button variant="outline" className="text-rose-600 hover:text-rose-600" disabled={disconnectMut.isPending} onClick={() => disconnectMut.mutate()}>
            <ZapOff className="mr-1 h-4 w-4" /> Uzish
          </Button>
        )}
        <Button variant="outline" disabled={testMut.isPending} onClick={() => testMut.mutate()}>
          <TestTube2 className="mr-1 h-4 w-4" /> Test
        </Button>
      </div>

      {/* Audit log */}
      {(auditLog ?? []).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Amallar tarixi</p>
          {(auditLog ?? []).map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
              <span className="font-medium">{a.action}</span>
              <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString('uz-UZ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
