import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Plus, Search, Trash2, Upload, Wallet, X } from 'lucide-react';
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
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from '@clary/ui-web';
import type { DentalFile, DentalLabOrder, DentalPlan, DentalToothRow } from '@clary/api-client';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { ToothCell } from '@/components/dental/tooth-cell';
import {
  FDI_ADULT,
  FDI_CHILD,
  SURFACE_CONDITIONS,
  SURFACE_KEYS,
  SURFACE_LABEL,
  TOOTH_STATUS_META,
  type SurfaceKey,
} from '@/components/dental/dental-constants';
import { PaymentSplitEditor, type PaymentLeg } from '@/components/cashier/payment-split-editor';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function toStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      typeof x === 'string'
        ? x
        : x && typeof x === 'object' && 'name' in (x as Record<string, unknown>)
          ? String((x as { name: unknown }).name)
          : '',
    )
    .filter(Boolean);
}

function ageFromDob(dob?: string | null): string {
  if (!dob) return '—';
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '—';
  const years = Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
  return `${years} yosh`;
}

const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: 'Qoralama', approved: 'Tasdiqlangan', in_progress: 'Jarayonda', done: 'Yakunlangan', canceled: 'Bekor qilingan',
};

const FILE_KIND: Array<{ v: string; label: string }> = [
  { v: 'xray_opg', label: 'OPG (panoramik)' },
  { v: 'xray_ct', label: 'KT / KLKT' },
  { v: 'xray_periapical', label: 'Pritsel rentgen' },
  { v: 'intraoral', label: "Og'iz ichi foto" },
  { v: 'before', label: 'Oldin' },
  { v: 'after', label: 'Keyin' },
  { v: 'other', label: 'Boshqa' },
];
const FILE_KIND_LABEL: Record<string, string> = Object.fromEntries(FILE_KIND.map((k) => [k.v, k.label]));

const LAB_TYPE: Array<{ v: string; label: string }> = [
  { v: 'crown', label: 'Koronka' },
  { v: 'bridge', label: "Ko'prik (most)" },
  { v: 'denture', label: 'Protez' },
  { v: 'implant_crown', label: 'Implant koronka' },
  { v: 'inlay_onlay', label: 'Vkladka (inlay/onlay)' },
  { v: 'veneer', label: 'Vinir' },
  { v: 'aligner', label: 'Kappa / elayner' },
  { v: 'other', label: 'Boshqa' },
];
const LAB_TYPE_LABEL: Record<string, string> = Object.fromEntries(LAB_TYPE.map((k) => [k.v, k.label]));

const LAB_STATUS: Array<{ v: string; label: string; cls: string }> = [
  { v: 'ordered', label: 'Buyurtma berildi', cls: 'bg-slate-100 text-slate-700' },
  { v: 'in_progress', label: 'Jarayonda', cls: 'bg-amber-100 text-amber-700' },
  { v: 'ready', label: 'Tayyor', cls: 'bg-sky-100 text-sky-700' },
  { v: 'delivered', label: 'Topshirildi', cls: 'bg-emerald-100 text-emerald-700' },
  { v: 'canceled', label: 'Bekor qilingan', cls: 'bg-rose-100 text-rose-700' },
];
const LAB_STATUS_LABEL: Record<string, string> = Object.fromEntries(LAB_STATUS.map((k) => [k.v, k.label]));
const LAB_STATUS_CLS: Record<string, string> = Object.fromEntries(LAB_STATUS.map((k) => [k.v, k.cls]));

function fmtDay(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Mijoz tomonidan to'g'ridan-to'g'ri dental-files (maxfiy) bucket'ga yuklash.
async function uploadDentalFile(file: File, patientId: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'bin';
  const path = `${patientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('dental-files')
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

export function DentalPage() {
  const { can, role } = useAuth();
  const isOwner = role === 'clinic_owner' || role === 'clinic_admin';
  const canEdit = isOwner || can('dental.edit_chart');
  const canPlan = isOwner || can('dental.manage_plan');

  const [patient, setPatient] = useState<{ id: string; full_name: string } | null>(null);
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [activeSurface, setActiveSurface] = useState<SurfaceKey>('occlusal');
  const [payPlan, setPayPlan] = useState<DentalPlan | null>(null);
  const [addItemTo, setAddItemTo] = useState<{ planId: string; fdi?: number | null; surfaces?: Record<string, string> | null } | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stomatologiya"
        description="Interaktiv tish sxemasi, davolash rejasi va to‘lov"
      />

      {!patient ? (
        <PatientSearch onSelect={setPatient} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {patient.full_name.slice(0, 2).toUpperCase()}
              </span>
              <div className="font-medium">{patient.full_name}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setPatient(null); setSelectedTooth(null); }}>
              Boshqa bemor
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Chap: bemor kartasi + rejalar */}
            <div className="space-y-4 lg:col-span-1">
              <PatientCard patientId={patient.id} />
              <PlansSection
                patientId={patient.id}
                canPlan={canPlan}
                onPay={setPayPlan}
                onAddItem={(planId) => setAddItemTo({ planId })}
              />
            </div>

            {/* O'ng (asosiy): dental chart + tish paneli */}
            <div className="space-y-4 lg:col-span-2">
              <ChartSection
                patientId={patient.id}
                selectedTooth={selectedTooth}
                activeSurface={activeSurface}
                canEdit={canEdit}
                canPlan={canPlan}
                onPickTooth={(fdi, surface) => { setSelectedTooth(fdi); setActiveSurface(surface); }}
                onCloseTooth={() => setSelectedTooth(null)}
                onSetActiveSurface={setActiveSurface}
                onAddToPlan={(fdi, surfaces) => openAddToLatestPlan(patient.id, fdi, surfaces, setAddItemTo)}
              />
              <DentalFilesSection patientId={patient.id} canEdit={canEdit} currentTooth={selectedTooth} />
              <DentalLabSection patientId={patient.id} canPlan={canPlan} currentTooth={selectedTooth} />
            </div>
          </div>
        </>
      )}

      {payPlan && (
        <PayDialog plan={payPlan} onClose={() => setPayPlan(null)} />
      )}
      {addItemTo && (
        <AddItemDialog
          planId={addItemTo.planId}
          patientId={patient!.id}
          fdi={addItemTo.fdi ?? null}
          surfaces={addItemTo.surfaces ?? null}
          onClose={() => setAddItemTo(null)}
        />
      )}
    </div>
  );
}

// Joriy (eng so'nggi faol) rejani topib unga band qo'shadi; reja bo'lmasa
// yangi yaratadi, so'ng add-item dialogini ochadi.
async function openAddToLatestPlan(
  patientId: string,
  fdi: number,
  surfaces: Record<string, string>,
  setAddItemTo: (v: { planId: string; fdi?: number | null; surfaces?: Record<string, string> | null }) => void,
) {
  try {
    const plans = await api.dental.plans(patientId);
    const active = plans.find((p) => p.status !== 'canceled' && p.status !== 'done') ?? plans[0];
    const planId = active ? active.id : (await api.dental.createPlan({ patient_id: patientId })).id;
    setAddItemTo({ planId, fdi, surfaces });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// ---- Bemor qidiruv ----
function PatientSearch({ onSelect }: { onSelect: (p: { id: string; full_name: string }) => void }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['dental-patient-search', q],
    queryFn: () => api.patients.list({ q, pageSize: 12 }),
    enabled: q.length > 1,
  });
  const items = ((data as { items?: Array<{ id: string; full_name: string; phone?: string | null }> } | undefined)?.items) ?? [];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Bemor F.I.Sh. yoki telefon raqami..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        {q.length > 1 && (
          <div className="divide-y rounded-md border">
            {items.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Bemor topilmadi</div>
            ) : (
              items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/60"
                  onClick={() => onSelect({ id: p.id, full_name: p.full_name })}
                >
                  <span className="font-medium">{p.full_name}</span>
                  <span className="text-xs text-muted-foreground">{p.phone ?? ''}</span>
                </button>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Bemor kartasi ----
function PatientCard({ patientId }: { patientId: string }) {
  const { data } = useQuery({
    queryKey: ['dental-patient', patientId],
    queryFn: () => api.patients.get(patientId),
  });
  const p = (data ?? {}) as {
    full_name?: string; phone?: string | null; dob?: string | null; gender?: string | null;
    blood_type?: string | null; allergies?: unknown; chronic_conditions?: unknown;
  };
  const allergies = toStringList(p.allergies);
  const chronic = toStringList(p.chronic_conditions);
  const gender = p.gender === 'male' ? 'Erkak' : p.gender === 'female' ? 'Ayol' : '—';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Bemor ma'lumotlari</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row label="F.I.Sh." value={p.full_name ?? '—'} />
        <Row label="Telefon" value={p.phone ?? '—'} />
        <Row label="Yosh" value={ageFromDob(p.dob)} />
        <Row label="Jinsi" value={gender} />
        {p.blood_type && <Row label="Qon guruhi" value={p.blood_type} />}
        <div>
          <div className="text-xs text-muted-foreground">Allergiyalar</div>
          {allergies.length === 0 ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {allergies.map((a) => (
                <Badge key={a} variant="destructive" className="text-[10px]">{a}</Badge>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Surunkali kasalliklar</div>
          {chronic.length === 0 ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {chronic.map((c) => (
                <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

// ---- Dental Chart bo'limi (HERO) + tish paneli ----
function ChartSection({
  patientId, selectedTooth, activeSurface, canEdit, canPlan,
  onPickTooth, onCloseTooth, onSetActiveSurface, onAddToPlan,
}: {
  patientId: string;
  selectedTooth: number | null;
  activeSurface: SurfaceKey;
  canEdit: boolean;
  canPlan: boolean;
  onPickTooth: (fdi: number, surface: SurfaceKey) => void;
  onCloseTooth: () => void;
  onSetActiveSurface: (s: SurfaceKey) => void;
  onAddToPlan: (fdi: number, surfaces: Record<string, string>) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['dental', 'chart', patientId],
    queryFn: () => api.dental.chart(patientId),
  });
  const isAdult = data?.chart.is_adult ?? true;
  const teeth = useMemo(() => {
    const m = new Map<number, DentalToothRow>();
    for (const t of data?.teeth ?? []) m.set(t.fdi_number, t);
    return m;
  }, [data]);

  const updateTooth = useMutation({
    mutationFn: (body: { fdi_number: number; status?: string; surfaces?: Record<string, string>; notes?: string | null }) =>
      api.dental.updateTooth({ patient_id: patientId, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dental', 'chart', patientId] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const layout = isAdult ? FDI_ADULT : FDI_CHILD;
  const renderTooth = (fdi: number) => {
    const t = teeth.get(fdi);
    return (
      <ToothCell
        key={fdi}
        fdi={fdi}
        surfaces={(t?.surfaces ?? {}) as Record<string, string>}
        status={t?.status ?? 'sound'}
        selected={selectedTooth === fdi}
        onPick={(s) => onPickTooth(fdi, s)}
      />
    );
  };

  const current = selectedTooth != null ? teeth.get(selectedTooth) : undefined;
  const currentSurfaces = (current?.surfaces ?? {}) as Record<string, string>;

  const setSurfaceCond = (cond: string) => {
    if (selectedTooth == null) return;
    const next = { ...currentSurfaces };
    if (cond === '') delete next[activeSurface];
    else next[activeSurface] = cond;
    updateTooth.mutate({ fdi_number: selectedTooth, surfaces: next });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Tish sxemasi (FDI)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="mx-auto w-fit space-y-3 py-2">
              <div className="flex justify-center gap-4">
                <div className="flex gap-1">{layout.upperRight.map(renderTooth)}</div>
                <div className="w-px bg-border" />
                <div className="flex gap-1">{layout.upperLeft.map(renderTooth)}</div>
              </div>
              <div className="flex justify-center gap-4">
                <div className="flex gap-1">{layout.lowerRight.map(renderTooth)}</div>
                <div className="w-px bg-border" />
                <div className="flex gap-1">{layout.lowerLeft.map(renderTooth)}</div>
              </div>
            </div>
          </div>
        )}

        <Legend />

        {/* Tanlangan tish paneli */}
        {selectedTooth != null && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-semibold">Tish №{selectedTooth}</div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onCloseTooth}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Butun-tish holati */}
            <div className="mb-3">
              <div className="mb-1 text-xs text-muted-foreground">Butun tish holati</div>
              <Select
                value={current?.status ?? 'sound'}
                onValueChange={(v) => canEdit && updateTooth.mutate({ fdi_number: selectedTooth, status: v })}
                disabled={!canEdit}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TOOTH_STATUS_META.map((s) => (
                    <SelectItem key={s.v} value={s.v}>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                        {s.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Yuza (surface) tanlash */}
            <div className="mb-2">
              <div className="mb-1 text-xs text-muted-foreground">Yuza</div>
              <div className="flex flex-wrap gap-1">
                {SURFACE_KEYS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSetActiveSurface(s)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs',
                      activeSurface === s ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent/60',
                    )}
                  >
                    {SURFACE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Yuza sharti */}
            <div className="mb-3">
              <div className="mb-1 text-xs text-muted-foreground">{SURFACE_LABEL[activeSurface]} sharti</div>
              <div className="flex flex-wrap gap-1">
                {SURFACE_CONDITIONS.map((c) => {
                  const active = (currentSurfaces[activeSurface] ?? '') === c.v;
                  return (
                    <button
                      key={c.v || 'none'}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setSurfaceCond(c.v)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs disabled:opacity-50',
                        active ? 'border-primary bg-primary/10' : 'hover:bg-accent/60',
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-full border" style={{ background: c.color }} />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Izoh */}
            <ToothNote
              key={`note-${selectedTooth}`}
              initial={current?.notes ?? ''}
              disabled={!canEdit}
              onSave={(notes) => updateTooth.mutate({ fdi_number: selectedTooth, notes })}
            />

            {canPlan && (
              <Button
                size="sm"
                className="mt-3 w-full gap-1"
                onClick={() => onAddToPlan(selectedTooth, currentSurfaces)}
              >
                <Plus className="h-3.5 w-3.5" /> Davolash rejasiga qo'shish
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ToothNote({ initial, disabled, onSave }: { initial: string; disabled: boolean; onSave: (v: string) => void }) {
  const [val, setVal] = useState(initial);
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">Izoh</div>
      <Textarea
        value={val}
        disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => val !== initial && onSave(val)}
        rows={2}
        placeholder="Tish bo'yicha izoh..."
      />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border bg-muted/20 p-2 text-[11px]">
      <span className="font-medium text-muted-foreground">Yuza:</span>
      {SURFACE_CONDITIONS.filter((c) => c.v).map((c) => (
        <span key={c.v} className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full border" style={{ background: c.color }} />{c.label}
        </span>
      ))}
      <span className="font-medium text-muted-foreground">Holat:</span>
      {TOOTH_STATUS_META.filter((s) => ['pulpitis', 'periodontitis', 'crown', 'implant', 'extracted'].includes(s.v)).map((s) => (
        <span key={s.v} className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}
        </span>
      ))}
    </div>
  );
}

// ---- Davolash rejalari bo'limi ----
function PlansSection({
  patientId, canPlan, onPay, onAddItem,
}: {
  patientId: string;
  canPlan: boolean;
  onPay: (p: DentalPlan) => void;
  onAddItem: (planId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: plans, isLoading } = useQuery({
    queryKey: ['dental', 'plans', patientId],
    queryFn: () => api.dental.plans(patientId),
  });
  const { data: doctors } = useQuery({ queryKey: ['dental-doctors'], queryFn: () => api.doctors.list() });

  const createPlan = useMutation({
    mutationFn: () => api.dental.createPlan({ patient_id: patientId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dental', 'plans', patientId] }); toast.success('Reja yaratildi'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const removeItem = useMutation({
    mutationFn: (id: string) => api.dental.removeItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dental', 'plans', patientId] }),
    onError: (e) => toast.error((e as Error).message),
  });
  const updatePlan = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; doctor_id?: string | null }) => api.dental.updatePlan(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dental', 'plans', patientId] }),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Davolash rejalari</CardTitle>
        {canPlan && (
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => createPlan.mutate()} disabled={createPlan.isPending}>
            <Plus className="h-3.5 w-3.5" /> Yangi
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : (plans ?? []).length === 0 ? (
          <EmptyState title="Reja yo'q" description="Tishni belgilab davolash rejasi qo'shing." />
        ) : (
          (plans ?? []).map((plan) => {
            const remaining = Math.max(0, Number(plan.total_uzs) - Number(plan.paid_uzs));
            return (
              <div key={plan.id} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{plan.title}</div>
                    {canPlan ? (
                      <Select value={plan.doctor_id ?? ''} onValueChange={(v) => updatePlan.mutate({ id: plan.id, doctor_id: v })}>
                        <SelectTrigger className="mt-1 h-6 w-full text-[11px]">
                          <SelectValue placeholder="Shifokor tanlash (komissiya uchun)" />
                        </SelectTrigger>
                        <SelectContent>
                          {(doctors ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : plan.doctor?.full_name ? (
                      <div className="text-[11px] text-muted-foreground">{plan.doctor.full_name}</div>
                    ) : null}
                  </div>
                  {canPlan ? (
                    <Select value={plan.status} onValueChange={(v) => updatePlan.mutate({ id: plan.id, status: v })}>
                      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PLAN_STATUS_LABEL).map(([v, l]) => (
                          <SelectItem key={v} value={v}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{PLAN_STATUS_LABEL[plan.status] ?? plan.status}</Badge>
                  )}
                </div>

                {plan.items.length > 0 && (
                  <div className="mb-2 divide-y rounded-md border text-xs">
                    {plan.items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                        <div className="min-w-0">
                          <span className="font-medium">{it.fdi_number ? `№${it.fdi_number} ` : ''}{it.service_name_snapshot}</span>
                          {it.quantity > 1 && <span className="text-muted-foreground"> ×{it.quantity}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums">{fmt(it.price_uzs * it.quantity)}</span>
                          {canPlan && (
                            <button type="button" className="text-muted-foreground hover:text-rose-600" onClick={() => removeItem.mutate(it.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/30 p-2 text-center text-xs">
                  <div><div className="text-[10px] text-muted-foreground">Jami</div><div className="font-mono font-semibold">{fmt(plan.total_uzs)}</div></div>
                  <div><div className="text-[10px] text-muted-foreground">To'langan</div><div className="font-mono font-semibold text-emerald-700">{fmt(plan.paid_uzs)}</div></div>
                  <div><div className="text-[10px] text-muted-foreground">Qoldiq</div><div className={cn('font-mono font-semibold', remaining > 0 ? 'text-rose-700' : 'text-emerald-700')}>{fmt(remaining)}</div></div>
                </div>

                {canPlan && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onAddItem(plan.id)}>
                      <Plus className="h-3.5 w-3.5" /> Xizmat
                    </Button>
                    <Button size="sm" className="flex-1 gap-1" disabled={remaining <= 0} onClick={() => onPay(plan)}>
                      <Wallet className="h-3.5 w-3.5" /> To'lov
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ---- Xizmat qo'shish dialogi ----
function AddItemDialog({
  planId, patientId, fdi, surfaces, onClose,
}: {
  planId: string;
  patientId: string;
  fdi: number | null;
  surfaces: Record<string, string> | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: services } = useQuery({
    queryKey: ['dental-services'],
    queryFn: () => api.services.list(),
  });
  const [serviceId, setServiceId] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [qty, setQty] = useState<string>('1');

  const selected = (services ?? []).find((s) => s.id === serviceId);
  const effectivePrice = price !== '' ? Number(price) : Number(selected?.price_uzs ?? 0);

  const add = useMutation({
    mutationFn: () =>
      api.dental.addItem(planId, {
        service_id: serviceId || undefined,
        price_uzs: price !== '' ? Number(price) : undefined,
        quantity: Number(qty) || 1,
        fdi_number: fdi ?? undefined,
        surfaces: surfaces ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dental', 'plans', patientId] });
      toast.success('Xizmat qo‘shildi');
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rejaga xizmat qo'shish {fdi ? `(№${fdi})` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Xizmat</div>
            <Select value={serviceId} onValueChange={(v) => { setServiceId(v); setPrice(''); }}>
              <SelectTrigger><SelectValue placeholder="Xizmatni tanlang" /></SelectTrigger>
              <SelectContent>
                {(services ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name_i18n['uz-Latn'] ?? Object.values(s.name_i18n)[0]} — {fmt(s.price_uzs)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Narx (so'm)</div>
              <Input type="number" inputMode="numeric" value={price} placeholder={String(selected?.price_uzs ?? 0)} onChange={(e) => setPrice(e.target.value)} className="font-mono" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Soni</div>
              <Input type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="font-mono" />
            </div>
          </div>
          <div className="rounded-md bg-muted/30 p-2 text-right text-sm">
            Jami: <strong className="font-mono">{fmt(effectivePrice * (Number(qty) || 1))}</strong>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={!serviceId || add.isPending} onClick={() => add.mutate()}>Qo'shish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- To'lov dialogi ----
function PayDialog({ plan, onClose }: { plan: DentalPlan; onClose: () => void }) {
  const qc = useQueryClient();
  const remaining = Math.max(0, Number(plan.total_uzs) - Number(plan.paid_uzs));
  const [legs, setLegs] = useState<PaymentLeg[]>([{ method: 'cash', amount_uzs: remaining }]);

  const pay = useMutation({
    mutationFn: () =>
      api.dental.payPlan(plan.id, {
        payments: legs.filter((l) => l.amount_uzs > 0).map((l) => ({ method: l.method, amount_uzs: l.amount_uzs })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dental', 'plans', plan.patient_id] });
      qc.invalidateQueries({ queryKey: ['cashier'] });
      toast.success('To‘lov qabul qilindi');
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const sum = legs.reduce((s, l) => s + (Number(l.amount_uzs) || 0), 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>To'lov qabul qilish — {plan.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/30 p-2 text-center text-xs">
            <div><div className="text-[10px] text-muted-foreground">Jami</div><div className="font-mono font-semibold">{fmt(plan.total_uzs)}</div></div>
            <div><div className="text-[10px] text-muted-foreground">To'langan</div><div className="font-mono font-semibold text-emerald-700">{fmt(plan.paid_uzs)}</div></div>
            <div><div className="text-[10px] text-muted-foreground">Qoldiq</div><div className="font-mono font-semibold text-rose-700">{fmt(remaining)}</div></div>
          </div>
          <PaymentSplitEditor legs={legs} onChange={setLegs} target={remaining} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={sum <= 0 || pay.isPending} onClick={() => pay.mutate()}>
            {fmt(sum)} so'm qabul qilish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Rasmlar va rentgen ----
function DentalFilesSection({
  patientId, canEdit, currentTooth,
}: {
  patientId: string;
  canEdit: boolean;
  currentTooth: number | null;
}) {
  const qc = useQueryClient();
  const { data: files, isLoading } = useQuery({
    queryKey: ['dental', 'files', patientId],
    queryFn: () => api.dental.files(patientId),
  });
  const [kind, setKind] = useState('intraoral');
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<DentalFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.dental.removeFile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dental', 'files', patientId] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadDentalFile(file, patientId);
      await api.dental.addFile({
        patient_id: patientId,
        storage_path: path,
        kind,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        fdi_number: currentTooth ?? undefined,
      });
      qc.invalidateQueries({ queryKey: ['dental', 'files', patientId] });
      toast.success('Yuklandi');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const list = files ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Rasmlar va rentgen</CardTitle>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILE_KIND.map((k) => <SelectItem key={k.v} value={k.v}>{k.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <input ref={inputRef} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />
            <Button size="sm" className="h-8 gap-1" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {uploading ? 'Yuklanmoqda…' : 'Yuklash'}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {currentTooth != null && canEdit && (
          <div className="mb-2 text-[11px] text-muted-foreground">Yangi rasm tish <b>№{currentTooth}</b> ga bog'lanadi</div>
        )}
        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : list.length === 0 ? (
          <EmptyState title="Rasm yo'q" description="Rentgen yoki og'iz ichi rasm yuklang." />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {list.map((f) => {
              const isImg = (f.mime_type ?? '').startsWith('image/');
              return (
                <div key={f.id} className="group relative overflow-hidden rounded-lg border">
                  <button type="button" className="block aspect-square w-full bg-muted/40" onClick={() => setPreview(f)}>
                    {isImg && f.signed_url ? (
                      <img src={f.signed_url} alt={f.file_name ?? ''} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                        <FileText className="h-7 w-7" />
                        <span className="px-1 text-[10px]">PDF</span>
                      </span>
                    )}
                  </button>
                  <div className="absolute left-1 top-1">
                    <Badge variant="secondary" className="text-[9px]">{FILE_KIND_LABEL[f.kind] ?? f.kind}</Badge>
                  </div>
                  {f.fdi_number && (
                    <div className="absolute right-1 top-1"><Badge className="text-[9px]">№{f.fdi_number}</Badge></div>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="absolute bottom-1 right-1 rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-rose-600"
                      onClick={() => remove.mutate(f.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {preview && (
        <Dialog open onOpenChange={(o) => !o && setPreview(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {FILE_KIND_LABEL[preview.kind] ?? preview.kind}{preview.fdi_number ? ` — №${preview.fdi_number}` : ''}
              </DialogTitle>
            </DialogHeader>
            {(preview.mime_type ?? '').startsWith('image/') && preview.signed_url ? (
              <img src={preview.signed_url} alt={preview.file_name ?? ''} className="max-h-[70vh] w-full rounded-md object-contain" />
            ) : preview.signed_url ? (
              <a href={preview.signed_url} target="_blank" rel="noreferrer" className="text-primary underline">Faylni ochish</a>
            ) : (
              <div className="text-sm text-muted-foreground">URL mavjud emas</div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ---- Laboratoriya buyurtmalari ----
function DentalLabSection({
  patientId, canPlan, currentTooth,
}: {
  patientId: string;
  canPlan: boolean;
  currentTooth: number | null;
}) {
  const qc = useQueryClient();
  const { data: orders, isLoading } = useQuery({
    queryKey: ['dental', 'lab', patientId],
    queryFn: () => api.dental.labOrders({ patient_id: patientId }),
  });
  const [creating, setCreating] = useState(false);

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.dental.updateLabOrder(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dental', 'lab', patientId] }),
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.dental.removeLabOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dental', 'lab', patientId] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const list = orders ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Laboratoriya buyurtmalari</CardTitle>
        {canPlan && (
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Yangi
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Yuklanmoqda…</div>
        ) : list.length === 0 ? (
          <EmptyState title="Buyurtma yo'q" description="Protez/koronka uchun lab buyurtma qo'shing." />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Lab / Tur</th>
                  <th className="px-2 py-2 text-left font-medium">Tish</th>
                  <th className="px-2 py-2 text-left font-medium">Muddat</th>
                  <th className="px-2 py-2 text-right font-medium">Narx</th>
                  <th className="px-2 py-2 text-left font-medium">Holat</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-2 py-2">
                      <div className="font-medium">{o.lab_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {LAB_TYPE_LABEL[o.order_type] ?? o.order_type}{o.shade ? ` · ${o.shade}` : ''}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {(o.tooth_numbers ?? []).length ? o.tooth_numbers.map((n) => `№${n}`).join(', ') : '—'}
                    </td>
                    <td className="px-2 py-2 text-xs">{fmtDay(o.due_at)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{fmt(o.price_uzs)}</td>
                    <td className="px-2 py-2">
                      {canPlan ? (
                        <Select value={o.status} onValueChange={(v) => update.mutate({ id: o.id, status: v })}>
                          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {LAB_STATUS.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={cn('rounded px-2 py-0.5 text-[11px]', LAB_STATUS_CLS[o.status])}>
                          {LAB_STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {canPlan && (
                        <button type="button" className="text-muted-foreground hover:text-rose-600" onClick={() => remove.mutate(o.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {creating && <LabOrderDialog patientId={patientId} currentTooth={currentTooth} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function LabOrderDialog({
  patientId, currentTooth, onClose,
}: {
  patientId: string;
  currentTooth: number | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: doctors } = useQuery({ queryKey: ['dental-doctors'], queryFn: () => api.doctors.list() });
  const [labName, setLabName] = useState('');
  const [orderType, setOrderType] = useState('crown');
  const [teeth, setTeeth] = useState(currentTooth ? String(currentTooth) : '');
  const [shade, setShade] = useState('');
  const [material, setMaterial] = useState('');
  const [price, setPrice] = useState('');
  const [due, setDue] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.dental.createLabOrder({
        patient_id: patientId,
        lab_name: labName.trim(),
        order_type: orderType,
        tooth_numbers: teeth.split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)),
        shade: shade.trim() || undefined,
        material: material.trim() || undefined,
        price_uzs: price ? Number(price) : 0,
        due_at: due ? new Date(due).toISOString() : undefined,
        doctor_id: doctorId || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dental', 'lab', patientId] });
      toast.success('Buyurtma yaratildi');
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Yangi laboratoriya buyurtmasi</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Laboratoriya nomi *</div>
            <Input value={labName} onChange={(e) => setLabName(e.target.value)} placeholder="Masalan: ABC Dental Lab" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Tur</div>
              <Select value={orderType} onValueChange={setOrderType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LAB_TYPE.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Tishlar (№, vergul)</div>
              <Input value={teeth} onChange={(e) => setTeeth(e.target.value)} placeholder="16, 17" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Rang (shade)</div>
              <Input value={shade} onChange={(e) => setShade(e.target.value)} placeholder="A2" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Material</div>
              <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Tsirkon / metallokeramika" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Narx (so'm)</div>
              <Input type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className="font-mono" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Muddat</div>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Shifokor</div>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger><SelectValue placeholder="Tanlash (ixtiyoriy)" /></SelectTrigger>
              <SelectContent>{(doctors ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Izoh</div>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Bekor</Button>
          <Button disabled={!labName.trim() || create.isPending} onClick={() => create.mutate()}>Yaratish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
