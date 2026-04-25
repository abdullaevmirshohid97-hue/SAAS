import { randomUUID } from 'node:crypto';

import type {
  AdapterCredentials,
  ChargeInput,
  ChargeResult,
  PaymentAdapter,
  PollStatusResult,
  QrInvoiceInput,
  QrInvoiceResult,
  WebhookVerifyInput,
} from '../types';

/**
 * Payme.uz adapter (Uzbekistan, Merchant API).
 * Required creds: merchant_id, key.
 *
 * Supports:
 *  - merchant_qr: Payme checkout URL encoded as QR (most common for counter)
 *  - customer_scan: Payme Pass code (receptionist enters it)
 */
export class PaymeAdapter implements PaymentAdapter {
  readonly name = 'payme' as const;

  constructor(private readonly creds: AdapterCredentials) {
    if (!creds['merchant_id'] || !creds['key']) throw new Error('Payme merchant_id and key required');
  }

  private checkoutUrl(orderId: string, amountMinor: number): string {
    const paramsB64 = Buffer.from(
      `m=${this.creds['merchant_id']};ac.order_id=${orderId};a=${amountMinor}`,
    ).toString('base64');
    return `https://checkout.paycom.uz/${paramsB64}`;
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    return {
      providerReference: input.idempotencyKey,
      status: 'pending',
      redirectUrl: this.checkoutUrl(input.idempotencyKey, input.amountMinor),
    };
  }

  async createInvoice(input: QrInvoiceInput): Promise<QrInvoiceResult> {
    const ref = input.idempotencyKey || randomUUID();
    if (input.flow === 'merchant_qr') {
      const url = this.checkoutUrl(ref, input.amountMinor);
      return {
        providerReference: ref,
        status: 'pending',
        qrPayload: url,
        deepLink: url,
        redirectUrl: url,
        expiresAt: new Date(Date.now() + (input.expiresInSec ?? 600) * 1000).toISOString(),
      };
    }
    return {
      providerReference: ref,
      status: 'pending',
      expiresAt: new Date(Date.now() + (input.expiresInSec ?? 300) * 1000).toISOString(),
    };
  }

  async verifyPass(input: { providerReference: string; customerToken: string; amountMinor: number }): Promise<PollStatusResult> {
    // Real impl: POST https://merchant.paycom.uz/api with receipts.pay method using X-Auth header
    // Dev mock: 6 digit token succeeds
    const ok = /^\d{6}$/.test(input.customerToken);
    return {
      providerReference: input.providerReference,
      status: ok ? 'succeeded' : 'failed',
      paidAt: ok ? new Date().toISOString() : undefined,
      providerAmountMinor: ok ? input.amountMinor : undefined,
    };
  }

  async pollInvoice(ref: string): Promise<PollStatusResult> {
    return { providerReference: ref, status: 'pending' };
  }

  async refund(ref: string, _amount: number): Promise<ChargeResult> {
    return { providerReference: ref, status: 'succeeded' };
  }

  async verifyWebhook(input: WebhookVerifyInput) {
    const basic = Buffer.from(`Paycom:${input.secret}`).toString('base64');
    return { valid: input.signature === `Basic ${basic}`, event: JSON.parse(input.rawBody) };
  }
}
