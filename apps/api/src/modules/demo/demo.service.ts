import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { SupabaseService } from '../../common/services/supabase.service';

const TTL_HOURS = 24;
const PER_IP_DAILY_LIMIT = 3;

interface SpawnInput {
  ip: string;
  userAgent: string | null;
  fingerprint: string | null;
}

@Injectable()
export class DemoService {
  private readonly log = new Logger(DemoService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async spawn(input: SpawnInput) {
    const admin = this.supabase.admin();
    const ipHash = hashIp(input.ip);

    // Daily per-IP cap (defence in depth — Throttler guards the burst)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('demo_spawn_log')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', since);

    if ((count ?? 0) >= PER_IP_DAILY_LIMIT) {
      throw new HttpException(
        "Demo limit (24 soatda 3 marta) tugadi. Iltimos, ro'yxatdan o'ting.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 1. Create an anonymous Supabase Auth user — magic link will sign them in.
    const tempEmail = `demo+${randomToken(10)}@demo.clary.uz`;
    const tempPassword = randomToken(24);
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: tempEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { is_demo: true },
    });
    if (userErr || !userData.user) {
      this.log.error('demo user create failed', userErr);
      throw new BadRequestException('Demo yaratishda xatolik');
    }
    const userId = userData.user.id;

    // 2. Atomic seed via SQL function (clinic, services, patients, queue)
    const { data: spawnRows, error: spawnErr } = await admin.rpc(
      'spawn_demo_workspace' as never,
      { p_owner_user_id: userId, p_ttl_hours: TTL_HOURS } as never,
    );
    if (spawnErr || !spawnRows || (Array.isArray(spawnRows) && spawnRows.length === 0)) {
      this.log.error('spawn_demo_workspace RPC failed', spawnErr);
      // Best-effort: drop the orphan auth user
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      throw new BadRequestException('Demo yaratishda xatolik');
    }
    const row = Array.isArray(spawnRows) ? spawnRows[0] : spawnRows;
    const clinicId = (row as { clinic_id: string }).clinic_id;
    const expiresAt = (row as { expires_at: string }).expires_at;

    // 3. Magic link for one-shot sign-in
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: tempEmail,
      options: {
        redirectTo: `${publicClinicUrl()}/auth/callback?demo=1`,
      },
    });
    if (linkErr || !linkData) {
      this.log.error('generateLink failed', linkErr);
      throw new BadRequestException('Demo havolasi yaratilmadi');
    }

    // 4. Audit
    await admin.from('demo_spawn_log').insert({
      ip_hash: ipHash,
      fingerprint: input.fingerprint,
      user_agent: input.userAgent,
      clinic_id: clinicId,
    });

    return {
      clinicId,
      expiresAt,
      magicLink: linkData.properties?.action_link,
    };
  }

  async cleanup(secret: string | undefined) {
    const expected = process.env.CRON_SECRET;
    if (!expected || secret !== expected) {
      throw new ForbiddenException();
    }
    const { data, error } = await this.supabase
      .admin()
      .rpc('cleanup_expired_demos' as never);
    if (error) {
      this.log.error('cleanup_expired_demos failed', error);
      throw new BadRequestException(error.message);
    }
    return { deleted: data ?? 0 };
  }
}

function hashIp(ip: string): string {
  const salt = process.env.DEMO_IP_SALT ?? 'clary-demo-salt';
  return createHash('sha256').update(salt + ':' + ip).digest('hex');
}

function randomToken(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function publicClinicUrl(): string {
  return process.env.WEB_CLINIC_URL ?? 'https://app.clary.uz';
}
