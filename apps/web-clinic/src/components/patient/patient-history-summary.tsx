import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BedDouble,
  BookUser,
  ChevronDown,
  ClipboardList,
  History,
  Loader2,
  Plus,
  Stethoscope,
  UserCheck,
  UserPlus,
  Wallet,
} from 'lucide-react';

import { cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import { fmtDay, fmtUzs } from '@/lib/patient-labels';

// =============================================================================
// Bemor tarixi — qisqa ko'rinish (qabulxona o'ng paneli, shifokor ish stoli)
// =============================================================================
// Bitta qarashda: avval kelganmi, qarzi, qaysi shifokorlarda bo'lgan, qanday
// xizmatlardan foydalangan, oxirgi tashxislar. Qabulxonada shifokor/xizmat
// yonidagi tugma bilan bir bosishda qayta yo'naltirish mumkin.
// Manba — /patients/:id/history ("Xotira daftari" bilan bir xil kesh).

export type HistoryAction = { label: string; onClick: () => void; active?: boolean } | null;

const daysAgo = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (!Number.isFinite(d) || d < 0) return null;
  if (d === 0) return 'bugun';
  if (d === 1) return 'kecha';
  if (d < 31) return `${d} kun oldin`;
  if (d < 365) return `${Math.floor(d / 30)} oy oldin`;
  return `${Math.floor(d / 365)} yil oldin`;
};

export function PatientHistorySummary({
  patientId,
  doctorAction,
  serviceAction,
  className,
}: {
  patientId: string;
  /** Shifokor nomi bo'yicha tugma (masalan, "Shu shifokorga yozish"). */
  doctorAction?: (name: string) => HistoryAction;
  /** Xizmat nomi bo'yicha tugma (masalan, savatchaga qo'shish). */
  serviceAction?: (name: string) => HistoryAction;
  className?: string;
}) {
  const [showVisits, setShowVisits] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['patient-memory', patientId],
    queryFn: () => api.patients.history(patientId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className={cn('bg-card rounded-xl border p-4', className)}>
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Bemor tarixi yuklanmoqda…
        </div>
      </div>
    );
  }
  if (isError || !data) return null;

  const s = data.summary;
  const returning = s.visits > 0 || data.visits.length > 0;
  const debtElsewhere = s.debt_elsewhere ?? [];
  const doctors = [...data.doctors].sort((a, b) => b.last_at.localeCompare(a.last_at)).slice(0, 5);
  const services = [...data.services]
    .sort((a, b) => b.last_at.localeCompare(a.last_at))
    .slice(0, 6);
  const diagnoses = data.diagnoses.filter((d) => d.code || d.text).slice(0, 3);
  const lastVisit = data.visits[0];

  return (
    <div
      className={cn(
        'bg-card overflow-hidden rounded-xl border shadow-sm',
        s.debt_uzs > 0 && 'border-red-300 dark:border-red-900/60',
        className,
      )}
    >
      {/* Sarlavha */}
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-2',
          returning ? 'bg-sky-50 dark:bg-sky-950/30' : 'bg-muted/40',
        )}
      >
        {returning ? (
          <History className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
        ) : (
          <UserCheck className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">
            {returning ? `Qayta kelgan · ${s.visits} marta` : 'Birinchi tashrif'}
          </div>
          {s.last_visit_at && (
            <div className="text-muted-foreground text-[11px]">
              Oxirgi: {fmtDay(s.last_visit_at)} ({daysAgo(s.last_visit_at)})
            </div>
          )}
        </div>
        <Link
          to={`/patient/${patientId}`}
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-[11px] font-medium"
          title="To'liq tarix — Xotira daftari"
        >
          <BookUser className="h-3.5 w-3.5" /> To'liq
        </Link>
      </div>

      <div className="space-y-3 p-3 text-sm">
        {/* Qarz va holat — eng muhimi tepada */}
        {(s.debt_uzs > 0 || debtElsewhere.length > 0 || s.in_stay) && (
          <div className="space-y-1.5">
            {s.debt_uzs > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-white">
                <Wallet className="h-4 w-4 shrink-0" />
                <span className="text-xs">Qarzi</span>
                <span className="ml-auto font-bold">{fmtUzs(s.debt_uzs)}</span>
              </div>
            )}
            {debtElsewhere.map((d) => (
              <div
                key={d.clinic_id}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
              >
                {fmtUzs(d.debt_uzs)} — {d.clinic_name} filialida (o'sha kassada to'lanadi)
              </div>
            ))}
            {s.in_stay && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                <BedDouble className="h-3.5 w-3.5" /> Hozir statsionarda yotibdi
              </div>
            )}
          </div>
        )}

        {!returning && (
          <p className="text-muted-foreground text-xs">
            Bu bemor klinikaga birinchi marta kelmoqda — oldingi tashrif, xizmat va tashxis yo'q.
          </p>
        )}

        {/* Oxirgi tashrif */}
        {lastVisit && (
          <div className="bg-muted/40 rounded-lg px-3 py-2">
            <div className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
              Oxirgi tashrif · {fmtDay(lastVisit.date)}
            </div>
            <div className="mt-0.5 text-xs leading-relaxed">
              {lastVisit.services.length > 0 ? lastVisit.services.join(', ') : '—'}
            </div>
            {lastVisit.doctors.length > 0 && (
              <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                <Stethoscope className="h-3 w-3" /> {lastVisit.doctors.join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Shifokorlari */}
        {doctors.length > 0 && (
          <Block title="Qaysi shifokorlarda bo'lgan" icon={<Stethoscope className="h-3.5 w-3.5" />}>
            {doctors.map((d) => {
              const act = doctorAction?.(d.name) ?? null;
              return (
                <Row
                  key={d.name}
                  main={d.name}
                  sub={`${d.visits} marta · ${fmtDay(d.last_at)}`}
                  action={act}
                  actionIcon={<UserPlus className="h-3.5 w-3.5" />}
                />
              );
            })}
          </Block>
        )}

        {/* Xizmatlari */}
        {services.length > 0 && (
          <Block title="Foydalangan xizmatlari" icon={<ClipboardList className="h-3.5 w-3.5" />}>
            {services.map((x) => {
              const act = serviceAction?.(x.name) ?? null;
              return (
                <Row
                  key={x.name}
                  main={x.count > 1 ? `${x.name} ×${x.count}` : x.name}
                  sub={[fmtDay(x.last_at), x.doctors[0]].filter(Boolean).join(' · ')}
                  action={act}
                  actionIcon={<Plus className="h-3.5 w-3.5" />}
                />
              );
            })}
          </Block>
        )}

        {/* Oxirgi tashxislar */}
        {diagnoses.length > 0 && (
          <Block title="Oxirgi tashxislar" icon={<History className="h-3.5 w-3.5" />}>
            {diagnoses.map((d, i) => (
              <div key={i} className="rounded-md border px-2 py-1 text-xs">
                <div className="flex items-center gap-1.5">
                  {d.code && (
                    <span className="font-mono font-bold text-violet-600 dark:text-violet-400">
                      {d.code}
                    </span>
                  )}
                  <span className="truncate">{d.text ?? '—'}</span>
                </div>
                <div className="text-muted-foreground text-[10px]">
                  {fmtDay(d.date)}
                  {d.doctor ? ` · ${d.doctor}` : ''}
                </div>
              </div>
            ))}
          </Block>
        )}

        {/* Barcha tashriflar — yig'ma */}
        {data.visits.length > 1 && (
          <div>
            <button
              type="button"
              onClick={() => setShowVisits((v) => !v)}
              className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
            >
              Tashriflar ({data.visits.length})
              <ChevronDown
                className={cn('ml-auto h-3.5 w-3.5 transition', showVisits && 'rotate-180')}
              />
            </button>
            {showVisits && (
              <div className="mt-1.5 max-h-64 space-y-1 overflow-auto">
                {data.visits.slice(0, 30).map((v) => (
                  <div key={v.date} className="rounded-md border px-2 py-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{fmtDay(v.date)}</span>
                      {v.amount_uzs > 0 && (
                        <span className="text-muted-foreground">{fmtUzs(v.amount_uzs)}</span>
                      )}
                    </div>
                    <div className="text-muted-foreground truncate text-[11px]">
                      {[v.services.join(', '), v.doctors.join(', ')].filter(Boolean).join(' — ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Block({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  main,
  sub,
  action,
  actionIcon,
}: {
  main: string;
  sub: string;
  action: HistoryAction;
  actionIcon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{main}</div>
        {sub && <div className="text-muted-foreground truncate text-[10px]">{sub}</div>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.active}
          title={action.label}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition',
            action.active
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'text-primary border-primary/30 hover:bg-primary/10',
          )}
        >
          {actionIcon}
          <span className="hidden sm:inline">{action.label}</span>
        </button>
      )}
    </div>
  );
}
