import {
  Body,
  Controller,
  Headers,
  Injectable,
  Logger,
  Module,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';

import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// =============================================================================
// Payment webhooks — Click + Payme (Uzbekistan).
// Stripe O'zbekistonda ishlamaydi, shu sababli olib tashlandi. Obuna to'lovi
// billing_code (CLR-XXXXX) orqali — Click/Payme to'lov izohiga yoziladi,
// webhook activate_subscription RPC'ni chaqiradi.
// =============================================================================

// -----------------------------------------------------------------------------
// Click webhook handler — md5 signature verify
// -----------------------------------------------------------------------------
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
      // CLR-XXXXX → subscription to'lovi. Klinika billing_code orqali topiladi.
      if (merchantTransId.toUpperCase().startsWith('CLR-')) {
        const { data: clinic } = await this.supabase
          .admin()
          .from('clinics')
          .select('id, billing_code')
          .eq('billing_code', merchantTransId.toUpperCase())
          .maybeSingle();
        if (!clinic) return { error: -5, error_note: 'Billing code not found' };
        return { error: 0, error_note: 'Success', merchant_prepare_id: merchantTransId };
      }
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
      // CLR-XXXXX → obunani faollashtirish (activate_subscription RPC)
      if (merchantTransId.toUpperCase().startsWith('CLR-')) {
        const { error: rpcErr } = await this.supabase
          .admin()
          .rpc('activate_subscription' as never, {
            p_billing_code: merchantTransId.toUpperCase(),
            p_months: 1,
          } as never);
        if (rpcErr) {
          this.log.warn(`activate_subscription failed: ${rpcErr.message}`);
          return { error: -7, error_note: 'Activation failed' };
        }
        this.log.log(`Subscription activated via Click for ${merchantTransId}`);
        return { error: 0, error_note: 'Success', merchant_confirm_id: merchantTransId };
      }
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

// -----------------------------------------------------------------------------
// Payme webhook handler — Basic auth with merchant key
// -----------------------------------------------------------------------------
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
    const account = params.account as Record<string, unknown> | undefined;
    const orderId = String(account?.order_id ?? '');

    switch (method) {
      case 'CheckPerformTransaction':
        return { result: { allow: true } };
      case 'CreateTransaction': {
        const id = String(params.id);
        // CLR-XXXXX → subscription, aks holda payment_qr_invoices
        if (orderId.toUpperCase().startsWith('CLR-')) {
          return { result: { create_time: Date.now(), transaction: id, state: 1 } };
        }
        await this.supabase
          .admin()
          .from('payment_qr_invoices')
          .update({ status: 'pending', provider_reference: id })
          .eq('id', orderId);
        return { result: { create_time: Date.now(), transaction: id, state: 1 } };
      }
      case 'PerformTransaction': {
        const id = String(params.id);
        // Subscription to'lovi bo'lsa — activate
        if (orderId.toUpperCase().startsWith('CLR-')) {
          const { error: rpcErr } = await this.supabase
            .admin()
            .rpc('activate_subscription' as never, {
              p_billing_code: orderId.toUpperCase(),
              p_months: 1,
            } as never);
          if (rpcErr) {
            this.log.warn(`activate_subscription (payme) failed: ${rpcErr.message}`);
            return { error: { code: -31008, message: 'Activation failed' } };
          }
          this.log.log(`Subscription activated via Payme for ${orderId}`);
          return { result: { perform_time: Date.now(), transaction: id, state: 2 } };
        }
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
    private readonly clickHandler: ClickWebhookHandler,
    private readonly paymeHandler: PaymeWebhookHandler,
  ) {}

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

  // Stripe olib tashlandi (O'zbekistonda ishlamaydi).
  // Uzum/Kaspi: adapter'lar stub — real implementatsiyadan keyin qo'shiladi.
}

@Module({
  controllers: [WebhooksController],
  providers: [ClickWebhookHandler, PaymeWebhookHandler, SupabaseService],
})
export class WebhooksModule {}
