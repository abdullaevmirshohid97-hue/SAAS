import type { Credentials, EmailAdapter, EmailInput, SendResult } from '../types';

export class ResendAdapter implements EmailAdapter {
  readonly name = 'resend';

  constructor(private readonly creds: Credentials) {
    if (!creds['api_key']) throw new Error('Resend api_key required');
  }

  async send(input: EmailInput): Promise<SendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.creds['api_key']}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from ?? this.creds['from_default'] ?? 'Clary <hello@clary.uz>',
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
    });
    const body = (await res.json()) as { id?: string; message?: string };
    return res.ok
      ? { providerMessageId: body.id ?? '', status: 'sent' }
      : { providerMessageId: '', status: 'failed', error: body.message };
  }
}
