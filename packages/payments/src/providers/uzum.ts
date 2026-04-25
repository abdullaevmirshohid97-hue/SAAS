import type { AdapterCredentials, ChargeInput, ChargeResult, PaymentAdapter, WebhookVerifyInput } from '../types';

/**
 * Uzum Bank / Uzum Pay adapter. Stub for clinics that want Uzum integration.
 * Real implementation calls https://api.uzumbank.uz.
 */
export class UzumAdapter implements PaymentAdapter {
  readonly name = 'uzum' as const;

  constructor(private readonly creds: AdapterCredentials) {
    if (!creds['api_key'] || !creds['terminal_id']) throw new Error('Uzum api_key and terminal_id required');
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    return {
      providerReference: input.idempotencyKey,
      status: 'pending',
      redirectUrl: `https://checkout.uzum.uz/pay?terminal=${this.creds['terminal_id']}&amount=${input.amountMinor / 100}&order=${input.idempotencyKey}`,
    };
  }

  async refund(ref: string, _amount: number): Promise<ChargeResult> {
    return { providerReference: ref, status: 'succeeded' };
  }

  async verifyWebhook(input: WebhookVerifyInput) {
    return { valid: input.signature.length > 0, event: JSON.parse(input.rawBody) };
  }
}
