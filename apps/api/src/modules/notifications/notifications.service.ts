import { Injectable, Logger } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

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

  constructor(private readonly supabase: SupabaseService) {}

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
    return data as { id: string; status: string };
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
