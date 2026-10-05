import { z } from 'zod';

// =============================================================================
// Dorixona API sxemalari (zod) — controller va servislar uchun yagona joy
// =============================================================================

export const PAYMENT_METHOD = z.enum([
  'cash',
  'card',
  'transfer',
  'insurance',
  'click',
  'payme',
  'uzum',
  'kaspi',
  'humo',
  'uzcard',
  'debt',
]);

/** To'lov qismlari uchun (qarz bu yerda emas — u alohida debt_uzs). */
export const PAY_LEG_METHOD = z.enum([
  'cash',
  'card',
  'transfer',
  'click',
  'payme',
  'uzum',
  'humo',
  'uzcard',
  'insurance',
]);

export const UNIT_KIND = z.enum(['unit', 'blister', 'pack']);

export const SaleSchema = z.object({
  /** Ikki marta bosish / tarmoq takroridan himoya (savat UUID'si). */
  idempotency_key: z.string().uuid().optional(),
  patient_id: z.string().uuid().optional(),
  // Qabulxona "Dori bilan" — shu savdoni reception transaction'iga bog'laydi
  // (jurnal feed bitta yozuvga birlashtiradi).
  reception_transaction_id: z.string().uuid().optional(),
  // Mijoz-klinika (B2B) + shu klinikaning shifokori
  pharmacy_clinic_id: z.string().uuid().optional(),
  pharmacy_doctor_id: z.string().uuid().optional(),
  prescription_id: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        medication_id: z.string().uuid(),
        quantity: z.number().int().positive().max(1_000_000),
        unit_kind: UNIT_KIND.optional(),
        unit_price_override_uzs: z.number().int().nonnegative().optional(),
        /** DataMatrix'dan o'qilgan partiya — avval shu partiyadan yechiladi. */
        preferred_batch_no: z.string().max(100).optional(),
      }),
    )
    .min(1)
    .max(500),
  payment_method: PAYMENT_METHOD,
  /** Bo'lib to'lash (naqd + karta ...). Bo'sh bo'lsa payment_method + paid_uzs. */
  payments: z
    .array(z.object({ method: PAY_LEG_METHOD, amount_uzs: z.number().int().positive() }))
    .max(6)
    .optional(),
  paid_uzs: z.number().int().nonnegative().optional(),
  debt_uzs: z.number().int().nonnegative().default(0),
  discount_uzs: z.number().int().nonnegative().default(0),
  received_cash_uzs: z.number().int().nonnegative().optional(),
  change_uzs: z.number().int().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
  shift_id: z.string().uuid().optional(),
  register_no: z.number().int().min(1).max(20).optional(),
});
export type SaleInput = z.infer<typeof SaleSchema>;

export const ReceiptItemSchema = z.object({
  medication_id: z.string().uuid(),
  /** Kiritilgan soni — `unit_kind` birligida (qadoq yoki dona). */
  quantity: z.number().positive().max(10_000_000),
  unit_kind: z.enum(['unit', 'pack']).optional(),
  /** Kiritilgan birlikning tannarxi (qadoq bo'lsa — qadoq tannarxi). */
  unit_cost_uzs: z.number().nonnegative(),
  // Foyda foizi — sotuv narxi = tannarx * (1 + foyda%/100)
  profit_percent: z.number().min(0).max(100_000).default(0),
  // Doktor ulushi: foizda YOKI bonus summada (faqat dorixona hisobotida)
  doctor_share_percent: z.number().min(0).max(100).default(0),
  doctor_share_bonus_uzs: z.number().int().nonnegative().default(0),
  manufacturer: z.string().max(200).optional(),
  manufacture_date: z.string().max(20).optional(),
  batch_no: z.string().max(100).optional(),
  expiry_date: z.string().max(20).optional(),
  /** Eski shakl: 1 dona sotuv narxi (frontend bevosita yuborsa). */
  unit_price_uzs: z.number().int().nonnegative().optional(),
  /** 1 dona sotuv narxi. */
  sale_price_uzs: z.number().int().nonnegative().optional(),
  /** Qadoq sotuv narxi (qadoqda > 1 dona bo'lsa). */
  pack_price_uzs: z.number().int().nonnegative().optional(),
  /** Yangi narx eskisidan past bo'lsa eskisi qolsin. */
  keep_higher_price: z.boolean().optional(),
  gtin: z.string().max(64).optional(),
  mxik_code: z.string().max(32).optional(),
  /** Fakturadagi nom — "firmadagi nom → bizdagi dori" xotirasi uchun. */
  source_name: z.string().max(300).optional(),
});

export const ReceiptSchema = z.object({
  idempotency_key: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional(),
  receipt_no: z.string().max(100).optional(),
  invoice_date: z.string().max(20).optional(),
  received_at: z.string().datetime().optional(),
  // Yetkazib beruvchiga to'langan summa (qarz = jami − to'langan)
  paid_uzs: z.number().int().nonnegative().optional(),
  payment_method: z.string().max(30).optional(),
  notes: z.string().max(1000).optional(),
  source: z.enum(['manual', 'excel', 'scan', 'po', 'opening']).optional(),
  file_name: z.string().max(300).optional(),
  file_hash: z.string().max(128).optional(),
  expected_total_uzs: z.number().int().nonnegative().optional(),
  items: z.array(ReceiptItemSchema).min(1).max(2000),
});
export type ReceiptInput = z.infer<typeof ReceiptSchema>;

// Mijoz-klinika (B2B) — dorixonaning o'z ro'yxati
export const PharmClinicSchema = z.object({
  name: z.string().min(1).max(200),
  contact_person: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
});
export const PharmDoctorSchema = z.object({
  full_name: z.string().min(1).max(200),
  phone: z.string().max(50).optional(),
});
export const ClinicPaymentSchema = z.object({
  amount_uzs: z.number().int().positive(),
  payment_method: z.string().max(30).optional(),
  notes: z.string().max(500).optional(),
});
export const VoidSaleSchema = z.object({ reason: z.string().max(500).optional() });
export const SupplierPaymentSchema = z.object({
  supplier_id: z.string().uuid(),
  amount_uzs: z.number().int().positive(),
  payment_method: z.string().max(30).optional(),
  notes: z.string().max(500).optional(),
});

// Dori (medication) — to'liq ma'lumotlar, dorixona oynasida boshqariladi
export const MedicationSchema = z.object({
  name: z.string().min(1).max(300),
  category_id: z.string().uuid().nullish(),
  manufacturer: z.string().max(200).optional(),
  strength: z.string().max(100).optional(),
  form: z.string().max(100).optional(),
  barcode: z.string().max(64).optional(),
  price_uzs: z.number().int().nonnegative().default(0),
  cost_uzs: z.number().int().nonnegative().nullish(),
  reorder_level: z.number().int().nonnegative().nullish(),
  requires_prescription: z.boolean().optional(),
  image_url: z.string().url().nullish(),
  // Birliklar (qadoq/blister/dona) — pack_qty faqat yangi dori yaratishda;
  // mavjud dorida /medications/:id/pack-size orqali (qoldiqni qayta hisoblaydi).
  pack_qty: z.number().int().min(1).max(10_000).optional(),
  blister_qty: z.number().int().min(1).max(10_000).nullish(),
  unit_name: z.string().max(40).nullish(),
  pack_price_uzs: z.number().int().nonnegative().nullish(),
  blister_price_uzs: z.number().int().nonnegative().nullish(),
  sell_by_unit: z.boolean().optional(),
  // Fiskal chek uchun
  mxik_code: z.string().max(32).nullish(),
  package_code: z.string().max(32).nullish(),
  vat_percent: z.number().min(0).max(100).nullish(),
  generic_name: z.string().max(200).nullish(),
});
export const MedicationUpdateSchema = MedicationSchema.partial();
export const MedCategorySchema = z.object({ name: z.string().min(1).max(100) });

export const BulkMedicationSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        strength: z.string().max(100).optional(),
        form: z.string().max(100).optional(),
        manufacturer: z.string().max(200).optional(),
        barcode: z.string().max(64).optional(),
        mxik_code: z.string().max(32).optional(),
        pack_qty: z.number().int().min(1).max(10_000).optional(),
        unit_name: z.string().max(40).optional(),
        price_uzs: z.number().int().nonnegative().optional(),
        requires_prescription: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export const PackSizeSchema = z.object({
  pack_qty: z.number().int().min(1).max(10_000),
  /** true: hozirgi qoldiq qadoqda yuritilgan — donaga o'tkaziladi. */
  convert_stock: z.boolean(),
});

export const BarcodeSchema = z.object({
  code: z.string().min(1).max(200),
  kind: z.enum(['manufacturer', 'internal', 'supplier']).optional(),
});

export const ImportMatchSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  rows: z
    .array(
      z.object({
        idx: z.number().int().nonnegative(),
        name: z.string().max(400).default(''),
        strength: z.string().max(100).optional(),
        barcode: z.string().max(200).optional(),
        mxik: z.string().max(40).optional(),
      }),
    )
    .max(3000),
});

export const ImportProfileSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  mapping: z.record(z.string(), z.unknown()),
});

export const ReceiptDraftSchema = z.object({
  title: z.string().max(200).optional(),
  payload: z.record(z.string(), z.unknown()),
  lines_count: z.number().int().nonnegative().optional(),
});

export const DuplicateCheckSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  receipt_no: z.string().max(100).optional(),
  file_hash: z.string().max(128).optional(),
});

// Yetkazib beruvchi firma (suppliers jadvali) — anketa
export const SupplierSchema = z.object({
  name: z.string().min(1).max(200),
  contact_person: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  tax_id: z.string().max(30).optional(),
});
export const SupplierUpdateSchema = SupplierSchema.partial();
// Firma bilan oldi-berdi (manual): payment (pul berdim) / debt (qarz) / adjustment
export const SupplierEntrySchema = z.object({
  entry_kind: z.enum(['payment', 'debt', 'adjustment']),
  amount_uzs: z.number().int(),
  payment_method: z.string().max(30).optional(),
  invoice_no: z.string().max(100).optional(),
  occurred_at: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
});

// ---- Dorixona kassasi ---------------------------------------------------------
export const OpenShiftSchema = z.object({
  opening_cash_uzs: z.number().int().nonnegative().default(0),
  register_no: z.number().int().min(1).max(20).optional(),
});
export const CloseShiftSchema = z.object({
  actual_cash_uzs: z.number().int().nonnegative(),
  notes: z.string().max(1000).optional(),
});
export const CashMovementSchema = z.object({
  kind: z.enum(['expense', 'encashment', 'cash_in', 'cash_out']),
  amount_uzs: z.number().int().positive(),
  notes: z.string().max(500).optional(),
  register_no: z.number().int().min(1).max(20).optional(),
});

// ---- Dorixona kirishi (qurilma, PIN) -----------------------------------------
export const DeviceRegisterSchema = z.object({
  device_key: z.string().min(16).max(200),
  name: z.string().min(1).max(100),
  register_no: z.number().int().min(1).max(20).nullish(),
});
export const DeviceUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  register_no: z.number().int().min(1).max(20).nullish(),
});
const PIN = z.string().regex(/^\d{4,6}$/, 'PIN 4–6 ta raqamdan iborat bo‘lishi kerak');
export const OperatorLoginSchema = z.object({ operator_id: z.string().uuid(), pin: PIN });
export const OperatorSetupSchema = z.object({
  full_name: z.string().min(1).max(100),
  pin: PIN,
});
export const OperatorCreateSchema = z.object({
  full_name: z.string().min(1).max(100),
  role: z.enum(['admin', 'cashier']),
  register_no: z.number().int().min(1).max(20).nullish(),
  pin: PIN,
  can_return: z.boolean().optional(),
  can_receive: z.boolean().optional(),
  can_discount: z.boolean().optional(),
});
export const OperatorUpdateSchema = z.object({
  full_name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'cashier']).optional(),
  register_no: z.number().int().min(1).max(20).nullish(),
  pin: PIN.optional(),
  can_return: z.boolean().optional(),
  can_receive: z.boolean().optional(),
  can_discount: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

// ---- Fiskal --------------------------------------------------------------------
export const FiscalSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['test', 'http']),
  company_tin: z.string().max(20).nullish(),
  company_name: z.string().max(200).nullish(),
  terminal_id: z.string().max(64).nullish(),
  endpoint_url: z.string().url().max(500).nullish(),
  /** Faqat yangilashda yuboriladi; bo'sh qoldirilsa eski kalit saqlanadi. */
  secret: z.string().max(2000).optional(),
  auto_send: z.boolean().optional(),
  block_without_mxik: z.boolean().optional(),
  default_vat_percent: z.number().min(0).max(100).optional(),
});

// ---- Sotuv oynasi: tezkor tugmalar ---------------------------------------------
// clinics.settings.pharmacy_quick_buttons da saqlanadi — barcha kassalarda bir xil.
export const QUICK_BUTTON_COLORS = ['emerald', 'sky', 'violet', 'amber', 'rose', 'slate'] as const;

export const QuickButtonSchema = z.object({
  medication_id: z.string().uuid(),
  /** Tugmadagi qisqa nom (bo'sh — dori nomi). */
  label: z.string().trim().max(40).nullish(),
  color: z.enum(QUICK_BUTTON_COLORS).default('emerald'),
  /** Bo'sh — dorining standart birligi. */
  unit_kind: UNIT_KIND.nullish(),
  qty: z.number().int().min(1).max(1000).default(1),
});

export const QuickButtonsSchema = z.object({
  buttons: z.array(QuickButtonSchema).max(30),
  /** true — bosilganda darhol savatga; false — miqdor oynasi ochiladi. */
  instant: z.boolean().default(false),
});
