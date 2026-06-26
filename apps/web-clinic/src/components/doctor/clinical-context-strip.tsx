import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Droplet, HeartPulse, Lightbulb, Wallet } from 'lucide-react';

import { api } from '@/lib/api';

// Klinik xavfsizlik chizig'i (Epic "safety banner") — qon guruhi, allergiya (qizil),
// surunkali kasalliklar + CDS eslatma, qarz. Konsultatsiya tepasida doimiy ko'rinadi.

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const y = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 864e5));
  return Number.isFinite(y) ? y : null;
}

// CDS — surunkali kasallikka bog'liq eslatmalar (oddiy keyword; ontologiya v2)
const CHRONIC_REMINDERS: Array<{ match: RegExp; tip: string }> = [
  { match: /diabet|qand|saxar|сахар/i, tip: 'HbA1c / glyukoza tekshiring' },
  { match: /gipertenz|gipertoni|bosim|давлен|hypertension/i, tip: 'Qon bosimini nazorat qiling' },
  { match: /astma|copd|sook|xobl/i, tip: 'SpO₂ va nafasni baholang' },
];

export function ClinicalContextStrip({ patientId }: { patientId: string }) {
  const { data: timeline } = useQuery({
    queryKey: ['patient-timeline', patientId],
    queryFn: () => api.patients.timeline(patientId),
  });
  const { data: history } = useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => api.doctor.getHistory(patientId),
  });
  const { data: financial } = useQuery({
    queryKey: ['patient-financial', patientId],
    queryFn: () => api.doctor.financial(patientId),
  });

  const p = timeline?.patient;
  const allergies = (history?.allergies ?? []) as string[];
  const chronic = (history?.chronic_conditions ?? []) as string[];
  const blood = history?.blood_type as string | null | undefined;
  const debt = financial?.outstanding_debt_uzs ?? 0;
  const age = ageOf(p?.dob);

  const reminders = Array.from(
    new Set(chronic.flatMap((c) => CHRONIC_REMINDERS.filter((r) => r.match.test(c)).map((r) => r.tip))),
  );

  const genderLabel = p?.gender === 'male' ? 'Erkak' : p?.gender === 'female' ? 'Ayol' : p?.gender;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm">
      <span className="font-semibold">{p?.full_name ?? '—'}</span>
      {age != null && (
        <span className="text-xs text-muted-foreground">
          {age} yosh{genderLabel ? ` · ${genderLabel}` : ''}
        </span>
      )}

      {blood && (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
          <Droplet className="h-3 w-3" /> {blood}
        </span>
      )}

      {allergies.length > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
          <AlertTriangle className="h-3 w-3" /> Allergiya: {allergies.join(', ')}
        </span>
      )}

      {chronic.map((c) => (
        <span key={c} className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
          <HeartPulse className="h-3 w-3" /> {c}
        </span>
      ))}

      {debt > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
          <Wallet className="h-3 w-3" /> Qarz {fmt(debt)} so&apos;m
        </span>
      )}

      {reminders.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
          <Lightbulb className="h-3 w-3" /> {reminders.join(' · ')}
        </span>
      )}
    </div>
  );
}
