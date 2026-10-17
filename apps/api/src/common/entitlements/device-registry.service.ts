import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { DeviceClient, Entitlements } from '@clary/schemas';

import { SupabaseService } from '../services/supabase.service';

// =============================================================================
// Klinika qurilmalari (user_devices) — kim qaysi kompyuter/telefondan ishlaydi.
// Mijoz har so'rovda X-Clary-Device (barqaror tasodifiy ID) va X-Clary-Client
// (web | desktop | mobile | kiosk) yuboradi. Sarlavhasiz eski mijozlar
// tekshirilmaydi (orqaga moslik).
//   • tarifda shu ilova turi yopiq → CLIENT_NOT_ALLOWED
//   • super-admin/egasi qurilmani bloklagan → DEVICE_REVOKED
//   • devices.enforce_limit va limit to'lgan → yangi qurilma DEVICE_LIMIT
// Bazaga yozish qisqa kesh bilan siyraklashtirilgan (har so'rovda emas).
// =============================================================================

const CLIENTS: readonly DeviceClient[] = ['web', 'desktop', 'mobile', 'kiosk'];
const CLIENT_LABEL: Record<DeviceClient, string> = {
  web: 'Brauzer orqali kirish',
  desktop: 'Kompyuter ilovasi',
  mobile: 'Mobil ilova',
  kiosk: 'Kiosk / TV ekran',
};

export interface DeviceTouch {
  clinicId: string;
  userId: string;
  fingerprint: string | null;
  client: string | null;
  appVersion: string | null;
  userAgent: string | null;
  ip: string | null;
}

@Injectable()
export class DeviceRegistryService {
  private readonly log = new Logger('Devices');
  private readonly seen = new Map<string, { at: number; revoked: boolean }>();
  private readonly TTL = 5 * 60_000;

  constructor(private readonly supabase: SupabaseService) {}

  static parseClient(raw: string | null | undefined): DeviceClient | null {
    const v = (raw ?? '').trim().toLowerCase();
    return (CLIENTS as readonly string[]).includes(v) ? (v as DeviceClient) : null;
  }

  static parseFingerprint(raw: string | null | undefined): string | null {
    const v = (raw ?? '').trim();
    return /^[A-Za-z0-9_-]{8,100}$/.test(v) ? v : null;
  }

  /** "Windows · Chrome" kabi qisqa nom (User-Agent'dan). */
  static describe(
    ua: string | null,
    client: DeviceClient | null,
  ): {
    name: string;
    os: string | null;
    browser: string | null;
  } {
    const s = ua ?? '';
    const os = /Windows/i.test(s)
      ? 'Windows'
      : /Android/i.test(s)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(s)
          ? 'iOS'
          : /Mac OS X|Macintosh/i.test(s)
            ? 'macOS'
            : /Linux/i.test(s)
              ? 'Linux'
              : null;
    const browser = /Edg\//.test(s)
      ? 'Edge'
      : /OPR\//.test(s)
        ? 'Opera'
        : /YaBrowser/.test(s)
          ? 'Yandex'
          : /Chrome\//.test(s)
            ? 'Chrome'
            : /Firefox\//.test(s)
              ? 'Firefox'
              : /Safari\//.test(s)
                ? 'Safari'
                : null;
    const app =
      client === 'desktop' ? 'Clary Desktop' : client === 'mobile' ? 'Clary Mobile' : browser;
    const name = [os, app].filter(Boolean).join(' · ') || 'Noma‘lum qurilma';
    return { name, os, browser };
  }

  invalidate(clinicId: string, fingerprint?: string) {
    if (fingerprint) {
      this.seen.delete(`${clinicId}:${fingerprint}`);
      return;
    }
    for (const k of this.seen.keys()) if (k.startsWith(`${clinicId}:`)) this.seen.delete(k);
  }

  async touch(t: DeviceTouch, ent: Entitlements | null): Promise<void> {
    const client = DeviceRegistryService.parseClient(t.client);
    if (client && ent && ent.devices.clients[client] === false) {
      throw new ForbiddenException({
        error: 'CLIENT_NOT_ALLOWED',
        message: `${CLIENT_LABEL[client]} tarifingizga kirmaydi`,
        details: { client },
      });
    }

    const fp = DeviceRegistryService.parseFingerprint(t.fingerprint);
    if (!fp) return;

    const key = `${t.clinicId}:${fp}`;
    const hit = this.seen.get(key);
    if (hit && Date.now() - hit.at < this.TTL) {
      if (hit.revoked) throw deviceRevoked();
      return;
    }

    const admin = this.supabase.admin();
    const { data: row, error } = await admin
      .from('user_devices')
      .select('id, is_revoked')
      .eq('clinic_id', t.clinicId)
      .eq('fingerprint', fp)
      .maybeSingle();
    if (error) {
      // Ro'yxatga yozib bo'lmasa ishni to'xtatmaymiz (fail-open)
      this.log.warn(`user_devices: ${error.message}`);
      this.seen.set(key, { at: Date.now(), revoked: false });
      return;
    }

    const d = DeviceRegistryService.describe(t.userAgent, client);
    const ip = cleanIp(t.ip);
    const existing = row as { id: string; is_revoked: boolean } | null;
    if (existing) {
      this.seen.set(key, { at: Date.now(), revoked: existing.is_revoked });
      if (existing.is_revoked) throw deviceRevoked();
      void admin
        .from('user_devices')
        .update({
          user_id: t.userId,
          last_used_at: new Date().toISOString(),
          last_ip: ip,
          client,
          app_version: t.appVersion?.slice(0, 40) ?? null,
          user_agent: t.userAgent?.slice(0, 300) ?? null,
          os: d.os,
          browser: d.browser,
        })
        .eq('id', existing.id)
        .then(undefined, () => undefined);
      return;
    }

    // Yangi qurilma — qat'iy limit yoqilgan bo'lsa tekshiriladi
    const max = ent?.limits.max_devices ?? null;
    if (ent?.devices.enforce_limit && max != null) {
      const { count } = await admin
        .from('user_devices')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', t.clinicId)
        .eq('is_revoked', false);
      if ((count ?? 0) >= max) {
        throw new ForbiddenException({
          error: 'DEVICE_LIMIT',
          message: `Qurilmalar limiti to'lgan (${count}/${max}). Administrator eski qurilmani o'chirsin yoki tarifni yangilang.`,
        });
      }
    }

    const { error: insErr } = await admin.from('user_devices').upsert(
      {
        clinic_id: t.clinicId,
        user_id: t.userId,
        fingerprint: fp,
        kind: client === 'mobile' ? 'mobile' : client === 'kiosk' ? 'kiosk' : 'desktop',
        name: d.name,
        os: d.os,
        browser: d.browser,
        client,
        app_version: t.appVersion?.slice(0, 40) ?? null,
        user_agent: t.userAgent?.slice(0, 300) ?? null,
        last_ip: ip,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,fingerprint', ignoreDuplicates: true },
    );
    if (insErr) this.log.warn(`user_devices insert: ${insErr.message}`);
    this.seen.set(key, { at: Date.now(), revoked: false });
  }
}

/** inet ustuniga mos: birinchi manzil, ::ffff: prefiksisiz; yaroqsiz — null. */
function cleanIp(raw: string | null): string | null {
  const v =
    (raw ?? '')
      .split(',')[0]
      ?.trim()
      .replace(/^::ffff:/, '') ?? '';
  return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : null;
}

function deviceRevoked() {
  return new ForbiddenException({
    error: 'DEVICE_REVOKED',
    message: 'Bu qurilma klinika uchun bloklangan. Administrator bilan bog‘laning.',
  });
}
