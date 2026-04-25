import { z } from 'zod';

export const PlanCodeEnum = z.enum(['demo', '25pro', '50pro', '120pro']);
export type PlanCode = z.infer<typeof PlanCodeEnum>;

export const SubscriptionStatusEnum = z.enum(['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);

export const PlanSchema = z.object({
  code: PlanCodeEnum,
  name: z.string(),
  price_usd_cents: z.number().int(),
  max_staff: z.number().int().nullable(),
  max_devices: z.number().int().nullable(),
  features: z.record(z.unknown()),
});
