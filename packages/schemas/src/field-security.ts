// =============================================================================
// Maydon darajasidagi xavfsizlik (Odoo uslubi)
// =============================================================================
// Muammo: hozirgi RBAC faqat `modul.amal` darajasida. "Qabulxona bemorni
// ko'radi, lekin TASHXISINI ko'rmaydi" degan qoidani ifodalab bo'lmaydi.
//
// Yechim: himoyalangan maydonlar reyestri + bitta joyda filtrlash.
// Saqlash uchun YANGI jadval kerak emas — kalitlar mavjud ruxsat xaritasiga
// (`custom_roles.permissions`, `profiles.permissions_override`) yoziladi,
// chunki u oddiy Record<string, boolean>. Kalit prefiksi `field.` —
// `modul.amal` kalitlari bilan hech qachon to'qnashmaydi.
//
// XAVFSIZLIK YO'NALISHI — QORA RO'YXAT, oq ro'yxat EMAS:
// standart holda hamma maydon ochiq, faqat shu ro'yxatdagilar yopiladi.
// Sabab: xato bo'lganda ma'lumot JIMGINA YO'QOLMASLIGI kerak. Oq ro'yxatda
// bitta unutilgan maydon foydalanuvchidan yashirinib qolardi va buni
// sezish qiyin (bugungi kunda shunga o'xshash uchta xato topilgan).
//
// CHEKLOV (halol qayd): filtr maydon NOMI bo'yicha ishlaydi. Shu sababli
// ro'yxatga faqat O'ZIGA XOS nomlar kiritilgan (`pinfl`, `diagnosis_code`...).
// `phone` kabi hamma joyda uchraydigan nomlar ATAYLAB kiritilmagan — ular
// uchun marshrutga bog'langan filtr kerak, u keyingi bosqichda.

export interface ProtectedField {
  /** Ruxsat kaliti — `field.` prefiksi bilan. */
  key: string;
  /** Javobdan olib tashlanadigan maydon nomi. */
  field: string;
  /** Qaysi obyektga tegishli (UI'da guruhlash uchun). */
  entityUz: string;
  labelUz: string;
  /** Nega himoyalangan — rol muharririda ko'rsatiladi. */
  noteUz: string;
  /** Shu rollar standart holda KO'RADI. Qolganlari ko'rmaydi. */
  defaultRoles: string[];
}

const CLINICAL = ['clinic_owner', 'clinic_admin', 'doctor', 'nurse'];
const FINANCE = ['clinic_owner', 'clinic_admin', 'cashier', 'accountant'];

export const PROTECTED_FIELDS: ProtectedField[] = [
  {
    key: 'field.patient.pinfl',
    field: 'pinfl',
    entityUz: 'Bemor',
    labelUz: 'PINFL',
    noteUz: "Shaxsiy identifikatsiya raqami. Faqat haqiqatan kerak bo'lganda oching.",
    defaultRoles: ['clinic_owner', 'clinic_admin'],
  },
  {
    key: 'field.patient.passport',
    field: 'passport_number',
    entityUz: 'Bemor',
    labelUz: 'Passport raqami',
    noteUz: 'Shaxsni tasdiqlovchi hujjat.',
    defaultRoles: ['clinic_owner', 'clinic_admin'],
  },
  {
    key: 'field.clinical.diagnosis_code',
    field: 'diagnosis_code',
    entityUz: 'Klinik',
    labelUz: 'Tashxis kodi (ICD-10)',
    noteUz: "Tibbiy sir. Qabulxona va kassa odatda ko'rmasligi kerak.",
    defaultRoles: CLINICAL,
  },
  {
    key: 'field.clinical.diagnosis_text',
    field: 'diagnosis_text',
    entityUz: 'Klinik',
    labelUz: 'Tashxis matni',
    noteUz: 'Tibbiy sir.',
    defaultRoles: CLINICAL,
  },
  {
    key: 'field.finance.cost_uzs',
    field: 'cost_uzs',
    entityUz: 'Moliya',
    labelUz: 'Xizmat tannarxi',
    noteUz: "Foyda marjasi ko'rinib qoladi — odatda faqat rahbariyat.",
    defaultRoles: FINANCE,
  },
  {
    key: 'field.staff.salary_fixed',
    field: 'salary_fixed_uzs',
    entityUz: 'Xodim',
    labelUz: 'Belgilangan maosh',
    noteUz: 'Xodimlarning bir-birining maoshini ko\'rishi odatda istalmaydi.',
    defaultRoles: ['clinic_owner', 'clinic_admin'],
  },
  {
    key: 'field.staff.salary_percent',
    field: 'salary_percent',
    entityUz: 'Xodim',
    labelUz: 'Maosh foizi',
    noteUz: 'Komissiya foizi.',
    defaultRoles: ['clinic_owner', 'clinic_admin'],
  },
];

/** Tez qidirish uchun: maydon nomi → tavsif. */
export const PROTECTED_BY_FIELD: Record<string, ProtectedField> = Object.fromEntries(
  PROTECTED_FIELDS.map((f) => [f.field, f]),
);

export const PROTECTED_FIELD_KEYS: string[] = PROTECTED_FIELDS.map((f) => f.key);

/**
 * Rol uchun standart maydon ruxsatlari.
 * `permissions_override` yoki custom rol bu qiymatlarni bekor qila oladi.
 */
export function defaultFieldPermissions(role: string): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const f of PROTECTED_FIELDS) {
    map[f.key] = f.defaultRoles.includes(role);
  }
  return map;
}

/**
 * Foydalanuvchi ko'ra OLMAYDIGAN maydon nomlari.
 * `perms` — computeEffectivePermissions natijasi + maydon kalitlari.
 */
export function hiddenFieldsFor(
  role: string,
  perms: Record<string, boolean> | null | undefined,
): string[] {
  const defaults = defaultFieldPermissions(role);
  const hidden: string[] = [];
  for (const f of PROTECTED_FIELDS) {
    const allowed = perms?.[f.key] ?? defaults[f.key] ?? false;
    if (!allowed) hidden.push(f.field);
  }
  return hidden;
}
