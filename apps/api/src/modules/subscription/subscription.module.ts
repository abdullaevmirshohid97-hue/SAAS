import { Body, Controller, ForbiddenException, Get, Injectable, Module, Post } from '@nestjs/common';
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
    const { data } = await this.supabase.admin().from('clinics').select('current_plan, subscription_status, trial_ends_at, subscription_ends_at').eq('id', clinicId).single();
    return data;
  }

  async listPlans() {
    const { data } = await this.supabase.admin().from('plans').select('*').eq('is_active', true).order('sort_order');
    return data ?? [];
  }

  async createCheckoutSession(clinicId: string, userEmail: string, planCode: string) {
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

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: plan['stripe_price_id'] as string, quantity: 1 }],
      success_url: `${process.env.ASTRO_PUBLIC_APP_URL}/settings/subscription?status=success`,
      cancel_url: `${process.env.ASTRO_PUBLIC_APP_URL}/settings/subscription?status=cancel`,
      metadata: { clinic_id: clinicId, plan_code: planCode },
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

  @Post('checkout')
  @Roles('clinic_admin', 'clinic_owner')
  @Audit({ action: 'subscription.checkout_started', resourceType: 'subscriptions' })
  async checkout(
    @CurrentUser() u: { clinicId: string | null; userId: string | null },
    @Body() body: { plan_code: string; email: string },
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.createCheckoutSession(u.clinicId, body.email, body.plan_code);
  }
}

@Module({
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SupabaseService],
})
export class SubscriptionModule {}
