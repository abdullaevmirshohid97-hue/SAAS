import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DoctorQueueRow } from '@clary/api-client';
import { castRoomDisplay } from '@clary/schemas';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  BookText,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  History,
  Lightbulb,
  Loader2,
  Megaphone,
  MessageSquareText,
  PhoneIncoming,
  Pill,
  Play,
  Printer,
  Search,
  Send,
  Sparkles,
  Star,
  Stethoscope,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@clary/ui-web';

import { DoctorAnalyticsDialog } from '@/components/doctor/doctor-analytics-dialog';
import {
  DoctorPicker,
  DoctorTopBar,
  initialsOf,
  useDoctorIdentity,
  type DocMeta,
} from '@/components/doctor/doctor-shell';
import { IncomingReferrals } from '@/components/doctor/incoming-referrals';
import { PrescriptionComposer } from '@/components/doctor/prescription-composer';
import { ReferralComposer } from '@/components/doctor/referral-composer';
import { PatientSafetyChips, usePatientSafety } from '@/components/doctor/clinical-context-strip';
import {
  COMPLAINT_PHRASES,
  EXAM_PHRASES,
  FOLLOW_UPS,
  PLAN_PHRASES,
  STARTER_TEMPLATES,
  STARTER_TONE,
  appendPhrase,
  followUpLine,
  hasPhrase,
  type PhraseMode,
  type StarterTemplate,
} from '@/components/doctor/starter-content';
import { PatientHistorySummary } from '@/components/patient/patient-history-summary';
import { PatientTimeline, type TimelineEvent } from '@/components/patient/patient-timeline';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { printConsultation, type ConsultationDoc } from '@/lib/diagnosis-template-print';
import {
  classifyVital,
  computeBmi,
  criticalVitals,
  VITAL_LEVEL_CLASS,
  type VitalKind,
} from '@/lib/vital-thresholds';

// =============================================================================
// Shifokor ISH STOLI — bemor qabuli.
// Joylashuv: chapda navbat | markazda bemor banneri + 4 bo'limli xulosa
// (1 Shikoyat · 2 Ko'rik · 3 Tashxis · 4 Davolash) + pastda doimiy amallar |
// o'ngda Yordamchi (maslahatlar, oldingi xulosa, shablonlar), Tarix, Anamnez,
// Fayllar.
// Oqim: bemorni tanlash → yozish (qabul avtomatik boshlanadi) → "Qabulni
// yakunlash" (xulosa imzolanadi, vitals saqlanadi, navbat yopiladi) →
// chop etish → keyingi bemor.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

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

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

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

/** Har N ms da qayta chizish (taymerlar uchun). */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function DoctorWorkspacePage() {
  const ident = useDoctorIdentity();
  if (!ident.doctor) return <DoctorPicker title="Ish stoli" onPick={ident.pick} />;
  return <Desk key={ident.doctor.id} ident={ident} />;
}

function Desk({ ident }: { ident: ReturnType<typeof useDoctorIdentity> }) {
  const qc = useQueryClient();
  const doctor = ident.doctor!;
  const doctorId = doctor.id;
  const docMeta = ident.docMeta;
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<{
    name: string;
    doc: ConsultationDoc;
    patient: DoctorQueueRow['patient'];
  } | null>(null);

  const { data: dashboard, refetch: refetchDash } = useQuery({
    queryKey: ['doctor-dashboard', doctorId],
    queryFn: () => api.doctor.dashboard(doctorId),
    refetchInterval: 20_000,
  });

  // Realtime — navbat o'zgarsa yangilash
  useEffect(() => {
    const ch = supabase
      .channel('doc-ws-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, () =>
        qc.invalidateQueries({ queryKey: ['doctor-dashboard'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const live = useMemo(
    () => [...(dashboard?.queue.serving ?? []), ...(dashboard?.queue.called ?? [])],
    [dashboard],
  );
  const allOpen = useMemo(() => [...live, ...(dashboard?.queue.waiting ?? [])], [live, dashboard]);
  const current: DoctorQueueRow | null =
    (activeId ? allOpen.find((r) => r.id === activeId) : undefined) ?? live[0] ?? null;

  // Clary Cast: "Keyingi bemor" / navbatdan "Boshlash" — server o'zi TV'da
  // "N raqamli bemor, X-xonaga" deb e'lon qiladi. Bu — faqat qayta chaqirish.
  const recall = async (r: DoctorQueueRow | null) => {
    if (!r) return;
    try {
      const res = await api.cast.announce(r.id);
      if (res.tvs === 0) toast.warning('Klinikada bog‘langan TV yo‘q (Navbat → 📺 TV)');
      else if (!res.room)
        toast.success('TV’da chaqirildi. Xonangizni belgilang — xona ham aytiladi');
      else toast.success(`TV’da chaqirildi: ${castRoomDisplay(res.room)}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const callNextMut = useMutation({
    mutationFn: () => api.queues.callNext(doctorId),
    onSuccess: (r) => {
      const id = (r as { id?: string } | null)?.id ?? null;
      setLastDone(null);
      setActiveId(id);
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
  }, [callNextMut]);

  const waitingCount =
    (dashboard?.queue.waiting.length ?? 0) + (dashboard?.queue.called.length ?? 0);
  const callNext = () => callNextMut.mutate();

  return (
    <div className="space-y-4">
      <DoctorTopBar
        doctor={doctor}
        isDoctor={ident.isDoctor}
        onChangeDoctor={ident.clear}
        right={
          <>
            <Pill2 icon={<UserCheck className="h-3.5 w-3.5" />} label="Ko‘rildi">
              {dashboard?.queue.served_today ?? 0}
            </Pill2>
            <Pill2 icon={<Clock className="h-3.5 w-3.5" />} label="Navbatda">
              {waitingCount}
            </Pill2>
            <Pill2 label="Tushum" className="hidden 2xl:inline-flex">
              {fmt(dashboard?.today_income_uzs ?? 0)}
            </Pill2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAnalyticsOpen(true)}
              title="Mening statistikam (30 kun)"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button onClick={callNext} disabled={callNextMut.isPending || waitingCount === 0}>
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
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <QueueRail
          dashboard={dashboard}
          currentId={lastDone ? null : (current?.id ?? null)}
          onSelect={(r) => {
            setLastDone(null);
            setActiveId(r.id);
          }}
          onStart={(r) => startMut.mutate(r.id)}
          starting={startMut.isPending ? (startMut.variables ?? null) : null}
          docMeta={docMeta}
          doctorName={doctor.full_name}
        />

        <div className="min-w-0">
          {lastDone ? (
            <DoneCard
              done={lastDone}
              onPrint={() =>
                printConsultation(lastDone.doc, {
                  ...docMeta,
                  doctorName: doctor.full_name,
                  patient: toPatientInfo(lastDone.patient),
                  date: new Date().toLocaleDateString('uz-UZ'),
                })
              }
              onNext={callNext}
              nextDisabled={callNextMut.isPending || waitingCount === 0}
              waitingCount={waitingCount}
            />
          ) : !current ? (
            <IdleCard
              waitingCount={waitingCount}
              next={dashboard?.queue.waiting[0] ?? null}
              onNext={callNext}
              pending={callNextMut.isPending}
              doctorId={doctorId}
            />
          ) : (
            <Consultation
              key={current.id}
              row={current}
              doctorName={doctor.full_name}
              docMeta={docMeta}
              onStarted={() => void refetchDash()}
              onRecall={() => void recall(current)}
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
      </div>

      {analyticsOpen && (
        <DoctorAnalyticsDialog
          doctorId={doctorId}
          doctorName={doctor.full_name}
          onClose={() => setAnalyticsOpen(false)}
        />
      )}
    </div>
  );
}

function Pill2({
  icon,
  label,
  children,
  className,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'bg-card inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        className,
      )}
    >
      {icon && <span className="text-primary">{icon}</span>}
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{children}</span>
    </span>
  );
}

// ── Bo'sh holat va yakun kartalari ──────────────────────────────────────────
function IdleCard({
  waitingCount,
  next,
  onNext,
  pending,
  doctorId,
}: {
  waitingCount: number;
  next: DoctorQueueRow | null;
  onNext: () => void;
  pending: boolean;
  doctorId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border p-8 text-center shadow-sm">
        <div className="from-primary/15 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br to-teal-500/15">
          <Stethoscope className="text-primary h-8 w-8" />
        </div>
        {waitingCount > 0 ? (
          <>
            <div className="mt-4 text-lg font-semibold">Navbatda {waitingCount} ta bemor</div>
            {next && (
              <div className="text-muted-foreground mt-1 text-sm">
                Keyingi: {next.ticket_no ? `№ ${next.ticket_no} · ` : ''}
                {next.patient?.full_name ?? '—'}
                {next.service_name ? ` · ${next.service_name}` : ''}
              </div>
            )}
            <Button size="lg" className="mt-5" onClick={onNext} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <PhoneIncoming className="mr-2 h-5 w-5" />
              )}
              Keyingi bemorni chaqirish
            </Button>
            <div className="text-muted-foreground mt-2 text-xs">
              yoki chapdagi ro‘yxatdan bemorni tanlang · <kbd className="font-mono">N</kbd>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 text-lg font-semibold">Navbat bo‘sh</div>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
              Qabulxona bemorni sizga yozganda shu yerda avtomatik paydo bo‘ladi. Bo‘sh vaqtda
              kabinetda shablon tayyorlab qo‘ying — qabul tezlashadi.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link to="/doctor/kabinet">
                <BookText className="mr-1.5 h-4 w-4" /> Kabinetga o‘tish
              </Link>
            </Button>
          </>
        )}
      </div>
      <IncomingReferrals doctorId={doctorId} />
    </div>
  );
}

function DoneCard({
  done,
  onPrint,
  onNext,
  nextDisabled,
  waitingCount,
}: {
  done: { name: string; doc: ConsultationDoc };
  onPrint: () => void;
  onNext: () => void;
  nextDisabled: boolean;
  waitingCount: number;
}) {
  const dx = [done.doc.diagnosis_code, done.doc.diagnosis_text].filter(Boolean).join(' — ');
  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
      <div className="space-y-5 p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <div>
          <div className="text-lg font-semibold">Qabul yakunlandi</div>
          <div className="text-muted-foreground text-sm">{done.name}</div>
        </div>
        {(dx || done.doc.plan) && (
          <div className="bg-muted/40 mx-auto max-w-lg rounded-xl px-4 py-3 text-left text-sm">
            {dx && (
              <div>
                <span className="text-muted-foreground text-xs">Tashxis: </span>
                <span className="font-medium">{dx}</span>
              </div>
            )}
            {done.doc.plan && (
              <div className="text-muted-foreground mt-1 line-clamp-3 whitespace-pre-line text-xs">
                {done.doc.plan}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="outline" onClick={onPrint}>
            <Printer className="mr-1.5 h-4 w-4" /> Xulosani chop etish
          </Button>
          <Button onClick={onNext} disabled={nextDisabled}>
            <PhoneIncoming className="mr-1.5 h-4 w-4" /> Keyingi bemor
            {waitingCount > 0 ? ` (${waitingCount})` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── CHAP — navbat ───────────────────────────────────────────────────────────
function waitTone(m: number | null) {
  if (m == null) return 'bg-muted text-foreground';
  if (m >= 30) return 'bg-red-500 text-white';
  if (m >= 15) return 'bg-amber-400 text-amber-950';
  return 'bg-emerald-500 text-white';
}

function QueueRail({
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
  useTick(30_000);
  const [showServed, setShowServed] = useState(false);
  const live = [...(dashboard?.queue.serving ?? []), ...(dashboard?.queue.called ?? [])];
  const waiting = dashboard?.queue.waiting ?? [];
  const served = dashboard?.queue.served ?? [];

  return (
    <aside className="bg-card space-y-4 rounded-xl border p-3 shadow-sm lg:sticky lg:top-0 lg:max-h-[calc(100vh-8.5rem)] lg:self-start lg:overflow-y-auto">
      {live.length > 0 && (
        <div>
          <RailTitle>Hozir</RailTitle>
          <div className="space-y-1.5">
            {live.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r)}
                className={cn(
                  'w-full rounded-lg border-l-4 border-emerald-500 px-2.5 py-2 text-left transition',
                  r.id === currentId
                    ? 'bg-emerald-50 ring-1 ring-emerald-300 dark:bg-emerald-950/30 dark:ring-emerald-800'
                    : 'bg-muted/40 hover:bg-muted',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="font-mono text-xs font-bold">{r.ticket_no ?? '—'}</span>
                  <span className="text-muted-foreground ml-auto text-[10px]">
                    {r.status === 'serving' ? 'Qabulda' : 'Chaqirildi'}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 break-words text-sm font-medium leading-tight">
                  {r.patient?.full_name ?? '—'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <RailTitle>Navbatda ({waiting.length})</RailTitle>
        <div className="space-y-1.5">
          {waiting.length === 0 ? (
            <div className="text-muted-foreground rounded-md border border-dashed px-2 py-4 text-center text-xs">
              Kutayotgan bemor yo‘q
            </div>
          ) : (
            waiting.map((r) => {
              const w = minutesSince(r.joined_at);
              const active = r.id === currentId;
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(r)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(r)}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition',
                    active
                      ? 'border-primary bg-primary/5 ring-primary/20 ring-1'
                      : 'hover:bg-muted/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md font-mono text-[11px] font-bold leading-none',
                      waitTone(w),
                    )}
                    title={w != null ? `${w} daqiqadan beri kutmoqda` : undefined}
                  >
                    {r.ticket_no ?? '—'}
                    {w != null && (
                      <span className="mt-0.5 text-[9px] font-medium opacity-90">{w}′</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 break-words text-sm font-medium leading-tight">
                      {r.patient?.full_name ?? '—'}
                    </div>
                    {r.service_name && (
                      <div className="text-muted-foreground truncate text-[11px]">
                        {r.service_name}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Qabulni boshlash"
                    disabled={starting === r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStart(r);
                    }}
                    className="text-primary hover:bg-primary/10 shrink-0 rounded-md p-1.5"
                  >
                    {starting === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                </div>
              );
            })
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
            {served.length === 0 && <div className="text-muted-foreground text-xs">Hali yo‘q</div>}
            {served.map((r) => (
              <ServedRow key={r.id} r={r} docMeta={docMeta} doctorName={doctorName} />
            ))}
          </div>
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5 border-t pt-2 text-[10px]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" /> &lt;15′
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-400" /> 15–30′
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red-500" /> 30′+
        </span>
      </div>
    </aside>
  );
}

function RailTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wide">
      {children}
    </div>
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

type Tpl = Awaited<ReturnType<typeof api.doctor.listTemplates>>[number];
type TplLike = Pick<
  Tpl,
  'diagnosis_code' | 'diagnosis_text' | 'soap_subjective' | 'soap_objective' | 'soap_plan'
> & { name: string; soap_assessment?: string | null };

export type Hint = { tone: 'red' | 'amber' | 'violet' | 'sky'; text: string };

const FIELD_IDS = ['dw-complaint', 'dw-exam', 'dw-dx', 'dw-plan'] as const;

function Consultation({
  row,
  doctorName,
  docMeta,
  onStarted,
  onFinished,
  onRecall,
}: {
  row: DoctorQueueRow;
  doctorName: string;
  docMeta: DocMeta;
  onStarted: () => void;
  onFinished: (doc: ConsultationDoc) => void;
  onRecall: () => void;
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
  const { data: clinical } = useQuery({
    queryKey: ['patient-clinical', patientId],
    queryFn: () => api.doctor.patientClinical(patientId),
    enabled: !!patientId,
  });
  // Takroriy bemor: oxirgi imzolangan xulosa (bugungidan oldingi)
  const prevNote = useMemo(
    () => (clinical?.notes ?? []).find((n) => n.is_final && !isToday(n.created_at)) ?? null,
    [clinical],
  );

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
      void qc.invalidateQueries({ queryKey: ['patient-memory', patientId] });
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

  // Ctrl+Enter — yakunlash; Alt+1…4 — bo'limga o'tish
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        finishRef.current();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-4]$/.test(e.code)) {
        const id = FIELD_IDS[Number(e.code.slice(5)) - 1];
        const el = id ? document.getElementById(id) : null;
        if (el) {
          e.preventDefault();
          el.focus();
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasText = !!(complaint.trim() || exam.trim() || plan.trim() || dxText.trim());

  /** Shablon / oldingi xulosa / tayyor shablon — formaga to'ldirish. */
  const fillFrom = (t: TplLike, label: string) => {
    if (
      hasText &&
      !window.confirm(`Yozilgan matn «${label}» bilan almashtiriladi. Davom etasizmi?`)
    )
      return false;
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
    return true;
  };
  const applyTemplate = (t: Tpl) => {
    if (!fillFrom(t, t.name)) return;
    api.doctor.useTemplate(t.id).catch(() => undefined);
    toast.success(`«${t.name}» shabloni qo‘llandi`);
  };
  const applyStarter = (t: StarterTemplate) => {
    if (!fillFrom(t, t.name)) return;
    toast.success(`«${t.name}» qo‘llandi — «___» joylarni to‘ldiring`);
  };
  const copyPrev = () => {
    if (!prevNote) return;
    const ok = fillFrom(
      {
        name: 'Oldingi xulosa',
        diagnosis_code: prevNote.diagnosis_code,
        diagnosis_text: prevNote.diagnosis_text,
        soap_subjective: prevNote.soap_subjective,
        soap_objective: prevNote.soap_objective,
        soap_assessment: prevNote.soap_assessment,
        soap_plan: prevNote.soap_plan,
      },
      'oldingi xulosa',
    );
    if (ok) toast.success('Oldingi xulosa ko‘chirildi — bugungi holatga moslang');
  };

  const age = ageOf(row.patient?.dob);
  const crit = criticalVitals(vitals);
  const bmi = computeBmi(num(vitals.weight_kg), num(vitals.height_cm));
  const safety = usePatientSafety(patientId);

  // Maslahatlar — bemor va kiritilgan ko'rsatkichlarga qarab
  const hints: Hint[] = [];
  if (safety.allergies.length)
    hints.push({
      tone: 'red',
      text: `Allergiya: ${safety.allergies.join(', ')} — dori tanlashda e’tibor bering.`,
    });
  if (crit.length)
    hints.push({
      tone: 'red',
      text: `Kritik ko‘rsatkich: ${crit.map((c) => `${c.label} ${c.value}`).join(', ')}.`,
    });
  const sys = num(vitals.systolic_mmhg);
  const dia = num(vitals.diastolic_mmhg);
  const htnKnown = safety.chronic.some((c) => /gipert|bosim|hypert/i.test(c));
  if (((sys ?? 0) >= 140 || (dia ?? 0) >= 90) && !crit.some((c) => /bosim/i.test(c.label)))
    hints.push({
      tone: 'amber',
      text: htnKnown
        ? 'Qon bosimi me’yordan yuqori — joriy terapiya samarasini baholang.'
        : 'Qon bosimi yuqori — 5 daqiqadan keyin qayta o‘lchang, gipertoniya ehtimoli.',
    });
  const temp = num(vitals.temperature_c);
  if (temp != null && temp > 37.5 && temp <= 38.5)
    hints.push({ tone: 'amber', text: 'Harorat ko‘tarilgan — infeksiya o‘chog‘ini aniqlang.' });
  const spo2 = num(vitals.oxygen_saturation);
  if (spo2 != null && spo2 >= 90 && spo2 < 95)
    hints.push({ tone: 'amber', text: 'SpO₂ pasaygan — nafas tizimini batafsil baholang.' });
  if (bmi && bmi.value >= 30)
    hints.push({ tone: 'amber', text: `BMI ${bmi.value} — vazn bo‘yicha tavsiya bering.` });
  safety.reminders.forEach((r) => hints.push({ tone: 'sky', text: r }));
  if (age != null && age >= 65)
    hints.push({
      tone: 'sky',
      text: 'Keksa bemor (65+): dori dozasi va o‘zaro ta’sirini tekshiring.',
    });
  if (age != null && age < 18)
    hints.push({ tone: 'sky', text: 'Bola bemor: dori dozasini yosh va vaznga qarab hisoblang.' });
  if (row.patient?.gender === 'female' && age != null && age >= 15 && age <= 49)
    hints.push({
      tone: 'sky',
      text: 'Homiladorlik ehtimolini aniqlang (dori va tekshiruv tanlashda).',
    });
  if (!dxText.trim() && (complaint.trim() || exam.trim()))
    hints.push({ tone: 'violet', text: 'Tashxis hali yozilmagan (3-bo‘lim).' });

  const steps = [
    { label: 'Shikoyat', done: !!complaint.trim() },
    { label: 'Ko‘rik', done: !!exam.trim() || !!vitalsLine(vitals) },
    { label: 'Tashxis', done: !!dxText.trim() },
    { label: 'Davolash', done: !!plan.trim() },
  ];
  const insert =
    (value: string, setter: (v: string) => void, mode: PhraseMode) => (phrase: string) => {
      dirtyRef.current = true;
      ensureStarted();
      setter(appendPhrase(value, phrase, mode));
    };

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-3">
        <PatientBanner
          row={row}
          onRecall={onRecall}
          templates={templates ?? []}
          onApplyTemplate={applyTemplate}
          onApplyStarter={applyStarter}
        />

        {/* Kichikroq ekranda Yordamchi paneli pastda — maslahatlar shu yerda */}
        {hints.length > 0 && (
          <div className="flex flex-wrap gap-1.5 2xl:hidden">
            {hints.map((h, i) => (
              <span
                key={i}
                className={cn('rounded-lg border px-2.5 py-1 text-xs', HINT_TONE[h.tone])}
              >
                <Lightbulb className="mr-1 inline h-3 w-3" />
                {h.text}
              </span>
            ))}
          </div>
        )}

        {signedToday && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Bugun{' '}
            {new Date(signedToday.created_at).toLocaleTimeString('uz-UZ', {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            da xulosa imzolangan. Yangi yozilgani alohida xulosa bo‘ladi.
          </div>
        )}

        {/* 1. Shikoyat */}
        <SectionCard
          n={1}
          tone="sky"
          icon={<MessageSquareText className="h-4 w-4" />}
          title="Shikoyat va anamnez"
          hint="Nimadan shikoyat qiladi, qachondan beri"
          done={steps[0]!.done}
          right={
            prevNote ? (
              <button
                type="button"
                onClick={copyPrev}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                title={`${new Date(prevNote.created_at).toLocaleDateString('uz-UZ')} dagi xulosani ko‘chirish`}
              >
                <Copy className="h-3 w-3" /> Oldingi xulosa
              </button>
            ) : null
          }
        >
          <AutoTextarea
            id="dw-complaint"
            value={complaint}
            onChange={touch(setComplaint)}
            placeholder="Bemor nimadan shikoyat qiladi, qachondan beri, avval nima qabul qilgan…"
            minRows={3}
          />
          <PhraseChips
            tone="sky"
            phrases={COMPLAINT_PHRASES}
            text={complaint}
            onPick={insert(complaint, setComplaint, 'list')}
          />
        </SectionCard>

        {/* 2. Ko'rik */}
        <SectionCard
          n={2}
          tone="teal"
          icon={<Activity className="h-4 w-4" />}
          title="Ko‘rik"
          hint="Vital belgilar va ob’ektiv ko‘rik"
          done={steps[1]!.done}
        >
          {crit.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Kritik ko‘rsatkich!</div>
                <div>{crit.map((c) => `${c.label}: ${c.value}`).join(' · ')}</div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 2xl:grid-cols-7">
            <VitalTile
              label="Harorat"
              unit="°C"
              kind="temperature_c"
              v={vitals.temperature_c}
              onChange={(x) => setVitals((p) => ({ ...p, temperature_c: x }))}
            />
            <VitalTile
              label="Puls"
              unit="/daq"
              kind="pulse_bpm"
              v={vitals.pulse_bpm}
              onChange={(x) => setVitals((p) => ({ ...p, pulse_bpm: x }))}
            />
            <VitalTile
              label="AQB sist."
              unit="mmHg"
              kind="systolic_mmhg"
              v={vitals.systolic_mmhg}
              onChange={(x) => setVitals((p) => ({ ...p, systolic_mmhg: x }))}
            />
            <VitalTile
              label="AQB diast."
              unit="mmHg"
              kind="diastolic_mmhg"
              v={vitals.diastolic_mmhg}
              onChange={(x) => setVitals((p) => ({ ...p, diastolic_mmhg: x }))}
            />
            <VitalTile
              label="SpO₂"
              unit="%"
              kind="oxygen_saturation"
              v={vitals.oxygen_saturation}
              onChange={(x) => setVitals((p) => ({ ...p, oxygen_saturation: x }))}
            />
            <VitalTile
              label="Vazn"
              unit="kg"
              v={vitals.weight_kg}
              onChange={(x) => setVitals((p) => ({ ...p, weight_kg: x }))}
            />
            <VitalTile
              label="Bo‘y"
              unit="sm"
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
            id="dw-exam"
            value={exam}
            onChange={touch(setExam)}
            placeholder="Ko‘rik natijalari: teri, o‘pka, yurak, qorin…"
            minRows={3}
          />
          <PhraseChips
            tone="teal"
            phrases={EXAM_PHRASES}
            text={exam}
            onPick={insert(exam, setExam, 'sentence')}
          />
        </SectionCard>

        {/* 3. Tashxis */}
        <SectionCard
          n={3}
          tone="violet"
          icon={<Stethoscope className="h-4 w-4" />}
          title="Tashxis"
          hint="Erkin matn yoki ICD-10 dan tanlang (kod ixtiyoriy)"
          done={steps[2]!.done}
        >
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
          <QuickDiagnosisChips
            currentCode={dxCode}
            onPick={(code, name) => {
              dirtyRef.current = true;
              ensureStarted();
              setDxCode(code);
              setDxText(name);
            }}
          />
          {showDxNote ? (
            <AutoTextarea
              value={dxNote}
              onChange={touch(setDxNote)}
              placeholder="Tashxisga izoh: asoratlar, yo‘ldosh kasalliklar (ixtiyoriy)"
              minRows={1}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowDxNote(true)}
              className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
            >
              + izoh qo‘shish
            </button>
          )}
        </SectionCard>

        {/* 4. Davolash */}
        <SectionCard
          n={4}
          tone="emerald"
          icon={<ClipboardList className="h-4 w-4" />}
          title="Davolash va tavsiyalar"
          hint="Dorilar, muolajalar, tekshiruvlar, qayta ko‘rik"
          done={steps[3]!.done}
        >
          <AutoTextarea
            id="dw-plan"
            value={plan}
            onChange={touch(setPlan)}
            placeholder="Dorilar, muolajalar, tekshiruvlar, qayta ko‘rik sanasi…"
            minRows={3}
          />
          <PhraseChips
            tone="emerald"
            phrases={PLAN_PHRASES}
            text={plan}
            onPick={insert(plan, setPlan, 'line')}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-[11px]">Qayta ko‘rik:</span>
            {FOLLOW_UPS.map((f) => (
              <button
                key={f.days}
                type="button"
                onClick={() => {
                  dirtyRef.current = true;
                  ensureStarted();
                  // Oldingi "Qayta ko'rik" qatori bo'lsa — almashtiriladi
                  const base = plan
                    .split('\n')
                    .filter((l) => !l.startsWith('Qayta ko‘rik:'))
                    .join('\n');
                  setPlan(appendPhrase(base, followUpLine(f.days), 'line'));
                }}
                className="rounded-full border border-emerald-200 px-2.5 py-0.5 text-xs text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-3">
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
              disabled={!hasText}
              title="Joriy yozuvni shablon qilib saqlash"
            >
              <Bookmark className="mr-1.5 h-3.5 w-3.5" /> Shablon qilib saqlash
            </Button>
          </div>
        </SectionCard>

        {/* Doimiy pastki panel */}
        <div className="bg-background/95 sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 shadow-lg backdrop-blur">
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <span
                key={s.label}
                title={s.label}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  s.done
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {s.done ? <CheckCircle2 className="h-3 w-3" /> : <span>{i + 1}</span>}
                <span className="hidden md:inline">{s.label}</span>
              </span>
            ))}
          </div>
          <span className="text-muted-foreground hidden items-center gap-1 text-[11px] sm:flex">
            {draftMut.isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saqlanmoqda…
              </>
            ) : savedAt ? (
              <>
                <Clock className="h-3 w-3" /> Saqlandi · {savedAt}
              </>
            ) : (
              'Avtomatik saqlanadi'
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
              <Printer className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Chop etish</span>
            </Button>
            <Button
              onClick={finish}
              disabled={finishMut.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {finishMut.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
              )}
              Qabulni yakunlash
              <kbd className="ml-2 hidden rounded border border-white/30 px-1 text-[10px] sm:inline">
                Ctrl+Enter
              </kbd>
            </Button>
          </div>
        </div>
      </div>

      <SidePanel
        patientId={patientId}
        hints={hints}
        prevNote={prevNote}
        onCopyPrev={copyPrev}
        templates={templates ?? []}
        onApplyTemplate={applyTemplate}
        onApplyStarter={applyStarter}
        lastVitals={clinical?.vitals?.[0] ?? null}
      />

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
    </div>
  );
}

// ── Bemor banneri ───────────────────────────────────────────────────────────
function PatientBanner({
  row,
  onRecall,
  templates,
  onApplyTemplate,
  onApplyStarter,
}: {
  row: DoctorQueueRow;
  onRecall: () => void;
  templates: Tpl[];
  onApplyTemplate: (t: Tpl) => void;
  onApplyStarter: (t: StarterTemplate) => void;
}) {
  useTick(30_000);
  const p = row.patient;
  const age = ageOf(p?.dob);
  const gender = genderLabel(p?.gender);
  const since =
    row.status === 'serving'
      ? minutesSince(row.started_at)
      : row.status === 'called'
        ? minutesSince(row.called_at)
        : minutesSince(row.joined_at);
  const statusText =
    row.status === 'serving'
      ? `Qabulda · ${since ?? 0} daq`
      : row.status === 'called'
        ? `Chaqirildi · ${since ?? 0} daq`
        : `Kutmoqda · ${since ?? 0} daq`;
  return (
    <div className="bg-card relative overflow-hidden rounded-xl border shadow-sm">
      <div className="from-primary absolute inset-x-0 top-0 h-1 bg-gradient-to-r via-teal-400 to-sky-400" />
      <div className="flex flex-wrap items-start gap-3 p-4 pt-5">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold',
            p?.gender === 'female'
              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
              : p?.gender === 'male'
                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                : 'bg-muted text-foreground',
          )}
        >
          {initialsOf(p?.full_name ?? '—')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold leading-tight">{p?.full_name ?? '—'}</h2>
            {row.ticket_no && (
              <span className="bg-muted rounded-md px-1.5 py-0.5 font-mono text-xs font-bold">
                № {row.ticket_no}
              </span>
            )}
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                row.status === 'serving'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
              )}
            >
              {statusText}
            </span>
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-sm">
            {age != null && <span>{age} yosh</span>}
            {gender && <span>{gender}</span>}
            {p?.phone && <span>{p.phone}</span>}
            {row.service_name && <span className="text-foreground/80">{row.service_name}</span>}
          </div>
          {p?.id && (
            <div className="mt-2">
              <PatientSafetyChips patientId={p.id} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={onRecall}
            title="Bemorni zal TV ekranida (Clary Cast) qayta chaqirish"
          >
            <Megaphone className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Chaqirish</span>
          </Button>
          <TemplatePicker
            templates={templates}
            onApply={onApplyTemplate}
            onApplyStarter={onApplyStarter}
          />
        </div>
      </div>
    </div>
  );
}

// ── Bo'lim kartasi ──────────────────────────────────────────────────────────
type Tone = 'sky' | 'teal' | 'violet' | 'emerald';
const TONE: Record<Tone, { bar: string; badge: string; chip: string; chipOn: string }> = {
  sky: {
    bar: 'bg-sky-500',
    badge: 'bg-sky-500 text-white',
    chip: 'hover:border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40',
    chipOn:
      'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  },
  teal: {
    bar: 'bg-teal-500',
    badge: 'bg-teal-500 text-white',
    chip: 'hover:border-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40',
    chipOn:
      'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
  },
  violet: {
    bar: 'bg-violet-500',
    badge: 'bg-violet-500 text-white',
    chip: 'hover:border-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40',
    chipOn:
      'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  },
  emerald: {
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-500 text-white',
    chip: 'hover:border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40',
    chipOn:
      'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
};

function SectionCard({
  n,
  tone,
  icon,
  title,
  hint,
  done,
  right,
  children,
}: {
  n: number;
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  hint: string;
  done: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <section className="bg-card relative overflow-hidden rounded-xl border shadow-sm">
      <div className={cn('absolute inset-y-0 left-0 w-1', t.bar)} />
      <div className="space-y-3 py-3 pl-5 pr-4">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              done ? 'bg-emerald-500 text-white' : t.badge,
            )}
          >
            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="text-muted-foreground">{icon}</span>
              {title}
            </div>
            <div className="text-muted-foreground truncate text-[11px]">{hint}</div>
          </div>
          {right}
          <kbd className="text-muted-foreground hidden rounded border px-1 font-mono text-[10px] lg:inline">
            Alt+{n}
          </kbd>
        </div>
        {children}
      </div>
    </section>
  );
}

/** Tez iboralar — bosilsa matnga qo'shiladi. Ishlatilganlari belgilanadi. */
function PhraseChips({
  tone,
  phrases,
  text,
  onPick,
}: {
  tone: Tone;
  phrases: string[];
  text: string;
  onPick: (p: string) => void;
}) {
  const [all, setAll] = useState(false);
  const LIMIT = 8;
  const shown = all ? phrases : phrases.slice(0, LIMIT);
  const t = TONE[tone];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Sparkles className="text-muted-foreground h-3.5 w-3.5" />
      {shown.map((p) => {
        const on = hasPhrase(text, p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition',
              on ? t.chipOn : cn('text-foreground/80', t.chip),
            )}
          >
            {on && '✓ '}
            {p}
          </button>
        );
      })}
      {phrases.length > LIMIT && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-muted-foreground hover:text-foreground px-1 text-xs"
        >
          {all ? 'kamroq' : `+${phrases.length - LIMIT} yana`}
        </button>
      )}
    </div>
  );
}

/** Matnga qarab o'sadigan maydon. */
function AutoTextarea({
  id,
  value,
  onChange,
  placeholder,
  minRows = 2,
}: {
  id?: string;
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
      id={id}
      ref={ref}
      rows={minRows}
      className="bg-background focus-visible:ring-ring placeholder:text-muted-foreground/70 w-full resize-none rounded-lg border px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function VitalTile({
  label,
  unit,
  v,
  onChange,
  kind,
}: {
  label: string;
  unit: string;
  v: string;
  onChange: (v: string) => void;
  kind?: VitalKind;
}) {
  const level =
    kind && v !== '' && Number.isFinite(Number(v)) ? classifyVital(kind, Number(v)) : 'normal';
  return (
    <label
      className={cn(
        'bg-background focus-within:ring-ring block rounded-lg border px-2 py-1.5 focus-within:ring-2',
        kind && v !== '' && VITAL_LEVEL_CLASS[level],
      )}
    >
      <span className="text-muted-foreground block truncate text-[10px] font-medium">{label}</span>
      <span className="flex items-baseline gap-1">
        <input
          className="w-full min-w-0 bg-transparent text-base font-semibold outline-none"
          value={v}
          onChange={(e) => onChange(e.target.value.replace(',', '.'))}
          inputMode="decimal"
          placeholder="—"
        />
        <span className="text-muted-foreground shrink-0 text-[10px]">{unit}</span>
      </span>
    </label>
  );
}

// ── Shablon tanlash (qidiruv bilan) ─────────────────────────────────────────
function TemplatePicker({
  templates,
  onApply,
  onApplyStarter,
}: {
  templates: Tpl[];
  onApply: (t: Tpl) => void;
  onApplyStarter: (t: StarterTemplate) => void;
}) {
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
  const s = q.trim().toLowerCase();
  const match = (t: {
    name: string;
    diagnosis_code: string | null;
    diagnosis_text: string | null;
  }) =>
    !s || `${t.name} ${t.diagnosis_code ?? ''} ${t.diagnosis_text ?? ''}`.toLowerCase().includes(s);
  const list = templates.filter(match);
  const starters = STARTER_TEMPLATES.filter(match);
  return (
    <div className="relative" ref={boxRef}>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
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
          <div className="max-h-80 overflow-auto py-1">
            {list.length + starters.length === 0 && (
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
            {starters.length > 0 && (
              <div className="text-muted-foreground border-t px-3 pb-1 pt-2 text-[10px] font-semibold uppercase">
                Tayyor shablonlar
              </div>
            )}
            {starters.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  onApplyStarter(t);
                  setOpen(false);
                  setQ('');
                }}
                className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left"
              >
                <span className="text-sm">{t.name}</span>
                <span className="text-muted-foreground ml-auto font-mono text-[10px]">
                  {t.diagnosis_code}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── O'NG — Yordamchi panel ──────────────────────────────────────────────────
type ClinicalNote = NonNullable<
  Awaited<ReturnType<typeof api.doctor.patientClinical>>['notes']
>[number];
type ClinicalVitals = NonNullable<
  Awaited<ReturnType<typeof api.doctor.patientClinical>>['vitals']
>[number];

const HINT_TONE: Record<Hint['tone'], string> = {
  red: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  amber:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100',
  violet:
    'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100',
  sky: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100',
};

function SidePanel({
  patientId,
  hints,
  prevNote,
  onCopyPrev,
  templates,
  onApplyTemplate,
  onApplyStarter,
  lastVitals,
}: {
  patientId: string;
  hints: Hint[];
  prevNote: ClinicalNote | null;
  onCopyPrev: () => void;
  templates: Tpl[];
  onApplyTemplate: (t: Tpl) => void;
  onApplyStarter: (t: StarterTemplate) => void;
  lastVitals: ClinicalVitals | null;
}) {
  const [tab, setTab] = useState<'help' | 'history' | 'anamnez' | 'files'>('help');
  const TABS = [
    { k: 'help' as const, label: 'Yordamchi', icon: Lightbulb },
    { k: 'history' as const, label: 'Tarix', icon: History },
    { k: 'anamnez' as const, label: 'Anamnez', icon: AlertTriangle },
    { k: 'files' as const, label: 'Fayllar', icon: FolderOpen },
  ];
  return (
    <aside className="bg-card min-w-0 rounded-xl border shadow-sm 2xl:sticky 2xl:top-0 2xl:max-h-[calc(100vh-8.5rem)] 2xl:self-start 2xl:overflow-y-auto">
      <div className="bg-card sticky top-0 z-10 grid grid-cols-4 gap-0.5 border-b p-1">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] font-medium transition',
              tab === t.k
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-3">
        {tab === 'help' && (
          <HelpTab
            hints={hints}
            prevNote={prevNote}
            onCopyPrev={onCopyPrev}
            templates={templates}
            onApplyTemplate={onApplyTemplate}
            onApplyStarter={onApplyStarter}
          />
        )}
        {tab === 'history' && <HistoryTab patientId={patientId} lastVitals={lastVitals} />}
        {tab === 'anamnez' && <MedicalHistoryPanel patientId={patientId} />}
        {tab === 'files' && <PatientFilesPanel patientId={patientId} />}
      </div>
    </aside>
  );
}

function HelpTab({
  hints,
  prevNote,
  onCopyPrev,
  templates,
  onApplyTemplate,
  onApplyStarter,
}: {
  hints: Hint[];
  prevNote: ClinicalNote | null;
  onCopyPrev: () => void;
  templates: Tpl[];
  onApplyTemplate: (t: Tpl) => void;
  onApplyStarter: (t: StarterTemplate) => void;
}) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const match = (x: {
    name: string;
    diagnosis_code?: string | null;
    diagnosis_text?: string | null;
  }) =>
    !s || `${x.name} ${x.diagnosis_code ?? ''} ${x.diagnosis_text ?? ''}`.toLowerCase().includes(s);
  const mine = templates.filter((t) => t.is_mine && match(t));
  const clinic = templates.filter((t) => !t.is_mine && match(t));
  const starters = STARTER_TEMPLATES.filter(match);

  return (
    <div className="space-y-4">
      {/* Maslahatlar */}
      <div>
        <PanelTitle icon={<Lightbulb className="h-3.5 w-3.5 text-amber-500" />}>
          Maslahatlar
        </PanelTitle>
        {hints.length === 0 ? (
          <div className="text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 text-xs">
            Ko‘rsatkichlarni kiritsangiz, shu yerda eslatmalar chiqadi.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {hints.map((h, i) => (
              <li
                key={i}
                className={cn('rounded-lg border px-2.5 py-1.5 text-xs', HINT_TONE[h.tone])}
              >
                {h.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Oldingi xulosa */}
      {prevNote && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-2.5 dark:border-sky-900/60 dark:bg-sky-950/20">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            Oldingi tashrif · {new Date(prevNote.created_at).toLocaleDateString('uz-UZ')}
          </div>
          <div className="mt-0.5 text-sm font-medium">
            {[prevNote.diagnosis_code, prevNote.diagnosis_text].filter(Boolean).join(' — ') ||
              'Tashxissiz xulosa'}
          </div>
          {prevNote.author?.full_name && (
            <div className="text-muted-foreground text-[11px]">{prevNote.author.full_name}</div>
          )}
          {prevNote.soap_plan && (
            <div className="text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line text-[11px]">
              {prevNote.soap_plan}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 w-full text-xs"
            onClick={onCopyPrev}
          >
            <Copy className="mr-1.5 h-3 w-3" /> Xulosani ko‘chirish
          </Button>
        </div>
      )}

      {/* Shablonlar */}
      <div>
        <PanelTitle icon={<BookText className="h-3.5 w-3.5" />}>Shablonlar</PanelTitle>
        <div className="mb-2 flex items-center gap-2 rounded-md border px-2">
          <Search className="text-muted-foreground h-3.5 w-3.5" />
          <input
            className="h-8 flex-1 bg-transparent text-xs outline-none"
            placeholder="Nomi yoki ICD kodi…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {mine.length > 0 && (
          <TplGroup title="Mening shablonlarim">
            {mine.map((t) => (
              <TplButton
                key={t.id}
                name={t.name}
                code={t.diagnosis_code}
                onClick={() => onApplyTemplate(t)}
              />
            ))}
          </TplGroup>
        )}
        {clinic.length > 0 && (
          <TplGroup title="Klinika shablonlari">
            {clinic.map((t) => (
              <TplButton
                key={t.id}
                name={t.name}
                code={t.diagnosis_code}
                onClick={() => onApplyTemplate(t)}
              />
            ))}
          </TplGroup>
        )}
        {starters.length > 0 && (
          <TplGroup title="Tayyor shablonlar">
            <div className="grid grid-cols-2 gap-1.5">
              {starters.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onApplyStarter(t)}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-left transition hover:shadow-sm',
                    STARTER_TONE[t.tone],
                  )}
                >
                  <div className="truncate text-xs font-semibold">{t.name}</div>
                  <div className="font-mono text-[10px] opacity-70">{t.diagnosis_code}</div>
                </button>
              ))}
            </div>
          </TplGroup>
        )}
        {mine.length + clinic.length + starters.length === 0 && (
          <div className="text-muted-foreground text-xs">Topilmadi</div>
        )}
        <Link
          to="/doctor/kabinet"
          className="text-primary mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          <BookText className="h-3 w-3" /> Shablonlarni Kabinetda boshqarish
        </Link>
      </div>
    </div>
  );
}

function PanelTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
      {icon}
      {children}
    </div>
  );
}

function TplGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-muted-foreground mb-1 text-[10px] font-medium">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function TplButton({
  name,
  code,
  onClick,
}: {
  name: string;
  code: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:border-primary/40 hover:bg-primary/5 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition"
    >
      <FileText className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
      {code && (
        <span className="text-primary shrink-0 font-mono text-[10px] font-bold">{code}</span>
      )}
    </button>
  );
}

function HistoryTab({
  patientId,
  lastVitals,
}: {
  patientId: string;
  lastVitals: ClinicalVitals | null;
}) {
  const { data: timeline } = useQuery({
    queryKey: ['patient-timeline', patientId],
    queryFn: () => api.patients.timeline(patientId),
  });
  return (
    <div className="space-y-3">
      {lastVitals && (
        <div className="bg-muted/40 rounded-lg px-3 py-2">
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wide">
            Oxirgi vitals · {new Date(lastVitals.recorded_at).toLocaleDateString('uz-UZ')}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {lastVitals.temperature_c != null && <span>T° {lastVitals.temperature_c}</span>}
            {lastVitals.pulse_bpm != null && <span>Puls {lastVitals.pulse_bpm}</span>}
            {lastVitals.systolic_mmhg != null && (
              <span>
                AQB {lastVitals.systolic_mmhg}/{lastVitals.diastolic_mmhg ?? '—'}
              </span>
            )}
            {lastVitals.oxygen_saturation != null && (
              <span>SpO₂ {lastVitals.oxygen_saturation}%</span>
            )}
            {lastVitals.weight_kg != null && <span>{lastVitals.weight_kg} kg</span>}
          </div>
        </div>
      )}
      <PatientHistorySummary patientId={patientId} />
      <div>
        <PanelTitle icon={<History className="h-3.5 w-3.5" />}>Klinik voqealar</PanelTitle>
        <PatientTimeline events={(timeline?.events ?? []) as TimelineEvent[]} />
      </div>
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

function useMyDiagnoses() {
  return useQuery({
    queryKey: ['diagnosis-codes', 'my'],
    queryFn: () => api.diagnosisCodes.my(),
    staleTime: 60_000,
  });
}

/** Sevimli va so'nggi tashxislar — doim ko'rinib turadi, bir bosishda tanlanadi. */
function QuickDiagnosisChips({
  currentCode,
  onPick,
}: {
  currentCode: string | null;
  onPick: (code: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const { data: mine } = useMyDiagnoses();
  const favorites = mine?.favorites ?? [];
  const recent = mine?.recent ?? [];
  const quick = [
    ...favorites.map((f) => ({ ...f, fav: true })),
    ...recent
      .filter((r) => !favorites.some((f) => f.code === r.code))
      .map((r) => ({ ...r, fav: false })),
  ].slice(0, 8);
  if (quick.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground text-[11px]">Tez-tez:</span>
      {quick.map((r) => (
        <button
          key={`${r.code_system}:${r.code}`}
          type="button"
          onClick={() => {
            onPick(r.code, r.title);
            api.diagnosisCodes
              .markUsed(r.code, r.code_system)
              .then(() => qc.invalidateQueries({ queryKey: ['diagnosis-codes', 'my'] }))
              .catch(() => undefined);
          }}
          title={r.title}
          className={cn(
            'inline-flex max-w-[14rem] items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition',
            currentCode === r.code
              ? TONE.violet.chipOn
              : cn('text-foreground/80', TONE.violet.chip),
          )}
        >
          {r.fav && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
          <span className="font-mono text-[10px] font-bold text-violet-600 dark:text-violet-400">
            {r.code}
          </span>
          <span className="truncate">{r.title}</span>
        </button>
      ))}
    </div>
  );
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

  const { data: mine } = useMyDiagnoses();
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

  return (
    <div className="relative" ref={boxRef}>
      <div className="bg-background focus-within:ring-ring flex items-center gap-2 rounded-lg border px-2 focus-within:ring-2">
        {code && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-xs font-bold text-violet-700 dark:text-violet-300">
            {code}
            <button type="button" onClick={onClearCode} title="Kodni olib tashlash">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <input
          id="dw-dx"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
          placeholder="Tashxis — yozing, ICD-10 ro‘yxatidan tavsiya chiqadi"
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
      {open && searchTerm.length >= 2 && (results ?? []).length > 0 && (
        <div className="bg-popover absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border shadow-lg">
          {(results ?? []).map((r) => (
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
                  <span className="font-mono text-xs font-bold text-violet-600 dark:text-violet-400">
                    {r.code}
                  </span>
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

// ── Anamnez paneli ──────────────────────────────────────────────────────────
function MedicalHistoryPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [allergyInput, setAllergyInput] = useState('');
  const [chronicInput, setChronicInput] = useState('');
  const { data: history } = useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => api.doctor.getHistory(patientId),
  });

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
    <div className="space-y-4 text-xs">
      <div className="text-muted-foreground bg-muted/40 rounded-lg px-2.5 py-1.5">
        Bu yerga yozilganlar bemor bannerida doim ko‘rinadi (allergiya — qizil).
      </div>
      {/* Allergiya */}
      <div>
        <div className="mb-1 font-semibold text-red-700 dark:text-red-400">Allergiya</div>
        <div className="flex flex-wrap gap-1">
          {allergies.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-950/40 dark:text-red-300"
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
            placeholder="Masalan: penitsillin"
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
        <div className="mb-1 font-semibold text-amber-700 dark:text-amber-400">
          Surunkali kasalliklar
        </div>
        <div className="flex flex-wrap gap-1">
          {chronic.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
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
            placeholder="Masalan: qandli diabet"
            value={chronicInput}
            onChange={(e) => setChronicInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addChronic()}
          />
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={addChronic}>
            +
          </Button>
        </div>
      </div>

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

function PatientFilesPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const { data: files } = useQuery({
    queryKey: ['patient-files', patientId],
    queryFn: () => api.doctor.listFiles(patientId),
  });

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
      <label className="hover:bg-accent flex cursor-pointer items-center justify-center rounded-md border border-dashed py-3">
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
        {(files ?? []).map((f) => (
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
        {(files ?? []).length === 0 && <div className="text-muted-foreground">Fayl yo&apos;q</div>}
      </div>
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
  const [name, setName] = useState(current.diagnosis_text ?? '');
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
            <div className="mt-1">Barcha bo‘limlar joriy qabuldan ko‘chiriladi.</div>
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
