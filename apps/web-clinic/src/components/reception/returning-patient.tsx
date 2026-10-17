import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookUser, History, UserCheck } from 'lucide-react';

import type { PatientMatchResult } from '@clary/api-client';
import { Button } from '@clary/ui-web';

import { api } from '@/lib/api';
import { fmtDay, fmtUzs } from '@/lib/patient-labels';

// =============================================================================
// Qabulxona: "qayta keldi" — bemor avval kelganmi?
// =============================================================================

/** Tanlangan bemor: avval necha marta kelgan, oxirgi tashrif, qarzi. */
export function ReturningPatientCard({ patientId }: { patientId: string }) {
  const { data: s } = useQuery({
    queryKey: ['patient-stats', patientId],
    queryFn: () => api.patients.stats(patientId),
    staleTime: 30_000,
  });
  if (!s) return null;
  const returning = s.visits > 0;
  return (
    <div
      className={
        'mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm ' +
        (returning
          ? 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200'
          : 'bg-muted/30')
      }
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        {returning ? <History className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
        {returning ? `Qayta kelgan bemor — avval ${s.visits} marta kelgan` : 'Birinchi tashrif'}
      </span>
      {s.last_visit_at && (
        <span className="text-xs opacity-80">Oxirgi: {fmtDay(s.last_visit_at)}</span>
      )}
      {s.in_stay && (
        <span className="text-xs font-semibold text-emerald-700">Hozir statsionarda</span>
      )}
      {s.debt_uzs > 0 && (
        <span className="text-destructive text-xs font-semibold">Qarzi: {fmtUzs(s.debt_uzs)}</span>
      )}
      {/* Tarmoq: qarz boshqa filialda — o'sha filial kassasida yopiladi */}
      {(s.debt_elsewhere ?? []).map((d) => (
        <span key={d.clinic_id} className="text-xs text-amber-700 dark:text-amber-400">
          {fmtUzs(d.debt_uzs)} — {d.clinic_name} filialida (o'sha kassada to'lanadi)
        </span>
      ))}
      <Link
        to={`/patient/${patientId}`}
        className="ml-auto inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
      >
        <BookUser className="h-3.5 w-3.5" /> Xotira daftari
      </Link>
    </div>
  );
}

/**
 * Yangi bemor kiritilayotganda: familiya + ism + telefon bazadagi bemorga mos
 * kelsa — o'sha bemor (yangi karta kerak emas).
 */
export function useIdentityMatch(lastName: string, firstName: string, phone: string) {
  const [key, setKey] = useState<{ last_name: string; first_name: string; phone: string } | null>(
    null,
  );
  useEffect(() => {
    const t = setTimeout(() => {
      const ready =
        lastName.trim().length > 1 &&
        firstName.trim().length > 1 &&
        phone.replace(/\D/g, '').length >= 7;
      setKey(
        ready
          ? { last_name: lastName.trim(), first_name: firstName.trim(), phone: phone.trim() }
          : null,
      );
    }, 400);
    return () => clearTimeout(t);
  }, [lastName, firstName, phone]);
  const { data } = useQuery({
    queryKey: ['patient-match', key],
    queryFn: () => api.patients.match(key!),
    enabled: !!key,
    staleTime: 30_000,
  });
  return key ? (data ?? null) : null;
}

export function IdentityMatchBanner({
  match,
  onPick,
}: {
  match: PatientMatchResult;
  onPick: () => void;
}) {
  if (!match.patient) return null;
  const s = match.stats;
  return (
    <div className="rounded-lg border-2 border-sky-400 bg-sky-50 p-3 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">
      <div className="flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Bu bemor avval kelgan — qayta keldi</div>
          <div className="mt-0.5">
            {match.patient.full_name}
            {match.patient.phone ? ` · ${match.patient.phone}` : ''}
          </div>
          {s && (
            <div className="mt-0.5 text-xs opacity-80">
              {s.visits} marta kelgan
              {s.last_visit_at ? ` · oxirgi ${fmtDay(s.last_visit_at)}` : ''}
              {s.debt_uzs > 0 ? ` · qarzi ${fmtUzs(s.debt_uzs)}` : ''}
              {s.in_stay ? ' · hozir statsionarda' : ''}
            </div>
          )}
        </div>
        <Button size="sm" onClick={onPick} className="shrink-0">
          Shu bemorni tanlash
        </Button>
      </div>
    </div>
  );
}
