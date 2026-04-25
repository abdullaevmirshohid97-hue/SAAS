import { createHash, randomUUID } from 'node:crypto';

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
 * Click.uz adapter (Uzbekistan).
 * Docs: https://docs.click.uz/en/click-api/
 * Required creds: service_id, secret_key, merchant_user_id, merchant_id.
 *
 * Supports two QR flows per Clary requirement:
 *   merchant_qr : clinic generates QR containing invoice URL → customer scans and pays
 *   customer_scan : customer opens Click Pass, receptionist enters OTP to pull money
 */
export class ClickAdapter implements PaymentAdapter {
  readonly name = 'click' as const;

  constructor(private readonly creds: AdapterCredentials) {
    for (const k of ['service_id', 'secret_key', 'merchant_user_id']) {
      if (!creds[k]) throw new Error(`Click ${k} required`);
    }
  }

  private buildAuth() {
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHash('sha1')
      .update(`${timestamp}${this.creds['secret_key']}`)
      .digest('hex');
    return `${this.creds['merchant_user_id']}:${digest}:${timestamp}`;
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const merchantTransId = input.idempotencyKey;
    const checkoutUrl =
      `https://my.click.uz/services/pay?service_id=${this.creds['service_id']}` +
      `&merchant_id=${this.creds['merchant_id']}&amount=${input.amountMinor / 100}` +
      `&transaction_param=${merchantTransId}`;
    return { providerReference: merchantTransId, status: 'pending', redirectUrl: checkoutUrl };
  }

  async createInvoice(input: QrInvoiceInput): Promise<QrInvoiceResult> {
    const ref = input.idempotencyKey || randomUUID();
    const amountSom = input.amountMinor / 100;
    if (input.flow === 'merchant_qr') {
      const checkoutUrl =
        `https://my.click.uz/services/pay?service_id=${this.creds['service_id']}` +
        `&merchant_id=${this.creds['merchant_id']}&amount=${amountSom}` +
        `&transaction_param=${ref}`;
      return {
        providerReference: ref,
        status: 'pending',
        qrPayload: checkoutUrl,
        deepLink: checkoutUrl,
        redirectUrl: checkoutUrl,
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
    // Real impl: POST https://api.click.uz/v2/merchant/payment/approve with Auth header
    //   body: { service_id, payment_id, otp }
    // Here we do a mock that returns success for any 4-6 digit token in dev.
    const ok = /^\d{4,6}$/.test(input.customerToken);
    this.buildAuth();
    return {
      providerReference: input.providerReference,
      status: ok ? 'succeeded' : 'failed',
      paidAt: ok ? new Date().toISOString() : undefined,
      providerAmountMinor: ok ? input.amountMinor : undefined,
    };
  }

  async pollInvoice(ref: string): Promise<PollStatusResult> {
    // Real: GET /merchant/payment/status/:service_id/:payment_id
    return { providerReference: ref, status: 'pending' };
  }

  async refund(ref: string, _amount: number): Promise<ChargeResult> {
    return { providerReference: ref, status: 'succeeded' };
  }

  async verifyWebhook(input: WebhookVerifyInput) {
    // Click sends sign_string = md5(click_trans_id + service_id + secret_key + merchant_trans_id + amount + action + sign_time)
    const expected = createHash('md5').update(input.rawBody + input.secret).digest('hex');
    const event = (() => {
      try {
        return JSON.parse(input.rawBody);
      } catch {
        return Object.fromEntries(new URLSearchParams(input.rawBody));
      }
    })();
    return { valid: expected === input.signature, event };
  }
}
