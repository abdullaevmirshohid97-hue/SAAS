// Hamshira vazifalari uchun uz yorliqlar + ranglar (klinika nurse_tasks + uy chaqiruvlari).

/** nurse_tasks.category → uz yorliq + Feather ikon nomi */
export const CLINIC_CATEGORY: Record<string, { label: string; icon: string }> = {
  general: { label: 'Umumiy', icon: 'clipboard' },
  injection: { label: "In'eksiya", icon: 'crosshair' },
  iv_drip: { label: 'Kapelnitsa', icon: 'droplet' },
  dressing: { label: "Bog'lash", icon: 'package' },
  vitals: { label: "Hayotiy ko'rsatkichlar", icon: 'activity' },
  medication: { label: 'Dori berish', icon: 'thermometer' },
  home_visit: { label: 'Uy chaqiruvi', icon: 'home' },
  procedure: { label: 'Muolaja', icon: 'tool' },
  observation: { label: 'Kuzatuv', icon: 'eye' },
};

export function clinicCategory(c: string) {
  return CLINIC_CATEGORY[c] ?? { label: c, icon: 'clipboard' };
}

/** nurse_tasks.status → yorliq + Tailwind ranglar (bg + text) */
export const CLINIC_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Kutilmoqda', cls: 'bg-amber-100 text-amber-700' },
  in_progress: { label: 'Bajarilmoqda', cls: 'bg-indigo-100 text-indigo-700' },
  done: { label: 'Bajarilgan', cls: 'bg-emerald-100 text-emerald-700' },
  skipped: { label: "O'tkazilgan", cls: 'bg-gray-200 text-gray-600' },
  canceled: { label: 'Bekor', cls: 'bg-gray-200 text-gray-600' },
};

export function clinicStatus(s: string) {
  return CLINIC_STATUS[s] ?? { label: s, cls: 'bg-gray-100 text-gray-600' };
}

/** home_nurse_requests.status → yorliq + ranglar */
export const HOME_STATUS: Record<string, { label: string; cls: string }> = {
  assigned: { label: 'Yangi', cls: 'bg-amber-100 text-amber-700' },
  on_the_way: { label: "Yo'lda", cls: 'bg-indigo-100 text-indigo-700' },
  in_progress: { label: 'Bajarilmoqda', cls: 'bg-purple-100 text-purple-700' },
  completed: { label: 'Tugagan', cls: 'bg-emerald-100 text-emerald-700' },
  canceled: { label: 'Bekor', cls: 'bg-gray-200 text-gray-600' },
};

export function homeStatus(s: string) {
  return HOME_STATUS[s] ?? { label: s, cls: 'bg-gray-100 text-gray-600' };
}

/** Faol (tugamagan) holatlar */
export const CLINIC_ACTIVE = ['pending', 'in_progress'];
export const HOME_ACTIVE = ['assigned', 'on_the_way', 'in_progress'];

/** nurse_tasks.priority → 2+ shoshilinch */
export function isUrgentPriority(p: number | null | undefined) {
  return (p ?? 0) >= 2;
}

/** "HH:MM" yoki ISO sanadan vaqtni chiqarish */
export function timeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  // "HH:MM" yoki "HH:MM:SS"
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });
}

export function dateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('uz', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Hafta kunlari (nurse_schedules.day_of_week, 0=Yakshanba ... mos JS getDay) */
export const DAYS = [
  { v: 1, label: 'Du' },
  { v: 2, label: 'Se' },
  { v: 3, label: 'Ch' },
  { v: 4, label: 'Pa' },
  { v: 5, label: 'Ju' },
  { v: 6, label: 'Sh' },
  { v: 0, label: 'Ya' },
];

export function dayLabel(v: number) {
  return DAYS.find((d) => d.v === v)?.label ?? String(v);
}
