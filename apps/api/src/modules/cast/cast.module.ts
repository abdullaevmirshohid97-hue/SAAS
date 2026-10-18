import { randomInt } from 'node:crypto';

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
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CAST_VOICE_KEYS } from '@clary/schemas';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
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
const PairSchema = z.object({ code: z.string().min(4).max(12), name: z.string().min(1).max(80) });
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

@Injectable()
export class CastService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly announcer: CastAnnouncer,
  ) {}

  // TV (login'siz) — birinchi ochilganda ro'yxatdan o'tadi, pairing kodi oladi.
  async register(deviceId: string) {
    const admin = this.supabase.admin();
    const { data: existing } = await admin
      .from('queue_displays')
      .select('id, clinic_id, name, pairing_code, is_paired')
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
      };
    }

    const code = genCode();
    await admin.from('queue_displays').insert({
      device_id: deviceId,
      pairing_code: code,
      is_paired: false,
      last_seen_at: now,
    });
    return { paired: false, clinic_id: null, name: null, pairing_code: code };
  }

  // TV poll qiladi — bog'langanini va clinic_id'ni bilish uchun (+ heartbeat).
  async status(deviceId: string) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('queue_displays')
      .select('clinic_id, name, is_paired, pairing_code')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (!data) return { paired: false, clinic_id: null, name: null, pairing_code: null };
    await admin
      .from('queue_displays')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('device_id', deviceId);
    const row = data as {
      clinic_id: string | null;
      name: string | null;
      is_paired: boolean;
      pairing_code: string | null;
    };
    return {
      paired: row.is_paired,
      clinic_id: row.clinic_id,
      name: row.name,
      pairing_code: row.is_paired ? null : row.pairing_code,
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
      .select('id, device_id, name, is_paired, last_seen_at, created_at')
      .eq('clinic_id', clinicId)
      .eq('is_paired', true)
      .order('created_at', { ascending: true });
    const nowMs = Date.now();
    return (
      (data ?? []) as Array<{
        id: string;
        device_id: string;
        name: string | null;
        last_seen_at: string | null;
        created_at: string;
      }>
    ).map((d) => ({
      ...d,
      online: !!d.last_seen_at && nowMs - new Date(d.last_seen_at).getTime() < ONLINE_WINDOW_MS,
    }));
  }

  // Klinika — kod bilan TV'ni bog'lash.
  async pairDisplay(clinicId: string, code: string, name: string) {
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
      .update({ clinic_id: clinicId, name: name.trim(), is_paired: true, pairing_code: null })
      .eq('id', row.id)
      .select('id, device_id, name, is_paired, last_seen_at, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
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
    const { code, name } = PairSchema.parse(body);
    return this.svc.pairDisplay(u.clinicId, code, name);
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
