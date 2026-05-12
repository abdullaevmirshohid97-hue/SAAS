import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Logger,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';

// ============================================================================
// Schemas
// ============================================================================
const RegisterBotSchema = z.object({
  bot_token: z.string().min(20),  // 12345:ABC-DEF...
  bot_username: z.string().min(3).regex(/^[a-zA-Z0-9_]+_bot$/i, 'Telegram bot username _bot bilan tugashi kerak'),
});

// ============================================================================
// Service: Telegram per-clinic bot management + message sending
// ============================================================================
@Injectable()
export class TelegramService {
  private readonly log = new Logger('Telegram');

  constructor(private readonly supabase: SupabaseService) {}

  // ---------------------------------------------------------------------------
  // Admin: register / unregister / get clinic bot
  // ---------------------------------------------------------------------------
  async getClinicBot(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('telegram_bots')
      .select('id, bot_username, is_active, webhook_secret, registered_at')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    return data;
  }

  async registerBot(clinicId: string, input: z.infer<typeof RegisterBotSchema>) {
    const admin = this.supabase.admin();
    // Verify token via getMe before saving
    const me = await this.callTelegramApi(input.bot_token, 'getMe', {});
    if (!me?.ok) {
      throw new BadRequestException(
        'Telegram bot token noto‘g‘ri yoki bot mavjud emas. Tokenni @BotFather dan tekshiring.',
      );
    }
    const apiUsername = (me.result as { username?: string } | undefined)?.username;
    if (apiUsername && apiUsername.toLowerCase() !== input.bot_username.toLowerCase()) {
      throw new BadRequestException(
        `Berilgan username (${input.bot_username}) Telegram'dagi @${apiUsername} bilan mos kelmaydi`,
      );
    }

    const { data, error } = await admin
      .from('telegram_bots')
      .upsert(
        {
          clinic_id: clinicId,
          bot_token: input.bot_token,
          bot_username: input.bot_username,
          is_active: true,
        },
        { onConflict: 'clinic_id' },
      )
      .select('id, bot_username, webhook_secret')
      .single();
    if (error) throw new BadRequestException(error.message);
    const row = data as { id: string; bot_username: string; webhook_secret: string };

    // Try to set webhook (best-effort, doesn't block on failure)
    const baseUrl = process.env.API_PUBLIC_URL ?? 'https://api.clary.uz';
    const webhookUrl = `${baseUrl}/api/v1/telegram/webhook/${row.id}`;
    try {
      await this.callTelegramApi(input.bot_token, 'setWebhook', {
        url: webhookUrl,
        secret_token: row.webhook_secret,
        allowed_updates: ['message'],
      });
    } catch (e) {
      this.log.warn(`Webhook set failed for ${row.bot_username}: ${(e as Error).message}`);
    }
    return { id: row.id, bot_username: row.bot_username, webhook_url: webhookUrl };
  }

  async unregisterBot(clinicId: string) {
    const admin = this.supabase.admin();
    const { data: bot } = await admin
      .from('telegram_bots')
      .select('bot_token')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (bot) {
      try {
        await this.callTelegramApi((bot as { bot_token: string }).bot_token, 'deleteWebhook', {});
      } catch {
        // ignore
      }
    }
    await admin.from('telegram_bots').delete().eq('clinic_id', clinicId);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Webhook: receive updates from Telegram. /start <phone> binds chat_id.
  // ---------------------------------------------------------------------------
  async handleWebhook(botId: string, secretHeader: string | undefined, update: unknown) {
    const admin = this.supabase.admin();
    const { data: bot } = await admin
      .from('telegram_bots')
      .select('id, clinic_id, bot_token, webhook_secret, is_active')
      .eq('id', botId)
      .maybeSingle();
    if (!bot) {
      this.log.warn(`Webhook for unknown bot ${botId}`);
      return { ok: true }; // silently accept
    }
    const row = bot as {
      id: string;
      clinic_id: string;
      bot_token: string;
      webhook_secret: string;
      is_active: boolean;
    };
    if (!row.is_active) return { ok: true };
    if (secretHeader !== row.webhook_secret) {
      this.log.warn(`Webhook secret mismatch for bot ${botId}`);
      return { ok: true };
    }

    const u = update as
      | { message?: { chat: { id: number; username?: string; first_name?: string }; text?: string; from?: { id: number } } }
      | undefined;
    const msg = u?.message;
    if (!msg?.text) return { ok: true };

    const text = msg.text.trim();
    const chatId = msg.chat.id;
    const username = msg.chat.username;
    const firstName = msg.chat.first_name;

    if (text.startsWith('/start')) {
      const arg = text.replace('/start', '').trim();
      if (!arg) {
        await this.callTelegramApi(row.bot_token, 'sendMessage', {
          chat_id: chatId,
          text:
            'Salom! 👋 Klinika tahlil va eslatmalarini olish uchun:\n\n' +
            '`/start +998901234567`\n\n' +
            'shaklida telefon raqamingizni yuboring (klinikaga ro‘yxatdan o‘tgan raqam).',
          parse_mode: 'Markdown',
        });
        return { ok: true };
      }
      // Find patient by phone
      const phone = arg.replace(/\s/g, '');
      const { data: patient } = await admin
        .from('patients')
        .select('id, full_name')
        .eq('clinic_id', row.clinic_id)
        .eq('phone', phone)
        .maybeSingle();
      if (!patient) {
        await this.callTelegramApi(row.bot_token, 'sendMessage', {
          chat_id: chatId,
          text:
            `Telefon raqami ${phone} klinikada topilmadi. Iltimos qabulxonaga murojaat qiling.`,
        });
        return { ok: true };
      }
      const p = patient as { id: string; full_name: string };
      await admin
        .from('patient_telegram_links')
        .upsert(
          {
            clinic_id: row.clinic_id,
            patient_id: p.id,
            telegram_chat_id: chatId,
            telegram_username: username ?? null,
            telegram_first_name: firstName ?? null,
            is_active: true,
          },
          { onConflict: 'clinic_id,patient_id' },
        );
      await this.callTelegramApi(row.bot_token, 'sendMessage', {
        chat_id: chatId,
        text:
          `✅ Salom, ${p.full_name}!\n\n` +
          `Endi sizning tahlil natijalaringiz, eslatmalar va boshqa muhim xabarlar shu yerga keladi.`,
      });
      return { ok: true };
    }

    if (text === '/help' || text === '/start') {
      await this.callTelegramApi(row.bot_token, 'sendMessage', {
        chat_id: chatId,
        text:
          'Buyruqlar:\n' +
          '/start +998... — telefon raqami orqali ulanish\n' +
          '/help — yordam',
      });
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Send message to a patient via clinic bot. Used by NotificationsService.
  // ---------------------------------------------------------------------------
  async sendToPatient(
    clinicId: string,
    patientId: string,
    body: string,
    options?: { document?: { url: string; filename: string } },
  ): Promise<{ ok: boolean; chat_id?: number; error?: string }> {
    const admin = this.supabase.admin();
    const [{ data: bot }, { data: link }] = await Promise.all([
      admin
        .from('telegram_bots')
        .select('bot_token, is_active')
        .eq('clinic_id', clinicId)
        .maybeSingle(),
      admin
        .from('patient_telegram_links')
        .select('telegram_chat_id, is_active')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .maybeSingle(),
    ]);
    if (!bot || !(bot as { is_active: boolean }).is_active) {
      return { ok: false, error: 'Klinika Telegram boti sozlanmagan yoki o‘chirilgan' };
    }
    if (!link || !(link as { is_active: boolean }).is_active) {
      return { ok: false, error: 'Bemor Telegram orqali bog‘lanmagan (/start yubormagan)' };
    }
    const token = (bot as { bot_token: string }).bot_token;
    const chatId = (link as { telegram_chat_id: number }).telegram_chat_id;

    try {
      if (options?.document) {
        await this.callTelegramApi(token, 'sendDocument', {
          chat_id: chatId,
          document: options.document.url,
          caption: body,
        });
      } else {
        await this.callTelegramApi(token, 'sendMessage', { chat_id: chatId, text: body });
      }
      return { ok: true, chat_id: chatId };
    } catch (e) {
      return { ok: false, chat_id: chatId, error: (e as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Telegram API helper
  // ---------------------------------------------------------------------------
  private async callTelegramApi(
    token: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; description?: string } | null> {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!json.ok) {
      this.log.warn(`Telegram API ${method} failed: ${json.description}`);
      throw new Error(json.description ?? 'Telegram API call failed');
    }
    return json;
  }
}

// ============================================================================
// Controller
// ============================================================================
@ApiTags('telegram')
@Controller('telegram')
class TelegramController {
  constructor(private readonly svc: TelegramService) {}

  // --- Admin endpoints (clinic owner / admin) ---
  @Get('bot')
  async getBot(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getClinicBot(u.clinicId);
  }

  @Post('bot/register')
  @Audit({ action: 'telegram.bot_registered', resourceType: 'telegram_bots' })
  registerBot(
    @CurrentUser() u: { clinicId: string | null },
    @Body() body: unknown,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.registerBot(u.clinicId, RegisterBotSchema.parse(body));
  }

  @Post('bot/unregister')
  @Audit({ action: 'telegram.bot_unregistered', resourceType: 'telegram_bots' })
  unregisterBot(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.unregisterBot(u.clinicId);
  }

  // --- Webhook (public, validated by secret header) ---
  @Public()
  @Post('webhook/:botId')
  webhook(
    @Param('botId') botId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string,
    @Body() body: unknown,
  ) {
    return this.svc.handleWebhook(botId, secret, body);
  }
}

@Module({
  controllers: [TelegramController],
  providers: [TelegramService, SupabaseService],
  exports: [TelegramService],
})
export class TelegramModule {}
