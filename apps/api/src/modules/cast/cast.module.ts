import { randomInt, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CAST_VOICE_KEYS, castAdsLimits } from '@clary/schemas';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EntitlementsService } from '../../common/entitlements/entitlements.service';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { CastAnnouncer, shortPatientName } from '../../common/services/cast-announcer.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { tashkentDate } from '../../common/tashkent-range';

// =============================================================================
// Clary Cast — TV navbat ekranlari (pairing). Cast signali Supabase Realtime
// Broadcast orqali yuboriladi (login'siz TV; jadval SELECT talab qilmaydi).
// Bu modul faqat TV ro'yxati/bog'lashni boshqaradi. Online = last_seen < 40s.
// =============================================================================

const ONLINE_WINDOW_MS = 40_000;
// Chalkashtirmaydigan alifbo (0/O, 1/I yo'q)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

const RegisterSchema = z.object({ device_id: z.string().min(6).max(64) });
const DisplayMode = z.enum(['queue', 'ads']);
type DisplayMode = z.infer<typeof DisplayMode>;
const PairSchema = z.object({
  code: z.string().min(4).max(12),
  name: z.string().min(1).max(80),
  mode: DisplayMode.default('queue'),
});
const DisplayPatchSchema = z
  .object({ mode: DisplayMode.optional(), name: z.string().min(1).max(80).optional() })
  .refine((v) => v.mode !== undefined || v.name !== undefined, { message: "Bo'sh so'rov" });
const AnnounceSchema = z.object({ queue_id: z.string().uuid() });

// Navbat ovozi (yozib olingan iboralar) — ommaviy bucket, yozish faqat API orqali.
const VOICE_BUCKET = 'cast-voice';
const VOICE_DEFAULT_SCOPE = '_default';
const VOICE_MAX_BYTES = 1_500_000;
const VOICE_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
};
// Brauzer/OS beradigan muqobil nomlar → bucket ruxsat bergan kanonik tur
const VOICE_CANON: Record<string, string> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
};
const VoiceUploadSchema = z.object({
  data_base64: z.string().min(16),
  content_type: z.string().min(5).max(80),
});

// TV reklama videolari — ommaviy bucket (TV login'siz ijro etadi), yo'l taxmin
// qilinmaydi (<clinic_id>/<uuid>.<ext>). Fayl brauzerdan imzolangan URL bilan
// to'g'ridan-to'g'ri yuklanadi (katta video API orqali o'tmaydi); limit (soni +
// jami hajm) URL berishda VA yuklash tugagach haqiqiy hajm bilan tekshiriladi.
const ADS_BUCKET = 'cast-ads';
const AD_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
// Tugallanmagan yuklash (URL olingan, fayl kelmagan) shu vaqtdan keyin o'chiriladi.
const AD_PENDING_TTL_MS = 6 * 3600_000;
const MB = 1024 * 1024;
const AdUploadSchema = z.object({
  file_name: z.string().min(1).max(200),
  size_bytes: z.number().int().positive(),
  content_type: z.string().min(5).max(80),
  title: z.string().max(120).optional(),
});
const AdPatchSchema = z
  .object({
    title: z.string().max(120).nullable().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Bo'sh so'rov" });

type AdRow = {
  id: string;
  title: string | null;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  status: 'pending' | 'ready';
  is_active: boolean;
  sort_order: number;
  created_at: string;
};
const AD_COLS =
  'id, title, storage_path, content_type, size_bytes, status, is_active, sort_order, created_at';

/** Migratsiya hali qo'llanmagan bo'lsa tushunarli xabar. */
function adsSchemaHint(msg: string): string {
  return /cast_ad_videos|mode|schema cache|does not exist|bucket/i.test(msg)
    ? 'TV reklama hali yoqilmagan — serverda scripts/deploy-cast-ads.sh ishga tushirilsin'
    : msg;
}

@Injectable()
export class CastService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly announcer: CastAnnouncer,
    private readonly entitlements: EntitlementsService,
  ) {}

  // TV (login'siz) — birinchi ochilganda ro'yxatdan o'tadi, pairing kodi oladi.
  async register(deviceId: string) {
    const admin = this.supabase.admin();
    const { data: existing } = await admin
      .from('queue_displays')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();
    const now = new Date().toISOString();

    if (existing) {
      const row = existing as {
        id: string;
        clinic_id: string | null;
        name: string | null;
        pairing_code: string | null;
        is_paired: boolean;
        mode?: string | null;
      };
      // Bog'lanmagan bo'lsa kod bo'lishini ta'minlaymiz.
      let code = row.pairing_code;
      if (!row.is_paired && !code) {
        code = genCode();
        await admin.from('queue_displays').update({ pairing_code: code }).eq('id', row.id);
      }
      await admin.from('queue_displays').update({ last_seen_at: now }).eq('id', row.id);
      return {
        paired: row.is_paired,
        clinic_id: row.clinic_id,
        name: row.name,
        pairing_code: row.is_paired ? null : code,
        mode: row.mode === 'ads' ? ('ads' as const) : ('queue' as const),
      };
    }

    const code = genCode();
    await admin.from('queue_displays').insert({
      device_id: deviceId,
      pairing_code: code,
      is_paired: false,
      last_seen_at: now,
    });
    return {
      paired: false,
      clinic_id: null,
      name: null,
      pairing_code: code,
      mode: 'queue' as const,
    };
  }

  // TV poll qiladi — bog'langanini va clinic_id'ni bilish uchun (+ heartbeat).
  async status(deviceId: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('queue_displays')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (!data)
      return {
        paired: false,
        clinic_id: null,
        name: null,
        pairing_code: null,
        mode: 'queue' as const,
      };
    await admin
      .from('queue_displays')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('device_id', deviceId);
    const row = data as {
      clinic_id: string | null;
      name: string | null;
      is_paired: boolean;
      pairing_code: string | null;
      mode?: string | null;
    };
    return {
      paired: row.is_paired,
      clinic_id: row.clinic_id,
      name: row.name,
      pairing_code: row.is_paired ? null : row.pairing_code,
      mode: row.mode === 'ads' ? ('ads' as const) : ('queue' as const),
    };
  }

  private async pairedClinic(deviceId: string): Promise<string | null> {
    const { data } = await this.supabase
      .admin()
      .from('queue_displays')
      .select('clinic_id, is_paired')
      .eq('device_id', deviceId)
      .maybeSingle();
    const d = data as { clinic_id: string | null; is_paired: boolean } | null;
    return d?.is_paired && d.clinic_id ? d.clinic_id : null;
  }

  /**
   * TV taxtasi (login'siz): bog'langan qurilma o'z klinikasining BUGUNGI
   * navbatini ko'radi. Bemor ismi qisqartiriladi ("Karimova D.") — umumiy
   * zalda to'liq ism ko'rinmasin. Xona — shifokor profilidan.
   */
  async board(deviceId: string) {
    const clinicId = await this.pairedClinic(deviceId);
    if (!clinicId) return { paired: false, clinic_name: null, called: [], waiting: [] };
    const admin = this.supabase.admin();

    const [{ data, error }, { data: clinic }] = await Promise.all([
      admin
        .from('queues')
        .select(
          'id, ticket_code, ticket_color, status, queue_seq, doctor_id, called_at, started_at, joined_at, doctor:profiles!doctor_id(full_name), patient:patients(full_name)',
        )
        .eq('clinic_id', clinicId)
        .eq('queue_date', tashkentDate())
        .in('status', ['waiting', 'called', 'serving'])
        .order('priority', { ascending: false })
        .order('joined_at', { ascending: true })
        .limit(200),
      admin.from('clinics').select('name').eq('id', clinicId).maybeSingle(),
    ]);
    if (error) throw new BadRequestException(error.message);

    type Row = {
      id: string;
      ticket_code: string | null;
      ticket_color: string | null;
      status: string;
      queue_seq: number | null;
      doctor_id: string | null;
      called_at: string | null;
      started_at: string | null;
      doctor: { full_name: string | null } | null;
      patient: { full_name: string | null } | null;
    };
    const list = (data ?? []) as unknown as Row[];
    const rooms = await this.announcer.roomsFor(list.map((r) => r.doctor_id));
    const rows = list.map((r) => ({
      id: r.id,
      ticket_code: r.ticket_code,
      ticket_color: r.ticket_color,
      status: r.status,
      seq: r.queue_seq,
      at: r.called_at ?? r.started_at,
      patient: shortPatientName(r.patient?.full_name),
      doctor: r.doctor?.full_name ?? null,
      room: r.doctor_id ? (rooms[r.doctor_id] ?? null) : null,
    }));
    const called = rows
      .filter((r) => r.status === 'called' || r.status === 'serving')
      .sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')))
      .slice(0, 8);
    const waiting = rows.filter((r) => r.status === 'waiting').slice(0, 14);
    return {
      paired: true,
      clinic_name: (clinic as { name: string | null } | null)?.name ?? null,
      called,
      waiting,
    };
  }

  // Qayta chaqirish (qabulxona "TV ga", shifokor 📣) — holatni o'zgartirmaydi.
  async announce(clinicId: string, queueId: string) {
    const payload = await this.announcer.payloadFor(clinicId, queueId);
    if (!payload) throw new NotFoundException('Navbat topilmadi');
    const { count } = await this.supabase
      .admin()
      .from('queue_displays')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('is_paired', true);
    try {
      await this.announcer.broadcast(clinicId, 'call', payload);
    } catch (e) {
      throw new BadRequestException(`TV'ga yuborilmadi: ${(e as Error).message}`);
    }
    return { ok: true, tvs: count ?? 0, room: payload.room };
  }

  // ── Navbat ovozi ──────────────────────────────────────────────────────────
  /** Shu to'plamdagi yozuvlar: kalit → ommaviy URL (?v= — kesh yangilanishi uchun). */
  async voiceList(scope: string): Promise<Record<string, string>> {
    const bucket = this.supabase.admin().storage.from(VOICE_BUCKET);
    const { data, error } = await bucket.list(scope, { limit: 500 });
    if (error || !data) return {}; // bucket hali yo'q (migratsiya) — ovozsiz
    const out: Record<string, string> = {};
    for (const f of data) {
      const key = f.name.replace(/\.[^.]+$/, '');
      if (!CAST_VOICE_KEYS.has(key)) continue;
      const url = bucket.getPublicUrl(`${scope}/${f.name}`).data.publicUrl;
      const v = Date.parse(f.updated_at ?? f.created_at ?? '') || 0;
      out[key] = `${url}?v=${v}`;
    }
    return out;
  }

  async voiceUpload(scope: string, key: string, body: unknown) {
    if (!CAST_VOICE_KEYS.has(key)) throw new BadRequestException("Noma'lum ibora kaliti");
    const { data_base64, content_type } = VoiceUploadSchema.parse(body);
    const raw = content_type.split(';')[0]!.trim().toLowerCase();
    const ct = VOICE_CANON[raw] ?? raw;
    const ext = VOICE_EXT[ct];
    if (!ext) throw new BadRequestException(`Audio turi qo'llanmaydi: ${ct}`);
    const buf = Buffer.from(data_base64, 'base64');
    if (buf.length < 200) throw new BadRequestException("Yozuv bo'sh");
    if (buf.length > VOICE_MAX_BYTES)
      throw new BadRequestException('Yozuv juda katta (1,5 MB dan oshmasin)');
    await this.voiceRemove(scope, key);
    const { error } = await this.supabase
      .admin()
      .storage.from(VOICE_BUCKET)
      .upload(`${scope}/${key}.${ext}`, buf, {
        contentType: ct,
        upsert: true,
        cacheControl: '3600',
      });
    if (error) {
      throw new BadRequestException(
        /bucket/i.test(error.message)
          ? 'Ovoz ombori hali yaratilmagan — serverda scripts/deploy-cast-voice.sh ishga tushirilsin'
          : error.message,
      );
    }
    return { ok: true, clips: await this.voiceList(scope) };
  }

  /** Kalitning barcha formatdagi fayllarini o'chiradi (webm → mp3 almashganda ham). */
  async voiceRemove(scope: string, key: string) {
    if (!CAST_VOICE_KEYS.has(key)) throw new BadRequestException("Noma'lum ibora kaliti");
    const bucket = this.supabase.admin().storage.from(VOICE_BUCKET);
    const { data } = await bucket.list(scope, { limit: 500, search: key });
    const paths = (data ?? [])
      .filter((f) => f.name.replace(/\.[^.]+$/, '') === key)
      .map((f) => `${scope}/${f.name}`);
    if (paths.length) await bucket.remove(paths);
    return { ok: true };
  }

  /** TV uchun: platforma standart ovozi + klinikaning o'zi yozganlari (ustun). */
  async publicVoice(deviceId: string) {
    const clinicId = await this.pairedClinic(deviceId);
    if (!clinicId) return { clips: {} as Record<string, string> };
    const [def, own] = await Promise.all([
      this.voiceList(VOICE_DEFAULT_SCOPE),
      this.voiceList(clinicId),
    ]);
    return { clips: { ...def, ...own } };
  }

  async clinicVoice(clinicId: string) {
    const [def, own] = await Promise.all([
      this.voiceList(VOICE_DEFAULT_SCOPE),
      this.voiceList(clinicId),
    ]);
    return { clinic: own, default: def };
  }

  // Klinika — bog'langan TV'lar ro'yxati (online holati bilan).
  async listDisplays(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('queue_displays')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_paired', true)
      .order('created_at', { ascending: true });
    const nowMs = Date.now();
    return (
      (data ?? []) as Array<{
        id: string;
        device_id: string;
        name: string | null;
        is_paired: boolean;
        last_seen_at: string | null;
        created_at: string;
        mode?: string | null;
      }>
    ).map((d) => ({
      id: d.id,
      device_id: d.device_id,
      name: d.name,
      is_paired: d.is_paired,
      last_seen_at: d.last_seen_at,
      created_at: d.created_at,
      mode: d.mode === 'ads' ? ('ads' as const) : ('queue' as const),
      online: !!d.last_seen_at && nowMs - new Date(d.last_seen_at).getTime() < ONLINE_WINDOW_MS,
    }));
  }

  // Klinika — kod bilan TV'ni bog'lash.
  async pairDisplay(clinicId: string, code: string, name: string, mode: DisplayMode = 'queue') {
    const admin = this.supabase.admin();
    const { data: display } = await admin
      .from('queue_displays')
      .select('id, is_paired')
      .eq('pairing_code', code.trim().toUpperCase())
      .maybeSingle();
    if (!display) throw new BadRequestException("Kod noto'g'ri yoki muddati o'tgan");
    const row = display as { id: string; is_paired: boolean };
    if (row.is_paired) throw new BadRequestException("Bu TV allaqachon bog'langan");
    const { data, error } = await admin
      .from('queue_displays')
      .update({
        clinic_id: clinicId,
        name: name.trim(),
        is_paired: true,
        pairing_code: null,
        // Oddiy TV — ustun yo'q bo'lsa ham (migratsiyasiz) bog'lanaversin
        ...(mode === 'ads' ? { mode } : {}),
      })
      .eq('id', row.id)
      .select('id, device_id, name, is_paired, last_seen_at, created_at')
      .single();
    if (error) throw new BadRequestException(adsSchemaHint(error.message));
    return { ...data, mode };
  }

  // Klinika — TV rejimi (navbat / faqat reklama) yoki nomini o'zgartirish.
  async updateDisplay(clinicId: string, id: string, patch: { mode?: DisplayMode; name?: string }) {
    const upd: Record<string, unknown> = {};
    if (patch.mode) upd.mode = patch.mode;
    if (patch.name) upd.name = patch.name.trim();
    const { data, error } = await this.supabase
      .admin()
      .from('queue_displays')
      .update(upd)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(adsSchemaHint(error.message));
    if (!data) throw new NotFoundException('TV topilmadi');
    return { ok: true };
  }

  // Klinika — TV'ni uzish (o'chirish).
  async removeDisplay(clinicId: string, id: string) {
    const { error } = await this.supabase
      .admin()
      .from('queue_displays')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── TV reklama videolari ──────────────────────────────────────────────────
  private adUrl(path: string): string {
    return this.supabase.admin().storage.from(ADS_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  private async adRows(clinicId: string): Promise<AdRow[]> {
    const { data, error } = await this.supabase
      .admin()
      .from('cast_ad_videos')
      .select(AD_COLS)
      .eq('clinic_id', clinicId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(adsSchemaHint(error.message));
    return (data ?? []) as unknown as AdRow[];
  }

  /** Tugallanmagan eski yuklashlar fayli bilan o'chiriladi — limitni band qilmasin. */
  private async dropStalePending(rows: AdRow[]): Promise<AdRow[]> {
    const now = Date.now();
    const stale = rows.filter(
      (r) => r.status === 'pending' && now - Date.parse(r.created_at) > AD_PENDING_TTL_MS,
    );
    if (stale.length === 0) return rows;
    const admin = this.supabase.admin();
    await admin.storage.from(ADS_BUCKET).remove(stale.map((r) => r.storage_path));
    await admin
      .from('cast_ad_videos')
      .delete()
      .in(
        'id',
        stale.map((r) => r.id),
      );
    return rows.filter((r) => !stale.includes(r));
  }

  private async adLimits(clinicId: string) {
    return castAdsLimits(await this.entitlements.get(clinicId));
  }

  private static usage(rows: AdRow[]) {
    return {
      count: rows.length,
      bytes: rows.reduce((sum, r) => sum + Number(r.size_bytes || 0), 0),
    };
  }

  /** Klinika: videolar, band joy (yuklanayotganlar ham) va tarif limiti. */
  async adsState(clinicId: string) {
    const rows = await this.dropStalePending(await this.adRows(clinicId));
    return {
      videos: rows
        .filter((r) => r.status === 'ready')
        .map((r) => ({
          id: r.id,
          title: r.title,
          url: this.adUrl(r.storage_path),
          content_type: r.content_type,
          size_bytes: Number(r.size_bytes),
          is_active: r.is_active,
          sort_order: r.sort_order,
          created_at: r.created_at,
        })),
      usage: CastService.usage(rows),
      limits: await this.adLimits(clinicId),
    };
  }

  /**
   * Yuklash boshlash: limitni tekshiradi, yozuv (pending) ochadi va brauzer
   * faylni to'g'ridan-to'g'ri saqlashga yuklashi uchun imzolangan URL beradi.
   */
  async adsUploadUrl(clinicId: string, userId: string | null, body: unknown) {
    const b = AdUploadSchema.parse(body);
    const ct = (b.content_type.split(';')[0] ?? '').trim().toLowerCase();
    const ext = AD_EXT[ct];
    if (!ext) throw new BadRequestException('Faqat MP4 yoki WebM video yuklanadi');
    const limits = await this.adLimits(clinicId);
    if (b.size_bytes > limits.max_file_mb * MB) {
      throw new BadRequestException(`Bitta video ${fmtMb(limits.max_file_mb)} dan oshmasin`);
    }
    const rows = await this.dropStalePending(await this.adRows(clinicId));
    const used = CastService.usage(rows);
    if (used.count >= limits.max_videos) {
      throw new BadRequestException(
        `Tarifingizda ko'pi bilan ${limits.max_videos} ta video. Avval keraksizini o'chiring.`,
      );
    }
    if (used.bytes + b.size_bytes > limits.max_storage_mb * MB) {
      throw new BadRequestException(
        `Jami hajm ${fmtMb(limits.max_storage_mb)} dan oshadi (band: ${fmtMb(used.bytes / MB)}).`,
      );
    }

    const admin = this.supabase.admin();
    const path = `${clinicId}/${randomUUID()}.${ext}`;
    const title = (b.title ?? b.file_name.replace(/\.[^.]+$/, '')).trim().slice(0, 120) || null;
    const nextSort = rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
    const { data: row, error } = await admin
      .from('cast_ad_videos')
      .insert({
        clinic_id: clinicId,
        title,
        storage_path: path,
        content_type: ct,
        size_bytes: b.size_bytes,
        status: 'pending',
        sort_order: nextSort,
        created_by: userId,
      })
      .select('id')
      .single();
    if (error || !row) throw new BadRequestException(adsSchemaHint(error?.message ?? 'Xato'));
    const id = (row as { id: string }).id;

    const { data: signed, error: sErr } = await admin.storage
      .from(ADS_BUCKET)
      .createSignedUploadUrl(path);
    if (sErr || !signed) {
      await admin.from('cast_ad_videos').delete().eq('id', id);
      throw new BadRequestException(adsSchemaHint(sErr?.message ?? 'Yuklash havolasi olinmadi'));
    }
    return { id, signed_url: signed.signedUrl, content_type: ct };
  }

  /** Yuklash tugadi: fayl HAQIQIY hajmi bilan qayta tekshiriladi, keyin TV'ga chiqadi. */
  async adsComplete(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const rows = await this.adRows(clinicId);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundException('Video topilmadi');
    if (row.status === 'ready') return this.adsState(clinicId);

    const [dir, file] = row.storage_path.split('/') as [string, string];
    const { data: list } = await admin.storage.from(ADS_BUCKET).list(dir, { search: file });
    const obj = (list ?? []).find((f) => f.name === file);
    if (!obj) throw new BadRequestException('Fayl yuklanmagan — qayta urinib ko‘ring');
    const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);

    const limits = await this.adLimits(clinicId);
    const ready = rows.filter((r) => r.status === 'ready');
    const readyBytes = CastService.usage(ready).bytes;
    const reject = (msg: string) => {
      void admin.storage.from(ADS_BUCKET).remove([row.storage_path]);
      void admin.from('cast_ad_videos').delete().eq('id', id);
      return new BadRequestException(msg);
    };
    if (size <= 0) throw reject("Fayl bo'sh");
    if (size > limits.max_file_mb * MB) {
      throw reject(`Bitta video ${fmtMb(limits.max_file_mb)} dan oshmasin`);
    }
    if (ready.length + 1 > limits.max_videos) {
      throw reject(`Tarifingizda ko'pi bilan ${limits.max_videos} ta video`);
    }
    if (readyBytes + size > limits.max_storage_mb * MB) {
      throw reject(`Jami hajm ${fmtMb(limits.max_storage_mb)} dan oshadi`);
    }

    const { error } = await admin
      .from('cast_ad_videos')
      .update({ status: 'ready', size_bytes: size, updated_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.adsState(clinicId);
  }

  async adsPatch(clinicId: string, id: string, body: unknown) {
    const b = AdPatchSchema.parse(body);
    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.title !== undefined) upd.title = b.title?.trim() || null;
    if (b.is_active !== undefined) upd.is_active = b.is_active;
    if (b.sort_order !== undefined) upd.sort_order = b.sort_order;
    const { data, error } = await this.supabase
      .admin()
      .from('cast_ad_videos')
      .update(upd)
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(adsSchemaHint(error.message));
    if (!data) throw new NotFoundException('Video topilmadi');
    return this.adsState(clinicId);
  }

  /** Tartib: berilgan id'lar ketma-ketligi bo'yicha. */
  async adsOrder(clinicId: string, ids: string[]) {
    const admin = this.supabase.admin();
    await Promise.all(
      ids.map((id, i) =>
        admin
          .from('cast_ad_videos')
          .update({ sort_order: i })
          .eq('clinic_id', clinicId)
          .eq('id', id),
      ),
    );
    return this.adsState(clinicId);
  }

  async adsDelete(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('cast_ad_videos')
      .select('id, storage_path')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Video topilmadi');
    const row = data as { id: string; storage_path: string };
    const { error: rmErr } = await admin.storage.from(ADS_BUCKET).remove([row.storage_path]);
    if (rmErr) throw new BadRequestException(rmErr.message);
    await admin.from('cast_ad_videos').delete().eq('clinic_id', clinicId).eq('id', id);
    return this.adsState(clinicId);
  }

  /** TV (login'siz): rejim + yoqilgan videolar tartib bilan. */
  async publicAds(deviceId: string) {
    const admin = this.supabase.admin();
    const { data: d } = await admin
      .from('queue_displays')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();
    const disp = d as { clinic_id: string | null; is_paired: boolean; mode?: string | null } | null;
    if (!disp?.is_paired || !disp.clinic_id) {
      return {
        mode: 'queue' as const,
        videos: [] as Array<{ id: string; url: string; title: string | null }>,
      };
    }
    const mode = disp.mode === 'ads' ? ('ads' as const) : ('queue' as const);
    const { data, error } = await admin
      .from('cast_ad_videos')
      .select('id, title, storage_path')
      .eq('clinic_id', disp.clinic_id)
      .eq('status', 'ready')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) return { mode, videos: [] }; // migratsiya hali yo'q — reklamasiz
    return {
      mode,
      videos: (
        (data ?? []) as Array<{ id: string; title: string | null; storage_path: string }>
      ).map((r) => ({ id: r.id, title: r.title, url: this.adUrl(r.storage_path) })),
    };
  }
}

function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${Math.ceil(mb)} MB`;
}

// TV (login'siz) — public endpointlar.
@ApiTags('cast')
@Controller('public/cast')
export class CastPublicController {
  constructor(private readonly svc: CastService) {}

  @Public()
  @Post('register')
  register(@Body() body: unknown) {
    const { device_id } = RegisterSchema.parse(body);
    return this.svc.register(device_id);
  }

  @Public()
  @Get('status')
  status(@Query('device_id') deviceId?: string) {
    if (!deviceId) throw new BadRequestException('device_id required');
    return this.svc.status(deviceId);
  }

  @Public()
  @Get('board')
  board(@Query('device_id') deviceId?: string) {
    if (!deviceId) throw new BadRequestException('device_id required');
    return this.svc.board(deviceId);
  }

  @Public()
  @Get('voice')
  voice(@Query('device_id') deviceId?: string) {
    if (!deviceId) throw new BadRequestException('device_id required');
    return this.svc.publicVoice(deviceId);
  }

  @Public()
  @Get('ads')
  ads(@Query('device_id') deviceId?: string) {
    if (!deviceId) throw new BadRequestException('device_id required');
    return this.svc.publicAds(deviceId);
  }
}

// Klinika (auth) — TV boshqaruvi.
@ApiTags('cast')
@Controller({ path: 'cast', version: '1' })
export class CastController {
  constructor(private readonly svc: CastService) {}

  @Get('displays')
  displays(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listDisplays(u.clinicId);
  }

  @Post('displays/pair')
  pair(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const { code, name, mode } = PairSchema.parse(body);
    return this.svc.pairDisplay(u.clinicId, code, name, mode);
  }

  @Patch('displays/:id')
  updateDisplay(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateDisplay(u.clinicId, id, DisplayPatchSchema.parse(body));
  }

  // ── TV reklama videolari ──
  @Get('ads')
  ads(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.adsState(u.clinicId);
  }

  @Post('ads/upload-url')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  adsUploadUrl(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.adsUploadUrl(u.clinicId, u.userId, body);
  }

  @Post('ads/:id/complete')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  adsComplete(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.adsComplete(u.clinicId, id);
  }

  @Put('ads/order')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  adsOrder(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(100) }).parse(body);
    return this.svc.adsOrder(u.clinicId, ids);
  }

  @Patch('ads/:id')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  adsPatch(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.adsPatch(u.clinicId, id, body);
  }

  @Delete('ads/:id')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  adsDelete(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.adsDelete(u.clinicId, id);
  }

  @Delete('displays/:id')
  remove(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.removeDisplay(u.clinicId, id);
  }

  // Bemorni TV'da qayta chaqirish (holat o'zgarmaydi).
  @Post('announce')
  announce(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const { queue_id } = AnnounceSchema.parse(body);
    return this.svc.announce(u.clinicId, queue_id);
  }

  // Klinikaning o'z ovozi (bo'sh bo'lsa platforma standart ovozi ishlaydi).
  @Get('voice')
  voice(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.clinicVoice(u.clinicId);
  }

  @Put('voice/:key')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  voiceUpload(
    @CurrentUser() u: { clinicId: string | null },
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.voiceUpload(u.clinicId, key, body);
  }

  @Delete('voice/:key')
  @Roles('clinic_owner', 'clinic_admin', 'super_admin')
  async voiceRemove(@CurrentUser() u: { clinicId: string | null }, @Param('key') key: string) {
    if (!u.clinicId) throw new ForbiddenException();
    await this.svc.voiceRemove(u.clinicId, key);
    return { ok: true, clips: await this.svc.voiceList(u.clinicId) };
  }
}

// Super admin — platformaning standart navbat ovozi (barcha klinikalar uchun).
@ApiTags('admin')
@Controller('admin/cast/voice')
@UseGuards(SuperAdminGuard)
export class AdminCastVoiceController {
  constructor(private readonly svc: CastService) {}

  @Get()
  async list() {
    return { clips: await this.svc.voiceList(VOICE_DEFAULT_SCOPE) };
  }

  @Put(':key')
  upload(@Param('key') key: string, @Body() body: unknown) {
    return this.svc.voiceUpload(VOICE_DEFAULT_SCOPE, key, body);
  }

  @Delete(':key')
  async remove(@Param('key') key: string) {
    await this.svc.voiceRemove(VOICE_DEFAULT_SCOPE, key);
    return { ok: true, clips: await this.svc.voiceList(VOICE_DEFAULT_SCOPE) };
  }
}

@Module({
  controllers: [CastPublicController, CastController, AdminCastVoiceController],
  providers: [CastService, SupabaseService, CastAnnouncer],
})
export class CastModule {}
