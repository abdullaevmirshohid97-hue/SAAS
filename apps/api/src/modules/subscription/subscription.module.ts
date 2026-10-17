import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Subscription — trial + billing code flow (Click/Payme, NO Stripe).
// O'zbekistonda Stripe ishlamaydi; to'lov billing_code + Click/Payme webhook
// orqali tasdiqlanadi (webhooks.module.ts), yoki admin qo'lda faollashtiradi.
// =============================================================================
@Injectable()
class SubscriptionService {
  constructor(private readonly supabase: SupabaseService) {}

  async currentPlan(clinicId: string) {
    const admin = this.supabase.admin();
    const fields =
      'current_plan, subscription_status, trial_ends_at, subscription_ends_at, grace_ends_at, billing_code, trial_used';
    const { data } = await admin
      .from('clinics')
      .select(`${fields}, is_hq, company_id`)
      .eq('id', clinicId)
      .single();
    const row = data as
      | (Record<string, unknown> & { is_hq: boolean; company_id: string | null })
      | null;
    if (!row) return data;
    const plan = row;
    // Filial tarmog'i (billing_mode='company'): filial obunasi HQ orqali — tarif
    // va holat HQ'niki, to'lov ham HQ hisob raqami (billing_code) bilan.
    let billingMode: string | null = null;
    if (!row.is_hq && row.company_id) {
      const { data: co } = await admin
        .from('companies')
        .select('billing_mode')
        .eq('id', row.company_id)
        .maybeSingle();
      billingMode = (co as { billing_mode?: string } | null)?.billing_mode ?? null;
    }
    if (!row.is_hq && row.company_id && billingMode === 'company') {
      const { data: hq } = await admin
        .from('clinics')
        .select(`${fields}, name`)
        .eq('company_id', row.company_id)
        .eq('is_hq', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (hq) {
        const { name, ...hqPlan } = hq as Record<string, unknown> & { name: string };
        return { ...plan, ...hqPlan, billed_by_hq: true, hq_name: name };
      }
    }
    return { ...plan, billed_by_hq: false, hq_name: null };
  }

  // Demo'dan keyin "1 oy bepul" — tanlangan tarif bilan trialing'ga o'tadi.
  async startTrial(clinicId: string, planCode: '25pro' | '50pro' | '120pro') {
    const { data, error } = await this.supabase
      .admin()
      .rpc(
        'start_trial' as never,
        {
          p_clinic_id: clinicId,
          p_plan: planCode,
        } as never,
      )
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listPlans() {
    const { data } = await this.supabase
      .admin()
      .from('plans')
      .select(
        'id, code, name, price_usd_cents, price_yearly_cents, price_uzs, price_yearly_uzs, max_staff, max_devices, max_patients, features, sort_order, description, highlights, entitlements',
      )
      .eq('is_active', true)
      .order('sort_order');
    return data ?? [];
  }

  // Xodim/qurilma soniga qarab plan tavsiya (limit-based, AI emas).
  async recommendation(clinicId: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc('recommend_plan' as never, { p_clinic_id: clinicId } as never)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Klinikaning joriy seat usage'i — UI hint uchun
  async usage(clinicId: string) {
    const admin = this.supabase.admin();
    const [{ count: staffCount }, { count: deviceCount }, { data: limits }] = await Promise.all([
      admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_active', true),
      admin
        .from('user_devices')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('is_revoked', false),
      admin.rpc('get_clinic_plan_limits' as never, { p_clinic_id: clinicId } as never).single(),
    ]);
    const lim = limits as { max_staff: number | null; max_devices: number | null } | null;
    return {
      staff_used: staffCount ?? 0,
      staff_limit: lim?.max_staff ?? null,
      devices_used: deviceCount ?? 0,
      devices_limit: lim?.max_devices ?? null,
    };
  }
}

@ApiTags('subscription')
@Controller('subscription')
class SubscriptionController {
  constructor(private readonly svc: SubscriptionService) {}

  @Get('plans')
  plans() {
    return this.svc.listPlans();
  }

  @Get('current')
  current(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.currentPlan(u.clinicId);
  }

  @Get('usage')
  usage(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.usage(u.clinicId);
  }

  @Get('recommendation')
  recommendation(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.recommendation(u.clinicId);
  }

  // "1 oy bepul" — demo'dan keyin tanlangan tarif bilan trial boshlash.
  @Post('start-trial')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'subscription.trial_started', resourceType: 'clinics' })
  startTrial(@CurrentUser() u: { clinicId: string | null }, @Body() body: { plan_code: string }) {
    if (!u.clinicId) throw new ForbiddenException();
    const VALID = ['25pro', '50pro', '120pro'];
    if (!VALID.includes(body.plan_code)) {
      throw new BadRequestException(`Trial uchun tarif tanlang: ${VALID.join(', ')}`);
    }
    return this.svc.startTrial(u.clinicId, body.plan_code as '25pro' | '50pro' | '120pro');
  }
}

@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SupabaseService],
})
export class SubscriptionModule {}
