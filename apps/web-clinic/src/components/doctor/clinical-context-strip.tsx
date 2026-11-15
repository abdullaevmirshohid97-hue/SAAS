import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Droplet, HeartPulse, Wallet } from 'lucide-react';

import { api } from '@/lib/api';

// Klinik xavfsizlik belgilari (Epic "safety banner") — qon guruhi, allergiya
// (qizil), surunkali kasalliklar + CDS eslatma, qarz. Ish stolida bemor
// banneri ichida doimiy ko'rinadi.

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

// CDS — surunkali kasallikka bog'liq eslatmalar (oddiy keyword; ontologiya v2)
const CHRONIC_REMINDERS: Array<{ match: RegExp; tip: string }> = [
  { match: /diabet|qand|saxar|сахар/i, tip: 'HbA1c / glyukoza tekshiring' },
  { match: /gipertenz|gipertoni|bosim|давлен|hypertension/i, tip: 'Qon bosimini nazorat qiling' },
  { match: /astma|copd|sook|xobl/i, tip: 'SpO₂ va nafasni baholang' },
];

/** Bemorning xavfsizlik ma'lumoti (keshdagi so'rovlar — qayta yuklanmaydi). */
export function usePatientSafety(patientId: string) {
  const { data: history } = useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => api.doctor.getHistory(patientId),
    enabled: !!patientId,
  });
  const { data: financial } = useQuery({
    queryKey: ['patient-financial', patientId],
    queryFn: () => api.doctor.financial(patientId),
    enabled: !!patientId,
  });
  const allergies = (history?.allergies ?? []) as string[];
  const chronic = (history?.chronic_conditions ?? []) as string[];
  const blood = (history?.blood_type as string | null | undefined) ?? null;
  const debt = financial?.outstanding_debt_uzs ?? 0;
  const reminders = Array.from(
    new Set(
      chronic.flatMap((c) => CHRONIC_REMINDERS.filter((r) => r.match.test(c)).map((r) => r.tip)),
    ),
  );
  return { allergies, chronic, blood, debt, reminders };
}

export function PatientSafetyChips({ patientId }: { patientId: string }) {
  const { allergies, chronic, blood, debt } = usePatientSafety(patientId);
  if (!blood && allergies.length === 0 && chronic.length === 0 && debt <= 0) {
    return (
      <span className="text-muted-foreground text-xs">
        Allergiya va surunkali kasallik qayd etilmagan
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allergies.length > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
          <AlertTriangle className="h-3 w-3" /> Allergiya: {allergies.join(', ')}
        </span>
      )}
      {blood && (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
          <Droplet className="h-3 w-3" /> {blood}
        </span>
      )}
      {chronic.map((c) => (
        <span
          key={c}
          className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <HeartPulse className="h-3 w-3" /> {c}
        </span>
      ))}
      {debt > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-300 px-2 py-0.5 text-xs font-semibold text-red-600 dark:border-red-900/60 dark:text-red-400">
          <Wallet className="h-3 w-3" /> Qarz {fmt(debt)} so&apos;m
        </span>
      )}
      {/* CDS eslatmalari (reminders) — ish stolidagi «Maslahatlar»da */}
    </div>
  );
}
