import { z } from 'zod';

export const ReferralKindEnum = z.enum(['diagnostic', 'lab', 'service', 'inpatient', 'other']);
export type ReferralKind = z.infer<typeof ReferralKindEnum>;

export const ReferralUrgencyEnum = z.enum(['routine', 'urgent', 'stat']);
export type ReferralUrgency = z.infer<typeof ReferralUrgencyEnum>;

export const ReferralStatusEnum = z.enum(['pending', 'received', 'billed', 'completed', 'canceled']);
export type ReferralStatus = z.infer<typeof ReferralStatusEnum>;

export const ServiceReferralSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable().optional(),
  stay_id: z.string().uuid().nullable().optional(),
  doctor_id: z.string().uuid(),
  referral_kind: ReferralKindEnum,
  target_service_id: z.string().uuid().nullable().optional(),
  target_diagnostic_type_id: z.string().uuid().nullable().optional(),
  target_lab_test_id: z.string().uuid().nullable().optional(),
  target_room_id: z.string().uuid().nullable().optional(),
  urgency: ReferralUrgencyEnum,
  status: ReferralStatusEnum,
  clinical_indication: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  fulfilled_transaction_id: z.string().uuid().nullable().optional(),
  fulfilled_at: z.string().datetime().nullable().optional(),
  fulfilled_by: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  created_by: z.string().uuid(),
});
export type ServiceReferral = z.infer<typeof ServiceReferralSchema>;

export const CreateServiceReferralSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullable().optional(),
  stay_id: z.string().uuid().nullable().optional(),
  referral_kind: ReferralKindEnum,
  target_service_id: z.string().uuid().nullable().optional(),
  target_diagnostic_type_id: z.string().uuid().nullable().optional(),
  target_lab_test_id: z.string().uuid().nullable().optional(),
  target_room_id: z.string().uuid().nullable().optional(),
  urgency: ReferralUrgencyEnum.default('routine'),
  clinical_indication: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateServiceReferral = z.infer<typeof CreateServiceReferralSchema>;
