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

async function load(init?: RequestInit): Promise<PublicPlans | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/public/plans`, {
      headers: { accept: 'application/json' },
      ...init,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as PublicPlans;
    return Array.isArray(json?.plans) ? json : null;
  } catch {
    return null;
  }
}

let cache: Promise<PublicPlans | null> | null = null;

/** Build vaqtida (statik HTML va SEO uchun). */
export function fetchPublicPlans(): Promise<PublicPlans | null> {
  cache ??= load();
  return cache;
}

let live: Promise<PublicPlans | null> | null = null;

/**
 * Brauzerda — sahifa ochilganda yangi ma'lumot. Super-admin tarifni
 * o'zgartirsa sayt qayta qurilishini kutmasdan darhol ko'rinadi.
 */
export function fetchLivePlans(): Promise<PublicPlans | null> {
  live ??= load({ cache: 'no-store' });
  return live;
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

// ── Narx kartochkalari (narxlar sahifasi) ──────────────────────────────────
export interface PlanCard {
  code: string;
  name: string;
  description: string | null;
  monthly: number;
  annualMonthly: number;
  annualTotal: number;
  staff: string;
  devices: string;
  features: string[];
  modulesCount: number | null;
  featured?: boolean;
  badge?: string;
}

// Har bir tarifda doim bor asosiy bo'limlar (modul katalogiga kirmaydi):
// qabulxona, bemorlar bazasi, navbat, kassa, jurnal, xodimlar
export const CORE_COUNT = 6;

export const limitText = (n: number | null) => (n == null ? 'Cheksiz' : String(n));

export function planCards(pub: PublicPlans): PlanCard[] {
  const cards = pub.plans.map((p): PlanCard => {
    const monthly = p.price_uzs ?? 0;
    const annualTotal = p.price_yearly_uzs ?? Math.round(monthly * 12 * 0.8);
    return {
      code: p.code,
      name: p.name,
      description: p.description,
      monthly,
      annualTotal,
      annualMonthly: Math.round(annualTotal / 12),
      staff: limitText(p.limits.max_staff),
      devices: limitText(p.limits.max_devices),
      features: p.highlights,
      modulesCount: p.modules.length + CORE_COUNT,
    };
  });
  const paid = cards.filter((p) => p.monthly > 0);
  const mid = paid[Math.floor((paid.length - 1) / 2)];
  if (mid && paid.length >= 3) {
    mid.featured = true;
    mid.badge = "Ko'p tanlanadi";
  }
  const demo = cards.find((p) => p.monthly === 0);
  if (demo) demo.badge = 'Boshlash uchun';
  return cards;
}

export function yearlyDiscount(cards: PlanCard[]): number {
  const p = cards.find((x) => x.monthly > 0);
  if (!p || !p.monthly) return 20;
  return Math.max(0, Math.round((1 - p.annualTotal / (p.monthly * 12)) * 100));
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
  humo: 'Humo',
  uzcard: 'Uzcard',
  transfer: "O'tkazma",
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  mbank: 'Mbank',
  insurance: "Sug'urta",
  debt: 'Qarzga',
};
