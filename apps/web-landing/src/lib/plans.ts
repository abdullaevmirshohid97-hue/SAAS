// Ochiq tariflar — super-admin tarif muharriridan (GET /api/v1/public/plans).
// Build vaqtida o'qiladi; API javob bermasa — fallback (sayt baribir quriladi).

export interface PublicModule {
  key: string;
  label: string;
  description: string;
  group: string;
}

export interface PublicPlan {
  code: string;
  name: string;
  price_uzs: number | null;
  price_yearly_uzs: number | null;
  description: string | null;
  highlights: string[];
  limits: { max_staff: number | null; max_devices: number | null; max_patients: number | null };
  modules: string[];
  payments: { methods: string[] | null };
  journal: {
    history_days: number | null;
    allow_edit: boolean;
    allow_delete: boolean;
    allow_export: boolean;
  };
  roles: { allowed: string[] | null; custom_roles: boolean };
  devices: { clients: Record<string, boolean>; enforce_limit: boolean };
}

export interface PublicPlans {
  groups: Array<{ key: string; label: string }>;
  modules: PublicModule[];
  plans: PublicPlan[];
}

const API_BASE =
  (typeof import.meta !== 'undefined'
    ? (import.meta as unknown as { env?: Record<string, string> }).env?.PUBLIC_API_URL
    : undefined) ??
  (typeof process !== 'undefined' ? process.env?.PUBLIC_API_URL : undefined) ??
  'https://api.clary.uz';

let cache: Promise<PublicPlans | null> | null = null;

export function fetchPublicPlans(): Promise<PublicPlans | null> {
  cache ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/public/plans`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as PublicPlans;
      return Array.isArray(json?.plans) ? json : null;
    } catch {
      return null;
    }
  })();
  return cache;
}

// API yetib bo'lmasa ishlatiladigan katalog (packages/schemas ENTITLEMENT_MODULES bilan bir xil)
export const FALLBACK_GROUPS = [
  { key: 'clinical', label: 'Klinik modullar' },
  { key: 'operations', label: 'Qabul va operatsiyalar' },
  { key: 'finance', label: 'Moliya va buxgalteriya' },
  { key: 'analytics', label: 'Analitika va hisobotlar' },
  { key: 'growth', label: 'Marketing va aloqa' },
];

export const FALLBACK_MODULES: PublicModule[] = [
  {
    key: 'doctor',
    label: 'Shifokor ish joyi',
    description: "Ko'rik, SOAP, retseptlar, shablonlar",
    group: 'clinical',
  },
  {
    key: 'diagnostics',
    label: 'Diagnostika',
    description: 'UZI, rentgen, EKG va uskunali tekshiruvlar',
    group: 'clinical',
  },
  {
    key: 'lab',
    label: 'Laboratoriya',
    description: 'Tahlillar, natijalar, QR natija',
    group: 'clinical',
  },
  {
    key: 'pharmacy',
    label: 'Dorixona',
    description: 'Sotuv, prixod, qoldiq, muddat nazorati',
    group: 'clinical',
  },
  {
    key: 'inpatient',
    label: 'Statsionar',
    description: 'Yotqizish, palata, depozit, chiqarish',
    group: 'clinical',
  },
  {
    key: 'dental',
    label: 'Stomatologiya',
    description: 'Tish kartasi, davolash rejasi',
    group: 'clinical',
  },
  {
    key: 'nurse',
    label: 'Hamshira paneli',
    description: 'Muolajalar va topshiriqlar',
    group: 'clinical',
  },
  {
    key: 'home_nurse',
    label: 'Uyga hamshira',
    description: "Uyga chaqiruv so'rovlari",
    group: 'clinical',
  },
  {
    key: 'online_booking',
    label: "Onlayn navbat so'rovlari",
    description: 'Sayt, portal va botdan',
    group: 'operations',
  },
  {
    key: 'telephony',
    label: "Qo'ng'iroqlar va bulutli ATS",
    description: 'IP-telefoniya va softfon',
    group: 'operations',
  },
  {
    key: 'ai_reception',
    label: 'AI ovozli qabulxona',
    description: "Qo'ng'iroqqa avtomatik javob",
    group: 'operations',
  },
  {
    key: 'clary_cast',
    label: 'TV navbat ekrani',
    description: 'Kutish zalida navbat',
    group: 'operations',
  },
  { key: 'inventory', label: 'Inventar', description: 'Sarf materiallari', group: 'operations' },
  {
    key: 'procurement',
    label: 'Xaridlar',
    description: 'Yetkazib beruvchilar, buyurtmalar',
    group: 'operations',
  },
  {
    key: 'network',
    label: "Filial tarmog'i",
    description: '10 tagacha filial bir joydan',
    group: 'operations',
  },
  {
    key: 'accounting',
    label: 'Buxgalteriya',
    description: 'Bosh kitob, balans, P&L',
    group: 'finance',
  },
  { key: 'budget', label: 'Byudjet', description: 'Reja va xarajat markazlari', group: 'finance' },
  { key: 'tax', label: 'Soliq markazi', description: 'QQS hisoboti', group: 'finance' },
  {
    key: 'month_closing',
    label: 'Oy yopish',
    description: 'Hisobot davrini yopish',
    group: 'finance',
  },
  { key: 'bank', label: 'Bank', description: "Hisoblar va ko'chirmalar", group: 'finance' },
  {
    key: 'fixed_assets',
    label: 'Asosiy vositalar',
    description: 'Amortizatsiya',
    group: 'finance',
  },
  {
    key: 'insurance',
    label: "Sug'urta",
    description: "Shartnomalar va da'volar",
    group: 'finance',
  },
  { key: 'payroll', label: 'Maosh', description: 'Foiz, oylik, avans', group: 'finance' },
  {
    key: 'analytics',
    label: 'Kengaytirilgan analitika',
    description: 'Shifokorlar, xizmatlar, prognoz',
    group: 'analytics',
  },
  {
    key: 'analytics_builder',
    label: 'Hisobot quruvchi (BI)',
    description: 'Ixtiyoriy kesimlar',
    group: 'analytics',
  },
  {
    key: 'executive',
    label: 'CFO paneli',
    description: "Rahbar ko'rsatkichlari",
    group: 'analytics',
  },
  {
    key: 'ai_copilot',
    label: 'AI yordamchi',
    description: 'Kunlik xulosa, savol-javob',
    group: 'analytics',
  },
  {
    key: 'telegram_reports',
    label: 'Telegram hisobotlari',
    description: 'Smena va kunlik hisobot',
    group: 'analytics',
  },
  { key: 'marketing', label: 'Marketing', description: 'Kampaniyalar, sodiqlik', group: 'growth' },
  { key: 'reviews', label: 'Sharhlar', description: 'Reyting', group: 'growth' },
  {
    key: 'patient_bot',
    label: 'Bemor Telegram boti',
    description: 'Navbat va natijalar',
    group: 'growth',
  },
  {
    key: 'web_profile',
    label: 'Klinika veb-sahifasi',
    description: 'Katalog va onlayn yozilish',
    group: 'growth',
  },
];

export const fmtUzs = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(n).toLocaleString('ru-RU').replace(/[  ,]/g, ' ');
