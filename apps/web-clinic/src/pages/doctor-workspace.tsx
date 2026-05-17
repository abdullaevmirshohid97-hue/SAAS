import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bookmark,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  Loader2,
  PhoneIncoming,
  Search,
  Stethoscope,
  UserCheck,
  Wallet,
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
  cn,
} from '@clary/ui-web';

import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

type Doctor = { id: string; full_name: string; role: string; phone?: string };

// =============================================================================
// Doctor Workspace — 3-panel: navbat | konsultatsiya | bemor kartasi
// =============================================================================
export function DoctorWorkspacePage() {
  const qc = useQueryClient();
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const doctorId = selectedDoctor?.id ?? null;

  const { data: doctors, isLoading: doctorsLoading } = useQuery({
    queryKey: ['doctors-list'],
    queryFn: () => api.doctors.list(),
  });

  const { data: dashboard, refetch: refetchDash } = useQuery({
    queryKey: ['doctor-dashboard', doctorId],
    queryFn: () => api.doctor.dashboard(doctorId ?? undefined),
    enabled: !!doctorId,
    refetchInterval: 20_000,
  });

  // Realtime — navbat o'zgarsa yangilash
  useEffect(() => {
    if (!doctorId) return;
    const ch = supabase
      .channel('doc-ws-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queues' },
        () => qc.invalidateQueries({ queryKey: ['doctor-dashboard'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [doctorId, qc]);

  const current =
    dashboard?.queue.serving[0] ?? dashboard?.queue.called[0] ?? null;
  const currentPatientId = current?.patient?.id ?? null;

  const callNextMut = useMutation({
    mutationFn: () => api.queues.callNext(doctorId ?? undefined),
    onSuccess: () => refetchDash(),
    onError: () => toast.error('Navbatda bemor yo‘q'),
  });
  const acceptMut = useMutation({
    mutationFn: (id: string) => api.queues.accept(id),
    onSuccess: () => refetchDash(),
  });
  const completeMut = useMutation({
    mutationFn: (id: string) => api.queues.complete(id),
    onSuccess: () => {
      refetchDash();
      toast.success('Qabul yakunlandi');
    },
  });

  // Keyboard shortcuts — tezkor ish (input/textarea fokusda emas paytda)
  useEffect(() => {
    if (!doctorId) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const cur = dashboard?.queue.serving[0] ?? dashboard?.queue.called[0] ?? null;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        callNextMut.mutate();
      } else if ((e.key === 'a' || e.key === 'A') && cur?.status === 'called') {
        e.preventDefault();
        acceptMut.mutate(cur.id);
      } else if ((e.key === 'c' || e.key === 'C') && cur?.status === 'serving') {
        e.preventDefault();
        completeMut.mutate(cur.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doctorId, dashboard, callNextMut, acceptMut, completeMut]);

  // ── Shifokor tanlash ──────────────────────────────────────────────────────
  if (!selectedDoctor) {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Shifokor oynasi</h1>
          <p className="text-sm text-muted-foreground">
            Davom etish uchun o&apos;z ismingizni tanlang
          </p>
        </header>
        {doctorsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...
          </div>
        ) : ((doctors as Doctor[]) ?? []).length === 0 ? (
          <EmptyState
            title="Shifokorlar topilmadi"
            description="Avval xodimlar ro'yxatiga shifokor qo'shing."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {((doctors as Doctor[]) ?? []).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedDoctor(d)}
                className="rounded-xl border bg-card p-5 text-left shadow-sm transition hover:border-primary hover:shadow-md"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                  {d.full_name[0]?.toUpperCase() ?? 'S'}
                </div>
                <div className="font-semibold">{d.full_name}</div>
                {d.phone && (
                  <div className="text-xs text-muted-foreground">{d.phone}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Asosiy workspace ──────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header — dashboard widgetlari */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
            {selectedDoctor.full_name[0]?.toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              {selectedDoctor.full_name}
            </div>
            <button
              type="button"
              onClick={() => setSelectedDoctor(null)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              O&apos;zgartirish
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashWidget
            icon={<Wallet className="h-4 w-4" />}
            label="Bugungi tushum"
            value={`${fmt(dashboard?.today_income_uzs ?? 0)} so'm`}
          />
          <DashWidget
            icon={<UserCheck className="h-4 w-4" />}
            label="Qabul qilingan"
            value={String(dashboard?.queue.served_today ?? 0)}
          />
          <DashWidget
            icon={<FlaskConical className="h-4 w-4" />}
            label="Lab kutilmoqda"
            value={String(dashboard?.pending_lab ?? 0)}
          />
          <DashWidget
            icon={<ClipboardList className="h-4 w-4" />}
            label="Hisobotlar"
            value={String(dashboard?.pending_reports ?? 0)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAnalyticsOpen(true)}
            title="Mening statistikam (30 kun)"
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => callNextMut.mutate()}
            disabled={callNextMut.isPending || !doctorId}
          >
            {callNextMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <PhoneIncoming className="mr-1 h-4 w-4" />
            )}
            Keyingi bemor
            <kbd className="ml-1.5 rounded border border-primary-foreground/30 px-1 text-[10px]">
              N
            </kbd>
          </Button>
        </div>
      </header>

      {/* 3-panel split */}
      <div className="grid grid-cols-12 gap-3">
        {/* CHAP — navbat */}
        <div className="col-span-12 lg:col-span-3">
          <QueuePanel
            dashboard={dashboard}
            currentId={current?.id ?? null}
            onAccept={(id) => acceptMut.mutate(id)}
          />
        </div>

        {/* MARKAZ — konsultatsiya */}
        <div className="col-span-12 lg:col-span-6">
          {!current ? (
            <EmptyState
              title="Qabul qilinadigan bemor yo'q"
              description="«Keyingi bemor» tugmasini bosing yoki navbatdan tanlang."
            />
          ) : (
            <ConsultationWorkspace
              key={current.id}
              queueId={current.id}
              patientId={currentPatientId!}
              patientName={current.patient?.full_name ?? '—'}
              status={current.status}
              onAccept={() => acceptMut.mutate(current.id)}
              onComplete={() => completeMut.mutate(current.id)}
            />
          )}
        </div>

        {/* O'NG — bemor kartasi */}
        <div className="col-span-12 lg:col-span-3">
          {currentPatientId ? (
            <PatientCard patientId={currentPatientId} />
          ) : (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                Bemor tanlanmagan
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Analytics modal */}
      {analyticsOpen && doctorId && (
        <DoctorAnalyticsDialog
          doctorId={doctorId}
          doctorName={selectedDoctor.full_name}
          onClose={() => setAnalyticsOpen(false)}
        />
      )}
    </div>
  );
}

// ── Doctor Analytics modali ─────────────────────────────────────────────────
function DoctorAnalyticsDialog({
  doctorId,
  doctorName,
  onClose,
}: {
  doctorId: string;
  doctorName: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['doctor-analytics', doctorId],
    queryFn: () => api.doctor.analytics(doctorId),
  });

  const maxDay = useMemo(
    () => Math.max(1, ...(data?.daily_patients ?? []).map((d) => d.count)),
    [data],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doctorName} — statistika (30 kun)</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...
          </div>
        ) : (
          <div className="space-y-4">
            {/* KPI kartochkalar */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Qabullar" value={String(data.completed_appointments)} />
              <Stat label="Bemorlar" value={String(data.unique_patients)} />
              <Stat label="Qaytgan bemor" value={String(data.repeat_patients)} />
              <Stat label="Kuniga o'rtacha" value={String(data.avg_per_day)} />
            </div>
            <div className="rounded-md border bg-primary/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                30 kunlik tushum
              </div>
              <div className="text-xl font-bold">{fmt(data.income_uzs)} so&apos;m</div>
            </div>

            {/* Kun bo'yicha bemorlar — oddiy bar */}
            {data.daily_patients.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Kun bo&apos;yicha bemorlar
                </div>
                <div className="flex h-24 items-end gap-0.5">
                  {data.daily_patients.map((d) => (
                    <div
                      key={d.day}
                      className="flex-1 rounded-t bg-primary/70"
                      style={{ height: `${(d.count / maxDay) * 100}%` }}
                      title={`${d.day}: ${d.count}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Top tashxislar */}
            {data.top_diagnoses.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Eng ko&apos;p tashxislar
                </div>
                <div className="space-y-1">
                  {data.top_diagnoses.map((d) => (
                    <div
                      key={d.code}
                      className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-primary">{d.code}</span>
                        <span className="truncate">{d.text}</span>
                      </span>
                      <span className="font-semibold">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Yopish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dashboard widget ────────────────────────────────────────────────────────
function DashWidget({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
      <div className="text-primary">{icon}</div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-sm font-semibold leading-tight">{value}</div>
      </div>
    </div>
  );
}

// ── CHAP panel — navbat ─────────────────────────────────────────────────────
function QueuePanel({
  dashboard,
  currentId,
  onAccept,
}: {
  dashboard: Awaited<ReturnType<typeof api.doctor.dashboard>> | undefined;
  currentId: string | null;
  onAccept: (id: string) => void;
}) {
  const groups = [
    { key: 'called', label: 'Chaqirilgan', rows: dashboard?.queue.called ?? [] },
    { key: 'waiting', label: 'Kutmoqda', rows: dashboard?.queue.waiting ?? [] },
  ];
  return (
    <Card className="h-full">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Stethoscope className="h-4 w-4" /> Navbat
        </div>
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {g.label} ({g.rows.length})
            </div>
            <div className="space-y-1.5">
              {g.rows.length === 0 && (
                <div className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
                  Bo&apos;sh
                </div>
              )}
              {g.rows.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-sm',
                    r.id === currentId && 'border-primary bg-primary/5',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold">{r.ticket_no ?? '—'}</span>
                    {g.key === 'called' && r.id !== currentId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => onAccept(r.id)}
                      >
                        Qabul
                      </Button>
                    )}
                  </div>
                  <div className="truncate text-xs">{r.patient?.full_name ?? '—'}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── MARKAZ — Consultation Workspace ─────────────────────────────────────────
function ConsultationWorkspace({
  queueId: _queueId,
  patientId,
  patientName,
  status,
  onAccept,
  onComplete,
}: {
  queueId: string;
  patientId: string;
  patientName: string;
  status: string;
  onAccept: () => void;
  onComplete: () => void;
}) {
  const qc = useQueryClient();
  // SOAP
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  // Tashxis (ICD-10)
  const [dxCode, setDxCode] = useState<string | null>(null);
  const [dxText, setDxText] = useState('');
  // Shablon yaratish modali
  const [tplOpen, setTplOpen] = useState(false);
  // Vitals
  const [vitals, setVitals] = useState({
    temperature_c: '',
    pulse_bpm: '',
    systolic_mmhg: '',
    diastolic_mmhg: '',
    oxygen_saturation: '',
    weight_kg: '',
  });

  // Tashxis shablonlari
  const { data: templates } = useQuery({
    queryKey: ['doctor-templates'],
    queryFn: () => api.doctor.listTemplates(),
  });

  const applyTemplate = (t: NonNullable<typeof templates>[number]) => {
    if (t.diagnosis_code) {
      setDxCode(t.diagnosis_code);
      setDxText(t.diagnosis_text ?? '');
    }
    if (t.soap_subjective) setSubjective(t.soap_subjective);
    if (t.soap_objective) setObjective(t.soap_objective);
    if (t.soap_assessment) setAssessment(t.soap_assessment);
    if (t.soap_plan) setPlan(t.soap_plan);
    api.doctor.useTemplate(t.id).catch(() => undefined);
    toast.success(`«${t.name}» shabloni qo‘llandi`);
  };

  const vitalsMut = useMutation({
    mutationFn: () =>
      api.doctor.recordVitals({
        patient_id: patientId,
        temperature_c: vitals.temperature_c ? Number(vitals.temperature_c) : null,
        pulse_bpm: vitals.pulse_bpm ? Number(vitals.pulse_bpm) : null,
        systolic_mmhg: vitals.systolic_mmhg ? Number(vitals.systolic_mmhg) : null,
        diastolic_mmhg: vitals.diastolic_mmhg ? Number(vitals.diastolic_mmhg) : null,
        oxygen_saturation: vitals.oxygen_saturation
          ? Number(vitals.oxygen_saturation)
          : null,
        weight_kg: vitals.weight_kg ? Number(vitals.weight_kg) : null,
      }),
    onSuccess: () => {
      toast.success('Vitals saqlandi');
      qc.invalidateQueries({ queryKey: ['patient-clinical', patientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const consultMut = useMutation({
    mutationFn: (sign: boolean) =>
      api.doctor.saveConsultation({
        patient_id: patientId,
        soap_subjective: subjective || null,
        soap_objective: objective || null,
        soap_assessment: assessment || null,
        soap_plan: plan || null,
        diagnosis_code: dxCode,
        diagnosis_text: dxText || null,
        sign,
      }),
    onSuccess: (_d, sign) => {
      toast.success(sign ? 'Konsultatsiya imzolandi' : 'Saqlandi');
      qc.invalidateQueries({ queryKey: ['patient-clinical', patientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="h-full">
      <CardContent className="space-y-3 p-4">
        {/* Bemor + holat */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{patientName}</div>
            <Badge variant={status === 'serving' ? 'default' : 'secondary'}>
              {status === 'called' ? 'Chaqirilgan' : status === 'serving' ? 'Qabulda' : status}
            </Badge>
          </div>
          <div className="flex gap-2">
            {status === 'called' && (
              <Button size="sm" onClick={onAccept}>
                <UserCheck className="mr-1 h-3.5 w-3.5" /> Qabul qilish
                <kbd className="ml-1.5 rounded border border-primary-foreground/30 px-1 text-[10px]">
                  A
                </kbd>
              </Button>
            )}
            {status === 'serving' && (
              <Button size="sm" variant="outline" onClick={onComplete}>
                Yakunlash <ChevronRight className="ml-1 h-3.5 w-3.5" />
                <kbd className="ml-1.5 rounded border px-1 text-[10px]">C</kbd>
              </Button>
            )}
          </div>
        </div>

        {/* Tashxis shablonlari — 1-click */}
        {(templates ?? []).length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">
              Tayyor shablonlar
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(templates ?? []).slice(0, 8).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="rounded-full border bg-card px-2.5 py-0.5 text-xs hover:border-primary hover:bg-primary/5"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Shikoyat */}
        <Field label="Shikoyat (subyektiv)">
          <textarea
            className="min-h-[56px] w-full rounded-md border bg-transparent p-2 text-sm"
            value={subjective}
            onChange={(e) => setSubjective(e.target.value)}
            placeholder="Bemor shikoyatlari..."
          />
        </Field>

        {/* Vitals */}
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> Vital belgilar
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <VitalInput label="T°C" v={vitals.temperature_c} onChange={(x) => setVitals((p) => ({ ...p, temperature_c: x }))} />
            <VitalInput label="Puls" v={vitals.pulse_bpm} onChange={(x) => setVitals((p) => ({ ...p, pulse_bpm: x }))} />
            <VitalInput label="Sist." v={vitals.systolic_mmhg} onChange={(x) => setVitals((p) => ({ ...p, systolic_mmhg: x }))} />
            <VitalInput label="Diast." v={vitals.diastolic_mmhg} onChange={(x) => setVitals((p) => ({ ...p, diastolic_mmhg: x }))} />
            <VitalInput label="SpO₂" v={vitals.oxygen_saturation} onChange={(x) => setVitals((p) => ({ ...p, oxygen_saturation: x }))} />
            <VitalInput label="Vazn" v={vitals.weight_kg} onChange={(x) => setVitals((p) => ({ ...p, weight_kg: x }))} />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-1.5 h-7 text-xs"
            onClick={() => vitalsMut.mutate()}
            disabled={vitalsMut.isPending}
          >
            Vitalsni saqlash
          </Button>
        </div>

        {/* Tashxis — ICD-10 picker */}
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Tashxis (ICD-10)
          </div>
          <Icd10Picker
            selectedCode={dxCode}
            onSelect={(code, name) => {
              setDxCode(code);
              setDxText(name);
            }}
          />
        </div>

        {/* SOAP — obyektiv / baho / reja */}
        <Field label="Obyektiv ko'rik">
          <textarea
            className="min-h-[44px] w-full rounded-md border bg-transparent p-2 text-sm"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
        </Field>
        <Field label="Baho (assessment)">
          <textarea
            className="min-h-[44px] w-full rounded-md border bg-transparent p-2 text-sm"
            value={assessment}
            onChange={(e) => setAssessment(e.target.value)}
          />
        </Field>
        <Field label="Davolash rejasi">
          <textarea
            className="min-h-[44px] w-full rounded-md border bg-transparent p-2 text-sm"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </Field>

        {/* Yakunlash */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTplOpen(true)}
            title="Joriy holatni shablon sifatida saqlash"
          >
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => consultMut.mutate(false)}
            disabled={consultMut.isPending}
          >
            Qoralama saqlash
          </Button>
          <Button
            className="flex-1"
            onClick={() => consultMut.mutate(true)}
            disabled={consultMut.isPending || !dxCode}
          >
            {consultMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Imzolash
          </Button>
        </div>
      </CardContent>

      {/* Shablon yaratish modali */}
      {tplOpen && (
        <SaveTemplateDialog
          onClose={() => setTplOpen(false)}
          current={{
            diagnosis_code: dxCode,
            diagnosis_text: dxText || null,
            soap_subjective: subjective || null,
            soap_objective: objective || null,
            soap_assessment: assessment || null,
            soap_plan: plan || null,
          }}
        />
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function VitalInput({
  label,
  v,
  onChange,
}: {
  label: string;
  v: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <Input
        className="h-8 px-2 text-sm"
        value={v}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
      />
    </div>
  );
}

// ── ICD-10 Picker ───────────────────────────────────────────────────────────
function Icd10Picker({
  selectedCode,
  onSelect,
}: {
  selectedCode: string | null;
  onSelect: (code: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(query, 250);

  const { data: results, isFetching } = useQuery({
    queryKey: ['icd10', debounced],
    queryFn: () => api.icd10.search(debounced, 15),
    enabled: debounced.trim().length >= 2,
  });

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border px-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="h-9 flex-1 bg-transparent text-sm outline-none"
          placeholder="Kasallik nomi yoki kod (uz/ru/en)..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {selectedCode && (
        <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs">
          <span className="font-mono font-bold text-primary">{selectedCode}</span>
        </div>
      )}
      {open && (results ?? []).length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-lg">
          {(results ?? []).map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => {
                onSelect(r.code, r.name_uz);
                setQuery(`${r.code} — ${r.name_uz}`);
                setOpen(false);
              }}
              className="flex w-full flex-col gap-0.5 border-b px-3 py-1.5 text-left text-sm last:border-0 hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-primary">{r.code}</span>
                <span className="font-medium">{r.name_uz}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">{r.name_ru}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    t.current = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t.current);
  }, [value, ms]);
  return v;
}

// ── O'NG — Patient Card (EMR) ───────────────────────────────────────────────
const FILE_KIND_LABEL: Record<string, string> = {
  xray: 'Rentgen',
  mri: 'MRT',
  ct: 'KT',
  ultrasound: 'UTT',
  lab: 'Lab natija',
  prescription: 'Retsept',
  photo: 'Rasm',
  document: 'Hujjat',
  other: 'Boshqa',
};

function PatientCard({ patientId }: { patientId: string }) {
  const [tab, setTab] = useState<'info' | 'history' | 'files'>('info');

  const { data: timeline } = useQuery({
    queryKey: ['patient-timeline', patientId],
    queryFn: () => api.patients.timeline(patientId),
  });
  const { data: clinical } = useQuery({
    queryKey: ['patient-clinical', patientId],
    queryFn: () => api.doctor.patientClinical(patientId),
  });
  const { data: financial } = useQuery({
    queryKey: ['patient-financial', patientId],
    queryFn: () => api.doctor.financial(patientId),
  });
  const { data: history } = useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => api.doctor.getHistory(patientId),
  });
  const { data: files } = useQuery({
    queryKey: ['patient-files', patientId],
    queryFn: () => api.doctor.listFiles(patientId),
    enabled: tab === 'files',
  });

  const patient = timeline?.patient;
  const summary = timeline?.summary;
  const lastVitals = clinical?.vitals?.[0];

  const age = useMemo(() => {
    if (!patient?.dob) return null;
    const y = Math.floor(
      (Date.now() - new Date(patient.dob).getTime()) / (365.25 * 864e5),
    );
    return Number.isFinite(y) ? y : null;
  }, [patient?.dob]);

  const debt = financial?.outstanding_debt_uzs ?? 0;

  return (
    <Card className="h-full">
      <CardContent className="space-y-3 p-3 text-sm">
        {/* Asosiy info */}
        <div>
          <div className="text-base font-semibold">{patient?.full_name ?? '—'}</div>
          <div className="text-xs text-muted-foreground">
            {age != null && `${age} yosh`}
            {patient?.gender && ` · ${patient.gender === 'male' ? 'Erkak' : patient.gender === 'female' ? 'Ayol' : patient.gender}`}
          </div>
          {patient?.phone && (
            <div className="text-xs text-muted-foreground">{patient.phone}</div>
          )}
        </div>

        {/* Moliyaviy ogohlantirish — qarz bo'lsa */}
        {debt > 0 && (
          <div className="rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-xs">
            <span className="font-semibold text-red-700">Qarz: {fmt(debt)} so&apos;m</span>
          </div>
        )}

        {/* Allergiya — qizil ogohlantirish */}
        {(history?.allergies ?? []).length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs">
            <span className="font-semibold text-amber-800">⚠ Allergiya: </span>
            {(history?.allergies ?? []).join(', ')}
          </div>
        )}

        {/* Tab tugmalari */}
        <div className="inline-flex w-full rounded-md border bg-card p-0.5 text-xs">
          {(['info', 'history', 'files'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 rounded px-2 py-1',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {t === 'info' ? 'Umumiy' : t === 'history' ? 'Anamnez' : 'Fayllar'}
            </button>
          ))}
        </div>

        {/* TAB: Umumiy */}
        {tab === 'info' && (
          <div className="space-y-3">
            {lastVitals && (
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Oxirgi vitals
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {lastVitals.temperature_c != null && <span>T° {lastVitals.temperature_c}</span>}
                  {lastVitals.pulse_bpm != null && <span>Puls {lastVitals.pulse_bpm}</span>}
                  {lastVitals.systolic_mmhg != null && (
                    <span>BP {lastVitals.systolic_mmhg}/{lastVitals.diastolic_mmhg ?? '—'}</span>
                  )}
                  {lastVitals.oxygen_saturation != null && (
                    <span>SpO₂ {lastVitals.oxygen_saturation}%</span>
                  )}
                </div>
              </div>
            )}
            {summary && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Tashriflar" value={String(summary.visits)} />
                <Stat label="Retseptlar" value={String(summary.prescriptions)} />
                <Stat label="Lab" value={String(summary.lab_orders)} />
                <Stat label="Sarflagan" value={`${fmt(summary.total_spent_uzs)}`} />
              </div>
            )}
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Oxirgi tashxislar
              </div>
              <div className="space-y-1">
                {(clinical?.notes ?? []).slice(0, 5).map((n) => (
                  <div key={n.id} className="rounded-md border px-2 py-1 text-xs">
                    <div className="flex items-center gap-1.5">
                      {n.diagnosis_code && (
                        <span className="font-mono font-bold text-primary">
                          {n.diagnosis_code}
                        </span>
                      )}
                      <span className="truncate">{n.diagnosis_text ?? '—'}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleDateString('uz-UZ')}
                      {n.author?.full_name ? ` · ${n.author.full_name}` : ''}
                    </div>
                  </div>
                ))}
                {(clinical?.notes ?? []).length === 0 && (
                  <div className="text-xs text-muted-foreground">Tashxis tarixi yo&apos;q</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB: Anamnez */}
        {tab === 'history' && (
          <MedicalHistoryPanel patientId={patientId} history={history} />
        )}

        {/* TAB: Fayllar */}
        {tab === 'files' && (
          <PatientFilesPanel patientId={patientId} files={files ?? []} />
        )}
      </CardContent>
    </Card>
  );
}

// ── Anamnez paneli ──────────────────────────────────────────────────────────
function MedicalHistoryPanel({
  patientId,
  history,
}: {
  patientId: string;
  history: Awaited<ReturnType<typeof api.doctor.getHistory>> | undefined;
}) {
  const qc = useQueryClient();
  const [allergyInput, setAllergyInput] = useState('');
  const [chronicInput, setChronicInput] = useState('');

  const allergies = history?.allergies ?? [];
  const chronic = history?.chronic_conditions ?? [];
  const meds = history?.current_medications ?? [];
  const surgeries = history?.surgeries ?? [];

  const updateMut = useMutation({
    mutationFn: (body: Parameters<typeof api.doctor.updateHistory>[1]) =>
      api.doctor.updateHistory(patientId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-history', patientId] });
      toast.success('Anamnez yangilandi');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addAllergy = () => {
    if (!allergyInput.trim()) return;
    updateMut.mutate({ allergies: [...allergies, allergyInput.trim()] });
    setAllergyInput('');
  };
  const removeAllergy = (i: number) =>
    updateMut.mutate({ allergies: allergies.filter((_, idx) => idx !== i) });
  const addChronic = () => {
    if (!chronicInput.trim()) return;
    updateMut.mutate({ chronic_conditions: [...chronic, chronicInput.trim()] });
    setChronicInput('');
  };
  const removeChronic = (i: number) =>
    updateMut.mutate({ chronic_conditions: chronic.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-3 text-xs">
      {/* Allergiya */}
      <div>
        <div className="mb-1 font-medium text-muted-foreground">Allergiya</div>
        <div className="flex flex-wrap gap-1">
          {allergies.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800"
            >
              {a}
              <button type="button" onClick={() => removeAllergy(i)} className="font-bold">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          <Input
            className="h-7 text-xs"
            placeholder="Yangi allergiya..."
            value={allergyInput}
            onChange={(e) => setAllergyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAllergy()}
          />
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={addAllergy}>
            +
          </Button>
        </div>
      </div>

      {/* Surunkali kasalliklar */}
      <div>
        <div className="mb-1 font-medium text-muted-foreground">Surunkali kasalliklar</div>
        <div className="flex flex-wrap gap-1">
          {chronic.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"
            >
              {c}
              <button type="button" onClick={() => removeChronic(i)} className="font-bold">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          <Input
            className="h-7 text-xs"
            placeholder="Surunkali kasallik..."
            value={chronicInput}
            onChange={(e) => setChronicInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addChronic()}
          />
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={addChronic}>
            +
          </Button>
        </div>
      </div>

      {/* Doimiy dorilar (read-only ko'rinish) */}
      {meds.length > 0 && (
        <div>
          <div className="mb-1 font-medium text-muted-foreground">Doimiy dorilar</div>
          <ul className="space-y-0.5">
            {meds.map((m, i) => (
              <li key={i} className="rounded border px-2 py-0.5">
                {m.name} {m.dose ? `· ${m.dose}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Operatsiyalar */}
      {surgeries.length > 0 && (
        <div>
          <div className="mb-1 font-medium text-muted-foreground">Operatsiyalar</div>
          <ul className="space-y-0.5">
            {surgeries.map((s, i) => (
              <li key={i} className="rounded border px-2 py-0.5">
                {s.name} {s.year ? `(${s.year})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history?.blood_type && (
        <div>
          <span className="font-medium text-muted-foreground">Qon guruhi: </span>
          <span className="font-semibold">{history.blood_type}</span>
        </div>
      )}
    </div>
  );
}

// ── Fayllar paneli ──────────────────────────────────────────────────────────
function PatientFilesPanel({
  patientId,
  files,
}: {
  patientId: string;
  files: Awaited<ReturnType<typeof api.doctor.listFiles>>;
}) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.doctor.deleteFile(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-files', patientId] });
      toast.success('Fayl o‘chirildi');
    },
  });

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `patient-files/${patientId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('clinic-media')
        .upload(path, file, { upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from('clinic-media').getPublicUrl(path);
      // Kind avtomatik aniqlash
      const lower = file.name.toLowerCase();
      let kind: 'lab' | 'photo' | 'document' = 'document';
      if (file.type.startsWith('image/')) kind = 'photo';
      if (lower.includes('lab') || lower.includes('tahlil')) kind = 'lab';
      await api.doctor.addFile({
        patient_id: patientId,
        kind,
        title: file.name,
        url: pub.publicUrl,
        mime_type: file.type || null,
        size_bytes: file.size,
      });
      qc.invalidateQueries({ queryKey: ['patient-files', patientId] });
      toast.success('Fayl yuklandi');
    } catch (e) {
      toast.error(`Xatolik: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed py-2 hover:bg-accent">
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span className="text-muted-foreground">+ Fayl yuklash (rasm/PDF)</span>
        )}
        <input
          type="file"
          className="hidden"
          accept="image/*,.pdf"
          disabled={uploading}
          onChange={(e) => handleUpload(e.target.files?.[0])}
        />
      </label>
      <div className="space-y-1">
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-md border px-2 py-1">
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate hover:underline"
            >
              <span className="mr-1 rounded bg-muted px-1 text-[10px]">
                {FILE_KIND_LABEL[f.kind] ?? f.kind}
              </span>
              {f.title}
            </a>
            <button
              type="button"
              onClick={() => deleteMut.mutate(f.id)}
              className="ml-1 text-muted-foreground hover:text-destructive"
            >
              ×
            </button>
          </div>
        ))}
        {files.length === 0 && (
          <div className="text-muted-foreground">Fayl yo&apos;q</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

// ── Shablon saqlash modali ──────────────────────────────────────────────────
function SaveTemplateDialog({
  onClose,
  current,
}: {
  onClose: () => void;
  current: {
    diagnosis_code: string | null;
    diagnosis_text: string | null;
    soap_subjective: string | null;
    soap_objective: string | null;
    soap_assessment: string | null;
    soap_plan: string | null;
  };
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      api.doctor.createTemplate({
        name: name.trim(),
        diagnosis_code: current.diagnosis_code,
        diagnosis_text: current.diagnosis_text,
        soap_subjective: current.soap_subjective,
        soap_objective: current.soap_objective,
        soap_assessment: current.soap_assessment,
        soap_plan: current.soap_plan,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-templates'] });
      toast.success('Shablon saqlandi');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shablon sifatida saqlash</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Shablon nomi *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masalan: Viral infeksiya"
            />
          </div>
          <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
            <div>
              Tashxis: {current.diagnosis_code ?? '—'}
              {current.diagnosis_text ? ` · ${current.diagnosis_text}` : ''}
            </div>
            <div className="mt-1">
              SOAP maydonlari joriy konsultatsiyadan ko&apos;chiriladi.
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={name.trim().length < 2 || mut.isPending}
          >
            {mut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
