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

export const AdoptSchema = z.object({
  mxik_code: z.string().regex(/^\d{17}$/, 'MXIK kodi 17 xonali'),
  /** Skanerlangan kod (EAN-13 / DataMatrix) — doriga biriktiriladi. */
  barcode: z.string().max(200).nullish(),
  sell_by_unit: z.boolean().nullish(),
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
