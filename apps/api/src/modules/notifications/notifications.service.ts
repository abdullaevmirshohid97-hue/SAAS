import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';
import { EskizAdapter } from '@clary/notifications';
import { TelegramService } from '../telegram/telegram.module';
import { PublicBotService } from '../public-bot/public-bot.module';

export type Channel = 'sms' | 'email' | 'push' | 'telegram';

export interface EnqueueMessage {
  clinicId: string;
  channel: Channel;
  recipient: string;
  body: string;
  subject?: string;
  locale?: string;
  templateKey?: string;
  patientId?: string;
  relatedResource?: string;
  relatedId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  scheduledAt?: Date;
}

/**
 * NotificationsService — tenant-scoped messaging gateway.
 *
 * Writes to `notifications_outbox` (idempotent). An external worker
 * (BullMQ) picks pending rows and delivers via the tenant's configured
 * provider (Eskiz, Twilio, Resend...). For now rows stay in 'pending'
 * and can be inspected / manually dispatched.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly eskiz =
    process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD
      ? new EskizAdapter({
          email: process.env.ESKIZ_EMAIL,
          password: process.env.ESKIZ_PASSWORD,
        })
      : null;

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() @Inject(TelegramService) private readonly telegram?: TelegramService,
    @Optional() @Inject(PublicBotService) private readonly publicBot?: PublicBotService,
  ) {}

  async enqueue(msg: EnqueueMessage): Promise<{ id: string; status: string } | null> {
    const admin = this.supabase.admin();
    const payload = {
      clinic_id: msg.clinicId,
      channel: msg.channel,
      recipient: msg.recipient,
      body: msg.body,
      subject: msg.subject ?? null,
      locale: msg.locale ?? 'uz-Latn',
      template_key: msg.templateKey ?? null,
      patient_id: msg.patientId ?? null,
      related_resource: msg.relatedResource ?? null,
      related_id: msg.relatedId ?? null,
      idempotency_key: msg.idempotencyKey ?? null,
      metadata: msg.metadata ?? {},
      scheduled_at: (msg.scheduledAt ?? new Date()).toISOString(),
      status: 'pending',
    };

    // If idempotency key provided, upsert semantics to prevent duplicates.
    if (msg.idempotencyKey) {
      const { data: existing } = await admin
        .from('notifications_outbox')
        .select('id, status')
        .eq('clinic_id', msg.clinicId)
        .eq('idempotency_key', msg.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return existing as { id: string; status: string };
      }
    }

    const { data, error } = await admin
      .from('notifications_outbox')
      .insert(payload)
      .select('id, status')
      .single();
    if (error) {
      this.logger.error(`Failed to enqueue notification: ${error.message}`);
      return null;
    }
    const row = data as { id: string; status: string };

    // Fire-and-forget dispatch — agar provider sozlangan bo'lsa darhol jo'natamiz.
    // Xato bo'lsa outbox 'pending' qoladi, qayta jo'natish mumkin.
    if (msg.channel === 'sms') {
      void this.dispatchSms(row.id, msg).catch((e) =>
        this.logger.warn(`SMS dispatch failed for ${row.id}: ${(e as Error).message}`),
      );
    } else if (msg.channel === 'telegram') {
      void this.dispatchTelegram(row.id, msg).catch((e) =>
        this.logger.warn(`Telegram dispatch failed for ${row.id}: ${(e as Error).message}`),
      );
    }
    return row;
  }

  private async dispatchTelegram(outboxId: string, msg: EnqueueMessage): Promise<void> {
    if (!this.telegram) {
      this.logger.warn(`TelegramService not available; outbox ${outboxId} pending`);
      return;
    }
    if (!msg.patientId) {
      await this.supabase
        .admin()
        .from('notifications_outbox')
        .update({ status: 'failed', error: 'Telegram requires patient_id' })
        .eq('id', outboxId);
      return;
    }
    const docMeta = msg.metadata?.['telegram_document'] as
      | { url: string; filename: string }
      | undefined;
    let result = await this.telegram.sendToPatient(msg.clinicId, msg.patientId, msg.body, {
      document: docMeta,
    });
    let provider = 'telegram';
    // Fallback: per-klinika bot ishlamasa, umumiy Clary bot orqali urinish
    if (!result.ok && this.publicBot) {
      const ok = await this.publicBot.sendToPatient(msg.patientId, msg.body);
      if (ok) {
        result = { ok: true, chat_id: 0 } as typeof result;
        provider = 'telegram-public';
      }
    }
    await this.supabase
      .admin()
      .from('notifications_outbox')
      .update({
        status: result.ok ? 'sent' : 'failed',
        provider,
        sent_at: result.ok ? new Date().toISOString() : null,
        error: result.error ?? null,
      })
      .eq('id', outboxId);
  }

  private async dispatchSms(outboxId: string, msg: EnqueueMessage): Promise<void> {
    if (!this.eskiz) {
      this.logger.warn(
        `Eskiz not configured (ESKIZ_EMAIL/PASSWORD env vars missing); outbox row ${outboxId} stays pending`,
      );
      return;
    }
    const admin = this.supabase.admin();
    try {
      const result = await this.eskiz.send({ to: msg.recipient, text: msg.body });
      await admin
        .from('notifications_outbox')
        .update({
          status: result.status === 'sent' ? 'sent' : 'failed',
          provider: 'eskiz',
          provider_message_id: result.providerMessageId,
          sent_at: result.status === 'sent' ? new Date().toISOString() : null,
          error: result.error ?? null,
          metadata: { ...(msg.metadata ?? {}), provider_raw: result.raw },
        })
        .eq('id', outboxId);
    } catch (e) {
      await admin
        .from('notifications_outbox')
        .update({
          status: 'failed',
          provider: 'eskiz',
          error: (e as Error).message,
        })
        .eq('id', outboxId);
      throw e;
    }
  }

  // Manual retry for failed/pending rows (admin trigger).
  async retry(clinicId: string, outboxId: string): Promise<{ ok: boolean }> {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('notifications_outbox')
      .select('id, channel, recipient, body, patient_id, metadata')
      .eq('clinic_id', clinicId)
      .eq('id', outboxId)
      .maybeSingle();
    if (!data) return { ok: false };
    const row = data as {
      id: string;
      channel: string;
      recipient: string;
      body: string;
      patient_id: string | null;
      metadata: Record<string, unknown> | null;
    };
    if (row.channel === 'sms') {
      await this.dispatchSms(row.id, {
        clinicId,
        channel: 'sms',
        recipient: row.recipient,
        body: row.body,
        patientId: row.patient_id ?? undefined,
        metadata: row.metadata ?? undefined,
      });
    }
    return { ok: true };
  }

  async list(clinicId: string, params: { status?: string; limit?: number } = {}) {
    let q = this.supabase
      .admin()
      .from('notifications_outbox')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(params.limit ?? 50);
    if (params.status) q = q.eq('status', params.status);
    const { data } = await q;
    return data ?? [];
  }
}
