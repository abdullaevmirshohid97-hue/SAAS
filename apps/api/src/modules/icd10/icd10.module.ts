import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// ICD-10 — kasalliklar tasniflagichi qidiruvi (uz/ru/en).
// Global reference — barcha klinikalar uchun umumiy, tenant-scoped emas.
// =============================================================================
@Injectable()
export class Icd10Service {
  constructor(private readonly supabase: SupabaseService) {}

  async search(query: string, limit = 20) {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const { data, error } = await this.supabase
      .admin()
      .rpc('search_icd10' as never, { p_query: q, p_limit: limit } as never);
    if (error) return [];
    return data ?? [];
  }

  async byCode(code: string) {
    const { data } = await this.supabase
      .admin()
      .from('icd10_codes')
      .select('code, name_uz, name_ru, name_en, category')
      .eq('code', code)
      .maybeSingle();
    return data;
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
