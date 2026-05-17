// =============================================================================
// Vital signs — abnormal qiymat klassifikatsiyasi + BMI
// Standart kattalar normasi (klinika sozlamasi emas — kod ichida const).
// =============================================================================

export type VitalKind =
  | 'temperature_c'
  | 'pulse_bpm'
  | 'systolic_mmhg'
  | 'diastolic_mmhg'
  | 'oxygen_saturation';

export type VitalLevel = 'normal' | 'warning' | 'critical';

/** Bitta vital qiymatni standart kattalar normasiga ko'ra tasniflaydi. */
export function classifyVital(kind: VitalKind, value: number): VitalLevel {
  if (!Number.isFinite(value)) return 'normal';
  switch (kind) {
    case 'temperature_c':
      if (value < 35 || value > 38.5) return 'critical';
      if (value > 37.5) return 'warning';
      return 'normal';
    case 'pulse_bpm':
      if (value < 50 || value > 120) return 'critical';
      if (value < 60 || value > 100) return 'warning';
      return 'normal';
    case 'systolic_mmhg':
      if (value > 180) return 'critical';
      if (value >= 140 || value < 90) return 'warning';
      return 'normal';
    case 'diastolic_mmhg':
      if (value > 110) return 'critical';
      if (value >= 90 || value < 60) return 'warning';
      return 'normal';
    case 'oxygen_saturation':
      if (value < 90) return 'critical';
      if (value < 95) return 'warning';
      return 'normal';
    default:
      return 'normal';
  }
}

/** Tailwind klasslari — input chegarasi/foni uchun. */
export const VITAL_LEVEL_CLASS: Record<VitalLevel, string> = {
  normal: 'border-emerald-300',
  warning: 'border-amber-400 bg-amber-50',
  critical: 'border-red-500 bg-red-50 text-red-700',
};

/** Inson o'qiy oladigan vital nomi (RED ALERT bannerida). */
export const VITAL_LABEL: Record<VitalKind, string> = {
  temperature_c: 'Temperatura',
  pulse_bpm: 'Puls',
  systolic_mmhg: 'Sistolik bosim',
  diastolic_mmhg: 'Diastolik bosim',
  oxygen_saturation: 'SpO₂',
};

export interface BmiResult {
  value: number;
  category: string;
  level: VitalLevel;
}

/** Vazn (kg) va bo'y (sm) dan BMI hisoblaydi. null — yetarli ma'lumot yo'q. */
export function computeBmi(
  weightKg: number | null,
  heightCm: number | null,
): BmiResult | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  const value = Math.round((weightKg / (m * m)) * 10) / 10;
  let category: string;
  let level: VitalLevel;
  if (value < 16) {
    category = 'Og‘ir ozg‘inlik';
    level = 'critical';
  } else if (value < 18.5) {
    category = 'Ozg‘in';
    level = 'warning';
  } else if (value < 25) {
    category = 'Normal';
    level = 'normal';
  } else if (value < 30) {
    category = 'Ortiqcha vazn';
    level = 'warning';
  } else if (value < 40) {
    category = 'Semizlik';
    level = 'warning';
  } else {
    category = 'Og‘ir semizlik';
    level = 'critical';
  }
  return { value, category, level };
}

export interface VitalsInput {
  temperature_c?: string | number | null;
  pulse_bpm?: string | number | null;
  systolic_mmhg?: string | number | null;
  diastolic_mmhg?: string | number | null;
  oxygen_saturation?: string | number | null;
}

export interface CriticalVital {
  kind: VitalKind;
  label: string;
  value: number;
}

/** Kritik (RED ALERT) darajadagi vitallar ro'yxati. */
export function criticalVitals(v: VitalsInput): CriticalVital[] {
  const kinds: VitalKind[] = [
    'temperature_c',
    'pulse_bpm',
    'systolic_mmhg',
    'diastolic_mmhg',
    'oxygen_saturation',
  ];
  const out: CriticalVital[] = [];
  for (const kind of kinds) {
    const raw = v[kind];
    if (raw === '' || raw === null || raw === undefined) continue;
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;
    if (classifyVital(kind, num) === 'critical') {
      out.push({ kind, label: VITAL_LABEL[kind], value: num });
    }
  }
  return out;
}
