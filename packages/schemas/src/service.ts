import { z } from 'zod';
import { I18nTextSchema } from './i18n';

export const ServiceSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  category_id: z.string().uuid().nullable(),
  name_i18n: I18nTextSchema,
  description_i18n: I18nTextSchema.nullable(),
  price_uzs: z.number().int().nonnegative(),
  duration_min: z.number().int().positive(),
  doctor_required: z.boolean(),
  room_type: z.string().nullable(),
  is_insurance_covered: z.boolean(),
  is_archived: z.boolean(),
  sort_order: z.number().int(),
  version: z.number().int(),
});
export type Service = z.infer<typeof ServiceSchema>;
