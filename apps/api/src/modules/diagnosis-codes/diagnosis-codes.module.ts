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
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Diagnosis Codes — ICD-10 + ICD-11 birlashtirilgan qatlam
// =============================================================================
// /icd10/* (icd10.module.ts) TEGILMADI — mavjud chaqiruvchilar (doctor
// workspace pickeri) o'zgarishsiz ishlaydi. Bu YANGI, tizim-ogohli qatlam:
// ikkala klassifikatorni bitta so'rovda qidiradi, sevimlilarni ikkala
// tizim bo'yicha ham ko'rsatadi.
//
// ICD-11 (icd11_codes) hozircha BO'SH — WHO ICD-11 ma'lumoti hali
// yuklanmagan (D4 bilan bir xil holat: haqiqiy tibbiy ma'lumotni o'ylab
// topib bo'lmaydi). Qidiruv/ro'yxat funksiyalari ishlaydi, faqat natija
// hozircha 0 ta bo'ladi — bu KUTILGAN holat, xato emas.

const CODE_SYSTEMS = ['all', 'icd10', 'icd11'] as const;
export type CodeSystemParam = (typeof CODE_SYSTEMS)[number];

function parseSystem(v: string | undefined): CodeSystemParam {
  return (CODE_SYSTEMS as readonly string[]).includes(v ?? '')
    ? (v as CodeSystemParam)
    : 'all';
}

export interface DiagnosisSearchRow {
  code_system: 'icd10' | 'icd11';
  code: string;
  title_uz: string | null;
  title_ru: string | null;
  title_en: string | null;
  chapter: string | null;
}

const RECENT_LIMIT = 8;
const FAVORITE_LIMIT = 30;

@Injectable()
export class DiagnosisCodesService {
  constructor(private readonly supabase: SupabaseService) {}

  async search(query: string, system: CodeSystemParam, limit = 20): Promise<DiagnosisSearchRow[]> {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const { data, error } = await this.supabase.admin().rpc('search_diagnosis_codes' as never, {
      p_query: q,
      p_system: system,
      p_limit: Math.min(limit, 50),
    } as never);
    if (error) throw new BadRequestException(`Qidiruv xatosi: ${error.message}`);
    return (data ?? []) as DiagnosisSearchRow[];
  }

  /** Klassifikator holati — frontend ICD-11 bo'sh ekanini bilib, xabar berishi uchun. */
  async systemStatus() {
    const admin = this.supabase.admin();
    const [icd10, icd11] = await Promise.all([
      admin.from('icd10_codes').select('code', { count: 'exact', head: true }),
      admin.from('icd11_codes').select('code', { count: 'exact', head: true }),
    ]);
    return {
      icd10: { available: true, count: icd10.count ?? 0 },
      icd11: { available: (icd11.count ?? 0) > 0, count: icd11.count ?? 0 },
    };
  }

  /** Sevimlilar + oxirgi ishlatganlar — ikkala tizim bo'yicha, aralash. */
  async myCodes(userId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from('doctor_icd_usage')
      .select(
        'code, code_system, is_favorite, use_count, last_used_at, icd10:icd10_codes(name_uz, name_ru, name_en), icd11:icd11_codes(title_uz, title_ru, title_en)',
      )
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);

    type Row = {
      code: string;
      code_system: 'icd10' | 'icd11';
      is_favorite: boolean;
      last_used_at: string;
      icd10: { name_uz: string; name_ru: string | null; name_en: string | null } | null;
      icd11: { title_uz: string | null; title_ru: string | null; title_en: string } | null;
    };
    const rows = ((data ?? []) as unknown as Row[]).map((r) => {
      const title =
        r.code_system === 'icd10'
          ? (r.icd10?.name_uz ?? r.code)
          : (r.icd11?.title_uz ?? r.icd11?.title_en ?? r.code);
      return {
        code: r.code,
        code_system: r.code_system,
        title,
        is_favorite: r.is_favorite,
        last_used_at: r.last_used_at,
      };
    });

    return {
      favorites: rows.filter((r) => r.is_favorite).slice(0, FAVORITE_LIMIT),
      recent: rows.slice(0, RECENT_LIMIT),
    };
  }

  async markUsed(userId: string, clinicId: string | null, system: 'icd10' | 'icd11', code: string) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('doctor_icd_usage')
      .select('use_count')
      .eq('user_id', userId)
      .eq('code_system', system)
      .eq('code', code)
      .maybeSingle();

    // Trigger kodning haqiqatan lug'atda borligini tekshiradi — bu yerda
    // qo'shimcha tekshiruv shart emas, xato bo'lsa server aniq sabab bilan
    // 400 qaytaradi.
    const { error } = await admin.from('doctor_icd_usage').upsert(
      {
        user_id: userId,
        code,
        code_system: system,
        clinic_id: clinicId,
        use_count: ((cur as { use_count: number } | null)?.use_count ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,code_system,code' },
    );
    if (error) throw new BadRequestException(error.message);
    return { ok: true as const };
  }

  async toggleFavorite(
    userId: string,
    clinicId: string | null,
    system: 'icd10' | 'icd11',
    code: string,
  ) {
    const admin = this.supabase.admin();
    const { data: cur } = await admin
      .from('doctor_icd_usage')
      .select('is_favorite')
      .eq('user_id', userId)
      .eq('code_system', system)
      .eq('code', code)
      .maybeSingle();

    const next = !((cur as { is_favorite: boolean } | null)?.is_favorite ?? false);
    const { error } = await admin.from('doctor_icd_usage').upsert(
      { user_id: userId, code, code_system: system, clinic_id: clinicId, is_favorite: next },
      { onConflict: 'user_id,code_system,code' },
    );
    if (error) throw new BadRequestException(error.message);
    return { is_favorite: next };
  }
}

const UseSchema = z.object({ code_system: z.enum(['icd10', 'icd11']).default('icd10') });

@ApiTags('diagnosis-codes')
@Controller('diagnosis-codes')
class DiagnosisCodesController {
  constructor(private readonly svc: DiagnosisCodesService) {}

  @Get('search')
  search(
    @Query('q') q: string,
    @Query('system') system?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.search(q ?? '', parseSystem(system), limit ? Number(limit) : 20);
  }

  @Get('status')
  status() {
    return this.svc.systemStatus();
  }

  @Get('my')
  myCodes(@CurrentUser() u: { userId: string | null }) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.myCodes(u.userId);
  }

  @Post('my/:code/use')
  markUsed(
    @CurrentUser() u: { userId: string | null; clinicId: string | null },
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    if (!u.userId) throw new ForbiddenException();
    const { code_system } = UseSchema.parse(body ?? {});
    return this.svc.markUsed(u.userId, u.clinicId, code_system, code);
  }

  @Post('my/:code/favorite')
  toggleFavorite(
    @CurrentUser() u: { userId: string | null; clinicId: string | null },
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    if (!u.userId) throw new ForbiddenException();
    const { code_system } = UseSchema.parse(body ?? {});
    return this.svc.toggleFavorite(u.userId, u.clinicId, code_system, code);
  }
}

@Module({
  controllers: [DiagnosisCodesController],
  providers: [DiagnosisCodesService, SupabaseService],
  exports: [DiagnosisCodesService],
})
export class DiagnosisCodesModule {}
