import { randomBytes, randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { SupabaseService } from '../../common/services/supabase.service';

const DEMO_CLINIC_SLUG = process.env.DEMO_CLINIC_SLUG ?? 'demo';
const DEMO_SESSION_TTL_MS = Number(process.env.DEMO_SESSION_TTL_MS ?? 60 * 60 * 1000);

@Injectable()
export class PublicService {
  private readonly log = new Logger(PublicService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async verifyTurnstile(token: string): Promise<void> {
    if (!process.env.TURNSTILE_SECRET_KEY) return; // skip in local
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token }),
    });
    const json = (await res.json()) as { success: boolean };
    if (!json.success) throw new BadRequestException('Captcha failed');
  }

  async subscribeNewsletter(input: { email: string; locale: string; source?: string }) {
    const { error } = await this.supabase
      .admin()
      .from('newsletter_subscriptions')
      .upsert({ email: input.email, locale: input.locale, source: input.source }, { onConflict: 'email' });
    if (error) throw new BadRequestException(error.message);
  }

  async createLead(input: {
    fullName: string;
    email: string;
    phone?: string;
    clinicName?: string;
    message?: string;
    organizationType?: string;
    staffCountBucket?: string;
    source: string;
  }) {
    const { error } = await this.supabase.admin().from('sales_leads').insert({
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      clinic_name: input.clinicName,
      organization_type: input.organizationType,
      staff_count_bucket: input.staffCountBucket,
      message: input.message,
      source: input.source,
    });
    if (error) throw new BadRequestException(error.message);
  }

  async signup(input: { email: string; password: string; fullName: string }) {
    const admin = this.supabase.admin();

    // Create user with email already confirmed so they can log in immediately
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
    if (error) throw new BadRequestException(error.message);

    // Generate a magic link so the landing page can redirect into app.clary.uz
    // without requiring the user to re-enter credentials
    const origin = process.env.APP_URL ?? 'https://app.clary.uz';
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: input.email,
      options: { redirectTo: `${origin}/onboarding` },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      // Fallback: user will sign in manually
      return { userId: data.user.id, next: `${origin}/login` };
    }

    return { userId: data.user.id, magic_link: linkData.properties.action_link };
  }

  /**
   * Issues an ephemeral demo session for an anonymous visitor.
   * - Reuses the provisioned `demo` clinic (created by seed_demo_data).
   * - Creates (or reuses) a disposable demo user and records a row in
   *   `demo_tenants` with an expiry so we can purge it in the background cron.
   * - Returns the Supabase magiclink so the frontend can complete auth.
   */
  async createDemoSession(input: { locale?: string; fingerprint?: string }) {
    const admin = this.supabase.admin();

    const { data: clinic } = await admin
      .from('clinics')
      .select('id, name')
      .eq('slug', DEMO_CLINIC_SLUG)
      .is('deleted_at', null)
      .maybeSingle();
    if (!clinic) {
      throw new BadRequestException(
        'Demo sandbox is not provisioned. Ask a super admin to run scripts/seed-demo-data.ts.',
      );
    }

    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + DEMO_SESSION_TTL_MS).toISOString();
    const email = `demo+${token.slice(0, 12)}@clary.uz`;

    // Provision a disposable user.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: 'Demo Guest', is_demo: true, locale: input.locale ?? 'uz-Latn' },
      app_metadata: { role: 'receptionist', clinic_id: clinic.id, is_demo: true },
    });
    if (createErr || !created?.user) throw new BadRequestException(createErr?.message ?? 'demo user create failed');

    // Attach profile so RLS "my clinic" policies resolve correctly.
    await admin.from('profiles').upsert(
      {
        id: created.user.id,
        clinic_id: clinic.id,
        email,
        full_name: 'Demo Guest',
        role: 'receptionist',
        is_active: true,
      },
      { onConflict: 'id' },
    );

    const { data: linked } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const magicLink =
      (linked as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;

    await admin.from('demo_tenants').insert({
      clinic_id: clinic.id,
      session_token: token,
      magic_link: magicLink,
      expires_at: expiresAt,
      fingerprint: input.fingerprint ?? null,
      locale: input.locale ?? null,
    });

    return {
      session_token: token,
      expires_at: expiresAt,
      magic_link: magicLink,
      email,
      clinic: { id: clinic.id, name: (clinic as { name: string }).name },
      ttl_minutes: Math.round(DEMO_SESSION_TTL_MS / 60000),
    };
  }

  /**
   * Purges expired demo sessions. Runs every 10 minutes.
   * - Deletes the auth user (cascade removes profile + derived data).
   * - Removes the demo_tenants row.
   * - Never deletes the demo clinic itself.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredDemoSessions() {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('demo_tenants')
      .select('id, session_token, clinic_id, expires_at')
      .lt('expires_at', new Date().toISOString())
      .limit(200);
    if (error) {
      this.log.warn(`demo cleanup query failed: ${error.message}`);
      return { purged: 0 };
    }
    const rows = (data ?? []) as Array<{ id: string; session_token: string }>;
    if (rows.length === 0) return { purged: 0 };

    for (const row of rows) {
      try {
        const { data: user } = await admin
          .from('profiles')
          .select('id')
          .eq('email', `demo+${row.session_token.slice(0, 12)}@clary.uz`)
          .maybeSingle();
        if (user?.id) {
          await admin.auth.admin.deleteUser((user as { id: string }).id, true);
        }
        await admin.from('demo_tenants').delete().eq('id', row.id);
      } catch (err) {
        this.log.warn(`demo cleanup ${row.id} failed: ${(err as Error).message}`);
      }
    }
    this.log.log(`purged ${rows.length} expired demo sessions`);
    return { purged: rows.length };
  }

  /**
   * Resets (or creates) the demo clinic with an idempotent baseline payload.
   * Safe to call from a super admin UI / CLI. Use the full seed script for
   * richer realistic data (patients, medications, etc.).
   */
  async listAppVersions(filter: { app?: string; channel?: string }) {
    const admin = this.supabase.admin();
    let q = admin
      .from('app_versions')
      .select(
        'app, channel, version, min_supported_version, force_update, released_at, release_notes_i18n, download_url, changelog_url, metadata',
      )
      .eq('is_current', true);
    if (filter.app) q = q.eq('app', filter.app);
    if (filter.channel) q = q.eq('channel', filter.channel);
    const { data, error } = await q.order('app', { ascending: true }).limit(100);
    if (error) throw new BadRequestException(error.message);
    return { versions: data ?? [] };
  }

  async ensureDemoClinic() {
    const admin = this.supabase.admin();
    const { data: existing } = await admin
      .from('clinics')
      .select('id')
      .eq('slug', DEMO_CLINIC_SLUG)
      .maybeSingle();
    if (existing) return { clinic_id: existing.id, created: false };
    const id = randomUUID();
    const { error } = await admin.from('clinics').insert({
      id,
      slug: DEMO_CLINIC_SLUG,
      name: 'Clary Demo Klinikasi',
      timezone: 'Asia/Tashkent',
      default_locale: 'uz-Latn',
      is_suspended: false,
      settings: { is_demo: true },
    });
    if (error) throw new BadRequestException(error.message);
    return { clinic_id: id, created: true };
  }
}
