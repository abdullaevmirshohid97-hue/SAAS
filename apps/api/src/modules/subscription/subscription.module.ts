import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, Post } from '@nestjs/common';
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
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('current_plan, subscription_status, trial_ends_at, subscription_ends_at, grace_ends_at, billing_code')
      .eq('id', clinicId)
      .single();
    return data;
  }

  // Demo'dan keyin "1 oy bepul" — tanlangan tarif bilan trialing'ga o'tadi.
  async startTrial(clinicId: string, planCode: '25pro' | '50pro' | '120pro') {
    const { data, error } = await this.supabase
      .admin()
      .rpc('start_trial' as never, {
        p_clinic_id: clinicId,
        p_plan: planCode,
      } as never)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listPlans() {
    const { data } = await this.supabase
      .admin()
      .from('plans')
      .select('id, code, name, price_usd_cents, price_yearly_cents, max_staff, max_devices, max_patients, features, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    return data ?? [];
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
      admin
        .rpc('get_clinic_plan_limits' as never, { p_clinic_id: clinicId } as never)
        .single(),
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
  plans() { return this.svc.listPlans(); }

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

  // "1 oy bepul" — demo'dan keyin tanlangan tarif bilan trial boshlash.
  @Post('start-trial')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'subscription.trial_started', resourceType: 'clinics' })
  startTrial(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: { plan_code: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const VALID = ['25pro', '50pro', '120pro'];
    if (!VALID.includes(body.plan_code)) {
      throw new BadRequestException(
        `Trial uchun tarif tanlang: ${VALID.join(', ')}`,
      );
    }
    return this.svc.startTrial(u.clinicId, body.plan_code as '25pro' | '50pro' | '120pro');
  }
}

@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SupabaseService],
})
export class SubscriptionModule {}
