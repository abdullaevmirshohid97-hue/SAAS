import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Trash2, Wallet, X } from 'lucide-react';
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
import type { DentalPlan, DentalToothRow } from '@clary/api-client';

import { api } from '@/lib/api';
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
    mutationFn: ({ id, status }: { id: string; status: string }) => api.dental.updatePlan(id, { status }),
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
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{plan.title}</div>
                    {plan.doctor?.full_name && (
                      <div className="text-[11px] text-muted-foreground">{plan.doctor.full_name}</div>
                    )}
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
