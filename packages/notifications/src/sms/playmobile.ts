import type { Credentials, SendResult, SmsAdapter, SmsInput } from '../types';

/**
 * Playmobile.uz SMS adapter. https://playmobile.uz/api
 */
export class PlaymobileAdapter implements SmsAdapter {
  readonly name = 'playmobile';

  constructor(private readonly creds: Credentials) {
    if (!creds['login'] || !creds['password']) throw new Error('Playmobile login and password required');
  }

  async send(input: SmsInput): Promise<SendResult> {
    const auth = Buffer.from(`${this.creds['login']}:${this.creds['password']}`).toString('base64');
    const res = await fetch('https://send.smsxabar.uz/broker-api/send', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            recipient: input.to.replace(/\D/g, ''),
            'message-id': input.idempotencyKey ?? crypto.randomUUID(),
            sms: { originator: input.from ?? '3700', content: { text: input.text } },
          },
        ],
      }),
    });
    if (res.ok) {
      return { providerMessageId: input.idempotencyKey ?? '', status: 'queued' };
    }
    return { providerMessageId: '', status: 'failed', error: await res.text() };
  }
}
