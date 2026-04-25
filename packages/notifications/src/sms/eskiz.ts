import type { Credentials, SendResult, SmsAdapter, SmsInput } from '../types';

/**
 * Eskiz.uz SMS adapter (Uzbekistan). https://documenter.getpostman.com/view/663428/RzfmES4z
 */
export class EskizAdapter implements SmsAdapter {
  readonly name = 'eskiz';
  private token: string | null = null;
  private tokenExpires = 0;

  constructor(private readonly creds: Credentials) {
    if (!creds['email'] || !creds['password']) throw new Error('Eskiz email and password required');
  }

  private async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    const res = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.creds['email'], password: this.creds['password'] }),
    });
    const body = (await res.json()) as { data?: { token: string } };
    if (!body.data?.token) throw new Error('Eskiz auth failed');
    this.token = body.data.token;
    this.tokenExpires = Date.now() + 25 * 24 * 60 * 60 * 1000; // 25 days
    return this.token;
  }

  async send(input: SmsInput): Promise<SendResult> {
    const token = await this.authenticate();
    const res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mobile_phone: input.to.replace(/\D/g, ''),
        message: input.text,
        from: input.from ?? '4546',
      }),
    });
    const body = (await res.json()) as { id?: string; status?: string; message?: string };
    if (res.ok) {
      return { providerMessageId: body.id ?? '', status: 'sent', raw: body };
    }
    return { providerMessageId: '', status: 'failed', error: body.message, raw: body };
  }
}
