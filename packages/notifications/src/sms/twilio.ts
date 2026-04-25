import type { Credentials, SendResult, SmsAdapter, SmsInput } from '../types';

export class TwilioAdapter implements SmsAdapter {
  readonly name = 'twilio';

  constructor(private readonly creds: Credentials) {
    if (!creds['account_sid'] || !creds['auth_token'] || !creds['from']) {
      throw new Error('Twilio account_sid, auth_token, from required');
    }
  }

  async send(input: SmsInput): Promise<SendResult> {
    const auth = Buffer.from(`${this.creds['account_sid']}:${this.creds['auth_token']}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.creds['account_sid']}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: input.to, From: input.from ?? this.creds['from']!, Body: input.text }),
    });
    const json = (await res.json()) as { sid?: string; error_message?: string };
    return res.ok
      ? { providerMessageId: json.sid ?? '', status: 'sent' }
      : { providerMessageId: '', status: 'failed', error: json.error_message };
  }
}
