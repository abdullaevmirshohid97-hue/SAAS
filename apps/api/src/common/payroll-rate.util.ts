import type { SupabaseClient } from '@supabase/supabase-js';

// Anketa (staff_profiles) oylik sozlamalarini maosh stavkasiga (doctor_commission_rates)
// aylantirish. MUHIM: "oylik" maosh har-tranzaksiya `fixed_uzs` emas, har oy beriladigan
// `monthly_base_uzs` bo'lishi kerak — shunda transaksiyasiz xodimga ham NET hisoblanadi.

export type SalaryType = 'fixed' | 'percent' | 'weekly' | 'bonus' | 'mixed';

export interface SalaryInput {
  salary_type?: SalaryType | string | null;
  salary_fixed_uzs?: number | null;
  salary_percent?: number | null;
  salary_bonus_uzs?: number | null;
}

export interface RateFromSalary {
  percent: number;
  fixed_uzs: number; // har-tranzaksiya fix — anketa maoshi uchun har doim 0
  monthly_base_uzs: number;
}

// Foydalanuvchi qarori (2026-06-03): BARCHA oylik turlari monthly_base'ga yoziladi.
export function salaryToRate(input: SalaryInput): RateFromSalary {
  const fixed = Math.max(0, Math.round(Number(input.salary_fixed_uzs ?? 0)));
  const percent = Math.max(0, Number(input.salary_percent ?? 0));
  const bonus = Math.max(0, Math.round(Number(input.salary_bonus_uzs ?? 0)));
  switch (input.salary_type) {
    case 'percent':
      return { percent, fixed_uzs: 0, monthly_base_uzs: 0 };
    case 'mixed':
      return { percent, fixed_uzs: 0, monthly_base_uzs: fixed };
    case 'weekly':
      // Haftalik summa -> oylik ekvivalent (o'rtacha 4.33 hafta/oy)
      return { percent: 0, fixed_uzs: 0, monthly_base_uzs: Math.round(fixed * 4.33) };
    case 'bonus':
      return { percent: 0, fixed_uzs: 0, monthly_base_uzs: bonus };
    case 'fixed':
    default:
      return { percent: 0, fixed_uzs: 0, monthly_base_uzs: fixed };
  }
}

// Joriy oyning 1-kuni (Asia/Tashkent), YYYY-MM-DD. doctor_commission_rates.valid_from uchun:
// payroll_period_summary RPC `valid_from <= p_from` shartini joriy oyda ham qondiradi
// (avval valid_from=today bo'lib, oy boshidan ko'rilganda tushib qolardi).
export function startOfMonthTashkent(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

// Anketadagi maoshni global stavka (service_id IS NULL) sifatida sync qiladi.
// Dublikat satr to'planmasligi uchun avvalgi faol global stavkalar arxivlanadi,
// so'ng yangisi yoziladi. Hech narsa belgilanmagan bo'lsa (0%, 0 oylik) — mavjudga
// tegmaydi (eski stavkani saqlaymiz).
export async function syncSalaryRate(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  salary: SalaryInput,
): Promise<void> {
  const { percent, fixed_uzs, monthly_base_uzs } = salaryToRate(salary);
  if (percent === 0 && monthly_base_uzs === 0) return;

  await admin
    .from('doctor_commission_rates')
    .update({ is_archived: true })
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .is('service_id', null)
    .eq('is_archived', false);

  await admin.from('doctor_commission_rates').insert({
    clinic_id: clinicId,
    doctor_id: doctorId,
    service_id: null,
    percent,
    fixed_uzs,
    monthly_base_uzs,
    valid_from: startOfMonthTashkent(),
  });
}

// Self-heal: faqat global stavkasi YO'Q xodimga anketadan stavka yozadi.
// Mavjud stavkaga TEGMAYDI (idempotent — har Maosh sahifa yuklanishida churn
// bo'lmasligi uchun). Eski (fix'dan oldin yaratilgan) xodimlar Maosh sahifasini
// ochganda avtomatik to'g'rilanadi. Maosh o'zgarsa — anketa update() qayta sync qiladi.
export async function syncSalaryRateIfMissing(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  salary: SalaryInput,
): Promise<void> {
  const { percent, monthly_base_uzs } = salaryToRate(salary);
  if (percent === 0 && monthly_base_uzs === 0) return;
  const { data: existing } = await admin
    .from('doctor_commission_rates')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('doctor_id', doctorId)
    .is('service_id', null)
    .eq('is_archived', false)
    .limit(1)
    .maybeSingle();
  if (existing) return;
  await syncSalaryRate(admin, clinicId, doctorId, salary);
}
