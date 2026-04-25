import { z } from 'zod';

export const AppointmentStatusEnum = z.enum(['scheduled', 'checked_in', 'in_progress', 'completed', 'canceled', 'no_show']);

export const AppointmentSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid().nullable(),
  service_id: z.string().uuid().nullable(),
  room_id: z.string().uuid().nullable(),
  scheduled_at: z.string(),
  duration_min: z.number().int().positive(),
  status: AppointmentStatusEnum,
  service_name_snapshot: z.string().nullable(),
  service_price_snapshot: z.number().int().nullable(),
  reason: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type Appointment = z.infer<typeof AppointmentSchema>;
