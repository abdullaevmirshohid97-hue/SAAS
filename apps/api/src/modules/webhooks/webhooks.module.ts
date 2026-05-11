import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Injectable,
  Logger,
  Module,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import Stripe from 'stripe';
import { createHash } from 'node:crypto';

import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Stripe webhook handler — signature verify + subscription sync
// =============================================================================
@Injectable()
class StripeWebhookHandler {
  private readonly log = new Logger('StripeWebhook');
  private readonly stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    : null;

  constructor(private readonly supabase: SupabaseService) {}

  async handle(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!this.stripe) {
      this.log.warn('Stripe not configured, ignoring webhook');
      return { received: true, processed: false, reason: 'stripe_not_configured' };
    }
    if (!signature) throw new BadRequestException('Missing stripe-signature header');
    if (!rawBody) throw new BadRequestException('Missing raw body');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      this.log.error('STRIPE_WEBHOOK_SECRET not set; refusing webhook');
      throw new BadRequestException('Webhook secret not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.log.warn(`Signature verify failed: ${(err as Error).message}`);
      throw new BadRequestException('Invalid signature');
    }

    this.log.log(`Event ${event.type} id=${event.id}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.onCheckoutCompleted(session);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await this.syncSubscription(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await this.markCanceled(sub);
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        await this.onPaymentFailed(inv);
        break;
      }
      default:
        this.log.debug(`Unhandled event ${event.type}`);
    }

    return { received: true, processed: true, event_id: event.id, type: event.type };
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session) {
    const clinicId = session.metadata?.clinic_id ?? null;
    const planCode = session.metadata?.plan_code ?? null;
    const billingPeriod = (session.metadata?.billing_period ?? 'monthly') as 'monthly' | 'yearly';
    if (!clinicId || !planCode) {
      this.log.warn('checkout.session.completed missing metadata');
      return;
    }
    if (!this.stripe || !session.subscription) return;
    const sub = await this.stripe.subscriptions.retrieve(
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id,
    );
    await this.upsertSubscription(clinicId, planCode, billingPeriod, sub);
    await this.supabase
      .admin()
      .from('clinics')
      .update({ current_plan: planCode, subscription_status: sub.status })
      .eq('id', clinicId);
  }

  private async syncSubscription(sub: Stripe.Subscription) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const { data: clinic } = await this.supabase
      .admin()
      .from('clinics')
      .select('id, current_plan')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (!clinic) {
      this.log.warn(`No clinic found for customer ${customerId}`);
      return;
    }
    const clinicId = (clinic as { id: string }).id;
    const planCode = sub.metadata?.plan_code ?? (clinic as { current_plan: string }).current_plan;
    const billingPeriod = (sub.metadata?.billing_period ?? 'monthly') as 'monthly' | 'yearly';
    await this.upsertSubscription(clinicId, planCode, billingPeriod, sub);
    await this.supabase
      .admin()
      .from('clinics')
      .update({ subscription_status: sub.status })
      .eq('id', clinicId);
  }

  private async upsertSubscription(
    clinicId: string,
    planCode: string,
    billingPeriod: 'monthly' | 'yearly',
    sub: Stripe.Subscription,
  ) {
    await this.supabase
      .admin()
      .from('subscriptions')
      .upsert(
        {
          clinic_id: clinicId,
          plan_code: planCode,
          status: sub.status,
          stripe_subscription_id: sub.id,
          billing_period: billingPeriod,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end ?? false,
          canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
        },
        { onConflict: 'stripe_subscription_id' },
      );
  }

  private async markCanceled(sub: Stripe.Subscription) {
    await this.supabase
      .admin()
      .from('subscriptions')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id);
  }

  private async onPaymentFailed(inv: Stripe.Invoice) {
    if (!inv.subscription) return;
    const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription.id;
    await this.supabase
      .admin()
      .from('subscriptions')
      .update({ status: 'past_due', dunning_attempts: inv.attempt_count ?? 0 })
      .eq('stripe_subscription_id', subId);
  }
}

// =============================================================================
// Click webhook handler — md5 signature verify
// =============================================================================
@Injectable()
class ClickWebhookHandler {
  private readonly log = new Logger('ClickWebhook');
  constructor(private readonly supabase: SupabaseService) {}

  async handle(body: Record<string, unknown>) {
    const secret = process.env.CLICK_SECRET_KEY;
    if (!secret) {
      this.log.warn('CLICK_SECRET_KEY not set; rejecting');
      return { error: -9, error_note: 'Webhook not configured' };
    }
    const required = [
      'click_trans_id',
      'service_id',
      'merchant_trans_id',
      'amount',
      'action',
      'sign_time',
      'sign_string',
    ];
    for (const k of required) {
      if (!(k in body)) return { error: -8, error_note: `Missing ${k}` };
    }
    const expected = createHash('md5')
      .update(
        String(body.click_trans_id) +
          String(body.service_id) +
          secret +
          String(body.merchant_trans_id) +
          String(body.amount) +
          String(body.action) +
          String(body.sign_time),
      )
      .digest('hex');
    if (expected !== String(body.sign_string)) {
      this.log.warn(`Click signature mismatch for trans=${body.click_trans_id}`);
      return { error: -1, error_note: 'SIGN CHECK FAILED' };
    }

    const action = Number(body.action);
    const merchantTransId = String(body.merchant_trans_id);

    if (action === 0) {
      const { data: qr } = await this.supabase
        .admin()
        .from('payment_qr_invoices')
        .select('id, status')
        .eq('id', merchantTransId)
        .maybeSingle();
      if (!qr) return { error: -5, error_note: 'Order not found' };
      return { error: 0, error_note: 'Success', merchant_prepare_id: merchantTransId };
    }

    if (action === 1) {
      await this.supabase
        .admin()
        .from('payment_qr_invoices')
        .update({
          status: 'succeeded',
          paid_at: new Date().toISOString(),
          provider_reference: String(body.click_trans_id),
        })
        .eq('id', merchantTransId);
      return { error: 0, error_note: 'Success', merchant_confirm_id: merchantTransId };
    }

    return { error: -3, error_note: 'Unknown action' };
  }
}

// =============================================================================
// Payme webhook handler — Basic auth with merchant key
// =============================================================================
@Injectable()
class PaymeWebhookHandler {
  private readonly log = new Logger('PaymeWebhook');
  constructor(private readonly supabase: SupabaseService) {}

  async handle(authHeader: string | undefined, body: Record<string, unknown>) {
    const key = process.env.PAYME_MERCHANT_KEY;
    if (!key) {
      this.log.warn('PAYME_MERCHANT_KEY not set; rejecting');
      return { error: { code: -32504, message: 'Webhook not configured' } };
    }
    if (!authHeader?.startsWith('Basic ')) {
      return { error: { code: -32504, message: 'Insufficient privilege' } };
    }
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const [, pass] = decoded.split(':');
    if (pass !== key) {
      return { error: { code: -32504, message: 'Authorization failed' } };
    }

    const method = String(body.method ?? '');
    const params = (body.params ?? {}) as Record<string, unknown>;

    switch (method) {
      case 'CheckPerformTransaction':
        return { result: { allow: true } };
      case 'CreateTransaction': {
        const id = String(params.id);
        const account = params.account as Record<string, unknown> | undefined;
        await this.supabase
          .admin()
          .from('payment_qr_invoices')
          .update({ status: 'pending', provider_reference: id })
          .eq('id', String(account?.order_id ?? ''));
        return { result: { create_time: Date.now(), transaction: id, state: 1 } };
      }
      case 'PerformTransaction': {
        const id = String(params.id);
        await this.supabase
          .admin()
          .from('payment_qr_invoices')
          .update({ status: 'succeeded', paid_at: new Date().toISOString() })
          .eq('provider_reference', id);
        return { result: { perform_time: Date.now(), transaction: id, state: 2 } };
      }
      case 'CancelTransaction': {
        const id = String(params.id);
        await this.supabase
          .admin()
          .from('payment_qr_invoices')
          .update({ status: 'canceled' })
          .eq('provider_reference', id);
        return { result: { cancel_time: Date.now(), transaction: id, state: -1 } };
      }
      case 'CheckTransaction':
        return { result: { state: 1 } };
      default:
        return { error: { code: -32601, message: 'Method not found' } };
    }
  }
}

// =============================================================================
// Controller
// =============================================================================
@ApiTags('webhooks')
@Controller('webhooks')
class WebhooksController {
  constructor(
    private readonly stripeHandler: StripeWebhookHandler,
    private readonly clickHandler: ClickWebhookHandler,
    private readonly paymeHandler: PaymeWebhookHandler,
  ) {}

  @Public()
  @Post('stripe')
  stripe(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
    return this.stripeHandler.handle(req.rawBody, sig);
  }

  @Public()
  @Post('click')
  click(@Body() body: Record<string, unknown>) {
    return this.clickHandler.handle(body);
  }

  @Public()
  @Post('payme')
  payme(@Headers('authorization') auth: string, @Body() body: Record<string, unknown>) {
    return this.paymeHandler.handle(auth, body);
  }

  // Uzum/Kaspi: adapters are stubs (packages/payments/src/providers/{uzum,kaspi}.ts).
  // Webhook handlers will be added when the adapters are implemented.
}

@Module({
  controllers: [WebhooksController],
  providers: [StripeWebhookHandler, ClickWebhookHandler, PaymeWebhookHandler, SupabaseService],
})
export class WebhooksModule {}
