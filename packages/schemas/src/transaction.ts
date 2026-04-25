import { z } from 'zod';

export const PaymentMethodEnum = z.enum([
  'cash','card','transfer','insurance',
  'click','payme','uzum','kaspi','humo','uzcard','stripe',
]);

export const TransactionItemSchema = z.object({
  service_id: z.string().uuid().optional(),
  name: z.string(),
  price: z.number().int(),
  quantity: z.number().int().min(1).default(1),
});

export const CreateTransactionSchema = z.object({
  patient_id: z.string().uuid().optional(),
  appointment_id: z.string().uuid().optional(),
  amount_uzs: z.number().int(),
  payment_method: PaymentMethodEnum,
  kind: z.enum(['payment', 'refund', 'deposit', 'adjustment']).default('payment'),
  items: z.array(TransactionItemSchema).default([]),
});
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
