import { createHash, createHmac, randomUUID } from 'node:crypto';

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
 * MBANK (KG / UZ) payment adapter.
 *
 * Mode:
 *   - mock   : simulates end-to-end flow without calling real MBANK APIs.
 *              Used when tenant's integration card is marked as mock/sandbox,
 *              or when MBANK credentials are not yet provisioned.
 *   - live   : placeholder — contract / certification pending with MBANK.
 *              We accept credentials and lay out the request/response shape,
 *              so wiring live mode is a config switch, not a refactor.
 *
 * Supported flows:
 *   charge            — hosted payment page (redirect)
 *   createInvoice     — merchant_qr (clinic generates QR) and customer_scan
 *   verifyPass        — customer_scan: cashier enters OTP/code
 *   pollInvoice       — idempotent status pull
 *   verifyWebhook     — HMAC-SHA256 signature check
 *
 * Required creds (live): merchant_id, terminal_id, secret_key.
 * Mock mode: no creds required; any credentials are accepted.
 */
export class MbankAdapter implements PaymentAdapter {
  readonly name = 'mbank' as const;

  private readonly mock: boolean;

  constructor(private readonly creds: AdapterCredentials) {
    this.mock =
      creds['mode'] === 'mock' ||
      creds['is_mock'] === 'true' ||
      !creds['merchant_id'] ||
      !creds['secret_key'];
  }

  // --------------------------------------------------------------------------
  // charge: redirect-based checkout (hosted page)
  // --------------------------------------------------------------------------
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const ref = input.idempotencyKey || randomUUID();
    if (this.mock) {
      const checkoutUrl = `https://sandbox.mbank.mock/pay?ref=${encodeURIComponent(ref)}&amount=${input.amountMinor}`;
      return {
        providerReference: ref,
        status: 'pending',
        redirectUrl: checkoutUrl,
        raw: { mock: true, provider: 'mbank' },
      };
    }
    // Live call (placeholder — finalise when MBANK contract is signed):
    //   POST https://api.mbank.uz/v1/payments
    //   Headers: Authorization: Bearer <merchant_token>, X-Terminal-ID: <terminal_id>
    //   Body: { amount, currency, order_id, return_url, webhook_url, description }
    //   Response: { payment_url, payment_id }
    throw new Error('MBANK live mode not yet enabled. Switch integration to mock.');
  }

  // --------------------------------------------------------------------------
  // createInvoice: QR-based flows (merchant_qr / customer_scan)
  // --------------------------------------------------------------------------
  async createInvoice(input: QrInvoiceInput): Promise<QrInvoiceResult> {
    const ref = input.idempotencyKey || randomUUID();
    const expiresInSec = input.expiresInSec ?? 600;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

    if (this.mock) {
      if (input.flow === 'merchant_qr') {
        const payload = `mbank://pay?merchant=${this.creds['merchant_id'] ?? 'SANDBOX'}&ref=${ref}&amount=${input.amountMinor}`;
        return {
          providerReference: ref,
          status: 'pending',
          qrPayload: payload,
          deepLink: payload,
          expiresAt,
          raw: { mock: true, flow: 'merchant_qr' },
        };
      }
      return {
        providerReference: ref,
        status: 'pending',
        expiresAt,
        raw: { mock: true, flow: 'customer_scan' },
      };
    }
    throw new Error('MBANK live mode not yet enabled. Switch integration to mock.');
  }

  // --------------------------------------------------------------------------
  // verifyPass: cashier enters OTP shown by customer's MBANK app
  // --------------------------------------------------------------------------
  async verifyPass(input: {
    providerReference: string;
    customerToken: string;
    amountMinor: number;
  }): Promise<PollStatusResult> {
    if (this.mock) {
      // Accept 4-6 digit OTP in mock mode (mirrors Click adapter UX).
      const ok = /^\d{4,6}$/.test(input.customerToken);
      return {
        providerReference: input.providerReference,
        status: ok ? 'succeeded' : 'failed',
        paidAt: ok ? new Date().toISOString() : undefined,
        providerAmountMinor: ok ? input.amountMinor : undefined,
      };
    }
    throw new Error('MBANK live mode not yet enabled. Switch integration to mock.');
  }

  // --------------------------------------------------------------------------
  // pollInvoice: status pull (idempotent)
  // --------------------------------------------------------------------------
  async pollInvoice(ref: string): Promise<PollStatusResult> {
    if (this.mock) {
      return { providerReference: ref, status: 'pending' };
    }
    // Live: GET /v1/payments/:id → { status, paid_at, amount }
    throw new Error('MBANK live mode not yet enabled.');
  }

  // --------------------------------------------------------------------------
  // refund
  // --------------------------------------------------------------------------
  async refund(ref: string, _amount: number): Promise<ChargeResult> {
    if (this.mock) {
      return { providerReference: ref, status: 'succeeded', raw: { mock: true } };
    }
    throw new Error('MBANK live mode not yet enabled.');
  }

  // --------------------------------------------------------------------------
  // verifyWebhook: HMAC-SHA256 (X-Signature header)
  // --------------------------------------------------------------------------
  async verifyWebhook(input: WebhookVerifyInput) {
    const event = (() => {
      try {
        return JSON.parse(input.rawBody);
      } catch {
        return Object.fromEntries(new URLSearchParams(input.rawBody));
      }
    })();

    if (this.mock) {
      // Mock: accept any signature, but still compute it so tests can assert determinism.
      const expected = createHash('sha256').update(input.rawBody).digest('hex');
      return { valid: true, event, debug: { expected } as Record<string, unknown> };
    }

    const expected = createHmac('sha256', input.secret).update(input.rawBody).digest('hex');
    const valid = safeEqual(expected, input.signature);
    return { valid, event };
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
