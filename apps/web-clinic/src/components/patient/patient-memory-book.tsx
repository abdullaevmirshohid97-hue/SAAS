import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bed,
  CalendarDays,
  CreditCard,
  ExternalLink,
  HeartPulse,
  Pill,
  Stethoscope,
  Wallet,
} from 'lucide-react';

import type { PatientHistory } from '@clary/api-client';
import { Badge, StatCard, cn } from '@clary/ui-web';

import { api } from '@/lib/api';
import { STAY_REASON_LABEL, fmtDay, fmtUzs, payLabel } from '@/lib/patient-labels';

// =============================================================================
// Bemor xotira daftari — bitta qarashda: necha marta kelgan, qaysi shifokorlar,
// qanday xizmatlar, kasallik tarixi, dorilar, statsionar (tashxis, necha kun),
// qarz va to'lov usullari.
// =============================================================================

export function PatientMemoryBook({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => api.patients.history(patientId),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted/50 h-20 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="text-destructive rounded-lg border border-dashed p-6 text-center text-sm">
        Ma&lsquo;lumot yuklanmadi: {(error as Error)?.message ?? 'xato'}
      </div>
    );
  }
  return <MemoryBookView h={data} />;
}

function Section({
  icon,
  title,
  count,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border p-4', className)}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
        {count != null && <span className="text-muted-foreground font-normal">· {count}</span>}
      </h3>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => (
  <div className="text-muted-foreground py-3 text-center text-sm">{text}</div>
);

const SOURCE_LABEL: Record<PatientHistory['diagnoses'][number]['source'], string> = {
  outpatient: 'Ambulator',
  inpatient: 'Statsionar',
  admission: 'Yotqizish sababi',
};

function MemoryBookView({ h }: { h: PatientHistory }) {
  const s = h.summary;
  return (
    <div className="space-y-4">
      {h.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Ba&lsquo;zi bo&lsquo;limlar to&lsquo;liq yuklanmadi: {h.warnings.join('; ')}
        </div>
      )}

      {/* Asosiy ko'rsatkichlar */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Necha marta kelgan"
          value={`${s.visits} marta`}
          hint={
            s.first_visit_at
              ? `Birinchi: ${fmtDay(s.first_visit_at)} · Oxirgi: ${fmtDay(s.last_visit_at)}`
              : 'Hali tashrif yo‘q'
          }
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <StatCard
          label="Jami to‘lagan"
          value={fmtUzs(s.paid_uzs)}
          icon={<Wallet className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Qarzi"
          value={s.debt_uzs > 0 ? fmtUzs(s.debt_uzs) : 'Qarzi yo‘q'}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={s.debt_uzs > 0 ? 'danger' : 'default'}
          hint={s.balance_uzs > 0 ? `Oldindan to‘lov: ${fmtUzs(s.balance_uzs)}` : undefined}
        />
        <StatCard
          label="Statsionar"
          value={s.in_stay ? 'Hozir yotibdi' : s.stays > 0 ? `${s.stays} marta` : 'Yotmagan'}
          icon={<Bed className="h-4 w-4" />}
          tone={s.in_stay ? 'info' : 'default'}
        />
      </div>

      {/* To'lov usullari */}
      <Section
        icon={<CreditCard className="text-muted-foreground h-4 w-4" />}
        title="To‘lov usullari"
      >
        {h.payment_methods.length === 0 ? (
          <Empty text="To‘lov yo‘q" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {h.payment_methods.map((m) => (
              <div key={m.method} className="bg-muted/40 rounded-lg border px-3 py-2 text-sm">
                <div className="font-medium">{payLabel(m.method)}</div>
                <div className="text-muted-foreground text-xs">
                  {m.count} marta · {fmtUzs(m.amount_uzs)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          icon={<Stethoscope className="text-muted-foreground h-4 w-4" />}
          title="Qaysi shifokorlarda bo‘lgan"
          count={h.doctors.length}
        >
          {h.doctors.length === 0 ? (
            <Empty text="Shifokor ko‘rigi qayd etilmagan" />
          ) : (
            <ul className="divide-y">
              {h.doctors.map((d) => (
                <li key={d.name} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {d.visits} marta · oxirgi {fmtDay(d.last_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          icon={<HeartPulse className="text-muted-foreground h-4 w-4" />}
          title="Qanday xizmatlardan foydalangan"
          count={h.services.length}
        >
          {h.services.length === 0 ? (
            <Empty text="Xizmat yo‘q" />
          ) : (
            <ul className="max-h-72 divide-y overflow-auto">
              {h.services.map((sv) => (
                <li key={sv.name} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{sv.name}</span>
                    <span className="shrink-0 text-xs">
                      {sv.count} marta · {fmtUzs(sv.amount_uzs)}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    Oxirgi: {fmtDay(sv.last_at)}
                    {sv.doctors.length > 0 && ` · ${sv.doctors.join(', ')}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          icon={<HeartPulse className="h-4 w-4 text-rose-600" />}
          title="Kasallik tarixi (tashxislar)"
          count={h.diagnoses.length}
        >
          {h.diagnoses.length === 0 ? (
            <Empty text="Tashxis qayd etilmagan" />
          ) : (
            <ul className="max-h-80 divide-y overflow-auto">
              {h.diagnoses.map((d, i) => (
                <li key={i} className="py-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.code && (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {d.code}
                      </Badge>
                    )}
                    <span className="font-medium">{d.text ?? '—'}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {fmtDay(d.date)} · {SOURCE_LABEL[d.source]}
                    {d.doctor && ` · ${d.doctor}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          icon={<Pill className="h-4 w-4 text-sky-600" />}
          title="Qanday dorilar iste‘mol qilgan"
          count={h.medications.length}
        >
          {h.medications.length === 0 ? (
            <Empty text="Dori yozilmagan / olinmagan" />
          ) : (
            <ul className="max-h-80 divide-y overflow-auto">
              {h.medications.map((m, i) => (
                <li key={i} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">× {m.quantity}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {fmtDay(m.date)} ·{' '}
                    {m.source === 'prescription'
                      ? `Retsept${m.doctor ? ` (${m.doctor})` : ''}`
                      : 'Dorixonadan olingan'}
                    {m.dosage && ` · ${m.dosage}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Statsionar davolanish */}
      <Section
        icon={<Bed className="h-4 w-4 text-emerald-600" />}
        title="Statsionar davolanish"
        count={h.stays.length}
      >
        {h.stays.length === 0 ? (
          <Empty text="Statsionarda davolanmagan" />
        ) : (
          <div className="space-y-2">
            {h.stays.map((st) => (
              <div key={st.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">
                    {fmtDay(st.admitted_at)} →{' '}
                    {st.discharged_at ? fmtDay(st.discharged_at) : 'hozir'}
                    <span className="text-muted-foreground font-normal"> · {st.days} kun</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {st.status === 'admitted' ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        Davolanmoqda
                      </Badge>
                    ) : (
                      st.discharge_reason && (
                        <Badge variant="secondary">
                          {STAY_REASON_LABEL[st.discharge_reason] ?? st.discharge_reason}
                        </Badge>
                      )
                    )}
                    {st.discharged_with_debt && (
                      <Badge variant="destructive">Qarz bilan chiqqan</Badge>
                    )}
                    <Link
                      to={`/inpatient/stays/${st.id}`}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                    >
                      Karta <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {[
                    st.room
                      ? `${st.room.floor ? `${st.room.floor}-qavat · ` : ''}№ ${st.room.number}${st.bed_no ? ` · ${st.bed_no}-yotoq` : ''}`
                      : null,
                    st.doctor ? `Shifokor: ${st.doctor}` : null,
                    st.total_cost_uzs > 0 ? `Summa: ${fmtUzs(st.total_cost_uzs)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {st.admission_reason && (
                  <div className="mt-1.5">
                    <span className="text-muted-foreground text-xs">Yotqizish sababi: </span>
                    {st.admission_reason}
                  </div>
                )}
                {st.diagnoses.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Tashxislar:</span>
                    {st.diagnoses.map((d, i) => (
                      <Badge key={i} variant="outline" className="text-[11px]">
                        {[d.code, d.text].filter(Boolean).join(' — ')}
                      </Badge>
                    ))}
                  </div>
                )}
                {st.discharge_summary && (
                  <div className="bg-muted/40 mt-1.5 rounded p-2 text-xs">
                    <span className="font-medium">Xulosa: </span>
                    {st.discharge_summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Tashriflar tarixi */}
      <Section
        icon={<CalendarDays className="text-muted-foreground h-4 w-4" />}
        title="Tashriflar tarixi"
        count={h.visits.length}
      >
        {h.visits.length === 0 ? (
          <Empty text="Tashrif yo‘q" />
        ) : (
          <ul className="max-h-96 divide-y overflow-auto">
            {h.visits.map((v) => (
              <li key={v.date} className="grid grid-cols-[96px_1fr_auto] gap-3 py-2 text-sm">
                <span className="font-medium">{fmtDay(v.date)}</span>
                <div className="min-w-0">
                  <div className="truncate">{v.services.join(', ') || '—'}</div>
                  {v.doctors.length > 0 && (
                    <div className="text-muted-foreground text-xs">{v.doctors.join(', ')}</div>
                  )}
                </div>
                <div className="text-right">
                  <div>{v.amount_uzs > 0 ? fmtUzs(v.amount_uzs) : '—'}</div>
                  <div className="text-muted-foreground text-xs">
                    {v.methods.map(payLabel).join(', ')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
