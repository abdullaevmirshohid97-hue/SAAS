export type PaymentMode = 'platform' | 'tenant';

export type PaymentProviderName =
  | 'stripe'
  | 'click'
  | 'payme'
  | 'uzum'
  | 'kaspi'
  | 'mbank'
  | 'humo'
  | 'uzcard'
  | 'apelsin';

export interface ChargeInput {
  amountMinor: number; // cents or tiyin
  currency: string;
  idempotencyKey: string;
  description?: string;
  metadata?: Record<string, string>;
  customer?: { id?: string; email?: string; phone?: string; name?: string };
  returnUrl?: string;
  webhookUrl?: string;
}

export interface ChargeResult {
  providerReference: string;
  status: 'pending' | 'succeeded' | 'failed';
  redirectUrl?: string;
  clientSecret?: string;
  raw?: unknown;
}

export interface WebhookVerifyInput {
  rawBody: string;
  signature: string;
  secret: string;
}

export type QrFlowDirection = 'merchant_qr' | 'customer_scan';

export interface QrInvoiceInput extends ChargeInput {
  flow: QrFlowDirection;
  /** For customer_scan: the OTP/token shown by customer's Click Pass / Payme app */
  customerToken?: string;
  expiresInSec?: number;
}

export interface QrInvoiceResult extends ChargeResult {
  /** Data URL or string encoded in the QR (usually a deep-link). Undefined for customer_scan until verified. */
  qrPayload?: string;
  /** Deep-link for Click / Payme app (tap-to-pay on same device) */
  deepLink?: string;
  /** UTC ISO timestamp when the QR expires */
  expiresAt?: string;
}

export interface PollStatusResult {
  providerReference: string;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'expired';
  paidAt?: string;
  providerAmountMinor?: number;
}

export interface PaymentAdapter {
  readonly name: PaymentProviderName;
  charge(input: ChargeInput): Promise<ChargeResult>;
  refund(providerReference: string, amountMinor: number): Promise<ChargeResult>;
  verifyWebhook(input: WebhookVerifyInput): Promise<{ valid: boolean; event: unknown }>;
  /** Optional QR-specific methods (Click Pass / Payme P2P / Uzum QR) */
  createInvoice?(input: QrInvoiceInput): Promise<QrInvoiceResult>;
  pollInvoice?(providerReference: string): Promise<PollStatusResult>;
  /** Customer-scan: receptionist enters OTP/code shown by customer's app and we pull money */
  verifyPass?(input: { providerReference: string; customerToken: string; amountMinor: number }): Promise<PollStatusResult>;
}

export interface AdapterCredentials {
  [key: string]: string | undefined;
}
