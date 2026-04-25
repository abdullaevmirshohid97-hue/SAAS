import type { AdapterCredentials, ChargeInput, ChargeResult, PaymentAdapter, WebhookVerifyInput } from '../types';

/**
 * Kaspi Pay adapter for Kazakhstani clinics.
 */
export class KaspiAdapter implements PaymentAdapter {
  readonly name = 'kaspi' as const;

  constructor(private readonly creds: AdapterCredentials) {
    if (!creds['merchant_id'] || !creds['api_key']) throw new Error('Kaspi merchant_id and api_key required');
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    return {
      providerReference: input.idempotencyKey,
      status: 'pending',
      redirectUrl: `https://kaspi.kz/pay?merchant=${this.creds['merchant_id']}&amount=${input.amountMinor / 100}&ref=${input.idempotencyKey}`,
    };
  }

  async refund(ref: string, _amount: number): Promise<ChargeResult> {
    return { providerReference: ref, status: 'succeeded' };
  }

  async verifyWebhook(input: WebhookVerifyInput) {
    return { valid: input.signature.length > 0, event: JSON.parse(input.rawBody) };
  }
}
