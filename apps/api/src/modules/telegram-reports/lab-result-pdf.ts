// =============================================================================
// LABORATORIYA NATIJASI — bemor bo'yicha bitta PDF (Telegram bot yuboradi)
// =============================================================================
// Klinika admini botdan bemorni tanlaydi va shu PDF'ni oladi — keyin uni
// bemorning Telegramiga oddiy forward qiladi. Kompyuter ochish shart emas.
//
// MUHIM: normani tanlash mantiqi patient.clary.uz/r/<token> sahifasi bilan
// AYNAN BIR XIL bo'lishi shart — bemor QR orqali ochganda PDF'dagidan boshqa
// norma ko'rsa, bu klinikaga ishonchni yo'qotadi. Shuning uchun mantiq shu
// yerda sof funksiya sifatida ajratilgan va testlanadi.
// =============================================================================

import { buildDailyReportPdf, type PdfColumn } from './report-pdf';

/** 18 yoshgacha — bola normasi (web-patient bilan bir xil). */
export const CHILD_AGE_MAX = 18;

export type LabPatient = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  patronymic?: string | null;
  dob?: string | null;
  gender?: string | null;
};

export type LabTestRef = {
  name_i18n?: Record<string, string> | null;
  unit?: string | null;
  reference_range_male?: string | null;
  reference_range_female?: string | null;
  reference_range_child?: string | null;
} | null;

export type LabItem = {
  name_snapshot?: string | null;
  test?: LabTestRef;
  results?: Array<{
    value?: string | null;
    unit?: string | null;
    is_abnormal?: boolean | null;
    is_final?: boolean | null;
    flag?: string | null;
  }> | null;
};

export type LabOrderForPdf = {
  id: string;
  created_at?: string | null;
  reported_at?: string | null;
  clinical_notes?: string | null;
  public_token?: string | null;
  patient?: LabPatient | null;
  items?: LabItem[] | null;
};

export function ageYears(dob?: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

/** Bemorning to'liq ismi — familiya/ism/otasining ismi bo'lsa shundan. */
export function labPatientName(p?: LabPatient | null): string {
  if (!p) return '—';
  const parts = [p.last_name, p.first_name, p.patronymic].filter(Boolean).join(' ');
  return parts.length > 0 ? parts : (p.full_name ?? '—');
}

/**
 * Norma matni: bola → bola normasi (bo'lsa), aks holda jins bo'yicha, u ham
 * bo'lmasa qarama-qarshi jinsnikiga tushadi (web-patient bilan bir xil tartib).
 */
export function pickReferenceRange(test: LabTestRef, patient?: LabPatient | null): string {
  if (!test) return '—';
  const isChild = (ageYears(patient?.dob) ?? 99) < CHILD_AGE_MAX;
  if (isChild && test.reference_range_child) return test.reference_range_child;
  if (patient?.gender === 'female') {
    return test.reference_range_female ?? test.reference_range_male ?? '—';
  }
  return test.reference_range_male ?? test.reference_range_female ?? '—';
}

/** Norma qaysi guruh bo'yicha ko'rsatilgani (sarlavhada aytiladi). */
export function referenceGroupLabel(patient?: LabPatient | null): string {
  if ((ageYears(patient?.dob) ?? 99) < CHILD_AGE_MAX) return 'bola';
  if (patient?.gender === 'female') return 'ayol';
  if (patient?.gender === 'male') return 'erkak';
  return '—';
}

/** Tahlil nomi — snapshot ustuvor (buyurtma paytidagi nom). */
export function labTestName(item: LabItem): string {
  const i18n = item.test?.name_i18n ?? null;
  return (
    item.name_snapshot ??
    i18n?.['uz-Latn'] ??
    i18n?.['uz'] ??
    i18n?.['ru'] ??
    i18n?.['en'] ??
    'tahlil'
  );
}

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// A4 foydali kengligi 523pt (report-pdf margins 36/36) — ustunlar shunga mos.
const COLUMNS: PdfColumn[] = [
  { header: 'Tahlil', width: 165 },
  { header: 'Natija', width: 85 },
  { header: 'Birlik', width: 55 },
  { header: 'Norma', width: 150 },
  { header: 'Belgi', width: 68, align: 'center' },
];

/**
 * Bitta buyurtma uchun PDF. `patientPortalUrl` berilsa pastda QR havolasi
 * ko'rsatiladi — bemor keyin ham jonli natijani ochib ko'radi.
 */
export function buildLabResultPdf(
  order: LabOrderForPdf,
  clinicName: string,
  patientPortalUrl?: string | null,
): Promise<Buffer> {
  const patient = order.patient ?? null;
  const items = order.items ?? [];
  const reportedAt = order.reported_at ?? order.created_at ?? null;
  const day = (reportedAt ? new Date(reportedAt) : new Date()).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Tashkent',
  });

  const rows = items.map((it) => {
    // Yakuniy natija ustuvor; bo'lmasa oxirgi kiritilgani.
    const results = it.results ?? [];
    const r = results.find((x) => x.is_final) ?? results[results.length - 1] ?? null;
    return [
      labTestName(it),
      r?.value ?? '—',
      r?.unit ?? it.test?.unit ?? '',
      pickReferenceRange(it.test ?? null, patient),
      r?.is_abnormal ? '⚠ chetlash' : r?.value ? 'norma' : '—',
    ];
  });

  const abnormal = items.filter((it) =>
    (it.results ?? []).some((r) => r.is_abnormal && (r.is_final ?? true)),
  ).length;

  const link =
    order.public_token && patientPortalUrl ? `${patientPortalUrl}/r/${order.public_token}` : null;

  return buildDailyReportPdf({
    day,
    generatedAt: new Date(),
    title: 'Laboratoriya natijasi',
    subtitle: clinicName,
    kpis: [
      { label: 'Bemor', value: labPatientName(patient) },
      { label: 'Yosh', value: ageYears(patient?.dob) === null ? '—' : `${ageYears(patient?.dob)}` },
      { label: 'Tahlillar', value: String(items.length) },
      { label: 'Chetlashgan', value: String(abnormal) },
    ],
    tables: [
      {
        title: `Natijalar — norma (${referenceGroupLabel(patient)})`,
        columns: COLUMNS,
        rows,
        emptyText: 'Natija kiritilmagan',
      },
    ],
    footerNote:
      `Natija sanasi: ${fmtDate(reportedAt)}` +
      (order.clinical_notes ? ` · Izoh: ${order.clinical_notes}` : '') +
      (link ? ` · Onlayn: ${link}` : ''),
  });
}
