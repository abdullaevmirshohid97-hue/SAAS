import {
  Body, Controller, ForbiddenException, Get, Injectable, Logger, Module,
  Param, Post,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// QISM 2 / E2 — Fixed Assets (asosiy vositalar) + amortizatsiya.
// Oylik amortizatsiya: run_depreciation RPC (Dr 5300 / Cr 1590). Cron: oyma-oy.
// =============================================================================
const TZ = 'Asia/Tashkent';

const AssetSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  category: z.enum(['equipment', 'computer', 'furniture', 'vehicle', 'building', 'other']).optional(),
  acquisition_date: z.string().optional(),
  cost_uzs: z.number().int().nonnegative(),
  residual_uzs: z.number().int().nonnegative().optional(),
  useful_life_months: z.number().int().positive().optional(),
  cost_center_id: z.string().uuid().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  capitalize: z.boolean().optional(), // true → Dr 1500 / Cr kassa (kapitalizatsiya)
  payment_method: z.string().optional(),
});

@Injectable()
export class FixedAssetsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(clinicId: string) {
    const { data } = await this.supabase.admin()
      .from('fixed_assets')
      .select('*, cost_center:cost_centers(name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    return (data ?? []).map((a) => {
      const r = a as Record<string, unknown> & { cost_uzs: number; accumulated_depreciation_uzs: number };
      return { ...r, net_book_value_uzs: Number(r.cost_uzs) - Number(r.accumulated_depreciation_uzs) };
    });
  }

  async create(clinicId: string, userId: string | null, body: z.infer<typeof AssetSchema>) {
    const admin = this.supabase.admin();
    const code = body.code || 'FA-' + Date.now().toString(36).toUpperCase();
    const { data, error } = await admin.from('fixed_assets').insert({
      clinic_id: clinicId, code, name: body.name, category: body.category ?? 'equipment',
      acquisition_date: body.acquisition_date ?? undefined, cost_uzs: body.cost_uzs,
      residual_uzs: body.residual_uzs ?? 0, useful_life_months: body.useful_life_months ?? 60,
      cost_center_id: body.cost_center_id ?? null, location: body.location ?? null,
      qr_code: code, notes: body.notes ?? null, created_by: userId,
    }).select('id').single();
    if (error) throw new Error(error.message);
    const assetId = (data as { id: string }).id;

    // Ixtiyoriy kapitalizatsiya: Dr 1500 / Cr kassa (agar avval xarajat qilinmagan bo'lsa)
    if (body.capitalize && body.cost_uzs > 0) {
      try {
        await admin.rpc('post_journal', {
          p_clinic: clinicId, p_type: 'asset_acquire', p_date: body.acquisition_date ?? new Date().toISOString().slice(0, 10),
          p_source_table: 'fixed_assets', p_source_id: assetId, p_memo: 'Asosiy vosita: ' + body.name,
          p_lines: [
            { code: '1500', debit: body.cost_uzs, credit: 0 },
            { code: body.payment_method === 'cash' ? '1010' : '1030', debit: 0, credit: body.cost_uzs },
          ],
        });
      } catch { /* kapitalizatsiya GL xatosi asosiy yozuvni bloklamaydi */ }
    }
    return { id: assetId, code };
  }

  async update(clinicId: string, id: string, body: Record<string, unknown>) {
    const allowed = ['name', 'category', 'location', 'cost_center_id', 'residual_uzs', 'useful_life_months', 'notes'];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    await this.supabase.admin().from('fixed_assets').update(patch).eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async dispose(clinicId: string, id: string) {
    await this.supabase.admin().from('fixed_assets')
      .update({ status: 'disposed', disposed_at: new Date().toISOString().slice(0, 10) })
      .eq('clinic_id', clinicId).eq('id', id);
    return { ok: true };
  }

  async runDepreciation(clinicId: string, period?: string) {
    const { data, error } = await this.supabase.admin()
      .rpc('run_depreciation', { p_clinic: clinicId, p_period: period ?? new Date().toISOString().slice(0, 10) });
    if (error) throw new Error(error.message);
    return { posted: data as number };
  }
}

@Injectable()
export class FixedAssetsCronService {
  private readonly logger = new Logger('FixedAssetsCron');
  constructor(private readonly supabase: SupabaseService) {}

  // Har oyning 1-kuni 02:00 (Tashkent) — o'tgan oy uchun amortizatsiya
  @Cron('0 2 1 * *', { timeZone: TZ })
  async monthlyDepreciation(): Promise<void> {
    const now = new Date(Date.now() + 5 * 3_600_000);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const period = prev.toISOString().slice(0, 10);
    const { data } = await this.supabase.admin().from('clinics').select('id').is('deleted_at', null);
    for (const c of (data ?? []) as Array<{ id: string }>) {
      try {
        const { data: n } = await this.supabase.admin().rpc('run_depreciation', { p_clinic: c.id, p_period: period });
        if ((n as number) > 0) this.logger.log(`Amortizatsiya ${c.id} (${period}): ${n} ta`);
      } catch (e) { this.logger.warn(`Amortizatsiya ${c.id} xato: ${(e as Error).message}`); }
    }
  }
}

@ApiTags('fixed-assets')
@Controller({ path: 'fixed-assets', version: '1' })
class FixedAssetsController {
  constructor(private readonly svc: FixedAssetsService) {}

  @Get()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  list(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.list(u.clinicId);
  }

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId ?? null, AssetSchema.parse(body));
  }

  @Post(':id')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  update(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.update(u.clinicId, id, (body ?? {}) as Record<string, unknown>);
  }

  @Post(':id/dispose')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  dispose(@CurrentUser() u: { clinicId: string | null }, @Param('id') id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.dispose(u.clinicId, id);
  }

  @Post('run-depreciation/now')
  @Roles('clinic_admin', 'clinic_owner', 'super_admin')
  run(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    const period = (body as { period?: string })?.period;
    return this.svc.runDepreciation(u.clinicId, period);
  }
}

@Module({
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService, FixedAssetsCronService, SupabaseService],
})
export class FixedAssetsModule {}
