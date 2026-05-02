import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'node:crypto';

import { SupabaseService } from '../../common/services/supabase.service';

const OTP_TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_PER_PHONE_PER_HOUR = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const normalizePhone = (raw: string): string => {
  let v = raw.replace(/\D/g, '');
  if (v.startsWith('00998')) v = v.slice(2);
  if (v.startsWith('998')) v = v;
  else if (v.length === 9) v = '998' + v;
  return '+' + v;
};

interface EskizTokenCache {
  token: string;
  expires_at: number;
}

/**
 * Eskiz.uz SMS provider — token-based auth, then send SMS.
 * Docs: https://documenter.getpostman.com/view/663428/RzfmES4z
 *
 * Required env:
 *   ESKIZ_EMAIL=<your@email>
 *   ESKIZ_PASSWORD=<api-password>
 *   ESKIZ_FROM=4546                    (sender id, default OK)
 *   ESKIZ_BASE_URL=https://notify.eskiz.uz/api  (default)
 *
 * If ESKIZ_EMAIL is empty, the service runs in DEV MODE — it logs
 * the OTP code instead of calling Eskiz, so you can test locally.
 */
@Injectable()
export class SmsOtpService {
  private readonly log = new Logger(SmsOtpService.name);
  private tokenCache: EskizTokenCache | null = null;
  private readonly base = process.env.ESKIZ_BASE_URL ?? 'https://notify.eskiz.uz/api';
  private readonly from = process.env.ESKIZ_FROM ?? '4546';
  private readonly devMode = !process.env.ESKIZ_EMAIL || !process.env.ESKIZ_PASSWORD;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwt: JwtService,
  ) {
    if (this.devMode) {
      this.log.warn(
        'SmsOtpService running in DEV MODE — OTP codes will be logged instead of sent. Set ESKIZ_EMAIL/PASSWORD for production.',
      );
    }
  }

  // -------------------------------------------------------- OTP request flow
  async requestOtp(rawPhone: string, ip?: string, userAgent?: string) {
    const phone = normalizePhone(rawPhone);
    if (!/^\+998\d{9}$/.test(phone)) {
      throw new BadRequestException('Telefon raqam noto\'g\'ri formatda');
    }

    const admin = this.supabase.admin();

    // Rate limit: max N requests per phone per hour
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await admin
      .from('patient_otp_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('phone', phone)
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_PHONE_PER_HOUR) {
      throw new BadRequestException('Juda ko\'p urinish. 1 soatdan keyin urinib ko\'ring.');
    }

    // Invalidate old codes for this phone
    await admin
      .from('patient_otp_sessions')
      .update({ is_used: true })
      .eq('phone', phone)
      .eq('is_used', false);

    // Generate 6-digit code
    const code = String(randomInt(100_000, 999_999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();

    const { data: session, error } = await admin
      .from('patient_otp_sessions')
      .insert({
        phone,
        otp_hash: sha256(code),
        expires_at: expiresAt,
        ip_address: ip,
        user_agent: userAgent,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    // Send SMS
    const message = `CLARY CARE: tasdiqlash kodingiz ${code}. ${OTP_TTL_MIN} daqiqa amal qiladi.`;
    if (this.devMode) {
      this.log.warn(`[DEV] OTP for ${phone}: ${code}`);
    } else {
      try {
        await this.sendSms(phone.replace('+', ''), message);
      } catch (e) {
        this.log.error(`Eskiz SMS send failed: ${(e as Error).message}`);
        // Mark session unusable so user retries
        await admin.from('patient_otp_sessions').update({ is_used: true }).eq('id', session.id);
        throw new BadRequestException('SMS yuborishda xatolik. Keyinroq urinib ko\'ring.');
      }
    }

    return {
      session_id: session.id,
      phone,
      expires_in_sec: OTP_TTL_MIN * 60,
      dev_code: this.devMode ? code : undefined,
    };
  }

  // -------------------------------------------------------- OTP verify flow
  async verifyOtp(rawPhone: string, code: string) {
    const phone = normalizePhone(rawPhone);
    const admin = this.supabase.admin();

    const { data: session, error } = await admin
      .from('patient_otp_sessions')
      .select('*')
      .eq('phone', phone)
      .eq('is_used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!session) throw new UnauthorizedException('Kod muddati o\'tgan yoki topilmadi');

    if (session.attempts >= MAX_ATTEMPTS) {
      await admin.from('patient_otp_sessions').update({ is_used: true }).eq('id', session.id);
      throw new UnauthorizedException('Juda ko\'p urinish. Yangi kod oling.');
    }

    if (session.otp_hash !== sha256(code)) {
      await admin
        .from('patient_otp_sessions')
        .update({ attempts: session.attempts + 1 })
        .eq('id', session.id);
      throw new UnauthorizedException('Noto\'g\'ri kod');
    }

    // Mark consumed
    await admin.from('patient_otp_sessions').update({ is_used: true }).eq('id', session.id);

    // Find or create portal_user by phone
    const { data: existing } = await admin
      .from('portal_users')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    let user = existing;
    if (!user) {
      const { data: created, error: cErr } = await admin
        .from('portal_users')
        .insert({ phone, full_name: phone, is_verified: true })
        .select('*')
        .single();
      if (cErr) throw new BadRequestException(cErr.message);
      user = created;
    }

    // Issue JWT compatible with AuthGuard (uses SUPABASE_JWT_SECRET).
    // Subject = portal_user_id; role marker so guard can recognize portal user.
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        role: 'authenticated',
        aud: 'authenticated',
        portal_user: true,
        phone,
      },
      { expiresIn: '30d' },
    );

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in_sec: 30 * 24 * 3600,
      user: {
        id: user.id,
        phone: user.phone,
        full_name: user.full_name,
        is_verified: user.is_verified,
      },
    };
  }

  // -------------------------------------------------------- Eskiz internals
  private async getEskizToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expires_at > Date.now()) {
      return this.tokenCache.token;
    }
    const res = await fetch(`${this.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ESKIZ_EMAIL,
        password: process.env.ESKIZ_PASSWORD,
      }),
    });
    if (!res.ok) throw new Error(`Eskiz auth failed: ${res.status}`);
    const json = (await res.json()) as { data?: { token?: string } };
    const token = json.data?.token;
    if (!token) throw new Error('Eskiz returned empty token');

    // Eskiz tokens last 30 days; we cache 25
    this.tokenCache = { token, expires_at: Date.now() + 25 * 86_400_000 };
    return token;
  }

  private async sendSms(phoneDigits: string, message: string) {
    const token = await this.getEskizToken();
    const form = new URLSearchParams();
    form.set('mobile_phone', phoneDigits);
    form.set('message', message);
    form.set('from', this.from);

    const res = await fetch(`${this.base}/message/sms/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Eskiz send failed: ${res.status} ${text}`);
    }
  }
}
