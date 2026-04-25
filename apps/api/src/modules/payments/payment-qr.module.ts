import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ClickAdapter, PaymeAdapter } from '@clary/payments';
import type { PaymentAdapter, PaymentProviderName, QrFlowDirection } from '@clary/payments';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

const QR_PROVIDERS = ['click', 'payme'] as const;

const CreateInvoiceSchema = z.object({
  provider: z.enum(QR_PROVIDERS),
  amount_uzs: z.number().int().min(1000).max(1_000_000_000),
  flow: z.enum(['merchant_qr', 'customer_scan']).optional(),
  patient_id: z.string().uuid().nullish(),
  transaction_id: z.string().uuid().nullish(),
  shift_id: z.string().uuid().nullish(),
  idempotency_key: z.string().optional(),
  expires_in_sec: z.number().int().min(60).max(3600).optional(),
});

const VerifyPassSchema = z.object({
  customer_token: z.string().min(3).max(12),
});

@Injectable()
export class PaymentCredentialResolver {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Resolve provider credentials for a clinic.
   * In production: reads metadata (non-secret) from tenant_vault_secrets and
   *   pulls the secret via Supabase Vault (`vault.read_secret`). For now it merges
   *   metadata with a dev fallback embedded in metadata to allow end-to-end testing.
   */
  async forClinic(clinicId: string, provider: PaymentProviderName): Promise<Record<string, string>> {
    const { data } = await this.supabase
      .admin()
      .from('tenant_vault_secrets')
      .select('metadata, vault_secret_id')
      .eq('clinic_id', clinicId)
      .eq('provider_kind', 'payment')
      .eq('provider_name', provider)
      .eq('is_active', true)
      .eq('is_primary', true)
      .maybeSingle();

    const metadata = (data?.metadata as Record<string, string> | undefined) ?? {};
    let secretValue: string | undefined;
    if (data?.vault_secret_id) {
      const { data: secretRow } = await this.supabase
        .admin()
        .rpc('vault_read_secret' as never, { p_secret_id: data.vault_secret_id } as never)
        .single();
      secretValue = (secretRow as { decrypted_secret?: string } | null)?.decrypted_secret;
    }
    const creds: Record<string, string> = { ...metadata };
    if (secretValue) {
      // Single-secret providers: treat as primary key (e.g. Payme 'key', Click 'secret_key')
      if (provider === 'click') creds['secret_key'] = secretValue;
      if (provider === 'payme') creds['key'] = secretValue;
    }
    return creds;
  }

  buildAdapter(provider: PaymentProviderName, creds: Record<string, string>): PaymentAdapter {
    switch (provider) {
      case 'click':
        return new ClickAdapter(creds);
      case 'payme':
        return new PaymeAdapter(creds);
      default:
        throw new BadRequestException(`QR flow not supported for provider ${provider}`);
    }
  }
}

@Injectable()
export class PaymentQrService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly resolver: PaymentCredentialResolver,
  ) {}

  async defaultFlow(clinicId: string): Promise<QrFlowDirection> {
    const { data } = await this.supabase
      .admin()
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .single();
    const qrFlow = (data?.settings as { payments?: { qr_flow?: string } } | null)?.payments?.qr_flow;
    return qrFlow === 'customer_scan' ? 'customer_scan' : 'merchant_qr';
  }

  async create(
    clinicId: string,
    userId: string,
    input: z.infer<typeof CreateInvoiceSchema>,
  ): Promise<Record<string, unknown>> {
    const admin = this.supabase.admin();
    const idempotencyKey = input.idempotency_key ?? `${clinicId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: existing } = await admin
      .from('payment_qr_invoices')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing) return existing;

    const flow = input.flow ?? (await this.defaultFlow(clinicId));
    const creds = await this.resolver.forClinic(clinicId, input.provider);
    try {
      const adapter = this.resolver.buildAdapter(input.provider, creds);
      if (!adapter.createInvoice) throw new BadRequestException(`${input.provider} does not support QR invoices`);

      const result = await adapter.createInvoice({
        amountMinor: input.amount_uzs * 100,
        currency: 'UZS',
        idempotencyKey,
        flow,
        expiresInSec: input.expires_in_sec ?? 600,
      });

      const row = {
        clinic_id: clinicId,
        provider: input.provider,
        flow,
        provider_reference: result.providerReference,
        patient_id: input.patient_id ?? null,
        transaction_id: input.transaction_id ?? null,
        shift_id: input.shift_id ?? null,
        cashier_id: userId,
        amount_uzs: input.amount_uzs,
        qr_payload: result.qrPayload ?? null,
        deep_link: result.deepLink ?? null,
        status: 'pending' as const,
        expires_at: result.expiresAt ?? null,
        idempotency_key: idempotencyKey,
        raw_response: (result as { raw?: unknown }).raw ?? null,
      };
      const { data, error } = await admin.from('payment_qr_invoices').insert(row).select().single();
      if (error) throw new BadRequestException(error.message);
      return data as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'adapter error';
      throw new BadRequestException(`Payment provider error: ${message}`);
    }
  }

  async getStatus(clinicId: string, id: string) {
    const admin = this.supabase.admin();
    const { data: inv, error } = await admin
      .from('payment_qr_invoices')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error || !inv) throw new NotFoundException('invoice not found');
    const invoice = inv as { status: string; expires_at: string | null; provider: PaymentProviderName; provider_reference: string };
    if (invoice.status !== 'pending') return inv;

    // Expiry enforcement
    if (invoice.expires_at && new Date(invoice.expires_at) < new Date()) {
      const { data } = await admin
        .from('payment_qr_invoices')
        .update({ status: 'expired' })
        .eq('id', id)
        .select()
        .single();
      return data;
    }

    try {
      const creds = await this.resolver.forClinic(clinicId, invoice.provider);
      const adapter = this.resolver.buildAdapter(invoice.provider, creds);
      if (!adapter.pollInvoice) return inv;
      const status = await adapter.pollInvoice(invoice.provider_reference);
      if (status.status !== 'pending') {
        const { data } = await admin
          .from('payment_qr_invoices')
          .update({
            status: status.status,
            paid_at: status.paidAt ?? null,
          })
          .eq('id', id)
          .select()
          .single();
        return data;
      }
    } catch {
      // Silent fallback: return current row
    }
    return inv;
  }

  async verifyPass(clinicId: string, id: string, customerToken: string) {
    const admin = this.supabase.admin();
    const { data: inv, error } = await admin
      .from('payment_qr_invoices')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .single();
    if (error || !inv) throw new NotFoundException('invoice not found');
    const invoice = inv as {
      status: string;
      provider: PaymentProviderName;
      provider_reference: string;
      amount_uzs: number;
      flow: string;
    };
    if (invoice.flow !== 'customer_scan') throw new BadRequestException('verify only valid for customer_scan');
    if (invoice.status !== 'pending') throw new BadRequestException('invoice is not pending');

    const creds = await this.resolver.forClinic(clinicId, invoice.provider);
    const adapter = this.resolver.buildAdapter(invoice.provider, creds);
    if (!adapter.verifyPass) throw new BadRequestException('provider does not support customer-scan');

    const result = await adapter.verifyPass({
      providerReference: invoice.provider_reference,
      customerToken,
      amountMinor: invoice.amount_uzs * 100,
    });

    const { data } = await admin
      .from('payment_qr_invoices')
      .update({
        status: result.status,
        paid_at: result.paidAt ?? null,
        error_message: result.status === 'failed' ? 'customer token invalid' : null,
      })
      .eq('id', id)
      .select()
      .single();
    return data;
  }

  async cancel(clinicId: string, id: string) {
    const { data } = await this.supabase
      .admin()
      .from('payment_qr_invoices')
      .update({ status: 'canceled' })
      .eq('clinic_id', clinicId)
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();
    return data;
  }

  async recordWebhook(
    provider: PaymentProviderName,
    clinicId: string | null,
    headers: Record<string, string>,
    rawBody: string,
    signature: string,
    valid: boolean,
    event: unknown,
    providerRef?: string,
  ) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('payment_webhook_events')
      .insert({
        clinic_id: clinicId,
        provider,
        provider_reference: providerRef ?? null,
        headers,
        body: safeParse(rawBody),
        signature,
        valid,
        processed_at: valid ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (valid && providerRef) {
      const status = detectStatusFromEvent(provider, event);
      if (status) {
        await admin
          .from('payment_qr_invoices')
          .update({ status, paid_at: status === 'succeeded' ? new Date().toISOString() : null })
          .eq('provider', provider)
          .eq('provider_reference', providerRef)
          .eq('status', 'pending');
      }
    }
    return data;
  }
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

function detectStatusFromEvent(provider: PaymentProviderName, event: unknown): 'succeeded' | 'failed' | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (provider === 'click') {
    if (e['error'] && Number(e['error']) !== 0) return 'failed';
    if (e['action'] === '1' || e['action'] === 1) return 'succeeded';
  }
  if (provider === 'payme') {
    const method = e['method'] as string | undefined;
    if (method === 'PerformTransaction') return 'succeeded';
    if (method === 'CancelTransaction') return 'failed';
  }
  return null;
}

@ApiTags('payment-qr')
@Controller('payment-qr')
class PaymentQrController {
  constructor(private readonly svc: PaymentQrService) {}

  @Post()
  @Roles('clinic_admin', 'clinic_owner', 'receptionist')
  @Audit({ action: 'payment_qr.created', resourceType: 'payment_qr_invoices' })
  create(@CurrentUser() u: { clinicId: string | null; userId: string | null }, @Body() body: unknown) {
    if (!u.clinicId || !u.userId) throw new ForbiddenException();
    return this.svc.create(u.clinicId, u.userId, CreateInvoiceSchema.parse(body));
  }

  @Get(':id/status')
  status(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getStatus(u.clinicId, id);
  }

  @Post(':id/verify-pass')
  @Roles('clinic_admin', 'clinic_owner', 'receptionist')
  @Audit({ action: 'payment_qr.verify_pass', resourceType: 'payment_qr_invoices' })
  verify(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    const { customer_token } = VerifyPassSchema.parse(body);
    return this.svc.verifyPass(u.clinicId, id, customer_token);
  }

  @Post(':id/cancel')
  @Roles('clinic_admin', 'clinic_owner', 'receptionist')
  @Audit({ action: 'payment_qr.canceled', resourceType: 'payment_qr_invoices' })
  cancel(@CurrentUser() u: { clinicId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.cancel(u.clinicId, id);
  }
}

@ApiTags('webhooks')
@Controller('webhooks')
class PaymentWebhooksController {
  constructor(
    private readonly svc: PaymentQrService,
    private readonly supabase: SupabaseService,
    private readonly resolver: PaymentCredentialResolver,
  ) {}

  @Public()
  @Post('click')
  @HttpCode(200)
  async click(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>, @Res() res: Response) {
    const rawBody = (req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {})) as string;
    const signature = (headers['sign-string'] ?? headers['x-signature'] ?? '') as string;
    const body = (req.body ?? {}) as { merchant_trans_id?: string; service_id?: string };
    const providerRef = body.merchant_trans_id;

    let valid = false;
    let event: unknown = body;
    let clinicId: string | null = null;
    if (providerRef) {
      const { data: invoice } = await this.supabase
        .admin()
        .from('payment_qr_invoices')
        .select('clinic_id')
        .eq('provider', 'click')
        .eq('provider_reference', providerRef)
        .maybeSingle();
      clinicId = (invoice?.clinic_id as string | undefined) ?? null;
      if (clinicId) {
        try {
          const creds = await this.resolver.forClinic(clinicId, 'click');
          const adapter = this.resolver.buildAdapter('click', creds);
          const verified = await adapter.verifyWebhook({ rawBody, signature, secret: creds['secret_key'] ?? '' });
          valid = verified.valid;
          event = verified.event;
        } catch {
          valid = false;
        }
      }
    }

    await this.svc.recordWebhook('click', clinicId, headers, rawBody, signature, valid, event, providerRef);
    res.json({ error: valid ? 0 : -9, error_note: valid ? 'OK' : 'SIGN_CHECK_FAILED' });
  }

  @Public()
  @Post('payme')
  @HttpCode(200)
  async payme(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>, @Res() res: Response) {
    const rawBody = (req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {})) as string;
    const auth = (headers['authorization'] ?? '') as string;
    const body = (req.body ?? {}) as { params?: { account?: { order_id?: string } } };
    const providerRef = body.params?.account?.order_id;

    let valid = false;
    let event: unknown = body;
    let clinicId: string | null = null;
    if (providerRef) {
      const { data: invoice } = await this.supabase
        .admin()
        .from('payment_qr_invoices')
        .select('clinic_id')
        .eq('provider', 'payme')
        .eq('provider_reference', providerRef)
        .maybeSingle();
      clinicId = (invoice?.clinic_id as string | undefined) ?? null;
      if (clinicId) {
        try {
          const creds = await this.resolver.forClinic(clinicId, 'payme');
          const adapter = this.resolver.buildAdapter('payme', creds);
          const verified = await adapter.verifyWebhook({ rawBody, signature: auth, secret: creds['key'] ?? '' });
          valid = verified.valid;
          event = verified.event;
        } catch {
          valid = false;
        }
      }
    }

    await this.svc.recordWebhook('payme', clinicId, headers, rawBody, auth, valid, event, providerRef);
    res.json(valid ? { result: { success: true } } : { error: { code: -32504, message: 'Unauthorized' } });
  }
}

@Module({
  controllers: [PaymentQrController, PaymentWebhooksController],
  providers: [PaymentQrService, PaymentCredentialResolver, SupabaseService],
  exports: [PaymentQrService],
})
export class PaymentQrModule {}
