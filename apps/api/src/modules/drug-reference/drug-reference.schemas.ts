import { z } from 'zod';

// =============================================================================
// Davlat dori katalogi — kiruvchi so'rovlar
// =============================================================================

export const REF_KIND = z.enum(['drug', 'bad', 'device', 'other']);

export const ReferenceSearchSchema = z.object({
  q: z.string().max(200).default(''),
  kind: REF_KIND.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const PackageSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().max(300),
  qty: z.number().int().min(1).max(10_000),
});

export const AdoptSchema = z.object({
  mxik_code: z.string().regex(/^\d{17}$/, 'MXIK kodi 17 xonali'),
  /** Skanerlangan kod (EAN-13 / DataMatrix) — doriga biriktiriladi. */
  barcode: z.string().max(200).nullish(),
  sell_by_unit: z.boolean().nullish(),
  /** Brauzer MXIK'dan olgan qadoq kodlari — server o'zi ololmasa ishlatiladi. */
  packages: z.array(PackageSchema).max(30).nullish(),
});

/** Katalog yozuvi (@clary/utils mapMxikRow natijasi) — brauzer orqali yuklashda. */
export const DrugReferenceRowSchema = z.object({
  mxik_code: z.string().regex(/^\d{17}$/),
  kind: REF_KIND,
  name: z.string().min(1).max(300),
  manufacturer: z.string().max(200).nullable(),
  attribute: z.string().max(500).nullable(),
  form: z.string().max(100).nullable(),
  strength: z.string().max(100).nullable(),
  pack_qty: z.number().int().min(1).max(10_000),
  blister_qty: z.number().int().min(1).max(10_000).nullable(),
  unit_name: z.string().max(40).nullable(),
  generic_name: z.string().max(200).nullable(),
  atc_code: z.string().max(10).nullable(),
  class_code: z.string().regex(/^\d{5}$/),
  subposition_name: z.string().max(300).nullable(),
  vat_exempt: z.boolean(),
  gtins: z.array(z.string().regex(/^\d{14}$/)).max(20),
});

export const BrowserSyncRowsSchema = z.object({
  sync_id: z.string().uuid(),
  rows: z.array(DrugReferenceRowSchema).min(1).max(1000),
});

const ClassProgressSchema = z.object({
  label: z.string().max(200),
  total: z.number().int().nonnegative(),
  fetched: z.number().int().nonnegative(),
  mapped: z.number().int().nonnegative(),
  upserted: z.number().int().nonnegative(),
  complete: z.boolean(),
  error: z.string().max(500).nullable(),
});

export const BrowserSyncFinishSchema = z.object({
  sync_id: z.string().uuid(),
  classes: z.record(z.string().regex(/^\d{5,17}$/), ClassProgressSchema),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();

/** Reestr qatori — web-admin Excel'dan normallashtirib yuboradi. */
export const RegistryRowSchema = z.object({
  reg_number: z.string().max(100).nullish(),
  product_type: z.enum(['drug', 'device']).nullish(),
  trade_name: z.string().min(1).max(500),
  generic_name: z.string().max(300).nullish(),
  atc_code: z.string().max(10).nullish(),
  manufacturer: z.string().max(300).nullish(),
  country: z.string().max(100).nullish(),
  release_form: z.string().max(300).nullish(),
  dosage: z.string().max(200).nullish(),
  reg_date: isoDate,
  valid_until: isoDate,
  is_active: z.boolean().nullish(),
  rx_required: z.boolean().nullish(),
});

export const RegistryImportSchema = z.object({
  import_id: z.string().uuid(),
  rows: z.array(RegistryRowSchema).min(1).max(2000),
});

export const RegistryActivateSchema = z.object({
  import_id: z.string().uuid(),
  file_name: z.string().max(300).nullish(),
});

export type AdoptInput = z.infer<typeof AdoptSchema>;
export type RegistryRow = z.infer<typeof RegistryRowSchema>;
