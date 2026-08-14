// =============================================================================
// Obyekt reyestri — Clary'ning domen modeli bir joyda
// =============================================================================
// Muammo: kod bazasida jadval nomlari qatorda tarqoq yozilgan
// ('transactions', 'patients', 'pharmacy_sales'...). Natijada audit jurnali
// "pharmacy_sales yozuvi o'zgardi" deb ko'rsatadi va bosib bo'lmaydi —
// foydalanuvchi qaysi sotuv ekanini bilmaydi.
//
// Bu ORM emas, ORM o'rnini ham bosmaydi. Bu — METAMA'LUMOT: har bir muhim
// obyektning nomi, sarlavha maydoni va ilovadagi sahifasi.
//
// 1C'dagi metadata g'oyasining kichik va amaliy varianti. Hozir audit/jurnal
// ko'rinishini yaxshilaydi; keyinchalik global qidiruv, maydon darajasidagi
// ruxsatlar va AI agent qatlami ham shundan oziqlanadi.
//
// QO'SHISH QOIDASI: yangi obyekt qo'shsangiz shu yerga yozing. Sahifa yo'li
// bo'lmasa `route: null` — shunda UI havola qilmaydi, matn sifatida ko'rsatadi.

export type DomainObjectKey =
  | 'patients'
  | 'appointments'
  | 'transactions'
  | 'queues'
  | 'shifts'
  | 'services'
  | 'staff_profiles'
  | 'profiles'
  | 'pharmacy_sales'
  | 'pharmacy_receipts'
  | 'medications'
  | 'lab_orders'
  | 'lab_tests'
  | 'diagnostic_orders'
  | 'inpatient_stays'
  | 'rooms'
  | 'prescriptions'
  | 'service_referrals'
  | 'diagnosis_templates'
  | 'doctor_payouts'
  | 'expenses';

export interface DomainObject {
  /** Baza jadvali (audit `resource_type` shu qiymatni yozadi). */
  table: DomainObjectKey;
  /** Foydalanuvchiga ko'rsatiladigan nom (birlik). */
  labelUz: string;
  /** Ro'yxat sarlavhasi (ko'plik). */
  pluralUz: string;
  /**
   * Ilovadagi sahifa yo'li. `:id` almashtiriladi.
   * null — bu obyekt uchun alohida sahifa yo'q.
   */
  route: string | null;
  /** Sarlavha sifatida ko'rsatiladigan maydon(lar) — birinchi mavjudi olinadi. */
  titleFields: string[];
}

export const DOMAIN_OBJECTS: Record<DomainObjectKey, DomainObject> = {
  patients: {
    table: 'patients',
    labelUz: 'Bemor',
    pluralUz: 'Bemorlar',
    route: '/patient/:id',
    titleFields: ['full_name'],
  },
  appointments: {
    table: 'appointments',
    labelUz: 'Qabul',
    pluralUz: 'Qabullar',
    route: null,
    titleFields: ['scheduled_at'],
  },
  transactions: {
    table: 'transactions',
    labelUz: 'Tranzaksiya',
    pluralUz: 'Tranzaksiyalar',
    route: '/journal/entry/:id',
    titleFields: ['receipt_no', 'total_uzs'],
  },
  queues: {
    table: 'queues',
    labelUz: 'Navbat',
    pluralUz: 'Navbat',
    route: '/queue',
    titleFields: ['ticket_code'],
  },
  shifts: {
    table: 'shifts',
    labelUz: 'Smena',
    pluralUz: 'Smenalar',
    route: '/shifts-history',
    titleFields: ['opened_at'],
  },
  services: {
    table: 'services',
    labelUz: 'Xizmat',
    pluralUz: 'Xizmatlar',
    route: '/settings/catalog/services',
    titleFields: ['name_i18n', 'name'],
  },
  staff_profiles: {
    table: 'staff_profiles',
    labelUz: 'Xodim anketasi',
    pluralUz: 'Xodimlar anketasi',
    route: '/settings/staff-profiles',
    titleFields: ['full_name', 'first_name'],
  },
  profiles: {
    table: 'profiles',
    labelUz: 'Xodim',
    pluralUz: 'Xodimlar',
    route: '/settings/staff',
    titleFields: ['full_name', 'email'],
  },
  pharmacy_sales: {
    table: 'pharmacy_sales',
    labelUz: 'Dori sotuvi',
    pluralUz: 'Dori sotuvlari',
    route: '/pharmacy/sale/:id',
    titleFields: ['total_uzs'],
  },
  pharmacy_receipts: {
    table: 'pharmacy_receipts',
    labelUz: 'Dori prixodi',
    pluralUz: 'Dori prixodlari',
    route: '/pharmacy',
    titleFields: ['doc_number'],
  },
  medications: {
    table: 'medications',
    labelUz: 'Dori',
    pluralUz: 'Dorilar',
    route: '/settings/catalog/medications',
    titleFields: ['name'],
  },
  lab_orders: {
    table: 'lab_orders',
    labelUz: 'Lab buyurtmasi',
    pluralUz: 'Lab buyurtmalari',
    route: '/lab',
    titleFields: ['order_no'],
  },
  lab_tests: {
    table: 'lab_tests',
    labelUz: 'Lab testi',
    pluralUz: 'Lab testlari',
    route: '/settings/catalog/lab-tests',
    titleFields: ['name_i18n', 'code'],
  },
  diagnostic_orders: {
    table: 'diagnostic_orders',
    labelUz: 'Diagnostika buyurtmasi',
    pluralUz: 'Diagnostika buyurtmalari',
    route: '/diagnostics',
    titleFields: ['order_no'],
  },
  inpatient_stays: {
    table: 'inpatient_stays',
    labelUz: 'Statsionar yotish',
    pluralUz: 'Statsionar',
    route: '/inpatient/stays/:id',
    titleFields: ['admitted_at'],
  },
  rooms: {
    table: 'rooms',
    labelUz: 'Xona',
    pluralUz: 'Xonalar',
    route: '/settings/catalog/rooms',
    titleFields: ['number', 'name'],
  },
  prescriptions: {
    table: 'prescriptions',
    labelUz: 'Retsept',
    pluralUz: 'Retseptlar',
    route: null,
    titleFields: ['rx_number', 'diagnosis_text'],
  },
  service_referrals: {
    table: 'service_referrals',
    labelUz: "Yo'llanma",
    pluralUz: "Yo'llanmalar",
    route: null,
    titleFields: ['kind'],
  },
  diagnosis_templates: {
    table: 'diagnosis_templates',
    labelUz: 'Tashxis shabloni',
    pluralUz: 'Tashxis shablonlari',
    route: '/doctor/kabinet/:id',
    titleFields: ['name'],
  },
  doctor_payouts: {
    table: 'doctor_payouts',
    labelUz: "Shifokor to'lovi",
    pluralUz: "Shifokor to'lovlari",
    route: '/payroll',
    titleFields: ['amount_uzs'],
  },
  expenses: {
    table: 'expenses',
    labelUz: 'Xarajat',
    pluralUz: 'Xarajatlar',
    route: '/cashier',
    titleFields: ['title', 'amount_uzs'],
  },
};

/** Reyestrda bormi (audit `resource_type` noma'lum bo'lishi mumkin). */
export function isDomainObject(key: string): key is DomainObjectKey {
  return Object.prototype.hasOwnProperty.call(DOMAIN_OBJECTS, key);
}

/** Obyekt tavsifi yoki null — noma'lum jadval uchun UI xom nomni ko'rsatadi. */
export function domainObject(key: string | null | undefined): DomainObject | null {
  return key && isDomainObject(key) ? DOMAIN_OBJECTS[key] : null;
}

/** Obyektning ilovadagi havolasi; sahifasi bo'lmasa null. */
export function domainRoute(key: string | null | undefined, id: string | null | undefined): string | null {
  const obj = domainObject(key);
  if (!obj?.route) return null;
  if (obj.route.includes(':id')) {
    return id ? obj.route.replace(':id', id) : null;
  }
  return obj.route;
}

/** "Bemor", "Dori sotuvi" — noma'lum bo'lsa xom nomni qaytaradi. */
export function domainLabel(key: string | null | undefined): string {
  return domainObject(key)?.labelUz ?? (key ?? '—');
}
