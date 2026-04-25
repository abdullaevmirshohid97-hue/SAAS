import Stripe from 'stripe';

import type { AdapterCredentials, ChargeInput, ChargeResult, PaymentAdapter, WebhookVerifyInput } from '../types';

export class StripeAdapter implements PaymentAdapter {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(creds: AdapterCredentials) {
    if (!creds['secret_key']) throw new Error('Stripe secret_key required');
    this.stripe = new Stripe(creds['secret_key'], { apiVersion: '2024-06-20' });
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency,
        description: input.description,
        metadata: input.metadata,
        receipt_email: input.customer?.email,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      providerReference: intent.id,
      status: intent.status === 'succeeded' ? 'succeeded' : 'pending',
      clientSecret: intent.client_secret ?? undefined,
      raw: intent,
    };
  }

  async refund(ref: string, amountMinor: number): Promise<ChargeResult> {
    const refund = await this.stripe.refunds.create({ payment_intent: ref, amount: amountMinor });
    return { providerReference: refund.id, status: 'succeeded', raw: refund };
  }

  async verifyWebhook(input: WebhookVerifyInput) {
    try {
      const event = this.stripe.webhooks.constructEvent(input.rawBody, input.signature, input.secret);
      return { valid: true, event };
    } catch {
      return { valid: false, event: null };
    }
  }
}
