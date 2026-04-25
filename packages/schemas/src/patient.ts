import { z } from 'zod';

export const GenderEnum = z.enum(['male', 'female', 'other', 'unknown']);

export const ReferralSourceEnum = z.enum([
  'instagram',
  'telegram',
  'facebook',
  'tiktok',
  'youtube',
  'google',
  'billboard',
  'word_of_mouth',
  'doctor',
  'returning',
  'other',
]);
export type ReferralSource = z.infer<typeof ReferralSourceEnum>;

export const PatientSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  full_name: z.string().min(2),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  patronymic: z.string().optional().nullable(),
  dob: z.string().optional().nullable(),
  gender: GenderEnum.optional().nullable(),
  phone: z.string().optional().nullable(),
  secondary_phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  id_number: z.string().optional().nullable(),
  id_type: z.enum(['passport', 'id', 'driver']).optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  referral_source: ReferralSourceEnum.optional().nullable(),
  referral_notes: z.string().optional().nullable(),
  referral_partner_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).default([]),
  loyalty_points: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Patient = z.infer<typeof PatientSchema>;

export const CreatePatientSchema = PatientSchema.omit({
  id: true,
  clinic_id: true,
  created_at: true,
  updated_at: true,
  loyalty_points: true,
}).extend({
  full_name: z.string().min(2).optional(),
});
export type CreatePatientInput = z.infer<typeof CreatePatientSchema>;
