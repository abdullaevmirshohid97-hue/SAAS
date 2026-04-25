import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

@Injectable()
class TelegramBackupService {
  constructor(private readonly supabase: SupabaseService) {}

  // Midnight Asia/Tashkent => 19:00 UTC (TZ adjustment via host timezone)
  @Cron('0 0 * * *', { name: 'daily-backup-summary', timeZone: 'Asia/Tashkent' })
  async dailySummary() {
    const start = Date.now();
    await this.supabase.admin().from('backup_runs').insert({ kind: 'daily_summary', status: 'running' });

    const metrics = await this.collectMetrics();
    const summary = this.formatSummary(metrics);
    const telegramMessageId = await this.sendToTelegram(summary);

    await this.supabase.admin().from('backup_runs').update({
      status: 'success',
      completed_at: new Date().toISOString(),
      summary: metrics,
      telegram_message_id: telegramMessageId,
      duration_ms: Date.now() - start,
    }).eq('status', 'running');
  }

  async collectMetrics() {
    const admin = this.supabase.admin();
    const [clinics, patients, appointments, transactions] = await Promise.all([
      admin.from('clinics').select('id', { count: 'exact', head: true }),
      admin.from('patients').select('id', { count: 'exact', head: true }),
      admin.from('appointments').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      admin.from('transactions').select('amount_uzs').gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    ]);
    const revenue = (transactions.data ?? []).reduce((s, t) => s + ((t['amount_uzs'] as number) ?? 0), 0);
    return {
      clinics: clinics.count ?? 0,
      patients_total: patients.count ?? 0,
      appointments_24h: appointments.count ?? 0,
      revenue_24h_uzs: revenue,
    };
  }

  formatSummary(m: Record<string, number>): string {
    const date = new Date().toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' });
    return [
      `*Clary kunlik hisobot* \u2014 ${date}`,
      ``,
      `Klinikalar: *${m['clinics']}*`,
      `Bemorlar (jami): *${m['patients_total']?.toLocaleString()}*`,
      `Qabullar (24s): *${m['appointments_24h']}*`,
      `Daromad (24s): *${(m['revenue_24h_uzs'] ?? 0).toLocaleString()} UZS*`,
      ``,
      `Backup: OK \u2713`,
    ].join('\n');
  }

  async sendToTelegram(text: string): Promise<number | null> {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return null;
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
    const body = (await res.json()) as { result?: { message_id?: number } };
    return body.result?.message_id ?? null;
  }
}

@ApiTags('telegram-backup')
@Controller('telegram-backup')
class TelegramBackupController {
  constructor(private readonly svc: TelegramBackupService) {}

  @Public()
  @Get('test')
  async test() {
    await this.svc.dailySummary();
    return { ok: true };
  }
}

@Module({
  controllers: [TelegramBackupController],
  providers: [TelegramBackupService, SupabaseService],
})
export class TelegramBackupModule {}
