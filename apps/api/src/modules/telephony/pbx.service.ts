import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { localDateOf, localMidnightUtcMs, phoneIlikePattern, phoneKey } from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';
import { AiReceptionSettingsService, schemaError } from '../ai-reception/settings.service';
import { SttClient } from '../ai-reception/stt.client';

import {
  baseTenantCode,
  endpointFromChannel,
  EXTENSION_RE,
  generatePassword,
  mapCallStatus,
  nextExtension,
  nextTenantCode,
  normalizeDid,
  PBX_REALM,
  sipHa1,
  turnCredentials,
  validHost,
} from './pbx-utils';

// =============================================================================
// BULUTLI ATS — klinika IP-telefoniyasi, ichki raqamlar, softfon, jurnal
// =============================================================================
// Asterisk sozlamasi shu yerdan generatsiya qilinadi: voice-agent har 30 soniyada
// `GET /telephony/agent/config` ni oladi va /etc/asterisk/*_clary.conf ni yozadi.
// Ichki raqam parollari Asterisk'ka OCHIQ HOLDA berilmaydi — faqat HA1 (md5_cred).
// =============================================================================

export interface PbxTenantRow {
  clinic_id: string;
  code: string;
  enabled: boolean;
  provider: string;
  trunk_host: string | null;
  trunk_port: number;
  trunk_transport: 'udp' | 'tcp';
  trunk_username: string | null;
  trunk_password: string | null;
  trunk_from_domain: string | null;
  did: string | null;
  dial_format: 'e164' | 'digits12' | 'local9';
  ring_timeout_sec: number;
  after_hours: 'ring' | 'ai';
  no_answer: 'voicemail' | 'ai' | 'message';
  max_outbound: number;
  trunk_status: string | null;
  trunk_status_at: string | null;
  updated_at: string | null;
}

export interface PbxExtensionRow {
  id: string;
  clinic_id: string;
  ext: string;
  label: string;
  profile_id: string | null;
  phone_username: string;
  phone_password: string;
  web_username: string;
  web_password: string;
  in_ring_group: boolean;
  can_call_out: boolean;
  is_active: boolean;
  phone_status: string | null;
  web_status: string | null;
  status_at: string | null;
  created_at: string;
}

export interface TenantInput {
  enabled: boolean;
  trunk_host: string | null;
  trunk_port: number;
  trunk_transport: 'udp' | 'tcp';
  trunk_username: string | null;
  /** Bo'sh/undefined — eski parol saqlanadi */
  trunk_password?: string | null;
  trunk_from_domain: string | null;
  did: string | null;
  dial_format: 'e164' | 'digits12' | 'local9';
  ring_timeout_sec: number;
  after_hours: 'ring' | 'ai';
  /** Bo'sh — avvalgi qiymat saqlanadi (yangi klinikada: ovozli xabar) */
  no_answer?: 'voicemail' | 'ai' | 'message';
  max_outbound: number;
}

/** voice-agent uchun bitta klinika sozlamasi. */
export interface AgentTenant {
  code: string;
  clinic_id: string;
  name: string;
  trunk: {
    host: string;
    port: number;
    transport: 'udp' | 'tcp';
    username: string;
    password: string;
    from_domain: string;
    did: string | null;
    dial_format: 'e164' | 'digits12' | 'local9';
  } | null;
  ring_timeout: number;
  record: boolean;
  /**
   * Hech kim olmasa: ai — AI qabulxona; voicemail — ovozli xabar (Asterisk, AI'siz);
   * none — "keyinroq qo'ng'iroq qiling" va tugatish. voice-agent'da AI (nutq
   * serverlari) bo'lmasa 'ai' o'rniga ovozli xabar ishlatiladi.
   */
  ai_fallback: 'ai' | 'voicemail' | 'none';
  after_hours: 'ring' | 'ai';
  /** Ish vaqti (0 = yakshanba) — bo'sh bo'lsa doim "ochiq" */
  hours: Array<{ weekday: number; start: string; end: string }>;
  /** Yopiq kunlar (bayramlar), YYYY-MM-DD — keyingi 120 kun */
  closed_dates: string[];
  max_outbound: number;
  extensions: Array<{
    ext: string;
    label: string;
    phone_user: string;
    phone_ha1: string;
    web_user: string;
    web_ha1: string;
    ring: boolean;
    can_call_out: boolean;
  }>;
}

export interface AgentConfig {
  realm: string;
  generated_at: string;
  tenants: AgentTenant[];
}

/** Trunk login'i SIP URI'ga (client_uri, from_user) yoziladi — xavfsiz belgilar. */
const SIP_LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

const SELECT_TENANT =
  'clinic_id, code, enabled, provider, trunk_host, trunk_port, trunk_transport, trunk_username, trunk_password, trunk_from_domain, did, dial_format, ring_timeout_sec, after_hours, no_answer, max_outbound, trunk_status, trunk_status_at, updated_at';

@Injectable()
export class PbxService {
  private readonly log = new Logger('Pbx');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: AiReceptionSettingsService,
    private readonly stt: SttClient,
  ) {}

  // ==========================================================================
  // Server ma'lumoti (env) — telefon va softfon sozlamasi uchun
  // ==========================================================================
  serverInfo() {
    const domain = (process.env.PBX_SIP_DOMAIN ?? '').trim() || null;
    const wss = (process.env.PBX_WSS_URL ?? '').trim() || (domain ? `wss://${domain}/ws` : null);
    return {
      configured: !!domain,
      sip_domain: domain,
      sip_port: Number(process.env.PBX_SIP_PORT ?? 5060),
      wss_url: wss,
      turn_configured: !!(process.env.TURN_SECRET ?? '').trim(),
    };
  }

  iceServers(userId: string): Array<{ urls: string[]; username?: string; credential?: string }> {
    const domain = (process.env.PBX_SIP_DOMAIN ?? '').trim();
    const list = (v: string | undefined) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const stun = list(process.env.STUN_URLS);
    const turn = list(process.env.TURN_URLS);
    const out: Array<{ urls: string[]; username?: string; credential?: string }> = [];
    const stunUrls = stun.length ? stun : domain ? [`stun:${domain}:3478`] : [];
    if (stunUrls.length) out.push({ urls: stunUrls });
    const secret = (process.env.TURN_SECRET ?? '').trim();
    if (secret) {
      const turnUrls = turn.length
        ? turn
        : domain
          ? [`turn:${domain}:3478?transport=udp`, `turn:${domain}:3478?transport=tcp`]
          : [];
      if (turnUrls.length) out.push({ urls: turnUrls, ...turnCredentials(secret, userId) });
    }
    return out;
  }

  // ==========================================================================
  // Klinika ATS sozlamasi
  // ==========================================================================
  async getTenant(clinicId: string): Promise<PbxTenantRow | null> {
    const { data, error } = await this.supabase
      .admin()
      .from('pbx_tenants')
      .select(SELECT_TENANT)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error) throw schemaError(error);
    return (data as PbxTenantRow | null) ?? null;
  }

  publicTenant(t: PbxTenantRow | null) {
    if (!t) return null;
    const { trunk_password: pw, ...rest } = t;
    return { ...rest, has_password: !!pw };
  }

  private async uniqueCode(clinicId: string): Promise<string> {
    const admin = this.supabase.admin();
    const { data: clinic } = await admin
      .from('clinics')
      .select('slug')
      .eq('id', clinicId)
      .maybeSingle();
    const base = baseTenantCode((clinic as { slug?: string } | null)?.slug);
    const { data } = await admin.from('pbx_tenants').select('code').like('code', `${base}%`);
    const taken = new Set(((data ?? []) as Array<{ code: string }>).map((r) => r.code));
    return nextTenantCode(base, taken);
  }

  async saveTenant(clinicId: string, userId: string | null, input: TenantInput) {
    const current = await this.getTenant(clinicId);
    const host = input.trunk_host?.trim() || null;
    const username = input.trunk_username?.trim() || null;
    const newPassword = input.trunk_password?.trim() || null;
    const password = newPassword ?? current?.trunk_password ?? null;
    const did = input.did ? normalizeDid(input.did) : null;
    if (input.did && !did)
      throw new BadRequestException("Klinika raqami O'zbekiston raqami bo'lsin");
    if (host && !validHost(host)) throw new BadRequestException('SIP server manzili noto‘g‘ri');
    if (username && !SIP_LOGIN_RE.test(username)) {
      throw new BadRequestException("Login: lotin harflari, raqamlar va . _ + - (bo'shliqsiz)");
    }
    const fromDomain = input.trunk_from_domain?.trim() || null;
    if (fromDomain && !validHost(fromDomain))
      throw new BadRequestException('From domeni noto‘g‘ri');
    if (input.enabled && (!host || !username || !password || !did)) {
      throw new BadRequestException(
        'Yoqish uchun SIP server, login, parol va klinika raqami (Uztelecom bergan) kerak',
      );
    }

    const code = current?.code ?? (await this.uniqueCode(clinicId));
    const row = {
      clinic_id: clinicId,
      code,
      enabled: input.enabled,
      trunk_host: host,
      trunk_port: input.trunk_port,
      trunk_transport: input.trunk_transport,
      trunk_username: username,
      trunk_password: password,
      trunk_from_domain: fromDomain,
      did,
      dial_format: input.dial_format,
      ring_timeout_sec: input.ring_timeout_sec,
      after_hours: input.after_hours,
      no_answer: input.no_answer ?? current?.no_answer ?? 'voicemail',
      max_outbound: input.max_outbound,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };
    const { error } = await this.supabase
      .admin()
      .from('pbx_tenants')
      .upsert(row, { onConflict: 'clinic_id' });
    if (error) {
      if (error.code === '23505' && /did/i.test(error.message ?? '')) {
        throw new BadRequestException(
          "Bu raqam boshqa klinikada ulangan. Raqam sizniki bo'lsa — Clary qo'llab-quvvatlashga yozing",
        );
      }
      throw schemaError(error);
    }

    // AI qabulxona shu trunk'dan kelgan qo'ng'iroqni taniy olsin (liniya avtomatik)
    await this.settings.ensureLine(clinicId, `trunk-${code}`, {
      phone_number: did,
      label: 'IP-telefoniya (bulutli ATS)',
      is_active: input.enabled,
    });
    return this.publicTenant(await this.getTenant(clinicId));
  }

  // ==========================================================================
  // Ichki raqamlar
  // ==========================================================================
  async listExtensions(clinicId: string, withSecrets: boolean) {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('pbx_extensions')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('ext');
    if (error) throw schemaError(error);
    const rows = (data ?? []) as PbxExtensionRow[];
    const ids = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', ids);
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string }>)
        names.set(p.id, p.full_name);
    }
    return rows.map((r) => ({
      id: r.id,
      ext: r.ext,
      label: r.label,
      profile_id: r.profile_id,
      profile_name: r.profile_id ? (names.get(r.profile_id) ?? null) : null,
      in_ring_group: r.in_ring_group,
      can_call_out: r.can_call_out,
      is_active: r.is_active,
      phone_status: r.phone_status,
      web_status: r.web_status,
      status_at: r.status_at,
      phone_username: r.phone_username,
      ...(withSecrets ? { phone_password: r.phone_password } : {}),
    }));
  }

  /** Transfer ro'yxati uchun (parolsiz) — har qanday xodim ko'radi. */
  async directory(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pbx_extensions')
      .select('ext, label, phone_status, web_status')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('ext');
    if (error) throw schemaError(error);
    return (data ?? []) as Array<{
      ext: string;
      label: string;
      phone_status: string | null;
      web_status: string | null;
    }>;
  }

  private async assertProfile(clinicId: string, profileId: string, exceptExtensionId?: string) {
    const admin = this.supabase.admin();
    const { data: prof } = await admin
      .from('profiles')
      .select('id')
      .eq('id', profileId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!prof) throw new BadRequestException('Xodim topilmadi');
    let q = admin
      .from('pbx_extensions')
      .select('ext')
      .eq('clinic_id', clinicId)
      .eq('profile_id', profileId)
      .eq('is_active', true);
    if (exceptExtensionId) q = q.neq('id', exceptExtensionId);
    const { data: taken } = await q.limit(1).maybeSingle();
    if (taken) {
      throw new BadRequestException(
        `Bu xodimga allaqachon ${(taken as { ext: string }).ext} raqami biriktirilgan`,
      );
    }
  }

  async createExtension(
    clinicId: string,
    input: {
      label: string;
      ext?: string | null;
      profile_id?: string | null;
      in_ring_group?: boolean;
      can_call_out?: boolean;
    },
  ) {
    const tenant = await this.getTenant(clinicId);
    if (!tenant) throw new BadRequestException('Avval "IP-telefoniya" sozlamasini saqlang');
    const admin = this.supabase.admin();
    const { data: existing, error: exErr } = await admin
      .from('pbx_extensions')
      .select('ext')
      .eq('clinic_id', clinicId);
    if (exErr) throw schemaError(exErr);
    const used = ((existing ?? []) as Array<{ ext: string }>).map((r) => r.ext);
    const ext = input.ext?.trim() || nextExtension(used);
    if (!EXTENSION_RE.test(ext)) throw new BadRequestException('Ichki raqam 201–899 oralig‘ida');
    if (used.includes(ext)) throw new BadRequestException(`${ext} raqami band`);
    if (input.profile_id) await this.assertProfile(clinicId, input.profile_id);

    const { data, error } = await admin
      .from('pbx_extensions')
      .insert({
        clinic_id: clinicId,
        ext,
        label: input.label.trim(),
        profile_id: input.profile_id ?? null,
        phone_username: `${tenant.code}${ext}`,
        phone_password: generatePassword(14),
        web_username: `${tenant.code}${ext}w`,
        web_password: generatePassword(32),
        in_ring_group: input.in_ring_group ?? true,
        can_call_out: input.can_call_out ?? true,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException(`${ext} raqami band`);
      throw schemaError(error);
    }
    return { id: (data as { id: string }).id, ext };
  }

  async updateExtension(
    clinicId: string,
    id: string,
    patch: {
      label?: string;
      profile_id?: string | null;
      in_ring_group?: boolean;
      can_call_out?: boolean;
      is_active?: boolean;
    },
  ) {
    if (patch.profile_id) await this.assertProfile(clinicId, patch.profile_id, id);
    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of [
      'label',
      'profile_id',
      'in_ring_group',
      'can_call_out',
      'is_active',
    ] as const) {
      if (patch[k] !== undefined)
        values[k] = typeof patch[k] === 'string' ? (patch[k] as string).trim() : patch[k];
    }
    const { data, error } = await this.supabase
      .admin()
      .from('pbx_extensions')
      .update(values)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Ichki raqam topilmadi');
    return { ok: true };
  }

  async resetPassword(clinicId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pbx_extensions')
      .update({
        phone_password: generatePassword(14),
        web_password: generatePassword(32),
        updated_at: new Date().toISOString(),
      })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Ichki raqam topilmadi');
    return { ok: true };
  }

  async deleteExtension(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('pbx_extensions')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw schemaError(error);
    return { ok: true };
  }

  /** Sozlamalar → IP-telefoniya: xodimni biriktirish ro'yxati (login bor haqiqiy foydalanuvchilar). */
  async staffOptions(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('profiles')
      .select('id, full_name, role, email')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name');
    if (error) throw new BadRequestException(error.message);
    return (
      (data ?? []) as Array<{ id: string; full_name: string; role: string; email: string | null }>
    )
      .filter((p) => !(p.email ?? '').endsWith('@clary.local'))
      .map((p) => ({ id: p.id, full_name: p.full_name, role: p.role }));
  }

  // ==========================================================================
  // Softfon (joriy foydalanuvchi)
  // ==========================================================================
  async me(clinicId: string, userId: string) {
    const server = this.serverInfo();
    const tenant = await this.getTenant(clinicId).catch(() => null);
    if (!tenant?.enabled) return { enabled: false as const, reason: 'tenant_disabled' };
    if (!server.configured || !server.wss_url) {
      return { enabled: false as const, reason: 'server_not_configured' };
    }
    const { data } = await this.supabase
      .admin()
      .from('pbx_extensions')
      .select('ext, label, web_username, web_password')
      .eq('clinic_id', clinicId)
      .eq('profile_id', userId)
      .eq('is_active', true)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    const ext = data as {
      ext: string;
      label: string;
      web_username: string;
      web_password: string;
    } | null;
    if (!ext) return { enabled: false as const, reason: 'no_extension' };
    return {
      enabled: true as const,
      ext: ext.ext,
      display_name: ext.label,
      ws_url: server.wss_url,
      sip_domain: server.sip_domain as string,
      uri: `sip:${ext.web_username}@${server.sip_domain}`,
      username: ext.web_username,
      ha1: sipHa1(ext.web_username, ext.web_password),
      realm: PBX_REALM,
      ice_servers: this.iceServers(userId),
    };
  }

  /** Kiruvchi qo'ng'iroqda ekranda bemor kartasi (raqam bo'yicha). */
  async lookup(clinicId: string, phone: string) {
    const key = phoneKey(phone);
    if (!key) return { phone, patients: [] };
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('patients')
      .select('id, full_name, phone, dob')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .ilike('phone', phoneIlikePattern(phone) ?? '%')
      .limit(20);
    const patients = (
      (data ?? []) as Array<{
        id: string;
        full_name: string;
        phone: string | null;
        dob: string | null;
      }>
    )
      .filter((p) => phoneKey(p.phone) === key)
      .slice(0, 5);
    if (patients.length === 0) return { phone, patients: [] };
    const { data: appts } = await admin
      .from('appointments')
      .select('patient_id, scheduled_at, doctor:profiles!appointments_doctor_id_fkey(full_name)')
      .eq('clinic_id', clinicId)
      .in(
        'patient_id',
        patients.map((p) => p.id),
      )
      .eq('status', 'scheduled')
      .gt('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(10);
    const next = new Map<string, { scheduled_at: string; doctor_name: string | null }>();
    for (const a of (appts ?? []) as unknown as Array<{
      patient_id: string;
      scheduled_at: string;
      doctor: { full_name: string } | null;
    }>) {
      if (!next.has(a.patient_id)) {
        next.set(a.patient_id, {
          scheduled_at: a.scheduled_at,
          doctor_name: a.doctor?.full_name ?? null,
        });
      }
    }
    return {
      phone,
      patients: patients.map((p) => ({ ...p, next_appointment: next.get(p.id) ?? null })),
    };
  }

  // ==========================================================================
  // Qo'ng'iroqlar jurnali
  // ==========================================================================
  async listCalls(
    clinicId: string,
    opts: { filter?: string; page?: number; from?: string; to?: string },
  ) {
    const size = 50;
    const page = Math.max(1, opts.page ?? 1);
    let q = this.supabase
      .admin()
      .from('pbx_calls')
      .select(
        'id, uuid, direction, status, from_number, to_number, started_at, answered_sec, duration_sec, recording_path, transcript, needs_callback, callback_done_at, ai_call_id, patient:patients(id, full_name), extension:pbx_extensions(id, ext, label)',
        { count: 'exact' },
      )
      .eq('clinic_id', clinicId)
      .order('started_at', { ascending: false })
      .range((page - 1) * size, page * size - 1);
    if (opts.filter === 'missed') q = q.eq('needs_callback', true).is('callback_done_at', null);
    if (opts.filter === 'in' || opts.filter === 'out') q = q.eq('direction', opts.filter);
    if (opts.from) q = q.gte('started_at', opts.from);
    if (opts.to) q = q.lt('started_at', opts.to);
    const { data, error, count } = await q;
    if (error) throw schemaError(error);
    return {
      items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        has_recording: !!r.recording_path,
        recording_path: undefined,
      })),
      total: count ?? 0,
      page,
      pageSize: size,
    };
  }

  async callRecordingUrl(clinicId: string, id: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('pbx_calls')
      .select('recording_path')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Qo‘ng‘iroq topilmadi');
    const path = (data as { recording_path: string | null }).recording_path;
    if (!path) return { url: null };
    const { data: signed } = await this.supabase
      .admin()
      .storage.from('call-recordings')
      .createSignedUrl(path, 3600);
    return { url: signed?.signedUrl ?? null };
  }

  async callbackDone(clinicId: string, id: string, userId: string | null) {
    const { data, error } = await this.supabase
      .admin()
      .from('pbx_calls')
      .update({ callback_done_at: new Date().toISOString(), callback_done_by: userId })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw schemaError(error);
    if (!data) throw new NotFoundException('Qo‘ng‘iroq topilmadi');
    return { ok: true };
  }

  // ==========================================================================
  // Super admin (faqat ko'rish, parolsiz)
  // ==========================================================================
  async adminOverview(clinicId: string) {
    const [tenant, extensions] = await Promise.all([
      this.getTenant(clinicId),
      this.listExtensions(clinicId, false),
    ]);
    const monthStart = new Date(
      localMidnightUtcMs(`${localDateOf(new Date()).slice(0, 7)}-01`),
    ).toISOString();
    const admin = this.supabase.admin();
    const [all, missed] = await Promise.all([
      admin
        .from('pbx_calls')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .gte('started_at', monthStart),
      admin
        .from('pbx_calls')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('status', 'missed')
        .gte('started_at', monthStart),
    ]);
    return {
      server: this.serverInfo(),
      tenant: this.publicTenant(tenant),
      extensions,
      month: { calls: all.count ?? 0, missed: missed.count ?? 0 },
    };
  }

  // ==========================================================================
  // voice-agent (Asterisk serveri)
  // ==========================================================================
  async agentConfig(): Promise<AgentConfig> {
    const admin = this.supabase.admin();
    const { data: tenants, error } = await admin
      .from('pbx_tenants')
      .select(`${SELECT_TENANT}, clinic:clinics(name)`)
      .eq('enabled', true)
      // Tartib barqaror bo'lsin — aks holda voice-agent fayli "o'zgardi" deb keraksiz reload qiladi
      .order('code');
    if (error) throw schemaError(error);
    const rows = (tenants ?? []) as unknown as Array<
      PbxTenantRow & { clinic: { name: string } | null }
    >;
    if (rows.length === 0)
      return { realm: PBX_REALM, generated_at: new Date().toISOString(), tenants: [] };

    const clinicIds = rows.map((r) => r.clinic_id);
    const { data: exts, error: extErr } = await admin
      .from('pbx_extensions')
      .select('*')
      .in('clinic_id', clinicIds)
      .eq('is_active', true)
      .order('ext');
    if (extErr) throw schemaError(extErr);
    const byClinic = new Map<string, PbxExtensionRow[]>();
    for (const e of (exts ?? []) as PbxExtensionRow[]) {
      const arr = byClinic.get(e.clinic_id) ?? [];
      arr.push(e);
      byClinic.set(e.clinic_id, arr);
    }
    const settingsMap = await this.settings.getMany(clinicIds);

    const out: AgentTenant[] = [];
    for (const t of rows) {
      const s = settingsMap.get(t.clinic_id);
      let hours: AgentTenant['hours'] = [];
      let closedDates: string[] = [];
      try {
        const ctx = await this.settings.clinicContext(t.clinic_id);
        hours = ctx.working_hours.map((h) => ({
          weekday: h.weekday,
          start: String(h.start_time).slice(0, 5),
          end: String(h.end_time).slice(0, 5),
        }));
        closedDates = ctx.closed_dates;
      } catch (e) {
        this.log.warn(`ish vaqti (${t.code}): ${(e as Error).message}`);
      }
      const trunkReady = !!(t.trunk_host && t.trunk_username && t.trunk_password);
      out.push({
        code: t.code,
        clinic_id: t.clinic_id,
        name: t.clinic?.name ?? t.code,
        trunk: trunkReady
          ? {
              host: t.trunk_host as string,
              port: t.trunk_port,
              transport: t.trunk_transport,
              username: t.trunk_username as string,
              password: t.trunk_password as string,
              from_domain: t.trunk_from_domain || (t.trunk_host as string),
              did: t.did,
              dial_format: t.dial_format,
            }
          : null,
        ring_timeout: t.ring_timeout_sec,
        record: s?.record_calls ?? true,
        ai_fallback:
          t.no_answer === 'message'
            ? 'none'
            : t.no_answer === 'ai' && s?.mode === 'ai' && this.settings.aiEffective(s)
              ? 'ai'
              : 'voicemail',
        after_hours: t.after_hours,
        hours,
        closed_dates: closedDates,
        max_outbound: t.max_outbound,
        extensions: (byClinic.get(t.clinic_id) ?? []).map((e) => ({
          ext: e.ext,
          label: e.label,
          phone_user: e.phone_username,
          phone_ha1: sipHa1(e.phone_username, e.phone_password),
          web_user: e.web_username,
          web_ha1: sipHa1(e.web_username, e.web_password),
          ring: e.in_ring_group,
          can_call_out: e.can_call_out,
        })),
      });
    }
    return { realm: PBX_REALM, generated_at: new Date().toISOString(), tenants: out };
  }

  /** Asterisk holati: trunk ro'yxatdan o'tganmi, qaysi telefon/softfon onlayn. */
  async agentStatus(input: {
    registrations: Array<{ endpoint: string; status: string }>;
    contacts: Array<{ aor: string; status: string }>;
  }) {
    const admin = this.supabase.admin();
    const now = new Date().toISOString();
    for (const r of input.registrations) {
      if (!r.endpoint.startsWith('trunk-')) continue;
      await admin
        .from('pbx_tenants')
        .update({ trunk_status: r.status.slice(0, 40), trunk_status_at: now })
        .eq('code', r.endpoint.slice('trunk-'.length));
    }
    const online = new Set(
      input.contacts
        .filter((c) => /^(avail|nonqual|reachable|created|updated)$/i.test(c.status))
        .map((c) => c.aor.toLowerCase()),
    );
    const { data } = await admin
      .from('pbx_extensions')
      .select('id, phone_username, web_username, phone_status, web_status')
      .eq('is_active', true)
      .limit(5000);
    let changed = 0;
    for (const e of (data ?? []) as Array<{
      id: string;
      phone_username: string;
      web_username: string;
      phone_status: string | null;
      web_status: string | null;
    }>) {
      const phone = online.has(e.phone_username) ? 'online' : 'offline';
      const web = online.has(e.web_username) ? 'online' : 'offline';
      if (phone === e.phone_status && web === e.web_status) continue;
      changed++;
      await admin
        .from('pbx_extensions')
        .update({ phone_status: phone, web_status: web, status_at: now })
        .eq('id', e.id);
    }
    return { ok: true, changed };
  }

  /** Qo'ng'iroq tugadi (dialplan hangup handler → voice-agent → shu yer). */
  async agentCall(input: {
    uuid: string;
    tenant: string;
    direction: 'in' | 'out' | 'internal';
    from?: string | null;
    to?: string | null;
    dial_status?: string | null;
    peer?: string | null;
    started?: number | null;
    ended?: number | null;
    answered?: number | null;
    ai?: boolean;
    /** AI odamga ulamoqchi bo'lgan (transfer:group) */
    xfer?: boolean;
    /** Hech kim olmadi — bemor ovozli xabar qoldirdi (Asterisk Record) */
    voicemail?: boolean;
    recording_path?: string | null;
    hangup_cause?: string | null;
  }) {
    const admin = this.supabase.admin();
    const { data: tenant } = await admin
      .from('pbx_tenants')
      .select('clinic_id')
      .eq('code', input.tenant)
      .maybeSingle();
    const clinicId = (tenant as { clinic_id: string } | null)?.clinic_id;
    if (!clinicId) throw new NotFoundException(`ATS klinikasi topilmadi: ${input.tenant}`);

    const status = mapCallStatus(input.direction, input.dial_status, !!input.ai, !!input.voicemail);
    const endpoint = endpointFromChannel(input.peer);
    let extensionId: string | null = null;
    if (endpoint) {
      const { data: ext } = await admin
        .from('pbx_extensions')
        .select('id')
        .eq('clinic_id', clinicId)
        .or(`phone_username.eq.${endpoint},web_username.eq.${endpoint}`)
        .limit(1)
        .maybeSingle();
      extensionId = (ext as { id: string } | null)?.id ?? null;
    }

    const patientPhone = input.direction === 'in' ? input.from : input.to;
    let patientId: string | null = null;
    const key = phoneKey(patientPhone);
    if (key) {
      const { data: pats } = await admin
        .from('patients')
        .select('id, phone')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .ilike('phone', phoneIlikePattern(patientPhone) ?? '%')
        .order('created_at', { ascending: true })
        .limit(10);
      patientId =
        ((pats ?? []) as Array<{ id: string; phone: string | null }>).find(
          (p) => phoneKey(p.phone) === key,
        )?.id ?? null;
    }

    let aiCallId: string | null = null;
    if (input.ai) {
      const { data: ai } = await admin
        .from('ai_calls')
        .select('id')
        .eq('external_id', input.uuid)
        .limit(1)
        .maybeSingle();
      aiCallId = (ai as { id: string } | null)?.id ?? null;
    }

    const started = input.started && input.started > 0 ? input.started * 1000 : Date.now();
    const ended = input.ended && input.ended > 0 ? input.ended * 1000 : Date.now();
    const row = {
      clinic_id: clinicId,
      uuid: input.uuid,
      direction: input.direction,
      status,
      from_number: input.from?.slice(0, 40) ?? null,
      to_number: input.to?.slice(0, 40) ?? null,
      extension_id: extensionId,
      patient_id: patientId,
      ai_call_id: aiCallId,
      started_at: new Date(started).toISOString(),
      answered_sec:
        input.answered != null && input.answered >= 0 ? Math.round(input.answered) : null,
      duration_sec: Math.max(0, Math.round((ended - started) / 1000)),
      recording_path: input.recording_path ?? null,
      // Javobsiz kiruvchi (AI ham olmagan) yoki AI ulamoqchi bo'lgan-u, hech kim
      // olmagan — qabulxona qayta qo'ng'iroq qilsin
      needs_callback:
        !!key &&
        input.direction === 'in' &&
        (status === 'missed' ||
          status === 'voicemail' ||
          (!!input.ai && !!input.xfer && status !== 'answered')),
      meta: {
        dial_status: input.dial_status ?? null,
        peer: input.peer ?? null,
        cause: input.hangup_cause ?? null,
        xfer: !!input.xfer,
      },
    };
    const { error } = await admin.from('pbx_calls').upsert(row, { onConflict: 'uuid' });
    if (error) throw schemaError(error);
    // Ovozli xabar matni — o'zimizning STT serveri bo'lsa (fonda, javobni kutdirmaydi)
    if (status === 'voicemail' && row.recording_path && this.stt.enabled) {
      void this.transcribeVoicemail(input.uuid, row.recording_path);
    }
    return { ok: true, status };
  }

  private async transcribeVoicemail(uuid: string, path: string) {
    try {
      const admin = this.supabase.admin();
      const { data: file, error } = await admin.storage.from('call-recordings').download(path);
      if (error || !file) throw new Error(error?.message ?? 'fayl yo‘q');
      const text = await this.stt.transcribe(Buffer.from(await file.arrayBuffer()), {
        mime: 'audio/wav',
        filename: 'voicemail.wav',
        lang: 'uz',
      });
      if (text) {
        await admin
          .from('pbx_calls')
          .update({ transcript: text.slice(0, 4000) })
          .eq('uuid', uuid);
      }
    } catch (e) {
      this.log.warn(`ovozli xabar matni (${uuid.slice(0, 8)}): ${(e as Error).message}`);
    }
  }

  async agentRecording(tenantCode: string, uuid: string, wav: Buffer) {
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new BadRequestException('uuid noto‘g‘ri');
    if (wav.length < 44 || wav.subarray(0, 4).toString('ascii') !== 'RIFF') {
      throw new BadRequestException('WAV emas');
    }
    const admin = this.supabase.admin();
    const { data: tenant } = await admin
      .from('pbx_tenants')
      .select('clinic_id')
      .eq('code', tenantCode)
      .maybeSingle();
    const clinicId = (tenant as { clinic_id: string } | null)?.clinic_id;
    if (!clinicId) throw new NotFoundException(`ATS klinikasi topilmadi: ${tenantCode}`);
    const path = `${clinicId}/${localDateOf(new Date()).slice(0, 7)}/pbx-${uuid}.wav`;
    const { error } = await admin.storage
      .from('call-recordings')
      .upload(path, wav, { contentType: 'audio/wav', upsert: true });
    if (error) throw new BadRequestException(`Yozuv saqlanmadi: ${error.message}`);
    // Qo'ng'iroq qatori allaqachon bo'lsa — darhol bog'laymiz
    await admin.from('pbx_calls').update({ recording_path: path }).eq('uuid', uuid);
    return { ok: true, path };
  }
}
