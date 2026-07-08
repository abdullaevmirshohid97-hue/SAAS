import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Loader2 } from 'lucide-react';

import { labPublicApi, type PublicLabResult } from '@/lib/api';

const GENDER_LABEL: Record<string, string> = {
  male: 'Erkak',
  female: 'Ayol',
  other: 'Boshqa',
  unknown: '—',
};

function calcAge(dob?: string | null): string {
  if (!dob) return '—';
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '—';
  const years = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  return `${years} yosh`;
}

function fullName(p?: PublicLabResult['patient']): string {
  if (!p) return '—';
  const parts = [p.last_name, p.first_name, p.patronymic].filter(Boolean).join(' ');
  return parts.length > 0 ? parts : (p.full_name ?? '—');
}

export function PublicLabResultPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-lab-result', token],
    queryFn: () => labPublicApi.result(token as string),
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yuklanmoqda…
      </div>
    );
  }

  if (error || !data) {
    const notReady = error instanceof Error && error.message === 'NATIJA_TAYYOR_EMAS';
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <FlaskConical className="mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">
          {notReady ? 'Natija hali tayyor emas' : 'Natija topilmadi'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {notReady
            ? 'Laboratoriya natijasi hali yakunlanmagan. Iltimos, keyinroq qayta urinib ko‘ring.'
            : 'Havola noto‘g‘ri yoki eskirgan bo‘lishi mumkin. Klinikaga murojaat qiling.'}
        </p>
      </div>
    );
  }

  const clinic = data.clinic;
  const patient = data.patient;
  const gender = patient?.gender ?? 'unknown';
  const brand = clinic?.primary_color ?? '#2563EB';
  const clinicAddress = [clinic?.address, clinic?.city, clinic?.region].filter(Boolean).join(', ');
  const issuedAt = new Date(data.reported_at ?? data.created_at).toLocaleString('uz-UZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="mx-auto max-w-2xl bg-white px-4 py-6 text-[#111]">
      {/* Klinika header */}
      <header className="flex items-start justify-between gap-3 border-b-2 pb-3" style={{ borderColor: brand }}>
        <div className="flex items-center gap-3">
          {clinic?.logo_url ? (
            <img src={clinic.logo_url} alt={clinic.name} className="h-12 w-auto object-contain" />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg text-xl font-bold text-white"
              style={{ background: brand }}
            >
              {(clinic?.name ?? 'C').charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-base font-bold" style={{ color: brand }}>
              {clinic?.name ?? 'Klinika'}
            </div>
            {clinicAddress && <div className="text-[11px] text-[#555]">{clinicAddress}</div>}
            {clinic?.phone && <div className="text-[11px] text-[#555]">Tel: {clinic.phone}</div>}
          </div>
        </div>
        <div className="text-right text-[11px] text-[#555]">
          <div className="text-xs font-bold text-black">LAB NATIJA</div>
          <div>№ {data.id.slice(0, 8).toUpperCase()}</div>
          <div>{issuedAt}</div>
        </div>
      </header>

      {/* Bemor */}
      <section className="mt-4 rounded-md border bg-[#f7f7f7] p-3 text-sm">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-[#777]">Bemor</div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 sm:col-span-1">
            <div className="text-[10px] text-[#999]">F.I.SH.</div>
            <div className="font-semibold">{fullName(patient)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#999]">Yoshi</div>
            <div className="font-semibold">{calcAge(patient?.dob)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#999]">Jinsi</div>
            <div className="font-semibold">{GENDER_LABEL[gender] ?? '—'}</div>
          </div>
        </div>
      </section>

      {/* Natijalar */}
      <section className="mt-4">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-[#777]">
          Tahlil natijalari ({data.items?.length ?? 0} ta)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left" style={{ borderTop: `2px solid ${brand}`, borderBottom: `2px solid ${brand}` }}>
                <th className="py-2 pr-2">Tahlil</th>
                <th className="py-2 px-2 text-right">Natija</th>
                <th className="py-2 pl-2">Norma ({GENDER_LABEL[gender] ?? '—'})</th>
              </tr>
            </thead>
            <tbody>
              {(data.items ?? []).map((it) => {
                const result = it.results?.[0];
                const ref =
                  gender === 'female'
                    ? it.test?.reference_range_female ?? it.test?.reference_range_male ?? '—'
                    : it.test?.reference_range_male ?? it.test?.reference_range_female ?? '—';
                const abnormal = !!result?.is_abnormal;
                return (
                  <tr key={it.id} className="border-b border-[#eee] align-top">
                    <td className="py-2 pr-2">{it.name_snapshot}</td>
                    <td
                      className="py-2 px-2 text-right font-semibold"
                      style={{ color: abnormal ? '#b00' : '#000' }}
                    >
                      {result?.value ?? '—'}
                      {result?.unit ? ` ${result.unit}` : it.test?.unit ? ` ${it.test.unit}` : ''}
                      {abnormal ? ' ⚠' : ''}
                    </td>
                    <td className="py-2 pl-2 text-[12px] text-[#555]">{ref}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-6 border-t pt-3 text-center text-[11px] text-[#888]">
        <p className="italic">
          ⚠ Ushbu natijalarni faqat shifokoringiz bilan birga sharhlang. Bu sahifa tibbiy maslahat emas.
        </p>
        <p className="mt-1">{clinic?.name ?? 'Clary'} · Clary Care</p>
      </footer>
    </div>
  );
}
