/**
 * Clary — tarif imkoniyatlari (entitlements) katalogi — YAGONA manba.
 *
 * Tarif (plans.entitlements) va klinikaga individual sozlama
 * (clinic_entitlements.overrides) shu tuzilmada saqlanadi. Bazadagi
 * `clinic_effective_entitlements()` ularni chuqur birlashtiradi, API esa
 * `normalizeEntitlements()` bilan yetishmagan maydonlarni to'ldiradi.
 *
 * QOIDA: yo'q kalit = RUXSAT. Bo'sh `{}` tarif — hamma narsa ochiq (eski
 * xulq). Shuning uchun yangi modul qo'shilganda mavjud klinikalar yopilib
 * qolmaydi — super-admin uni tarifda o'zi yopadi.
 *
 * Modul qo'shish: shu ro'yxatga `routes` (web-clinic) va `api` (/api/v1/
 * dan keyingi prefiks) bilan yozing. Prefiks SEGMENT bo'yicha mos keladi
 * ('pharmacy' → 'pharmacy/x' ha, 'pharmacy-ws' yo'q), eng uzuni yutadi.
 */

export type EntitlementGroup = 'clinical' | 'operations' | 'finance' | 'analytics' | 'growth';

export interface EntitlementModuleDef {
  key: string;
  label: string;
  description: string;
  group: EntitlementGroup;
  routes: readonly string[];
  api: readonly string[];
}

export const ENTITLEMENT_GROUPS: ReadonlyArray<{ key: EntitlementGroup; label: string }> = [
  { key: 'clinical', label: 'Klinik modullar' },
  { key: 'operations', label: 'Qabul va operatsiyalar' },
  { key: 'finance', label: 'Moliya va buxgalteriya' },
  { key: 'analytics', label: 'Analitika va hisobotlar' },
  { key: 'growth', label: 'Marketing va aloqa' },
];

export const ENTITLEMENT_MODULES = [
  // ── Klinik ────────────────────────────────────────────────────────────────
  {
    key: 'doctor',
    label: 'Shifokor ish joyi',
    description: "Ko'rik, SOAP, retseptlar, shifokor kabineti va shablonlar",
    group: 'clinical',
    routes: ['/doctor'],
    api: ['doctor', 'prescriptions'],
  },
  {
    key: 'diagnostics',
    label: 'Diagnostika',
    description: 'UZI, rentgen, EKG va boshqa uskunali tekshiruvlar',
    group: 'clinical',
    routes: ['/diagnostics'],
    api: ['diagnostics'],
  },
  {
    key: 'lab',
    label: 'Laboratoriya',
    description: 'Tahlil buyurtmalari, natijalar, QR natija, laborant ish joyi',
    group: 'clinical',
    routes: ['/lab', '/lab-workstation'],
    api: ['lab'],
  },
  {
    key: 'pharmacy',
    label: 'Dorixona',
    description: 'Dori sotuvi, prixod, qoldiq, muddat nazorati (klinika ichidagi dorixona)',
    group: 'clinical',
    routes: ['/pharmacy'],
    api: ['pharmacy'],
  },
  {
    key: 'inpatient',
    label: 'Statsionar',
    description: "Yotqizish, palata/ko'rpa, depozit, kunlik hisob, chiqarish",
    group: 'clinical',
    routes: ['/inpatient'],
    api: ['inpatient'],
  },
  {
    key: 'dental',
    label: 'Stomatologiya',
    description: 'Interaktiv tish kartasi, davolash rejasi, tish texnik buyurtmalari',
    group: 'clinical',
    routes: ['/dental'],
    api: ['dental'],
  },
  {
    key: 'nurse',
    label: 'Hamshira paneli',
    description: 'Muolajalar, topshiriqlar, shoshilinch chaqiruv',
    group: 'clinical',
    routes: ['/nurse', '/settings/nurse-schedules'],
    api: ['nurse'],
  },
  {
    key: 'home_nurse',
    label: 'Uyga hamshira',
    description: "Bemorlarning uyga hamshira chaqiruv so'rovlari",
    group: 'clinical',
    routes: ['/nurse-requests'],
    api: ['clinic/nurse-portal'],
  },
  // ── Qabul va operatsiyalar ────────────────────────────────────────────────
  {
    key: 'online_booking',
    label: "Onlayn navbat so'rovlari",
    description: "Sayt, portal va bot orqali kelgan navbat so'rovlari",
    group: 'operations',
    routes: ['/appointment-requests'],
    api: ['clinic/appointment-requests'],
  },
  {
    key: 'telephony',
    label: "Qo'ng'iroqlar va bulutli ATS",
    description: "IP-telefoniya, stol telefonlari, softfon, qo'ng'iroqlar tarixi",
    group: 'operations',
    routes: ['/calls', '/settings/telephony'],
    api: ['telephony'],
  },
  {
    key: 'ai_reception',
    label: 'AI ovozli qabulxona',
    description: "Qo'ng'iroqqa avtomatik javob, navbatga yozish, ovozli xabar",
    group: 'operations',
    routes: ['/settings/ai-reception'],
    api: ['ai-reception'],
  },
  {
    key: 'clary_cast',
    label: 'TV navbat ekrani',
    description: 'Clary Cast — kutish zalidagi televizorda navbat va ovozli chaqiruv',
    group: 'operations',
    routes: ['/settings/cast'],
    api: ['cast'],
  },
  {
    key: 'inventory',
    label: 'Inventar',
    description: 'Sarf materiallari, ombor harakatlari, inventarizatsiya',
    group: 'operations',
    routes: ['/inventory'],
    api: ['inventory'],
  },
  {
    key: 'procurement',
    label: 'Xaridlar',
    description: 'Yetkazib beruvchilar, buyurtmalar, qabul qilish',
    group: 'operations',
    routes: ['/procurement'],
    api: ['procurement'],
  },
  {
    key: 'network',
    label: "Filial tarmog'i",
    description: "Bir joydan bir nechta filial: transferlar, yo'llanmalar, umumiy hisobot",
    group: 'operations',
    routes: ['/company'],
    api: ['company', 'referrals'],
  },
  // ── Moliya ────────────────────────────────────────────────────────────────
  {
    key: 'accounting',
    label: 'Buxgalteriya',
    description: 'Bosh kitob, balans, P&L, pul oqimi, debitor/kreditor',
    group: 'finance',
    routes: ['/accounting'],
    api: ['accounting'],
  },
  {
    key: 'budget',
    label: 'Byudjet',
    description: 'Byudjet rejasi va xarajat markazlari',
    group: 'finance',
    routes: ['/budget'],
    api: ['accounting/budget', 'accounting/cost-centers'],
  },
  {
    key: 'tax',
    label: 'Soliq markazi',
    description: 'Soliq hisob-kitobi va QQS hisoboti',
    group: 'finance',
    routes: ['/tax'],
    api: ['accounting/tax', 'accounting/qqs-report'],
  },
  {
    key: 'month_closing',
    label: 'Oy yopish',
    description: 'Hisobot davrini yopish va qayta ochish',
    group: 'finance',
    routes: ['/month-closing'],
    api: ['accounting/close-month', 'accounting/reopen-month', 'accounting/periods'],
  },
  {
    key: 'bank',
    label: 'Bank',
    description: "Bank hisoblari va ko'chirmalar",
    group: 'finance',
    routes: ['/bank'],
    api: ['bank'],
  },
  {
    key: 'fixed_assets',
    label: 'Asosiy vositalar',
    description: 'Uskunalar hisobi va amortizatsiya',
    group: 'finance',
    routes: ['/fixed-assets'],
    api: ['fixed-assets'],
  },
  {
    key: 'insurance',
    label: "Sug'urta",
    description: "Sug'urta shartnomalari, da'volar, hisob-kitob",
    group: 'finance',
    routes: ['/insurance', '/settings/insurance'],
    api: ['insurance'],
  },
  {
    key: 'payroll',
    label: 'Maosh (hisob-kitob)',
    description: "Xodimlar maoshi, foiz, avans, to'lov tarixi",
    group: 'finance',
    routes: ['/payroll'],
    api: ['payroll'],
  },
  // ── Analitika ─────────────────────────────────────────────────────────────
  {
    key: 'analytics',
    label: 'Kengaytirilgan analitika',
    description: 'Shifokorlar, xizmatlar, segmentlar, prognoz va dashboard kartalari',
    group: 'analytics',
    routes: ['/analytics'],
    api: ['analytics'],
  },
  {
    key: 'analytics_builder',
    label: 'Hisobot quruvchi (BI)',
    description: 'Davr hisoboti, ixtiyoriy kesimlar, jadvallashtirilgan hisobotlar',
    group: 'analytics',
    routes: ['/analytics/builder'],
    api: ['analytics/query', 'finance-report', 'report-schedules'],
  },
  {
    key: 'executive',
    label: 'CFO paneli',
    description: "Rahbar uchun umumiy moliyaviy ko'rsatkichlar",
    group: 'analytics',
    routes: ['/executive'],
    api: ['accounting/executive'],
  },
  {
    key: 'ai_copilot',
    label: 'AI yordamchi',
    description: 'AI kunlik xulosa, Copilot savol-javob, ICD-10 tavsiyasi',
    group: 'analytics',
    routes: [],
    api: ['ai'],
  },
  {
    key: 'telegram_reports',
    label: 'Telegram hisobotlari',
    description: 'Smena, kassa va kunlik hisobotlar Telegram botga',
    group: 'analytics',
    routes: [],
    api: ['telegram-reports', 'telegram-backup'],
  },
  // ── Marketing va aloqa ────────────────────────────────────────────────────
  {
    key: 'marketing',
    label: 'Marketing',
    description: 'Kampaniyalar, segmentlar, sodiqlik dasturi',
    group: 'growth',
    routes: ['/marketing'],
    api: ['marketing'],
  },
  {
    key: 'reviews',
    label: 'Sharhlar',
    description: 'Bemorlar sharhlari va reyting',
    group: 'growth',
    routes: ['/reviews'],
    api: [],
  },
  {
    key: 'patient_bot',
    label: 'Bemor Telegram boti',
    description: 'Bemorlar uchun navbat, natija va eslatmalar boti',
    group: 'growth',
    routes: [],
    api: ['telegram-patient'],
  },
  {
    key: 'web_profile',
    label: 'Klinika veb-sahifasi',
    description: 'clary.uz katalogidagi klinika sahifasi va onlayn yozilish',
    group: 'growth',
    routes: ['/settings/web-profile'],
    api: [],
  },
] as const satisfies readonly EntitlementModuleDef[];

export type EntitlementModuleKey = (typeof ENTITLEMENT_MODULES)[number]['key'];

/**
 * Modul prefiksiga tushsa ham HECH QACHON yopilmaydigan API yo'llari —
 * asosiy ish (dashboard KPI, filial almashtirgich).
 */
export const CORE_API_PATHS: readonly string[] = ['analytics/overview', 'company/my'];

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'cash', label: 'Naqd' },
  { key: 'card', label: 'Plastik karta (terminal)' },
  { key: 'humo', label: 'Humo' },
  { key: 'uzcard', label: 'Uzcard' },
  { key: 'transfer', label: "Bank o'tkazmasi" },
  { key: 'click', label: 'Click' },
  { key: 'payme', label: 'Payme' },
  { key: 'uzum', label: 'Uzum' },
  { key: 'mbank', label: 'Mbank' },
  { key: 'insurance', label: "Sug'urta" },
  { key: 'debt', label: 'Qarzga (nasiya)' },
];

export const ROLE_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'clinic_admin', label: 'Administrator' },
  { key: 'doctor', label: 'Shifokor' },
  { key: 'receptionist', label: 'Qabulxona' },
  { key: 'cashier', label: 'Kassir' },
  { key: 'pharmacist', label: 'Farmatsevt' },
  { key: 'lab_technician', label: 'Laborant' },
  { key: 'radiologist', label: 'Radiolog' },
  { key: 'nurse', label: 'Hamshira' },
  { key: 'staff', label: 'Xodim' },
];

export type DeviceClient = 'web' | 'desktop' | 'mobile' | 'kiosk';

export const DEVICE_CLIENT_OPTIONS: ReadonlyArray<{ key: DeviceClient; label: string }> = [
  { key: 'web', label: 'Brauzer (veb)' },
  { key: 'desktop', label: 'Kompyuter ilovasi' },
  { key: 'mobile', label: 'Mobil ilova' },
  { key: 'kiosk', label: 'Kiosk / TV ekran' },
];

export interface Entitlements {
  plan: string | null;
  plan_name: string | null;
  /** false — yopiq; yo'q/true — ochiq */
  modules: Partial<Record<EntitlementModuleKey, boolean>>;
  limits: {
    max_staff: number | null;
    max_devices: number | null;
    max_patients: number | null;
  };
  journal: {
    /** Jurnal/hisobotda necha kun orqaga ko'rinadi (null — cheksiz) */
    history_days: number | null;
    allow_edit: boolean;
    allow_delete: boolean;
    allow_export: boolean;
  };
  payments: {
    /** Ruxsat etilgan to'lov turlari (null — hammasi) */
    methods: string[] | null;
  };
  roles: {
    /** Ruxsat etilgan rollar (null — hammasi; egasi doim mumkin) */
    allowed: string[] | null;
    custom_roles: boolean;
  };
  devices: {
    clients: Record<DeviceClient, boolean>;
    /** true — qurilmalar soni max_devices bilan qat'iy cheklanadi */
    enforce_limit: boolean;
  };
  /** Klinikaga individual kelishuv (faqat effektiv javobda) */
  override?: {
    active: boolean;
    custom_price_uzs: number | null;
    custom_price_yearly_uzs: number | null;
    discount_percent: number | null;
    valid_until: string | null;
    note: string | null;
  } | null;
}

export const DEFAULT_ENTITLEMENTS: Entitlements = {
  plan: null,
  plan_name: null,
  modules: {},
  limits: { max_staff: null, max_devices: null, max_patients: null },
  journal: { history_days: null, allow_edit: true, allow_delete: true, allow_export: true },
  payments: { methods: null },
  roles: { allowed: null, custom_roles: true },
  devices: {
    clients: { web: true, desktop: true, mobile: true, kiosk: true },
    enforce_limit: false,
  },
  override: null,
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const numOrNull = (v: unknown, d: number | null) =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d;
const strList = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

/** Bazadan kelgan (yoki qisman) obyektni to'liq Entitlements ga keltiradi. */
export function normalizeEntitlements(raw: unknown): Entitlements {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_ENTITLEMENTS;
  const modules: Entitlements['modules'] = {};
  if (isObj(r.modules)) {
    for (const m of ENTITLEMENT_MODULES) {
      const v = r.modules[m.key];
      if (typeof v === 'boolean') modules[m.key] = v;
    }
  }
  const limits = isObj(r.limits) ? r.limits : {};
  const journal = isObj(r.journal) ? r.journal : {};
  const payments = isObj(r.payments) ? r.payments : {};
  const roles = isObj(r.roles) ? r.roles : {};
  const devices = isObj(r.devices) ? r.devices : {};
  const clients = isObj(devices.clients) ? devices.clients : {};
  const ov = isObj(r.override) ? r.override : null;
  return {
    plan: typeof r.plan === 'string' ? r.plan : null,
    plan_name: typeof r.plan_name === 'string' ? r.plan_name : null,
    modules,
    limits: {
      max_staff: numOrNull(limits.max_staff, d.limits.max_staff),
      max_devices: numOrNull(limits.max_devices, d.limits.max_devices),
      max_patients: numOrNull(limits.max_patients, d.limits.max_patients),
    },
    journal: {
      history_days: numOrNull(journal.history_days, d.journal.history_days),
      allow_edit: bool(journal.allow_edit, true),
      allow_delete: bool(journal.allow_delete, true),
      allow_export: bool(journal.allow_export, true),
    },
    payments: { methods: 'methods' in payments ? strList(payments.methods) : null },
    roles: {
      allowed: 'allowed' in roles ? strList(roles.allowed) : null,
      custom_roles: bool(roles.custom_roles, true),
    },
    devices: {
      clients: {
        web: bool(clients.web, true),
        desktop: bool(clients.desktop, true),
        mobile: bool(clients.mobile, true),
        kiosk: bool(clients.kiosk, true),
      },
      enforce_limit: bool(devices.enforce_limit, false),
    },
    override: ov
      ? {
          active: bool(ov.active, false),
          custom_price_uzs: numOrNull(ov.custom_price_uzs, null),
          custom_price_yearly_uzs: numOrNull(ov.custom_price_yearly_uzs, null),
          discount_percent:
            typeof ov.discount_percent === 'number' ? Number(ov.discount_percent) : null,
          valid_until: typeof ov.valid_until === 'string' ? ov.valid_until : null,
          note: typeof ov.note === 'string' ? ov.note : null,
        }
      : null,
  };
}

export function moduleEnabled(e: Entitlements | null | undefined, key: string): boolean {
  if (!e) return true;
  return (e.modules as Record<string, boolean | undefined>)[key] !== false;
}

export function paymentMethodAllowed(e: Entitlements | null | undefined, method: string): boolean {
  if (!e || !e.payments.methods) return true;
  if (method === 'mixed') return true;
  return e.payments.methods.includes(method);
}

export function roleAllowed(e: Entitlements | null | undefined, role: string): boolean {
  if (!e || !e.roles.allowed) return true;
  if (role === 'clinic_owner') return true;
  return e.roles.allowed.includes(role);
}

const segMatch = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');

/** "/api/v1/accounting/tax/x?y" yoki "accounting/tax/x" → "accounting/tax/x" */
export function normalizeApiPath(url: string): string {
  let p = url.split('?')[0] ?? '';
  p = p.replace(/^\/+/, '');
  p = p.replace(/^api\/v\d+\//, '');
  return p.replace(/\/+$/, '');
}

/** API yo'li qaysi modulga tegishli (eng uzun prefiks). Asosiy yo'llar → null. */
export function resolveApiModule(url: string): EntitlementModuleKey | null {
  const p = normalizeApiPath(url);
  if (CORE_API_PATHS.some((c) => segMatch(p, c))) return null;
  let best: { key: EntitlementModuleKey; len: number } | null = null;
  for (const m of ENTITLEMENT_MODULES) {
    for (const prefix of m.api) {
      if (segMatch(p, prefix) && (!best || prefix.length > best.len)) {
        best = { key: m.key, len: prefix.length };
      }
    }
  }
  return best?.key ?? null;
}

/** web-clinic marshruti qaysi modulga tegishli (eng uzun prefiks). */
export function resolveRouteModule(pathname: string): EntitlementModuleKey | null {
  const p = (pathname.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  let best: { key: EntitlementModuleKey; len: number } | null = null;
  for (const m of ENTITLEMENT_MODULES) {
    for (const prefix of m.routes) {
      if (segMatch(p, prefix) && (!best || prefix.length > best.len)) {
        best = { key: m.key, len: prefix.length };
      }
    }
  }
  return best?.key ?? null;
}

export function moduleLabel(key: string): string {
  return ENTITLEMENT_MODULES.find((m) => m.key === key)?.label ?? key;
}
