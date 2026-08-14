import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// ICD-10 — kasalliklar tasniflagichi qidiruvi (uz/ru/en).
// Global reference — barcha klinikalar uchun umumiy, tenant-scoped emas.
//
// Shifokorning sevimlilari va oxirgi ishlatganlari `doctor_icd_usage` da
// (ilgari brauzer localStorage'ida edi — kompyuter almashsa yo'qolardi).
// =============================================================================

const RECENT_LIMIT = 8;
const FAVORITE_LIMIT = 30;

export interface IcdEntry {
  code: string;
  name_uz: string;
  name_ru: string | null;
  name_en: string | null;
}

@Injectable()
export class Icd10Service {
  constructor(private readonly supabase: SupabaseService) {}

  async search(query: string, limit = 20) {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const { data, error } = await this.supabase
      .admin()
      .rpc('search_icd10' as never, { p_query: q, p_limit: limit } as never);
    // Xatoni YUTMAYMIZ: ilgari `if (error) return []` edi va qidiruv sinsa
    // shifokor "hech narsa topilmadi" deb o'ylardi — sababi ko'rinmasdi.
    if (error) throw new BadRequestException(`ICD qidiruv xatosi: ${error.message}`);
    return data ?? [];
  }

  async byCode(code: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('icd10_codes')
      .select('code, name_uz, name_ru, name_en, category')
      .eq('code', code)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Shifokorning sevimlilari + oxirgi ishlatganlari (nomlar bilan). */
  async myCodes(userId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('doctor_icd_usage')
      .select('code, is_favorite, use_count, last_used_at, icd:icd10_codes(name_uz, name_ru, name_en)')
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);

    type Row = {
      code: string;
      is_favorite: boolean;
      last_used_at: string;
      icd: { name_uz: string; name_ru: string | null; name_en: string | null } | null;
    };
    const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
      code: r.code,
      name_uz: r.icd?.name_uz ?? r.code,
      name_ru: r.icd?.name_ru ?? null,
      name_en: r.icd?.name_en ?? null,
      is_favorite: r.is_favorite,
      last_used_at: r.last_used_at,
    }));

    return {
      favorites: rows.filter((r) => r.is_favorite).slice(0, FAVORITE_LIMIT),
      recent: rows.slice(0, RECENT_LIMIT),
    };
  }

  /** Kod ishlatilganda — hisobni oshiradi va vaqtni yangilaydi. */
  async markUsed(userId: string, clinicId: string | null, code: string) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('doctor_icd_usage')
      .select('use_count')
      .eq('user_id', userId)
      .eq('code', code)
      .maybeSingle();

    const { error } = await admin.from('doctor_icd_usage').upsert(
      {
        user_id: userId,
        code,
        clinic_id: clinicId,
        use_count: ((cur as { use_count: number } | null)?.use_count ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,code' },
    );
    if (error) throw new BadRequestException(error.message);
    return { ok: true as const };
  }

  /** Sevimliga qo'shish / olib tashlash. */
  async toggleFavorite(userId: string, clinicId: string | null, code: string) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('doctor_icd_usage')
      .select('is_favorite')
      .eq('user_id', userId)
      .eq('code', code)
      .maybeSingle();

    const next = !((cur as { is_favorite: boolean } | null)?.is_favorite ?? false);
    const { error } = await admin.from('doctor_icd_usage').upsert(
      { user_id: userId, code, clinic_id: clinicId, is_favorite: next },
      { onConflict: 'user_id,code' },
    );
    if (error) throw new BadRequestException(error.message);
    return { is_favorite: next };
  }

  /**
   * Brauzerdagi eski ro'yxatni serverga ko'chirish (bir marta).
   * Shifokor localStorage'da yig'gan sevimlilari yo'qolmasligi uchun.
   * Mavjud yozuvlarga TEGMAYDI — faqat yo'qlarini qo'shadi.
   */
  async importLegacy(
    userId: string,
    clinicId: string | null,
    input: { favorites: string[]; recent: string[] },
  ) {
    const admin = this.supabase.admin();
    const codes = Array.from(new Set([...input.favorites, ...input.recent])).slice(0, 100);
    if (codes.length === 0) return { imported: 0 };

    // Faqat lug'atda mavjud kodlarni olamiz — FK buzilmasligi uchun.
    const { data: valid } = await admin.from('icd10_codes').select('code').in('code', codes);
    const validCodes = new Set(((valid ?? []) as Array<{ code: string }>).map((r) => r.code));

    const { data: existing } = await admin
      .from('doctor_icd_usage')
      .select('code')
      .eq('user_id', userId);
    const have = new Set(((existing ?? []) as Array<{ code: string }>).map((r) => r.code));

    const rows = codes
      .filter((c) => validCodes.has(c) && !have.has(c))
      .map((c) => ({
        user_id: userId,
        code: c,
        clinic_id: clinicId,
        is_favorite: input.favorites.includes(c),
        use_count: 1,
      }));
    if (rows.length === 0) return { imported: 0 };

    const { error } = await admin.from('doctor_icd_usage').insert(rows);
    if (error) throw new BadRequestException(error.message);
    return { imported: rows.length };
  }
}

@ApiTags('icd10')
@Controller('icd10')
class Icd10Controller {
  constructor(private readonly svc: Icd10Service) {}

  @Get('search')
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.svc.search(q ?? '', limit ? Number(limit) : 20);
  }

  // ':code' dan OLDIN turishi shart — aks holda 'my' kod deb qabul qilinadi.
  @Get('my')
  myCodes(@CurrentUser() u: { userId: string | null }) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.myCodes(u.userId);
  }

  @Post('my/import')
  importLegacy(
    @CurrentUser() u: { userId: string | null; clinicId: string | null },
    @Body() body: { favorites?: string[]; recent?: string[] },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.importLegacy(u.userId, u.clinicId, {
      favorites: Array.isArray(body?.favorites) ? body.favorites.slice(0, 100) : [],
      recent: Array.isArray(body?.recent) ? body.recent.slice(0, 100) : [],
    });
  }

  @Post('my/:code/use')
  markUsed(
    @CurrentUser() u: { userId: string | null; clinicId: string | null },
    @Param('code') code: string,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.markUsed(u.userId, u.clinicId, code);
  }

  @Post('my/:code/favorite')
  toggleFavorite(
    @CurrentUser() u: { userId: string | null; clinicId: string | null },
    @Param('code') code: string,
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.toggleFavorite(u.userId, u.clinicId, code);
  }

  @Get(':code')
  byCode(@Param('code') code: string) {
    return this.svc.byCode(code);
  }
}

@Module({
  controllers: [Icd10Controller],
  providers: [Icd10Service, SupabaseService],
  exports: [Icd10Service],
})
export class Icd10Module {}
