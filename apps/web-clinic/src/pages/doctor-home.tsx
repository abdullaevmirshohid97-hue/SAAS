import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  BookText,
  Clock,
  FlaskConical,
  Keyboard,
  Lightbulb,
  PlayCircle,
  Sparkles,
  Stethoscope,
  UserCheck,
  Wallet,
} from 'lucide-react';

import { Button, cn } from '@clary/ui-web';

import { DoctorAnalyticsDialog } from '@/components/doctor/doctor-analytics-dialog';
import {
  DoctorPicker,
  DoctorTopBar,
  greeting,
  useDoctorIdentity,
} from '@/components/doctor/doctor-shell';
import { IncomingReferrals } from '@/components/doctor/incoming-referrals';
import { api } from '@/lib/api';

// =============================================================================
// Shifokor — bosh sahifa ("eshik"): bu yerdan shifokor o'z ISH STOLIGA
// (bemor qabuli) yoki KABINETIGA (shablonlar, statistika) o'tadi.
// =============================================================================

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

const minutesSince = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return Number.isFinite(m) && m >= 0 ? m : null;
};

export function DoctorHomePage() {
  const ident = useDoctorIdentity();
  if (!ident.doctor) return <DoctorPicker title="Shifokor" onPick={ident.pick} />;
  return <DoctorHome ident={ident} />;
}

function DoctorHome({ ident }: { ident: ReturnType<typeof useDoctorIdentity> }) {
  const navigate = useNavigate();
  const doctor = ident.doctor!;
  const [statsOpen, setStatsOpen] = useState(false);

  const { data: dash } = useQuery({
    queryKey: ['doctor-dashboard', doctor.id],
    queryFn: () => api.doctor.dashboard(doctor.id),
    refetchInterval: 20_000,
  });
  const { data: templates } = useQuery({
    queryKey: ['doctor-templates'],
    queryFn: () => api.doctor.listTemplates(),
  });
  const { data: room } = useQuery({
    queryKey: ['doctor-room', doctor.id],
    queryFn: () => api.doctor.room(ident.isDoctor ? undefined : doctor.id),
    staleTime: 60_000,
  });

  const live = [...(dash?.queue.serving ?? []), ...(dash?.queue.called ?? [])];
  const waiting = dash?.queue.waiting ?? [];
  const inQueue = waiting.length + (dash?.queue.called.length ?? 0);
  const current = live[0] ?? null;
  const next = waiting[0] ?? null;
  const myTemplates = (templates ?? []).filter((t) => t.is_mine).length;
  const firstName = doctor.full_name.split(/\s+/)[1] ?? doctor.full_name.split(/\s+/)[0];

  // Maslahatlar — avval holatga bog'liqlari, keyin umumiylari
  const tips: Array<{ text: React.ReactNode; tone: 'amber' | 'violet' | 'sky' }> = [];
  if (room?.available && !room.room_label)
    tips.push({
      tone: 'amber',
      text: 'Xonangizni belgilang (tepadagi sariq belgi) — TV bemorni to‘g‘ri xonaga chaqiradi.',
    });
  if (myTemplates === 0)
    tips.push({
      tone: 'violet',
      text: (
        <>
          Sizda hali shablon yo‘q. Kabinetda <b>10 ta tayyor shablon</b> bor — bittasini bosib
          o‘zingizga moslang, qabulda bir bosishda qo‘llanadi.
        </>
      ),
    });
  tips.push(
    {
      tone: 'sky',
      text: 'Ish stolida har bo‘lim ostida tez iboralar bor — bosilsa matn o‘zi yoziladi.',
    },
    {
      tone: 'sky',
      text: 'Takroriy bemorda «Oldingi xulosa» tugmasi oxirgi yozuvni bir bosishda ko‘chiradi.',
    },
  );

  return (
    <div className="space-y-5">
      <DoctorTopBar
        doctor={doctor}
        isDoctor={ident.isDoctor}
        onChangeDoctor={ident.clear}
        right={
          <Button size="sm" variant="outline" onClick={() => setStatsOpen(true)}>
            <BarChart3 className="mr-1.5 h-4 w-4" /> Statistikam
          </Button>
        }
      />

      {/* Salomlashish */}
      <section className="from-primary/10 relative overflow-hidden rounded-2xl border bg-gradient-to-br via-transparent to-teal-500/10 p-5 sm:p-6">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-muted-foreground text-sm">
              {new Date().toLocaleDateString('uz-UZ', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting()}, {firstName}!
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {inQueue > 0
                ? `Bugun navbatda ${inQueue} ta bemor sizni kutmoqda.`
                : 'Hozircha navbat bo‘sh — kabinetda shablonlarni tayyorlab olish uchun yaxshi vaqt.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat
              icon={<UserCheck className="h-4 w-4" />}
              label="Ko‘rildi"
              value={String(dash?.queue.served_today ?? 0)}
            />
            <MiniStat
              icon={<Clock className="h-4 w-4" />}
              label="Navbatda"
              value={String(inQueue)}
            />
            <MiniStat
              icon={<Wallet className="h-4 w-4" />}
              label="Tushum"
              value={fmt(dash?.today_income_uzs ?? 0)}
            />
            <MiniStat
              icon={<FlaskConical className="h-4 w-4" />}
              label="Lab kutilmoqda"
              value={String(dash?.pending_lab ?? 0)}
            />
          </div>
        </div>
        <Stethoscope className="text-primary/5 pointer-events-none absolute -bottom-6 -right-4 h-40 w-40" />
      </section>

      {/* Qabulda turgan bemor — davom ettirish */}
      {current && (
        <Link
          to="/doctor/ish-stoli"
          className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900 transition hover:shadow-md dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
        >
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {current.status === 'serving' ? 'Qabulda' : 'Chaqirilgan'}:{' '}
              {current.patient?.full_name ?? '—'}
              {current.ticket_no ? ` · № ${current.ticket_no}` : ''}
            </div>
            <div className="text-xs opacity-80">Qabulni davom ettirish uchun bosing</div>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </Link>
      )}

      {/* Ikki eshik: Ish stoli | Kabinetim */}
      <div className="grid gap-4 md:grid-cols-2">
        <DoorCard
          to="/doctor/ish-stoli"
          tone="primary"
          icon={<Stethoscope className="h-7 w-7" />}
          title="Ish stoli"
          desc="Bemorni qabul qilish: shikoyat, ko‘rik, tashxis, retsept, yo‘llanma va xulosa — bitta oynada."
          facts={[
            `Navbatda: ${inQueue}`,
            next
              ? `Keyingi: ${next.ticket_no ? `№${next.ticket_no} ` : ''}${next.patient?.full_name ?? ''}`
              : 'Kutayotgan bemor yo‘q',
          ]}
          cta={current ? 'Qabulni davom ettirish' : 'Qabulni boshlash'}
        />
        <DoorCard
          to="/doctor/kabinet"
          tone="violet"
          icon={<BookText className="h-7 w-7" />}
          title="Kabinetim"
          desc="Shaxsiy shablonlaringiz, tayyor shablonlar kutubxonasi va oylik statistikangiz."
          facts={[`Shablonlarim: ${myTemplates}`, 'Tayyor shablonlar: 10']}
          cta="Kabinetga o‘tish"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Navbat ko'rinishi */}
        <section className="bg-card rounded-xl border p-4 shadow-sm lg:self-start">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Navbatdagi bemorlar</h2>
            {waiting.length > 0 && (
              <Button size="sm" onClick={() => navigate('/doctor/ish-stoli')}>
                <PlayCircle className="mr-1.5 h-4 w-4" /> Qabulga o‘tish
              </Button>
            )}
          </div>
          {waiting.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-sm">
              Kutayotgan bemor yo‘q. Qabulxona sizga bemor yozganda shu yerda paydo bo‘ladi.
            </div>
          ) : (
            <div className="divide-y">
              {waiting.slice(0, 8).map((r) => {
                const w = minutesSince(r.joined_at);
                return (
                  <div key={r.id} className="flex items-center gap-3 py-2">
                    <span className="bg-muted flex h-8 min-w-[2.5rem] items-center justify-center rounded-md px-1.5 font-mono text-xs font-bold">
                      {r.ticket_no ?? '—'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {r.patient?.full_name ?? '—'}
                      </div>
                      {r.service_name && (
                        <div className="text-muted-foreground truncate text-xs">
                          {r.service_name}
                        </div>
                      )}
                    </div>
                    {w != null && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                          w >= 30
                            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                            : w >= 15
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                        )}
                      >
                        {w} daq
                      </span>
                    )}
                  </div>
                );
              })}
              {waiting.length > 8 && (
                <div className="text-muted-foreground pt-2 text-xs">
                  va yana {waiting.length - 8} ta bemor
                </div>
              )}
            </div>
          )}
        </section>

        {/* Maslahatlar */}
        <aside className="space-y-4">
          <section className="bg-card rounded-xl border p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-amber-500" /> Maslahatlar
            </h2>
            <ul className="space-y-2">
              {tips.map((t, i) => (
                <li
                  key={i}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs leading-relaxed',
                    t.tone === 'amber' &&
                      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100',
                    t.tone === 'violet' &&
                      'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100',
                    t.tone === 'sky' && 'bg-muted/40',
                  )}
                >
                  {t.text}
                </li>
              ))}
            </ul>
            {myTemplates === 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => navigate('/doctor/kabinet')}
              >
                <Sparkles className="mr-1.5 h-4 w-4" /> Tayyor shablonlarni ko‘rish
              </Button>
            )}
          </section>
          <section className="bg-card rounded-xl border p-4 shadow-sm">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Keyboard className="h-4 w-4" /> Tezkor tugmalar
            </h2>
            <dl className="space-y-1.5 text-xs">
              <Shortcut k="N" text="Keyingi bemorni chaqirish" />
              <Shortcut k="Alt + 1…4" text="Bo‘limga o‘tish (shikoyat → davolash)" />
              <Shortcut k="Ctrl + Enter" text="Qabulni yakunlash" />
            </dl>
          </section>
        </aside>
      </div>

      <IncomingReferrals doctorId={doctor.id} />

      {statsOpen && (
        <DoctorAnalyticsDialog
          doctorId={doctor.id}
          doctorName={doctor.full_name}
          onClose={() => setStatsOpen(false)}
        />
      )}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-background/70 min-w-[6.5rem] rounded-xl border px-3 py-2 backdrop-blur">
      <div className="text-muted-foreground flex items-center gap-1 text-[10px] uppercase tracking-wide">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}

function DoorCard({
  to,
  tone,
  icon,
  title,
  desc,
  facts,
  cta,
}: {
  to: string;
  tone: 'primary' | 'violet';
  icon: React.ReactNode;
  title: string;
  desc: string;
  facts: string[];
  cta: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'bg-card group relative flex flex-col gap-4 overflow-hidden rounded-2xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg',
        tone === 'primary' ? 'hover:border-primary/50' : 'hover:border-violet-400/60',
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md',
            tone === 'primary'
              ? 'from-primary bg-gradient-to-br to-teal-500'
              : 'bg-gradient-to-br from-violet-500 to-fuchsia-500',
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold">{title}</div>
          <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed">{desc}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {facts.map((f) => (
          <span key={f} className="bg-muted rounded-full px-2.5 py-0.5 text-xs">
            {f}
          </span>
        ))}
      </div>
      <div
        className={cn(
          'mt-auto inline-flex items-center gap-1.5 text-sm font-semibold',
          tone === 'primary' ? 'text-primary' : 'text-violet-600 dark:text-violet-400',
        )}
      >
        {cta}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function Shortcut({ k, text }: { k: string; text: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{text}</dt>
      <dd>
        <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">{k}</kbd>
      </dd>
    </div>
  );
}
