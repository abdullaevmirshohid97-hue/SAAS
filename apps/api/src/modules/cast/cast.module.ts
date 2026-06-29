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
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

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

@Injectable()
export class CastService {
  constructor(private readonly supabase: SupabaseService) {}

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
        id: string; clinic_id: string | null; name: string | null;
        pairing_code: string | null; is_paired: boolean;
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
    await admin.from('queue_displays').update({ last_seen_at: new Date().toISOString() }).eq('device_id', deviceId);
    const row = data as { clinic_id: string | null; name: string | null; is_paired: boolean; pairing_code: string | null };
    return {
      paired: row.is_paired,
      clinic_id: row.clinic_id,
      name: row.name,
      pairing_code: row.is_paired ? null : row.pairing_code,
    };
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
    return ((data ?? []) as Array<{ id: string; device_id: string; name: string | null; last_seen_at: string | null; created_at: string }>)
      .map((d) => ({
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
    if (row.is_paired) throw new BadRequestException('Bu TV allaqachon bog\'langan');
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
}

@Module({
  controllers: [CastPublicController, CastController],
  providers: [CastService, SupabaseService],
})
export class CastModule {}
