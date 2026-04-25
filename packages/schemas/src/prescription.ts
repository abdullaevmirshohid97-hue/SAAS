import { z } from 'zod';

export const PrescriptionStatusEnum = z.enum([
  'issued',
  'partially_dispensed',
  'dispensed',
  'canceled',
  'expired',
]);
export type PrescriptionStatus = z.infer<typeof PrescriptionStatusEnum>;

export const PrescriptionItemSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  prescription_id: z.string().uuid(),
  medication_id: z.string().uuid().nullable().optional(),
  medication_name_snapshot: z.string(),
  dosage: z.string().nullable().optional(),
  route: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  dispensed_qty: z.number().int().nonnegative(),
  unit_price_snapshot: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime(),
});
export type PrescriptionItem = z.infer<typeof PrescriptionItemSchema>;

export const PrescriptionSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable().optional(),
  stay_id: z.string().uuid().nullable().optional(),
  rx_number: z.string().nullable().optional(),
  status: PrescriptionStatusEnum,
  diagnosis_code: z.string().nullable().optional(),
  diagnosis_text: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  is_signed: z.boolean(),
  signed_at: z.string().datetime().nullable().optional(),
  total_estimated_uzs: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  created_by: z.string().uuid(),
});
export type Prescription = z.infer<typeof PrescriptionSchema>;

export const CreatePrescriptionItemSchema = z.object({
  medication_id: z.string().uuid().optional(),
  medication_name_snapshot: z.string().min(1),
  dosage: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  unit_price_snapshot: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

export const CreatePrescriptionSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().optional(),
  stay_id: z.string().uuid().optional(),
  diagnosis_code: z.string().optional(),
  diagnosis_text: z.string().optional(),
  instructions: z.string().max(4000).optional(),
  valid_until: z.string().optional(),
  items: z.array(CreatePrescriptionItemSchema).min(1),
  sign: z.boolean().default(false),
});
export type CreatePrescription = z.infer<typeof CreatePrescriptionSchema>;
