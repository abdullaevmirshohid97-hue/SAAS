import type { SmsAdapter, Credentials } from './types';
import { EskizAdapter } from './sms/eskiz';
import { PlaymobileAdapter } from './sms/playmobile';
import { TwilioAdapter } from './sms/twilio';

export class SmsFactory {
  static forProvider(name: string, creds: Credentials): SmsAdapter {
    switch (name) {
      case 'eskiz': return new EskizAdapter(creds);
      case 'playmobile': return new PlaymobileAdapter(creds);
      case 'twilio': return new TwilioAdapter(creds);
      default: throw new Error(`Unsupported SMS provider: ${name}`);
    }
  }
}
