import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { SupabaseService } from '../../common/services/supabase.service';

interface CreateInput {
  name?: string;
  phone?: string;
  email?: string;
  clinicName?: string;
  message?: string;
  source: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  ip: string;
  userAgent: string | null;
}

@Injectable()
export class LeadsService {
  private readonly log = new Logger(LeadsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(input: CreateInput) {
    if (!input.phone && !input.email) {
      throw new BadRequestException('Telefon yoki email majburiy');
    }

    const ipHash = hashIp(input.ip);
    const { data, error } = await this.supabase
      .admin()
      .from('leads')
      .insert({
        name: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        clinic_name: input.clinicName ?? null,
        message: input.message ?? null,
        source: input.source,
        utm_source: input.utm?.source ?? null,
        utm_medium: input.utm?.medium ?? null,
        utm_campaign: input.utm?.campaign ?? null,
        utm_content: input.utm?.content ?? null,
        utm_term: input.utm?.term ?? null,
        ip_hash: ipHash,
        user_agent: input.userAgent,
      })
      .select('id')
      .single();

    if (error) {
      this.log.error('lead insert failed', error);
      throw new BadRequestException(error.message);
    }

    void this.notifyTelegram(input).catch((e) => this.log.warn('telegram notify failed', e));

    return { id: data.id, ok: true };
  }

  async list(opts: { status?: string; limit: number }) {
    let q = this.supabase.admin().from('leads').select('*').order('created_at', { ascending: false }).limit(opts.limit);
    if (opts.status) q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async notifyTelegram(input: CreateInput): Promise<void> {
    const token = process.env.TELEGRAM_LEADS_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_LEADS_CHAT_ID;
    if (!token || !chatId) return;

    const lines = [
      '🟢 *Yangi lead*',
      input.name ? `*Ism:* ${input.name}` : null,
      input.phone ? `*Telefon:* ${input.phone}` : null,
      input.email ? `*Email:* ${input.email}` : null,
      input.clinicName ? `*Klinika:* ${input.clinicName}` : null,
      input.message ? `*Xabar:* ${input.message}` : null,
      `*Manba:* ${input.source}`,
      input.utm?.source ? `*UTM:* ${input.utm.source}/${input.utm.medium ?? ''}` : null,
    ].filter(Boolean);

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
      }),
    });
  }
}

function hashIp(ip: string): string {
  const salt = process.env.LEADS_IP_SALT ?? 'clary-leads-salt';
  return createHash('sha256').update(salt + ':' + ip).digest('hex');
}
