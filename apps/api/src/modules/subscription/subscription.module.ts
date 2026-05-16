import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import Stripe from 'stripe';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
class SubscriptionService {
  private readonly stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    : null;

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

  // Sprint 2B: klinikaning joriy seat usage'i — UI hint uchun
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

  async createCheckoutSession(
    clinicId: string,
    userEmail: string,
    planCode: string,
    billingPeriod: 'monthly' | 'yearly' = 'monthly',
  ) {
    if (!this.stripe) throw new Error('Stripe not configured');
    const { data: plan } = await this.supabase.admin().from('plans').select('*').eq('code', planCode).single();
    if (!plan) throw new Error('Unknown plan');

    const { data: clinic } = await this.supabase.admin().from('clinics').select('stripe_customer_id, name').eq('id', clinicId).single();
    let customerId = clinic?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: userEmail,
        name: clinic?.['name'] as string,
        metadata: { clinic_id: clinicId },
      });
      customerId = customer.id;
      await this.supabase.admin().from('clinics').update({ stripe_customer_id: customerId }).eq('id', clinicId);
    }

    // Sprint 2 polish: yearly tanlangach stripe_price_id_yearly ishlatamiz.
    // Agar yearly Price ID o'rnatilmagan bo'lsa monthly'ga fallback (graceful).
    const yearlyPriceId = (plan as Record<string, unknown>)['stripe_price_id_yearly'] as string | null;
    const monthlyPriceId = (plan as Record<string, unknown>)['stripe_price_id'] as string | null;
    const priceId = billingPeriod === 'yearly' && yearlyPriceId ? yearlyPriceId : monthlyPriceId;
    if (!priceId) {
      throw new Error(
        `Plan ${planCode} ${billingPeriod} uchun Stripe Price ID o'rnatilmagan. ` +
          `Admin Stripe Dashboard'da Price yaratib, plans.stripe_price_id[_yearly] ga yozsin.`,
      );
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.ASTRO_PUBLIC_APP_URL}/settings/subscription?status=success`,
      cancel_url: `${process.env.ASTRO_PUBLIC_APP_URL}/settings/subscription?status=cancel`,
      metadata: { clinic_id: clinicId, plan_code: planCode, billing_period: billingPeriod },
      subscription_data: {
        metadata: { clinic_id: clinicId, plan_code: planCode, billing_period: billingPeriod },
      },
    });
    return { url: session.url };
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

  @Post('checkout')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'subscription.checkout_started', resourceType: 'subscriptions' })
  async checkout(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: { plan_code: string; email: string; billing_period?: 'monthly' | 'yearly' },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createCheckoutSession(
      u.clinicId,
      body.email,
      body.plan_code,
      body.billing_period ?? 'monthly',
    );
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
