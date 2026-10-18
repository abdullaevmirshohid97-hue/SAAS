import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DoctorQueueRow } from '@clary/api-client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  FlaskConical,
  Loader2,
  PhoneIncoming,
  Pill,
  Play,
  Printer,
  Search,
  Send,
  Star,
  Stethoscope,
  UserCheck,
  Wallet,
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
  cn,
} from '@clary/ui-web';

import { IncomingReferrals } from '@/components/doctor/incoming-referrals';
import { PrescriptionComposer } from '@/components/doctor/prescription-composer';
import { ReferralComposer } from '@/components/doctor/referral-composer';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { BlankSettings, ClinicInfo } from '@/lib/a4-blank';
import { printConsultation, type ConsultationDoc } from '@/lib/diagnosis-template-print';
import {
  classifyVital,
  computeBmi,
  criticalVitals,
  VITAL_LEVEL_CLASS,
  type VitalKind,
} from '@/lib/vital-thresholds';
import { ClinicalContextStrip } from '@/components/doctor/clinical-context-strip';
import { PatientTimeline, type TimelineEvent } from '@/components/patient/patient-timeline';
import { useAuth } from '@/providers/auth-provider';

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

type Doctor = { id: string; full_name: string; role?: string; phone?: string };

type DocMeta = {
  clinic: ClinicInfo;
  settings?: BlankSettings;
};

// Admin/qabulxona umumiy kompyuterda tanlagan shifokor — har safar qayta
// tanlamaslik uchun brauzerda eslab qolinadi. Shifokor o'zi kirsa — tanlov yo'q.
const PICKED_KEY = 'clary.doctor-ws.doctor';
function readPicked(): Doctor | null {
  try {
    const raw = window.localStorage.getItem(PICKED_KEY);
    const v = raw ? (JSON.parse(raw) as Doctor) : null;
    return v?.id ? v : null;
  } catch {
    return null;
  }
}

const minutesSince = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return Number.isFinite(m) && m >= 0 ? m : null;
};

const ageOf = (dob: string | null | undefined) => {
  if (!dob) return null;
  const y = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 864e5));
  return Number.isFinite(y) ? y : null;
};

const genderLabel = (g: string | null | undefined) =>
  g === 'male' ? 'Erkak' : g === 'female' ? 'Ayol' : null;

/** Hujjat blankasi uchun bemor ma'lumoti (jins o'zbekcha). */
const toPatientInfo = (p: DoctorQueueRow['patient'] | null | undefined) =>
  p
    ? {
        full_name: p.full_name,
        dob: p.dob,
        gender: genderLabel(p.gender) ?? p.gender,
        phone: p.phone,
      }
    : undefined;

// =============================================================================
// Shifokor ish joyi: navbat | qabul (xulosa) | bemor kartasi.
// Oqim: bemorni tanlash → yozish (qabul avtomatik boshlanadi) → "Qabulni
// yakunlash" (xulosa imzolanadi, vitals saqlanadi, navbat yopiladi) →
// xulosani chop etish → keyingi bemor.
// =============================================================================
export function DoctorWorkspacePage() {
  const qc = useQueryClient();
  const { role, user } = useAuth();
  const isDoctor = role === 'doctor';
  const [picked, setPicked] = useState<Doctor | null>(() => (isDoctor ? null : readPicked()));
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<{
    name: string;
    doc: ConsultationDoc;
    patient: DoctorQueueRow['patient'];
  } | null>(null);

  const meQ = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api.get<{
        clinic?: ClinicInfo & { document_settings?: BlankSettings };
        full_name?: string;
      }>('/api/v1/auth/me'),
    staleTime: 5 * 60_000,
  });
  const docMeta: DocMeta = useMemo(
    () => ({ clinic: meQ.data?.clinic ?? {}, settings: meQ.data?.clinic?.document_settings }),
    [meQ.data],
  );

  const selectedDoctor: Doctor | null =
    isDoctor && user
      ? { id: user.id, full_name: meQ.data?.full_name ?? user.email ?? 'Shifokor' }
      : picked;
  const doctorId = selectedDoctor?.id ?? null;

  const { data: doctors, isLoading: doctorsLoading } = useQuery({
    queryKey: ['doctors-list'],
    queryFn: () => api.doctors.list(),
    enabled: !isDoctor,
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, () =>
        qc.invalidateQueries({ queryKey: ['doctor-dashboard'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [doctorId, qc]);

  const live = useMemo(
    () => [...(dashboard?.queue.serving ?? []), ...(dashboard?.queue.called ?? [])],
    [dashboard],
  );
  const allOpen = useMemo(() => [...live, ...(dashboard?.queue.waiting ?? [])], [live, dashboard]);
  const current: DoctorQueueRow | null =
    (activeId ? allOpen.find((r) => r.id === activeId) : undefined) ?? live[0] ?? null;

  const callNextMut = useMutation({
    mutationFn: () => api.queues.callNext(doctorId ?? undefined),
    onSuccess: (r) => {
      setLastDone(null);
      setActiveId((r as { id?: string } | null)?.id ?? null);
      void refetchDash();
    },
    onError: () => toast.error('Navbatda bemor yo‘q'),
  });
  const startMut = useMutation({
    mutationFn: (id: string) => api.queues.accept(id),
    onSuccess: (_r, id) => {
      setLastDone(null);
      setActiveId(id);
      void refetchDash();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Klaviatura: N — keyingi bemor (matn yozilayotganda ishlamaydi)
  useEffect(() => {
    if (!doctorId) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        callNextMut.mutate();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doctorId, callNextMut]);

  // ── Shifokor tanlash (faqat shifokor bo'lmagan foydalanuvchi uchun) ─────
  if (!selectedDoctor) {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Shifokor ish joyi</h1>
          <p className="text-muted-foreground text-sm">
            Qaysi shifokor nomidan ishlaysiz? Tanlov shu kompyuterda eslab qolinadi.
          </p>
        </header>
        {doctorsLoading ? (
          <div className="text-muted-foreground flex items-center gap-2">
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
                onClick={() => {
                  setPicked(d);
                  try {
                    window.localStorage.setItem(
                      PICKED_KEY,
                      JSON.stringify({ id: d.id, full_name: d.full_name }),
                    );
                  } catch {
                    /* maxfiy rejim */
                  }
                }}
                className="bg-card hover:border-primary rounded-xl border p-5 text-left shadow-sm transition hover:shadow-md"
              >
                <div className="bg-primary/10 text-primary mb-3 flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold">
                  {d.full_name[0]?.toUpperCase() ?? 'S'}
                </div>
                <div className="font-semibold">{d.full_name}</div>
                {d.phone && <div className="text-muted-foreground text-xs">{d.phone}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const waitingCount =
    (dashboard?.queue.waiting.length ?? 0) + (dashboard?.queue.called.length ?? 0);

  return (
    <div className="space-y-3">
      {/* Sarlavha: shifokor, bugungi ko'rsatkichlar, keyingi bemor */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-full font-bold">
            {selectedDoctor.full_name[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-semibold leading-tight">{selectedDoctor.full_name}</div>
            {isDoctor ? (
              <div className="text-muted-foreground text-xs">Bugungi qabul</div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  setActiveId(null);
                  try {
                    window.localStorage.removeItem(PICKED_KEY);
                  } catch {
                    /* ignore */
                  }
                }}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                Boshqa shifokor
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashWidget
            icon={<UserCheck className="h-4 w-4" />}
            label="Ko‘rildi"
            value={String(dashboard?.queue.served_today ?? 0)}
          />
          <DashWidget
            icon={<Clock className="h-4 w-4" />}
            label="Navbatda"
            value={String(waitingCount)}
          />
          <DashWidget
            icon={<Wallet className="h-4 w-4" />}
            label="Bugungi tushum"
            value={`${fmt(dashboard?.today_income_uzs ?? 0)} so'm`}
          />
          {(dashboard?.pending_lab ?? 0) > 0 && (
            <DashWidget
              icon={<FlaskConical className="h-4 w-4" />}
              label="Lab kutilmoqda"
              value={String(dashboard?.pending_lab ?? 0)}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAnalyticsOpen(true)}
            title="Mening statistikam (30 kun)"
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => callNextMut.mutate()}
            disabled={callNextMut.isPending || waitingCount === 0}
          >
            {callNextMut.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <PhoneIncoming className="mr-1.5 h-4 w-4" />
            )}
            Keyingi bemor
            <kbd className="border-primary-foreground/30 ml-2 rounded border px-1 text-[10px]">
              N
            </kbd>
          </Button>
        </div>
      </header>

      {current?.patient?.id && <ClinicalContextStrip patientId={current.patient.id} />}

      <div className="grid grid-cols-12 gap-3">
        {/* CHAP — navbat */}
        <div className="col-span-12 lg:col-span-3">
          <QueuePanel
            dashboard={dashboard}
            currentId={current?.id ?? null}
            onSelect={(r) => {
              setLastDone(null);
              setActiveId(r.id);
            }}
            onStart={(r) => startMut.mutate(r.id)}
            starting={startMut.isPending ? (startMut.variables ?? null) : null}
            docMeta={docMeta}
            doctorName={selectedDoctor.full_name}
          />
        </div>

        {/* MARKAZ — qabul */}
        <div className="col-span-12 lg:col-span-5">
          {lastDone ? (
            <Card>
              <CardContent className="space-y-4 p-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <div>
                  <div className="text-lg font-semibold">Qabul yakunlandi</div>
                  <div className="text-muted-foreground text-sm">{lastDone.name}</div>
                </div>
                <div className="flex flex-col justify-center gap-2 sm:flex-row">
                  <Button
                    variant="outline"
                    onClick={() =>
                      printConsultation(lastDone.doc, {
                        ...docMeta,
                        doctorName: selectedDoctor.full_name,
                        patient: toPatientInfo(lastDone.patient),
                        date: new Date().toLocaleDateString('uz-UZ'),
                      })
                    }
                  >
                    <Printer className="mr-1.5 h-4 w-4" /> Xulosani chop etish
                  </Button>
                  <Button
                    onClick={() => callNextMut.mutate()}
                    disabled={callNextMut.isPending || waitingCount === 0}
                  >
                    <PhoneIncoming className="mr-1.5 h-4 w-4" /> Keyingi bemor
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : !current ? (
            <Card>
              <CardContent className="space-y-3 p-8 text-center">
                <Stethoscope className="text-muted-foreground mx-auto h-9 w-9" />
                <div className="font-semibold">Hozir qabulda bemor yo‘q</div>
                <p className="text-muted-foreground text-sm">
                  {waitingCount > 0
                    ? `Navbatda ${waitingCount} ta bemor. «Keyingi bemor» tugmasini bosing yoki ro‘yxatdan tanlang.`
                    : 'Navbat bo‘sh. Qabulxona bemorni sizga yozganda shu yerda paydo bo‘ladi.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <ConsultationWorkspace
              key={current.id}
              row={current}
              doctorName={selectedDoctor.full_name}
              docMeta={docMeta}
              onStarted={() => void refetchDash()}
              onFinished={(doc) => {
                setLastDone({
                  name: current.patient?.full_name ?? '—',
                  doc,
                  patient: current.patient,
                });
                setActiveId(null);
                void refetchDash();
              }}
            />
          )}
        </div>

        {/* O'NG — bemor kartasi + kelgan yo'llanmalar */}
        <div className="col-span-12 space-y-3 lg:col-span-4">
          {current?.patient?.id ? (
            <PatientCard patientId={current.patient.id} />
          ) : (
            <Card>
              <CardContent className="text-muted-foreground p-4 text-sm">
                Bemor tanlanmagan
              </CardContent>
            </Card>
          )}
          <IncomingReferrals doctorId={selectedDoctor.id} />
        </div>
      </div>

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

// ── Shifokor statistikasi ───────────────────────────────────────────────────
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
          <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Qabullar" value={String(data.completed_appointments)} />
              <Stat label="Bemorlar" value={String(data.unique_patients)} />
              <Stat label="Qaytgan bemor" value={String(data.repeat_patients)} />
              <Stat label="Kuniga o'rtacha" value={String(data.avg_per_day)} />
            </div>
            <div className="bg-primary/5 rounded-md border px-3 py-2">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                30 kunlik tushum
              </div>
              <div className="text-xl font-bold">{fmt(data.income_uzs)} so&apos;m</div>
            </div>
            {data.daily_patients.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium">
                  Kun bo&apos;yicha bemorlar
                </div>
                <div className="flex h-24 items-end gap-0.5">
                  {data.daily_patients.map((d) => (
                    <div
                      key={d.day}
                      className="bg-primary/70 flex-1 rounded-t"
                      style={{ height: `${(d.count / maxDay) * 100}%` }}
                      title={`${d.day}: ${d.count}`}
                    />
                  ))}
                </div>
              </div>
            )}
            {data.top_diagnoses.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium">
                  Eng ko&apos;p tashxislar
                </div>
                <div className="space-y-1">
                  {data.top_diagnoses.map((d) => (
                    <div
                      key={d.code}
                      className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-primary font-mono font-bold">{d.code}</span>
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
    <div className="bg-card flex items-center gap-2 rounded-lg border px-3 py-1.5">
      <div className="text-primary">{icon}</div>
      <div>
        <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
        <div className="text-sm font-semibold leading-tight">{value}</div>
      </div>
    </div>
  );
}

// ── CHAP — navbat ───────────────────────────────────────────────────────────
function QueuePanel({
  dashboard,
  currentId,
  onSelect,
  onStart,
  starting,
  docMeta,
  doctorName,
}: {
  dashboard: Awaited<ReturnType<typeof api.doctor.dashboard>> | undefined;
  currentId: string | null;
  onSelect: (r: DoctorQueueRow) => void;
  onStart: (r: DoctorQueueRow) => void;
  starting: string | null;
  docMeta: DocMeta;
  doctorName: string;
}) {
  const [showServed, setShowServed] = useState(false);
  const live = [...(dashboard?.queue.serving ?? []), ...(dashboard?.queue.called ?? [])];
  const waiting = dashboard?.queue.waiting ?? [];
  const served = dashboard?.queue.served ?? [];

  const row = (r: DoctorQueueRow, kind: 'live' | 'waiting') => {
    const wait = minutesSince(kind === 'live' ? (r.started_at ?? r.called_at) : r.joined_at);
    const active = r.id === currentId;
    return (
      <div
        key={r.id}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(r)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(r)}
        className={cn(
          'cursor-pointer rounded-lg border px-2.5 py-2 text-sm transition',
          active ? 'border-primary bg-primary/5 ring-primary/20 ring-1' : 'hover:bg-accent/50',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold">{r.ticket_no ?? '—'}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{r.patient?.full_name ?? '—'}</span>
          {kind === 'waiting' ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={starting === r.id}
              onClick={(e) => {
                e.stopPropagation();
                onStart(r);
              }}
            >
              {starting === r.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              <span className="ml-1">Boshlash</span>
            </Button>
          ) : (
            <Badge
              variant={r.status === 'serving' ? 'default' : 'secondary'}
              className="text-[10px]"
            >
              {r.status === 'serving' ? 'Qabulda' : 'Chaqirildi'}
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]">
          {r.service_name && <span className="truncate">{r.service_name}</span>}
          {wait != null && (
            <span
              className={cn(
                'ml-auto shrink-0',
                kind === 'waiting' && wait >= 30 && 'font-semibold text-amber-600',
              )}
            >
              {wait} daq
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className="h-full">
      <CardContent className="space-y-4 p-3">
        {live.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wide">
              Hozir
            </div>
            <div className="space-y-1.5">{live.map((r) => row(r, 'live'))}</div>
          </div>
        )}

        <div>
          <div className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wide">
            Navbatda ({waiting.length})
          </div>
          <div className="space-y-1.5">
            {waiting.length === 0 ? (
              <div className="text-muted-foreground rounded-md border border-dashed px-2 py-3 text-center text-xs">
                Kutayotgan bemor yo‘q
              </div>
            ) : (
              waiting.map((r) => row(r, 'waiting'))
            )}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowServed((v) => !v)}
            className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
          >
            Bugun ko‘rilgan ({served.length})
            <ChevronDown
              className={cn('ml-auto h-3.5 w-3.5 transition', showServed && 'rotate-180')}
            />
          </button>
          {showServed && (
            <div className="mt-1.5 space-y-1">
              {served.length === 0 && (
                <div className="text-muted-foreground text-xs">Hali yo‘q</div>
              )}
              {served.map((r) => (
                <ServedRow key={r.id} r={r} docMeta={docMeta} doctorName={doctorName} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Ko'rilgan bemor: vaqt, xulosa belgisi va qayta chop etish. */
function ServedRow({
  r,
  docMeta,
  doctorName,
}: {
  r: DoctorQueueRow;
  docMeta: DocMeta;
  doctorName: string;
}) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    if (!r.patient?.id) return;
    setBusy(true);
    try {
      const n = await api.doctor.visitDraft(r.patient.id);
      if (!n) {
        toast.info('Bu bemorga bugun xulosa yozilmagan');
        return;
      }
      printConsultation(
        {
          complaint: n.soap_subjective,
          exam: n.soap_objective,
          diagnosis_code: n.diagnosis_code,
          diagnosis_text: n.diagnosis_text,
          diagnosis_note: n.soap_assessment,
          plan: n.soap_plan,
        },
        {
          ...docMeta,
          doctorName,
          patient: toPatientInfo(r.patient),
          date: new Date(n.created_at).toLocaleDateString('uz-UZ'),
        },
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      <span className="min-w-0 flex-1 truncate">{r.patient?.full_name ?? '—'}</span>
      {r.served_at && (
        <span className="text-muted-foreground shrink-0">
          {new Date(r.served_at).toLocaleTimeString('uz-UZ', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )}
      {r.note?.is_final ? (
        <button
          type="button"
          onClick={print}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title="Xulosani chop etish"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Printer className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="text-muted-foreground shrink-0" title="Xulosa yozilmagan">
          <FileText className="h-3.5 w-3.5 opacity-40" />
        </span>
      )}
    </div>
  );
}

// ── MARKAZ — qabul (xulosa) ─────────────────────────────────────────────────
type VitalsState = {
  temperature_c: string;
  pulse_bpm: string;
  systolic_mmhg: string;
  diastolic_mmhg: string;
  oxygen_saturation: string;
  weight_kg: string;
  height_cm: string;
};
const EMPTY_VITALS: VitalsState = {
  temperature_c: '',
  pulse_bpm: '',
  systolic_mmhg: '',
  diastolic_mmhg: '',
  oxygen_saturation: '',
  weight_kg: '',
  height_cm: '',
};

const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function vitalsLine(v: VitalsState): string | null {
  const parts = [
    v.temperature_c && `T° ${v.temperature_c}`,
    v.pulse_bpm && `Puls ${v.pulse_bpm}`,
    (v.systolic_mmhg || v.diastolic_mmhg) &&
      `AQB ${v.systolic_mmhg || '—'}/${v.diastolic_mmhg || '—'}`,
    v.oxygen_saturation && `SpO₂ ${v.oxygen_saturation}%`,
    v.weight_kg && `Vazn ${v.weight_kg} kg`,
    v.height_cm && `Bo‘y ${v.height_cm} sm`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function ConsultationWorkspace({
  row,
  doctorName,
  docMeta,
  onStarted,
  onFinished,
}: {
  row: DoctorQueueRow;
  doctorName: string;
  docMeta: DocMeta;
  onStarted: () => void;
  onFinished: (doc: ConsultationDoc) => void;
}) {
  const qc = useQueryClient();
  const patientId = row.patient?.id ?? '';
  const [complaint, setComplaint] = useState('');
  const [exam, setExam] = useState('');
  const [dxNote, setDxNote] = useState('');
  const [showDxNote, setShowDxNote] = useState(false);
  const [plan, setPlan] = useState('');
  const [dxCode, setDxCode] = useState<string | null>(null);
  const [dxText, setDxText] = useState('');
  const [rxOpen, setRxOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const noteIdRef = useRef<string | null>(null);
  const startedRef = useRef(row.status === 'serving');
  const dirtyRef = useRef(false);

  // Vital belgilar — qoralama brauzerda (yakunlashda bazaga yoziladi)
  const vitalsKey = `vitals-draft-${patientId}`;
  const [vitals, setVitals] = useState<VitalsState>(() => {
    try {
      const raw = window.localStorage.getItem(vitalsKey);
      return raw ? { ...EMPTY_VITALS, ...(JSON.parse(raw) as Partial<VitalsState>) } : EMPTY_VITALS;
    } catch {
      return EMPTY_VITALS;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(vitalsKey, JSON.stringify(vitals));
    } catch {
      /* ignore */
    }
  }, [vitals, vitalsKey]);

  // Bugungi qoralamani tiklash (qabulga qaytilganda yozilgan narsa yo'qolmasin)
  const draftQ = useQuery({
    queryKey: ['doctor-visit-draft', patientId],
    queryFn: () => api.doctor.visitDraft(patientId),
    enabled: !!patientId,
    staleTime: 0,
  });
  const signedToday = draftQ.data?.is_final ? draftQ.data : null;
  useEffect(() => {
    const d = draftQ.data;
    if (!d || d.is_final || dirtyRef.current) return;
    noteIdRef.current = d.id;
    setComplaint(d.soap_subjective ?? '');
    setExam(d.soap_objective ?? '');
    setDxNote(d.soap_assessment ?? '');
    setShowDxNote(!!d.soap_assessment);
    setPlan(d.soap_plan ?? '');
    setDxCode(d.diagnosis_code);
    setDxText(d.diagnosis_text ?? '');
  }, [draftQ.data]);

  const { data: templates } = useQuery({
    queryKey: ['doctor-templates'],
    queryFn: () => api.doctor.listTemplates(),
  });

  // Birinchi yozuvda qabul avtomatik boshlanadi (alohida "qabul qilish" shart emas)
  const ensureStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    api.queues
      .accept(row.id)
      .then(onStarted)
      .catch(() => {
        startedRef.current = false;
      });
  };
  const touch =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      dirtyRef.current = true;
      ensureStarted();
      setter(v);
    };

  const fields = () => ({
    patient_id: patientId,
    appointment_id: row.appointment_id,
    note_id: noteIdRef.current,
    soap_subjective: complaint.trim() || null,
    soap_objective: exam.trim() || null,
    soap_assessment: dxNote.trim() || null,
    soap_plan: plan.trim() || null,
    diagnosis_code: dxCode,
    diagnosis_text: dxText.trim() || null,
  });

  const draftMut = useMutation({
    mutationFn: () => api.doctor.saveConsultation({ ...fields(), sign: false }),
    onSuccess: (r) => {
      noteIdRef.current = (r as { id?: string }).id ?? noteIdRef.current;
      setSavedAt(new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }));
    },
  });
  const draftRef = useRef(draftMut);
  draftRef.current = draftMut;

  // Avtosaqlash — yozish to'xtagach 1.5 s (bitta qoralama yangilanadi)
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (!complaint && !exam && !plan && !dxText && !dxNote) return;
    const t = setTimeout(() => draftRef.current.mutate(), 1500);
    return () => clearTimeout(t);
  }, [complaint, exam, plan, dxText, dxNote, dxCode]);

  const currentDoc = (): ConsultationDoc => ({
    complaint,
    exam,
    diagnosis_code: dxCode,
    diagnosis_text: dxText,
    diagnosis_note: dxNote,
    plan,
    vitals_line: vitalsLine(vitals),
  });

  const finishMut = useMutation({
    mutationFn: () =>
      api.doctor.finishVisit({
        ...fields(),
        queue_id: row.id,
        vitals: {
          temperature_c: num(vitals.temperature_c),
          pulse_bpm: num(vitals.pulse_bpm),
          systolic_mmhg: num(vitals.systolic_mmhg),
          diastolic_mmhg: num(vitals.diastolic_mmhg),
          oxygen_saturation: num(vitals.oxygen_saturation),
          weight_kg: num(vitals.weight_kg),
          height_cm: num(vitals.height_cm),
        },
      }),
    onSuccess: () => {
      try {
        window.localStorage.removeItem(vitalsKey);
      } catch {
        /* ignore */
      }
      toast.success('Qabul yakunlandi');
      void qc.invalidateQueries({ queryKey: ['patient-clinical', patientId] });
      void qc.invalidateQueries({ queryKey: ['patient-timeline', patientId] });
      void qc.invalidateQueries({ queryKey: ['doctor-visit-draft', patientId] });
      onFinished(currentDoc());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finish = () => {
    if (finishMut.isPending) return;
    const empty = !complaint.trim() && !exam.trim() && !plan.trim() && !dxText.trim();
    if (empty && !window.confirm('Xulosa yozilmagan. Qabulni xulosasiz yakunlaysizmi?')) return;
    finishMut.mutate();
  };

  // Ctrl+Enter — qabulni yakunlash
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        finishRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const applyTemplate = (t: NonNullable<typeof templates>[number]) => {
    dirtyRef.current = true;
    ensureStarted();
    if (t.diagnosis_code || t.diagnosis_text) {
      setDxCode(t.diagnosis_code ?? null);
      setDxText(t.diagnosis_text ?? '');
    }
    if (t.soap_subjective) setComplaint(t.soap_subjective);
    if (t.soap_objective) setExam(t.soap_objective);
    if (t.soap_assessment) {
      setDxNote(t.soap_assessment);
      setShowDxNote(true);
    }
    if (t.soap_plan) setPlan(t.soap_plan);
    api.doctor.useTemplate(t.id).catch(() => undefined);
    toast.success(`«${t.name}» shabloni qo‘llandi`);
  };

  const age = ageOf(row.patient?.dob);
  const gender = genderLabel(row.patient?.gender);
  const crit = criticalVitals(vitals);
  const bmi = computeBmi(num(vitals.weight_kg), num(vitals.height_cm));

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex-1 space-y-4 p-4">
        {/* Bemor */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{row.patient?.full_name ?? '—'}</div>
            <div className="text-muted-foreground text-xs">
              {[
                age != null ? `${age} yosh` : null,
                gender,
                row.service_name,
                row.ticket_no ? `№ ${row.ticket_no}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <TemplatePicker templates={templates ?? []} onApply={applyTemplate} />
          </div>
        </div>

        {signedToday && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Bugun{' '}
            {new Date(signedToday.created_at).toLocaleTimeString('uz-UZ', {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            da xulosa imzolangan. Yangi yozilgani alohida xulosa bo‘ladi.
          </div>
        )}

        <Field label="Shikoyat va anamnez">
          <AutoTextarea
            value={complaint}
            onChange={touch(setComplaint)}
            placeholder="Bemor nimadan shikoyat qiladi, qachondan beri, avval nima qabul qilgan…"
            minRows={2}
          />
        </Field>

        {/* Ko'rik: vital belgilar + matn */}
        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Activity className="h-3.5 w-3.5" /> Ko‘rik
          </div>
          {crit.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-red-500 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Kritik ko‘rsatkich!</div>
                <div>{crit.map((c) => `${c.label}: ${c.value}`).join(' · ')}</div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            <VitalInput
              label="T°C"
              kind="temperature_c"
              v={vitals.temperature_c}
              onChange={(x) => setVitals((p) => ({ ...p, temperature_c: x }))}
            />
            <VitalInput
              label="Puls"
              kind="pulse_bpm"
              v={vitals.pulse_bpm}
              onChange={(x) => setVitals((p) => ({ ...p, pulse_bpm: x }))}
            />
            <VitalInput
              label="AQB sist."
              kind="systolic_mmhg"
              v={vitals.systolic_mmhg}
              onChange={(x) => setVitals((p) => ({ ...p, systolic_mmhg: x }))}
            />
            <VitalInput
              label="AQB diast."
              kind="diastolic_mmhg"
              v={vitals.diastolic_mmhg}
              onChange={(x) => setVitals((p) => ({ ...p, diastolic_mmhg: x }))}
            />
            <VitalInput
              label="SpO₂"
              kind="oxygen_saturation"
              v={vitals.oxygen_saturation}
              onChange={(x) => setVitals((p) => ({ ...p, oxygen_saturation: x }))}
            />
            <VitalInput
              label="Vazn"
              v={vitals.weight_kg}
              onChange={(x) => setVitals((p) => ({ ...p, weight_kg: x }))}
            />
            <VitalInput
              label="Bo‘y"
              v={vitals.height_cm}
              onChange={(x) => setVitals((p) => ({ ...p, height_cm: x }))}
            />
          </div>
          {bmi && (
            <div
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs',
                VITAL_LEVEL_CLASS[bmi.level],
              )}
            >
              <span className="font-medium">BMI {bmi.value}</span>
              <span className="opacity-70">· {bmi.category}</span>
            </div>
          )}
          <AutoTextarea
            value={exam}
            onChange={touch(setExam)}
            placeholder="Ko‘rik natijalari: teri, o‘pka, yurak, qorin…"
            minRows={2}
          />
        </div>

        {/* Tashxis — erkin matn, ICD-10 ixtiyoriy tavsiya */}
        <div className="space-y-1.5">
          <div className="text-muted-foreground text-xs font-medium">Tashxis</div>
          <DiagnosisField
            text={dxText}
            code={dxCode}
            onText={(v) => {
              dirtyRef.current = true;
              ensureStarted();
              setDxText(v);
            }}
            onPick={(code, name) => {
              dirtyRef.current = true;
              ensureStarted();
              setDxCode(code);
              setDxText(name);
            }}
            onClearCode={() => setDxCode(null)}
          />
          {showDxNote ? (
            <AutoTextarea
              value={dxNote}
              onChange={touch(setDxNote)}
              placeholder="Tashxisga izoh (ixtiyoriy)"
              minRows={1}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowDxNote(true)}
              className="text-primary text-xs hover:underline"
            >
              + izoh qo‘shish
            </button>
          )}
        </div>

        <Field label="Tavsiyalar va davolash">
          <AutoTextarea
            value={plan}
            onChange={touch(setPlan)}
            placeholder="Dorilar, muolajalar, tekshiruvlar, qayta ko‘rik sanasi…"
            minRows={2}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setRxOpen(true)}>
            <Pill className="mr-1.5 h-3.5 w-3.5" /> Retsept
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRefOpen(true)}>
            <Send className="mr-1.5 h-3.5 w-3.5" /> Yo‘llanma
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTplOpen(true)}
            title="Joriy yozuvni shablon qilib saqlash"
          >
            <Bookmark className="mr-1.5 h-3.5 w-3.5" /> Shablon qilib saqlash
          </Button>
        </div>
      </CardContent>

      {/* Doimiy pastki panel */}
      <div className="bg-muted/30 flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
          {draftMut.isPending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Saqlanmoqda…
            </>
          ) : savedAt ? (
            <>
              <Clock className="h-3 w-3" /> Qoralama saqlandi · {savedAt}
            </>
          ) : (
            'Yozganingiz avtomatik saqlanadi'
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              printConsultation(currentDoc(), {
                ...docMeta,
                doctorName,
                patient: toPatientInfo(row.patient),
                date: new Date().toLocaleDateString('uz-UZ'),
              })
            }
          >
            <Printer className="mr-1.5 h-4 w-4" /> Chop etish
          </Button>
          <Button onClick={finish} disabled={finishMut.isPending}>
            {finishMut.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
            )}
            Qabulni yakunlash
            <kbd className="border-primary-foreground/30 ml-2 hidden rounded border px-1 text-[10px] sm:inline">
              Ctrl+Enter
            </kbd>
          </Button>
        </div>
      </div>

      {tplOpen && (
        <SaveTemplateDialog
          onClose={() => setTplOpen(false)}
          current={{
            diagnosis_code: dxCode,
            diagnosis_text: dxText || null,
            soap_subjective: complaint || null,
            soap_objective: exam || null,
            soap_assessment: dxNote || null,
            soap_plan: plan || null,
          }}
        />
      )}
      <PrescriptionComposer open={rxOpen} onClose={() => setRxOpen(false)} patientId={patientId} />
      <ReferralComposer open={refOpen} onClose={() => setRefOpen(false)} patientId={patientId} />
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Matnga qarab o'sadigan maydon. */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  minRows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className="focus-visible:ring-ring w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function VitalInput({
  label,
  v,
  onChange,
  kind,
}: {
  label: string;
  v: string;
  onChange: (v: string) => void;
  kind?: VitalKind;
}) {
  const level =
    kind && v !== '' && Number.isFinite(Number(v)) ? classifyVital(kind, Number(v)) : 'normal';
  return (
    <div>
      <div className="text-muted-foreground truncate text-[10px]">{label}</div>
      <Input
        className={cn('h-8 px-2 text-sm', kind && VITAL_LEVEL_CLASS[level])}
        value={v}
        onChange={(e) => onChange(e.target.value.replace(',', '.'))}
        inputMode="decimal"
      />
    </div>
  );
}

// ── Shablon tanlash (qidiruv bilan) ─────────────────────────────────────────
type Tpl = Awaited<ReturnType<typeof api.doctor.listTemplates>>[number];
function TemplatePicker({ templates, onApply }: { templates: Tpl[]; onApply: (t: Tpl) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const list = templates.filter((t) => {
    const s = q.trim().toLowerCase();
    return (
      !s ||
      `${t.name} ${t.diagnosis_code ?? ''} ${t.diagnosis_text ?? ''}`.toLowerCase().includes(s)
    );
  });
  return (
    <div className="relative" ref={boxRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={templates.length === 0}
        title={templates.length === 0 ? 'Shablonlar «Shifokor kabineti»da yaratiladi' : undefined}
      >
        <FileText className="mr-1.5 h-3.5 w-3.5" /> Shablon
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      </Button>
      {open && (
        <div className="bg-popover absolute right-0 z-30 mt-1 w-72 rounded-md border shadow-lg">
          <div className="flex items-center gap-2 border-b px-2">
            <Search className="text-muted-foreground h-3.5 w-3.5" />
            <input
              autoFocus
              className="h-9 flex-1 bg-transparent text-sm outline-none"
              placeholder="Shablon qidirish…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {list.length === 0 && (
              <div className="text-muted-foreground px-3 py-2 text-xs">Topilmadi</div>
            )}
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onApply(t);
                  setOpen(false);
                  setQ('');
                }}
                className="hover:bg-accent flex w-full flex-col items-start px-3 py-1.5 text-left"
              >
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-muted-foreground text-[11px]">
                  {[t.diagnosis_code, t.diagnosis_text].filter(Boolean).join(' — ') ||
                    (t.is_mine ? 'Mening shablonim' : 'Klinika shabloni')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tashxis: erkin matn + ICD-10 tavsiyalari ────────────────────────────────
type DiagnosisEntry = {
  code_system: 'icd10' | 'icd11';
  code: string;
  title_uz: string | null;
  title_ru: string | null;
  title_en: string | null;
};

// Eski brauzer sevimlilarini serverga bir marta ko'chirish (oldingi versiyadan)
const ICD10_RECENT_KEY = 'icd10-recent';
const ICD10_FAV_KEY = 'icd10-favorites';
const ICD10_MIGRATED_KEY = 'icd10-migrated-v1';

function readLegacyCodes(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (typeof x === 'string' ? x : (x as { code?: string })?.code))
      .filter((c): c is string => typeof c === 'string' && c.length > 0);
  } catch {
    return [];
  }
}

function DiagnosisField({
  text,
  code,
  onText,
  onPick,
  onClearCode,
}: {
  text: string;
  code: string | null;
  onText: (v: string) => void;
  onPick: (code: string, name: string) => void;
  onClearCode: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounce(text, 250);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const { data: mine } = useQuery({
    queryKey: ['diagnosis-codes', 'my'],
    queryFn: () => api.diagnosisCodes.my(),
    staleTime: 60_000,
  });
  const recent = mine?.recent ?? [];
  const favorites = mine?.favorites ?? [];

  useEffect(() => {
    if (window.localStorage.getItem(ICD10_MIGRATED_KEY)) return;
    const favs = readLegacyCodes(ICD10_FAV_KEY);
    const recents = readLegacyCodes(ICD10_RECENT_KEY);
    if (favs.length === 0 && recents.length === 0) {
      window.localStorage.setItem(ICD10_MIGRATED_KEY, '1');
      return;
    }
    api.icd10
      .importLegacy({ favorites: favs, recent: recents })
      .then((r) => {
        window.localStorage.setItem(ICD10_MIGRATED_KEY, '1');
        window.localStorage.removeItem(ICD10_FAV_KEY);
        window.localStorage.removeItem(ICD10_RECENT_KEY);
        if (r.imported > 0) void qc.invalidateQueries({ queryKey: ['diagnosis-codes', 'my'] });
      })
      .catch(() => undefined);
  }, [qc]);

  // Kod tanlangandan keyin matn o'sha nom bo'lsa — qayta qidirmaymiz
  const searchTerm = debounced.trim();
  const { data: results, isFetching } = useQuery({
    queryKey: ['diagnosis-codes', 'search', 'icd10', searchTerm],
    queryFn: () => api.diagnosisCodes.search(searchTerm, 'icd10', 12),
    enabled: open && searchTerm.length >= 2,
  });

  const pick = (r: DiagnosisEntry) => {
    const title = r.title_uz ?? r.title_en ?? r.title_ru ?? r.code;
    onPick(r.code, title);
    setOpen(false);
    api.diagnosisCodes
      .markUsed(r.code, r.code_system)
      .then(() => qc.invalidateQueries({ queryKey: ['diagnosis-codes', 'my'] }))
      .catch(() => undefined);
  };

  const favMut = useMutation({
    mutationFn: ({ c, s }: { c: string; s: 'icd10' | 'icd11' }) =>
      api.diagnosisCodes.toggleFavorite(c, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diagnosis-codes', 'my'] }),
  });
  const isFav = (c: string) => favorites.some((x) => x.code === c);

  const quick = [
    ...favorites,
    ...recent.filter((r) => !favorites.some((f) => f.code === r.code)),
  ].slice(0, 10);

  return (
    <div className="relative" ref={boxRef}>
      <div className="focus-within:ring-ring flex items-center gap-2 rounded-md border px-2 focus-within:ring-1">
        {code && (
          <span className="bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs font-bold">
            {code}
            <button type="button" onClick={onClearCode} title="Kodni olib tashlash">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <input
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder="Tashxis — yozing yoki ro‘yxatdan tanlang (ICD-10 ixtiyoriy)"
          value={text}
          onChange={(e) => {
            onText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {isFetching ? (
          <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        ) : (
          <Search className="text-muted-foreground h-3.5 w-3.5" />
        )}
      </div>
      {open && (searchTerm.length >= 2 ? (results ?? []).length > 0 : quick.length > 0) && (
        <div className="bg-popover absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border shadow-lg">
          {searchTerm.length >= 2 ? (
            (results ?? []).map((r) => (
              <div
                key={`${r.code_system}:${r.code}`}
                className="hover:bg-accent flex items-center gap-1 border-b px-1 last:border-0"
              >
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="flex flex-1 flex-col gap-0.5 px-2 py-1.5 text-left text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-primary font-mono text-xs font-bold">{r.code}</span>
                    <span className="font-medium">{r.title_uz ?? r.title_en}</span>
                  </span>
                  {r.title_ru && (
                    <span className="text-muted-foreground text-[11px]">{r.title_ru}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => favMut.mutate({ c: r.code, s: r.code_system })}
                  className="text-muted-foreground shrink-0 p-1.5 hover:text-amber-500"
                  title={isFav(r.code) ? 'Sevimlilardan olib tashlash' : 'Sevimlilarga qo‘shish'}
                >
                  <Star
                    className={cn('h-3.5 w-3.5', isFav(r.code) && 'fill-amber-400 text-amber-400')}
                  />
                </button>
              </div>
            ))
          ) : (
            <>
              <div className="text-muted-foreground px-3 pb-1 pt-2 text-[10px] font-semibold uppercase">
                Sevimli va so‘nggi
              </div>
              {quick.map((r) => (
                <button
                  key={`${r.code_system}:${r.code}`}
                  type="button"
                  onClick={() =>
                    pick({
                      code: r.code,
                      code_system: r.code_system,
                      title_uz: r.title,
                      title_ru: null,
                      title_en: null,
                    })
                  }
                  className="hover:bg-accent flex w-full items-center gap-2 border-b px-3 py-1.5 text-left text-sm last:border-0"
                >
                  <span className="text-primary font-mono text-xs font-bold">{r.code}</span>
                  <span className="truncate">{r.title}</span>
                  {isFav(r.code) && (
                    <Star className="ml-auto h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                  )}
                </button>
              ))}
            </>
          )}
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
  const [tab, setTab] = useState<'timeline' | 'info' | 'history' | 'files'>('timeline');

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
    const y = Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 864e5));
    return Number.isFinite(y) ? y : null;
  }, [patient?.dob]);

  const debt = financial?.outstanding_debt_uzs ?? 0;

  return (
    <Card className="h-full">
      <CardContent className="space-y-3 p-3 text-sm">
        {/* Asosiy info */}
        <div>
          <div className="text-base font-semibold">{patient?.full_name ?? '—'}</div>
          <div className="text-muted-foreground text-xs">
            {age != null && `${age} yosh`}
            {patient?.gender &&
              ` · ${patient.gender === 'male' ? 'Erkak' : patient.gender === 'female' ? 'Ayol' : patient.gender}`}
          </div>
          {patient?.phone && <div className="text-muted-foreground text-xs">{patient.phone}</div>}
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
        <div className="bg-card inline-flex w-full rounded-md border p-0.5 text-xs">
          {(['timeline', 'info', 'history', 'files'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 rounded px-2 py-1',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {t === 'timeline'
                ? '⭐ Tarix'
                : t === 'info'
                  ? 'Umumiy'
                  : t === 'history'
                    ? 'Anamnez'
                    : 'Fayllar'}
            </button>
          ))}
        </div>

        {/* TAB: 360° Timeline */}
        {tab === 'timeline' && (
          <PatientTimeline events={(timeline?.events ?? []) as TimelineEvent[]} />
        )}

        {/* TAB: Umumiy */}
        {tab === 'info' && (
          <div className="space-y-3">
            {lastVitals && (
              <div className="bg-muted/30 rounded-md border p-2">
                <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wide">
                  Oxirgi vitals
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {lastVitals.temperature_c != null && <span>T° {lastVitals.temperature_c}</span>}
                  {lastVitals.pulse_bpm != null && <span>Puls {lastVitals.pulse_bpm}</span>}
                  {lastVitals.systolic_mmhg != null && (
                    <span>
                      BP {lastVitals.systolic_mmhg}/{lastVitals.diastolic_mmhg ?? '—'}
                    </span>
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
              <div className="text-muted-foreground mb-1 text-[10px] uppercase tracking-wide">
                Oxirgi tashxislar
              </div>
              <div className="space-y-1">
                {(clinical?.notes ?? []).slice(0, 5).map((n) => (
                  <div key={n.id} className="rounded-md border px-2 py-1 text-xs">
                    <div className="flex items-center gap-1.5">
                      {n.diagnosis_code && (
                        <span className="text-primary font-mono font-bold">{n.diagnosis_code}</span>
                      )}
                      <span className="truncate">{n.diagnosis_text ?? '—'}</span>
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {new Date(n.created_at).toLocaleDateString('uz-UZ')}
                      {n.author?.full_name ? ` · ${n.author.full_name}` : ''}
                    </div>
                  </div>
                ))}
                {(clinical?.notes ?? []).length === 0 && (
                  <div className="text-muted-foreground text-xs">Tashxis tarixi yo&apos;q</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB: Anamnez */}
        {tab === 'history' && <MedicalHistoryPanel patientId={patientId} history={history} />}

        {/* TAB: Fayllar */}
        {tab === 'files' && <PatientFilesPanel patientId={patientId} files={files ?? []} />}
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
        <div className="text-muted-foreground mb-1 font-medium">Allergiya</div>
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
        <div className="text-muted-foreground mb-1 font-medium">Surunkali kasalliklar</div>
        <div className="flex flex-wrap gap-1">
          {chronic.map((c, i) => (
            <span
              key={i}
              className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5"
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
          <div className="text-muted-foreground mb-1 font-medium">Doimiy dorilar</div>
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
          <div className="text-muted-foreground mb-1 font-medium">Operatsiyalar</div>
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
          <span className="text-muted-foreground font-medium">Qon guruhi: </span>
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
      <label className="hover:bg-accent flex cursor-pointer items-center justify-center rounded-md border border-dashed py-2">
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
              <span className="bg-muted mr-1 rounded px-1 text-[10px]">
                {FILE_KIND_LABEL[f.kind] ?? f.kind}
              </span>
              {f.title}
            </a>
            <button
              type="button"
              onClick={() => deleteMut.mutate(f.id)}
              className="text-muted-foreground hover:text-destructive ml-1"
            >
              ×
            </button>
          </div>
        ))}
        {files.length === 0 && <div className="text-muted-foreground">Fayl yo&apos;q</div>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-md border px-2 py-1">
      <div className="text-muted-foreground text-[10px]">{label}</div>
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
  // Standart — shaxsiy. Shifokor o'zi xohlasa klinikaga ochadi.
  const [shared, setShared] = useState(false);

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
        visibility: shared ? 'clinic' : 'private',
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
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs">
              <span className="font-medium">Klinikaga ulashish</span>
              <span className="text-muted-foreground block">
                {shared
                  ? "Barcha shifokorlar bu shablonni ko'radi va ishlatadi (tahrirlash faqat sizda)."
                  : "Hozircha faqat siz ko'rasiz."}
              </span>
            </span>
          </label>

          <div className="bg-muted/30 text-muted-foreground rounded-md border p-2 text-xs">
            <div>
              Tashxis: {current.diagnosis_code ?? '—'}
              {current.diagnosis_text ? ` · ${current.diagnosis_text}` : ''}
            </div>
            <div className="mt-1">SOAP maydonlari joriy konsultatsiyadan ko&apos;chiriladi.</div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={name.trim().length < 2 || mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
