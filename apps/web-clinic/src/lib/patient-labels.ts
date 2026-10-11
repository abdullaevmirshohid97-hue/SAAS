// Bemorlar daftari — umumiy yorliqlar va formatlash.

export const PAY_METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd',
  card: 'Plastik karta',
  transfer: "O'tkazma",
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  humo: 'Humo',
  uzcard: 'Uzcard',
  mbank: 'Mbank',
  insurance: "Sug'urta",
  debt: 'Qarzga',
  mixed: 'Aralash',
};

export const payLabel = (m: string) => PAY_METHOD_LABEL[m] ?? m;

export const fmtUzs = (n: number | null | undefined) =>
  `${Math.round(Number(n ?? 0)).toLocaleString('uz-UZ')} so'm`;

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ageOf(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const years = Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
  return years >= 0 && years < 130 ? `${years} yosh` : null;
}

export const GENDER_LABEL: Record<string, string> = { male: 'Erkak', female: 'Ayol' };

/** "3-tashrif" / "birinchi tashrif" — qabulxonada ko'rsatish uchun. */
export function visitLabel(visits: number): string {
  if (visits <= 0) return 'Birinchi marta';
  return `${visits} marta kelgan`;
}

// inpatient.tsx DISCHARGE_REASONS bilan bir xil qiymatlar
export const STAY_REASON_LABEL: Record<string, string> = {
  recovery: 'Tuzaldi',
  treatment_refused: 'Davolanishdan voz kechdi',
  negative_review: 'Salbiy sharh',
  admin: "Ma'muriy",
  transferred: "Ko'chirildi",
  deceased: 'Vafot etgan',
  other: 'Boshqa',
};
