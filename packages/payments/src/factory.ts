import type { PaymentAdapter, PaymentProviderName, AdapterCredentials } from './types';
import { StripeAdapter } from './providers/stripe';
import { ClickAdapter } from './providers/click';
import { PaymeAdapter } from './providers/payme';
import { UzumAdapter } from './providers/uzum';
import { KaspiAdapter } from './providers/kaspi';
import { MbankAdapter } from './providers/mbank';

export class PaymentFactory {
  static forProvider(name: PaymentProviderName, creds: AdapterCredentials): PaymentAdapter {
    switch (name) {
      case 'stripe': return new StripeAdapter(creds);
      case 'click': return new ClickAdapter(creds);
      case 'payme': return new PaymeAdapter(creds);
      case 'uzum': return new UzumAdapter(creds);
      case 'kaspi': return new KaspiAdapter(creds);
      case 'mbank': return new MbankAdapter(creds);
      default: throw new Error(`Unsupported payment provider: ${name}`);
    }
  }
}
