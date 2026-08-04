import { createHash, randomInt } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { reportEvents, type ReportEvent } from '../../common/events/report-events';
import { SupabaseService } from '../../common/services/supabase.service';
import { CashierModule, CashierService } from '../cashier/cashier.module';

// ============================================================================
// Clary Hisobot Bot — klinika egalari uchun Telegram hisobot tizimi.
//   1) Markaziy bot (@ClaryHisobotBot, env TELEGRAM_OWNER_BOT_TOKEN):
//      egalar ro'yxatdan o'tadi → so'rov super-admin tasdig'iga tushadi.
//   2) Hisobot bot (har klinika alohida, token super-admindan):
//      klinika integratsiya sahifasida ro'yxatlanadi, ega bind-kod bilan
//      bog'lanadi va smena/kassa hodisalari + kunlik digest/backup oladi.
// ============================================================================

const RegisterReportBotSchema = z.object({
  bot_token: z.string().min(20),
  bot_username: z
    .string()
    .min(3)
    .regex(/^[a-zA-Z0-9_]+_bot$/i, 'Telegram bot username _bot bilan tugashi kerak'),
});

const EventsSchema = z.object({
  shift: z.boolean().optional(),
  encash: z.boolean().optional(),
  expense: z.boolean().optional(),
  refund: z.boolean().optional(),
  safe: z.boolean().optional(),
});

const fmt = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');
const TZ = 'Asia/Tashkent';

/** Platforma backup'i sarlavhasidagi yig'ma ko'rsatkichlar. */
type PlatformTotals = {
  day: string;
  clinics: number;
  active_clinics: number;
  revenue_uzs: number;
  refunds_uzs: number;
  meds_uzs: number;
  tx_count: number;
  new_patients: number;
};

/** Bugungi sana (Tashkent) YYYY-MM-DD ko'rinishida. */
function todayTashkent(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('uz-UZ', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type ReportBotRow = {
  id: string;
  clinic_id: string;
  bot_token: string;
  bot_username: string;
  webhook_secret: string;
  bind_code: string | null;
  bind_code_expires_at: string | null;
  events: Record<string, boolean>;
  is_active: boolean;
};

@Injectable()
export class TelegramReportsService implements OnModuleInit {
  private readonly log = new Logger('TelegramReports');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cashier: CashierService,
  ) {}

  // Kassa/smena hodisalarini tinglash — emitlovchi modullar bizga bog'lanmaydi.
  onModuleInit() {
    reportEvents.on('report', (e: ReportEvent) => {
      void this.handleReportEvent(e).catch((err) =>
        this.log.warn(`report event xato: ${(err as Error).message}`),
      );
    });
  }

  // ==========================================================================
  // Telegram API helperlar
  // ==========================================================================
  private async callTelegramApi(
    token: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!json.ok) {
      this.log.warn(`Telegram ${method} failed: ${json.description}`);
      throw new Error(json.description ?? 'Telegram API call failed');
    }
    return json;
  }

  /** Fayl yuborish — multipart (Buffer'dan), CSV backup uchun. */
  private async sendDocumentBuffer(
    token: string,
    chatId: number,
    filename: string,
    content: string,
    caption?: string,
  ): Promise<void> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('document', new Blob([content], { type: 'text/csv' }), filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) throw new Error(json.description ?? 'sendDocument failed');
  }

  // ==========================================================================
  // 1) MARKAZIY BOT — ro'yxatdan o'tish oqimi
  // ==========================================================================
  private centralToken(): string | null {
    return process.env.TELEGRAM_OWNER_BOT_TOKEN ?? null;
  }

  /** Markaziy bot webhook secret — token hash'idan (alohida env shart emas). */
  private centralSecret(): string {
    return createHash('sha256')
      .update(this.centralToken() ?? 'none')
      .digest('hex')
      .slice(0, 32);
  }

  /** Super-admin bir marta chaqiradi — markaziy bot webhook'ini o'rnatadi. */
  async setupCentralBot() {
    const token = this.centralToken();
    if (!token) throw new BadRequestException('TELEGRAM_OWNER_BOT_TOKEN sozlanmagan');
    const me = await this.callTelegramApi(token, 'getMe', {});
    const baseUrl = process.env.API_PUBLIC_URL ?? 'https://api.clary.uz';
    const url = `${baseUrl}/api/v1/telegram-reports/central-webhook`;
    await this.callTelegramApi(token, 'setWebhook', {
      url,
      secret_token: this.centralSecret(),
      allowed_updates: ['message'],
    });
    return { ok: true, bot: (me.result as { username?: string })?.username, webhook_url: url };
  }

  async handleCentralWebhook(secretHeader: string | undefined, update: unknown) {
    const token = this.centralToken();
    if (!token) return { ok: true };
    if (secretHeader !== this.centralSecret()) {
      this.log.warn('Central webhook secret mismatch');
      return { ok: true };
    }

    const u = update as
      | {
          message?: { chat: { id: number; username?: string; first_name?: string }; text?: string };
        }
      | undefined;
    const msg = u?.message;
    if (!msg?.text) return { ok: true };

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const admin = this.supabase.admin();

    const reply = (t: string) =>
      this.callTelegramApi(token, 'sendMessage', {
        chat_id: chatId,
        text: t,
        parse_mode: 'HTML',
      }).catch(() => undefined);

    if (text.startsWith('/start')) {
      // Ochiq so'rov bormi? (partial unique index upsert bilan ishlamaydi —
      // shuning uchun qo'lda select → update/insert)
      const { data: existing } = await admin
        .from('telegram_owner_requests')
        .select('id, status')
        .eq('telegram_chat_id', chatId)
        .in('status', ['draft', 'pending'])
        .maybeSingle();
      const open = existing as { id: string; status: string } | null;
      if (open?.status === 'pending') {
        await reply("So'rovingiz allaqachon yuborilgan — admin tasdig'ini kuting. ⏳");
        return { ok: true };
      }
      if (open) {
        // Draft bor — profil ma'lumotlarini yangilab qo'yamiz
        await admin
          .from('telegram_owner_requests')
          .update({
            telegram_username: msg.chat.username ?? null,
            full_name: msg.chat.first_name ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', open.id);
      } else {
        const { error: insErr } = await admin.from('telegram_owner_requests').insert({
          telegram_chat_id: chatId,
          telegram_username: msg.chat.username ?? null,
          full_name: msg.chat.first_name ?? null,
          status: 'draft',
        });
        if (insErr) {
          this.log.warn(`owner request insert failed: ${insErr.message}`);
          await reply("Texnik xatolik yuz berdi — birozdan keyin qayta urinib ko'ring.");
          return { ok: true };
        }
      }
      await reply(
        'Assalomu alaykum! 👋 <b>Clary Hisobot Bot</b>ga xush kelibsiz.\n\n' +
          "Klinika egasi sifatida ro'yxatdan o'tish uchun bitta xabarda yuboring:\n" +
          '<i>Klinika nomi, telefon raqamingiz</i>\n\n' +
          'Masalan: <code>NUR Klinika, +998901234567</code>',
      );
      return { ok: true };
    }

    // Draft holatidagi chat — kelgan matn klinika ma'lumotlari deb qabul qilinadi
    const { data: draft } = await admin
      .from('telegram_owner_requests')
      .select('id, status')
      .eq('telegram_chat_id', chatId)
      .eq('status', 'draft')
      .maybeSingle();
    if (draft) {
      const [clinicName, ...rest] = text.split(',');
      const phone = rest.join(',').trim() || null;
      await admin
        .from('telegram_owner_requests')
        .update({
          clinic_name: clinicName?.trim() || text.slice(0, 160),
          phone,
          message: text.slice(0, 500),
          status: 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', (draft as { id: string }).id);
      await reply(
        "✅ So'rovingiz qabul qilindi!\n\n" +
          'Clary administratori tekshirib tasdiqlagach, sizga shu yerda xabar beramiz.',
      );
      this.notifyPlatformAdmin(
        `🆕 Hisobot bot so'rovi:\n${text}\n@${msg.chat.username ?? '—'} (chat ${chatId})\n\nadmin.clary.uz → Telegram botlar → Hisobot so'rovlari`,
      );
      return { ok: true };
    }

    await reply("Buyruqlar:\n/start — ro'yxatdan o'tish");
    return { ok: true };
  }

  /** Platforma adminiga xabar — leads bot env'lari orqali (best-effort). */
  private notifyPlatformAdmin(text: string): void {
    const token = process.env.TELEGRAM_LEADS_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_LEADS_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    void fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    }).catch(() => undefined);
  }

  // --- So'rovlar (super-admin) ---
  async listRequests(status?: string) {
    let q = this.supabase
      .admin()
      .from('telegram_owner_requests')
      .select(
        'id, telegram_chat_id, telegram_username, full_name, phone, clinic_name, message, status, clinic_id, created_at',
      )
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async reviewRequest(
    id: string,
    reviewerId: string,
    action: 'approve' | 'reject',
    clinicId?: string,
  ) {
    const admin = this.supabase.admin();
    const { data: req } = await admin
      .from('telegram_owner_requests')
      .select('id, telegram_chat_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!req) throw new BadRequestException("So'rov topilmadi");

    const { data, error } = await admin
      .from('telegram_owner_requests')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        clinic_id: clinicId ?? null,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // Egaga markaziy bot orqali javob (best-effort)
    const token = this.centralToken();
    if (token) {
      const chatId = (req as { telegram_chat_id: number }).telegram_chat_id;
      const text =
        action === 'approve'
          ? "🎉 So'rovingiz tasdiqlandi!\n\nClary administratori klinikangiz uchun maxsus hisobot bot tokenini beradi. Token klinika dasturida Sozlamalar → Integratsiyalar → Hisobot bot bo'limiga kiritiladi, so'ng bot sizga bog'lanish kodini beradi."
          : "Afsuski so'rovingiz rad etildi. Savollar bo'lsa clarysupport@gmail.com ga yozing.";
      void this.callTelegramApi(token, 'sendMessage', { chat_id: chatId, text }).catch(
        () => undefined,
      );
    }
    return data;
  }

  // ==========================================================================
  // 2) HISOBOT BOT — klinika tomonidan ro'yxatlanadi
  // ==========================================================================
  async getReportBot(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('telegram_report_bots')
      .select('id, bot_username, is_active, bind_code, bind_code_expires_at, events, registered_at')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    return data;
  }

  async registerReportBot(clinicId: string, input: z.infer<typeof RegisterReportBotSchema>) {
    const admin = this.supabase.admin();
    const me = await this.callTelegramApi(input.bot_token, 'getMe', {}).catch(() => null);
    if (!me?.ok) {
      throw new BadRequestException("Bot token noto'g'ri — @BotFather'dan tekshiring");
    }
    const apiUsername = (me.result as { username?: string } | undefined)?.username;
    if (apiUsername && apiUsername.toLowerCase() !== input.bot_username.toLowerCase()) {
      throw new BadRequestException(`Username @${apiUsername} bilan mos kelmaydi`);
    }

    const { data, error } = await admin
      .from('telegram_report_bots')
      .upsert(
        {
          clinic_id: clinicId,
          bot_token: input.bot_token,
          bot_username: input.bot_username,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'clinic_id' },
      )
      .select('id, bot_username, webhook_secret')
      .single();
    if (error) throw new BadRequestException(error.message);
    const row = data as { id: string; bot_username: string; webhook_secret: string };

    const baseUrl = process.env.API_PUBLIC_URL ?? 'https://api.clary.uz';
    const webhookUrl = `${baseUrl}/api/v1/telegram-reports/webhook/${row.id}`;
    try {
      await this.callTelegramApi(input.bot_token, 'setWebhook', {
        url: webhookUrl,
        secret_token: row.webhook_secret,
        allowed_updates: ['message'],
      });
    } catch (e) {
      this.log.warn(`Report bot webhook set failed: ${(e as Error).message}`);
    }
    // Birinchi bind kod darhol tayyor bo'lsin
    const bind = await this.newBindCode(clinicId);
    return { id: row.id, bot_username: row.bot_username, webhook_url: webhookUrl, ...bind };
  }

  async unregisterReportBot(clinicId: string) {
    const admin = this.supabase.admin();
    const { data: bot } = await admin
      .from('telegram_report_bots')
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
    await admin.from('telegram_report_bots').delete().eq('clinic_id', clinicId);
    await admin.from('telegram_owner_chats').delete().eq('clinic_id', clinicId);
    return { ok: true };
  }

  /** 6 xonali bog'lanish kodi — 15 daqiqa amal qiladi. */
  async newBindCode(clinicId: string) {
    const code = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await this.supabase
      .admin()
      .from('telegram_report_bots')
      .update({
        bind_code: code,
        bind_code_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('clinic_id', clinicId);
    if (error) throw new BadRequestException(error.message);
    return { bind_code: code, bind_code_expires_at: expiresAt };
  }

  async listOwnerChats(clinicId: string) {
    const { data } = await this.supabase
      .admin()
      .from('telegram_owner_chats')
      .select('id, chat_id, username, first_name, is_active, bound_at')
      .eq('clinic_id', clinicId)
      .order('bound_at', { ascending: false });
    return data ?? [];
  }

  async removeOwnerChat(clinicId: string, id: string) {
    await this.supabase
      .admin()
      .from('telegram_owner_chats')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('id', id);
    return { ok: true };
  }

  async updateEvents(clinicId: string, patch: z.infer<typeof EventsSchema>) {
    const admin = this.supabase.admin();
    const { data: bot } = await admin
      .from('telegram_report_bots')
      .select('events')
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (!bot) throw new BadRequestException('Hisobot bot sozlanmagan');
    const events = { ...((bot as { events: Record<string, boolean> }).events ?? {}), ...patch };
    const { error } = await admin
      .from('telegram_report_bots')
      .update({ events, updated_at: new Date().toISOString() })
      .eq('clinic_id', clinicId);
    if (error) throw new BadRequestException(error.message);
    return { events };
  }

  // --- Hisobot bot webhook — /start <kod>, /kassa, /hisobot, /yordam ---
  async handleReportWebhook(botId: string, secretHeader: string | undefined, update: unknown) {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('telegram_report_bots')
      .select('*')
      .eq('id', botId)
      .maybeSingle();
    const bot = data as ReportBotRow | null;
    if (!bot || !bot.is_active) return { ok: true };
    if (secretHeader !== bot.webhook_secret) {
      this.log.warn(`Report webhook secret mismatch (bot ${botId})`);
      return { ok: true };
    }

    const u = update as
      | {
          message?: { chat: { id: number; username?: string; first_name?: string }; text?: string };
        }
      | undefined;
    const msg = u?.message;
    if (!msg?.text) return { ok: true };

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const reply = (t: string) =>
      this.callTelegramApi(bot.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: t,
        parse_mode: 'HTML',
      }).catch(() => undefined);

    if (text.startsWith('/start')) {
      const code = text.replace('/start', '').trim();
      if (!code) {
        await reply(
          'Salom! 👋 Bu klinika hisobot boti.\n\n' +
            "Bog'lanish uchun klinika dasturidagi (Sozlamalar → Integratsiyalar → Hisobot bot) kodni yuboring:\n" +
            '<code>/start 123456</code>',
        );
        return { ok: true };
      }
      const valid =
        bot.bind_code === code &&
        bot.bind_code_expires_at &&
        new Date(bot.bind_code_expires_at) > new Date();
      if (!valid) {
        await reply("❌ Kod noto'g'ri yoki muddati o'tgan. Klinika dasturidan yangi kod oling.");
        return { ok: true };
      }
      await admin.from('telegram_owner_chats').upsert(
        {
          clinic_id: bot.clinic_id,
          chat_id: chatId,
          username: msg.chat.username ?? null,
          first_name: msg.chat.first_name ?? null,
          is_active: true,
        },
        { onConflict: 'clinic_id,chat_id' },
      );
      // Kod bir martalik
      await admin
        .from('telegram_report_bots')
        .update({ bind_code: null, bind_code_expires_at: null })
        .eq('id', bot.id);
      await reply(
        "✅ Bog'landingiz! Endi sizga keladi:\n" +
          '• Smena ochilish/yopilish xabarlari\n' +
          '• Muhim kassa amaliyotlari\n' +
          '• Har kuni 23:55 da kunlik hisobot + backup\n\n' +
          'Buyruqlar: /kassa /hisobot /yordam',
      );
      return { ok: true };
    }

    // Qolgan komandalar — faqat bog'langan chatlar uchun
    const { data: link } = await admin
      .from('telegram_owner_chats')
      .select('id, is_active')
      .eq('clinic_id', bot.clinic_id)
      .eq('chat_id', chatId)
      .maybeSingle();
    if (!link || !(link as { is_active: boolean }).is_active) {
      await reply(
        "Avval bog'laning: klinika dasturidan kod olib <code>/start KOD</code> yuboring.",
      );
      return { ok: true };
    }

    if (text === '/kassa') {
      await reply(await this.buildCashStatus(bot.clinic_id));
    } else if (text === '/hisobot') {
      await reply(await this.buildDailyDigest(bot.clinic_id, todayTashkent()));
    } else {
      await reply(
        'Buyruqlar:\n/kassa — kassadagi joriy pul\n/hisobot — bugungi hisobot\n/yordam — yordam',
      );
    }
    return { ok: true };
  }

  // ==========================================================================
  // 3) XABAR YUBORISH
  // ==========================================================================
  private async getActiveBotWithChats(
    clinicId: string,
  ): Promise<{ bot: ReportBotRow; chatIds: number[] } | null> {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('telegram_report_bots')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .maybeSingle();
    const bot = data as ReportBotRow | null;
    if (!bot) return null;
    const { data: chats } = await admin
      .from('telegram_owner_chats')
      .select('chat_id')
      .eq('clinic_id', clinicId)
      .eq('is_active', true);
    const chatIds = ((chats ?? []) as Array<{ chat_id: number }>).map((c) => c.chat_id);
    if (chatIds.length === 0) return null;
    return { bot, chatIds };
  }

  async sendToOwners(clinicId: string, text: string): Promise<void> {
    const target = await this.getActiveBotWithChats(clinicId);
    if (!target) return;
    for (const chatId of target.chatIds) {
      await this.callTelegramApi(target.bot.bot_token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }).catch(() => undefined);
    }
  }

  /** Klinika faol Telegram hisobot boti bormi (jadvallashtirish UI uchun). */
  async hasActiveReportBot(clinicId: string): Promise<boolean> {
    return (await this.getActiveBotWithChats(clinicId)) !== null;
  }

  /**
   * Hisobot (caption + CSV fayllar) ni klinika ega chatlariga yuboradi.
   * Faza 5C jadvallashtirilgan eksport shu metodni ishlatadi. Bot/chat yo'q
   * bo'lsa false qaytaradi (yuborilmadi).
   */
  async deliverReportToOwners(
    clinicId: string,
    caption: string,
    files: Array<{ filename: string; content: string }>,
  ): Promise<boolean> {
    const target = await this.getActiveBotWithChats(clinicId);
    if (!target) return false;
    for (const chatId of target.chatIds) {
      if (caption) {
        await this.callTelegramApi(target.bot.bot_token, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
        }).catch(() => undefined);
      }
      for (const f of files) {
        await this.sendDocumentBuffer(target.bot.bot_token, chatId, f.filename, f.content).catch(
          () => undefined,
        );
      }
    }
    return true;
  }

  // ==========================================================================
  // 4) HODISALAR (smena/kassa) — event listener
  // ==========================================================================
  private async handleReportEvent(e: ReportEvent): Promise<void> {
    const target = await this.getActiveBotWithChats(e.clinicId);
    if (!target) return;
    const ev = target.bot.events ?? {};

    if (e.type === 'shift_opened' && ev.shift !== false) {
      const s = await this.getShift(e.clinicId, e.shiftId);
      if (!s) return;
      await this.sendToOwners(
        e.clinicId,
        `🟢 <b>Smena ochildi</b>\n` +
          `Vaqt: ${fmtTime(s.opened_at)}\n` +
          `Boshlang'ich naqd: <b>${fmt(s.opening_cash_uzs ?? 0)}</b> so'm` +
          (s.operator_name ? `\nOperator: ${s.operator_name}` : ''),
      );
    } else if (e.type === 'shift_closed' && ev.shift !== false) {
      await this.sendToOwners(e.clinicId, await this.buildShiftSummary(e.clinicId, e.shiftId));
    } else if (e.type === 'encash' && ev.encash !== false) {
      await this.sendToOwners(
        e.clinicId,
        `🏦 <b>Inkassatsiya</b>: ${fmt(e.amountUzs)} so'm seyfga o'tkazildi` +
          (e.destination ? `\nManzil: ${e.destination}` : ''),
      );
    } else if (e.type === 'expense' && ev.expense !== false) {
      await this.sendToOwners(
        e.clinicId,
        `💸 <b>Rasxot</b>: ${fmt(e.amountUzs)} so'm${e.notes ? `\n${e.notes}` : ''}`,
      );
    } else if (e.type === 'refund' && ev.refund !== false) {
      await this.sendToOwners(
        e.clinicId,
        `↩️ <b>Qaytarish (refund)</b>: ${fmt(e.amountUzs)} so'm${e.notes ? `\n${e.notes}` : ''}`,
      );
    } else if (e.type === 'adjustment' && ev.safe !== false) {
      await this.sendToOwners(
        e.clinicId,
        `⚖️ <b>Kassa tuzatish</b>: ${fmt(e.amountUzs)} so'm${e.notes ? `\n${e.notes}` : ''}`,
      );
    } else if (e.type === 'safe_deposit' && ev.safe !== false) {
      await this.sendToOwners(
        e.clinicId,
        `🔐 <b>Seyfga kirim</b>: ${fmt(e.amountUzs)} so'm${e.notes ? `\n${e.notes}` : ''}`,
      );
    }
  }

  private async getShift(clinicId: string, shiftId: string) {
    const { data } = await this.supabase
      .admin()
      .from('shifts')
      .select(
        'id, opened_at, closed_at, opening_cash_uzs, expected_cash_uzs, actual_cash_uzs, ' +
          'cash_total_uzs, card_total_uzs, electronic_total_uzs, closing_notes, ' +
          'operator:shift_operators(full_name)',
      )
      .eq('clinic_id', clinicId)
      .eq('id', shiftId)
      .maybeSingle();
    if (!data) return null;
    const r = data as unknown as {
      id: string;
      opened_at: string;
      closed_at: string | null;
      opening_cash_uzs: number | null;
      expected_cash_uzs: number | null;
      actual_cash_uzs: number | null;
      cash_total_uzs: number | null;
      card_total_uzs: number | null;
      electronic_total_uzs: number | null;
      closing_notes: string | null;
      operator: { full_name?: string } | null;
    };
    return { ...r, operator_name: r.operator?.full_name ?? null };
  }

  async buildShiftSummary(clinicId: string, shiftId: string): Promise<string> {
    const s = await this.getShift(clinicId, shiftId);
    if (!s) return '🔴 Smena yopildi';

    const admin = this.supabase.admin();
    const [expRes, pharmRes] = await Promise.all([
      admin
        .from('expenses')
        .select('amount_uzs')
        .eq('clinic_id', clinicId)
        .eq('shift_id', shiftId)
        .eq('is_void', false),
      admin
        .from('pharmacy_sales')
        .select('total_uzs')
        .eq('clinic_id', clinicId)
        .eq('shift_id', shiftId)
        .eq('is_void', false),
    ]);
    const expenses = ((expRes.data ?? []) as Array<{ amount_uzs: number }>).reduce(
      (a, r) => a + Number(r.amount_uzs),
      0,
    );
    const pharm = ((pharmRes.data ?? []) as Array<{ total_uzs: number }>).reduce(
      (a, r) => a + Number(r.total_uzs),
      0,
    );

    const opening = Number(s.opening_cash_uzs ?? 0);
    const expected = opening + Number(s.expected_cash_uzs ?? s.cash_total_uzs ?? 0);
    const actual = Number(s.actual_cash_uzs ?? 0);
    const diff = actual - expected;
    const diffStr =
      diff === 0 ? "✅ farq yo'q" : diff > 0 ? `⚠️ +${fmt(diff)} ortiqcha` : `🔻 ${fmt(diff)} kam`;

    return (
      `🔴 <b>Smena yopildi</b>\n` +
      `${fmtTime(s.opened_at)} → ${s.closed_at ? fmtTime(s.closed_at) : '—'}` +
      (s.operator_name ? ` · ${s.operator_name}` : '') +
      `\n\n💵 Naqd: <b>${fmt(Number(s.cash_total_uzs ?? 0))}</b> so'm` +
      `\n💳 Karta: <b>${fmt(Number(s.card_total_uzs ?? 0))}</b> so'm` +
      `\n📱 Elektron: <b>${fmt(Number(s.electronic_total_uzs ?? 0))}</b> so'm` +
      `\n💸 Rasxotlar: ${fmt(expenses)} so'm` +
      (pharm > 0 ? `\n💊 Dorixona: ${fmt(pharm)} so'm` : '') +
      `\n\n🧮 Kutilgan naqd: ${fmt(expected)} so'm` +
      `\n💰 Haqiqiy naqd: <b>${fmt(actual)}</b> so'm (${diffStr})` +
      (s.closing_notes ? `\n📝 ${s.closing_notes}` : '')
    );
  }

  // ==========================================================================
  // 5) KUNLIK DIGEST + BACKUP — cron 23:55 (Asia/Tashkent)
  // ==========================================================================
  async buildCashStatus(clinicId: string): Promise<string> {
    const [cash, safe] = await Promise.all([
      this.cashier.cashOnHand(clinicId, 'reception'),
      this.cashier.safeBalance(clinicId, 'reception'),
    ]);
    const safeBal = (safe as { balance_uzs?: number; safe_balance_uzs?: number }) ?? {};
    const safeAmount = Number(safeBal.balance_uzs ?? safeBal.safe_balance_uzs ?? 0);
    return (
      `💵 <b>Kassada hozir</b>\n` +
      `Seyfga o'tmagan naqd: <b>${fmt(Number(cash.cash_on_hand_uzs ?? 0))}</b> so'm\n` +
      `Seyf balansi: <b>${fmt(safeAmount)}</b> so'm`
    );
  }

  async buildDailyDigest(clinicId: string, day: string): Promise<string> {
    const admin = this.supabase.admin();
    const dayStart = `${day}T00:00:00+05:00`;
    const dayEnd = `${day}T23:59:59.999+05:00`;

    const [revRes, expRes, pharmRes, txRes, apptRes, newPatRes] = await Promise.all([
      admin
        .from('daily_revenue_view')
        .select('revenue_uzs, transactions')
        .eq('clinic_id', clinicId)
        .eq('day', day)
        .maybeSingle(),
      admin
        .from('daily_expense_view')
        .select('expenses_uzs')
        .eq('clinic_id', clinicId)
        .eq('day', day)
        .maybeSingle(),
      admin
        .from('pharmacy_daily_view')
        .select('sales, revenue_uzs, debt_uzs')
        .eq('clinic_id', clinicId)
        .eq('day', day)
        .maybeSingle(),
      // To'lov usullari kesimi — bugungi tranzaksiyalar
      admin
        .from('transactions')
        .select('amount_uzs, payment_method, kind')
        .eq('clinic_id', clinicId)
        .eq('is_void', false)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd),
      admin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .gte('scheduled_at', dayStart)
        .lte('scheduled_at', dayEnd),
      admin
        .from('patients')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd),
    ]);

    const revenue = Number((revRes.data as { revenue_uzs?: number } | null)?.revenue_uzs ?? 0);
    const txCount = Number((revRes.data as { transactions?: number } | null)?.transactions ?? 0);
    const expenses = Number((expRes.data as { expenses_uzs?: number } | null)?.expenses_uzs ?? 0);
    const pharm =
      (pharmRes.data as { sales?: number; revenue_uzs?: number; debt_uzs?: number } | null) ?? {};

    // Usul kesimi (refund manfiy)
    const byMethod = new Map<string, number>();
    for (const r of (txRes.data ?? []) as Array<{
      amount_uzs: number;
      payment_method: string;
      kind: string;
    }>) {
      const sign = r.kind === 'refund' ? -1 : 1;
      byMethod.set(
        r.payment_method,
        (byMethod.get(r.payment_method) ?? 0) + sign * Number(r.amount_uzs),
      );
    }
    const methodLines = Array.from(byMethod.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([m, v]) => `   ${m}: ${fmt(v)}`)
      .join('\n');

    const cashStatus = await this.buildCashStatus(clinicId);

    return (
      `📊 <b>Kunlik hisobot — ${day}</b>\n\n` +
      `💰 <b>KASSA</b>\n` +
      `Daromad: <b>${fmt(revenue)}</b> so'm (${txCount} ta amal)\n` +
      (methodLines ? `${methodLines}\n` : '') +
      `Rasxot: ${fmt(expenses)} so'm\n` +
      `Sof: <b>${fmt(revenue - expenses)}</b> so'm\n\n` +
      `🏥 <b>QABUL</b>\n` +
      `Qabullar: ${apptRes.count ?? 0} ta · Yangi bemorlar: ${newPatRes.count ?? 0} ta\n\n` +
      `💊 <b>DORIXONA</b>\n` +
      `Sotuvlar: ${pharm.sales ?? 0} ta · Daromad: ${fmt(Number(pharm.revenue_uzs ?? 0))} so'm` +
      (Number(pharm.debt_uzs ?? 0) > 0 ? ` · Qarz: ${fmt(Number(pharm.debt_uzs))} so'm` : '') +
      `\n\n${cashStatus}`
    );
  }

  /** Kunlik backup — tranzaksiyalar va dorixona sotuvlari CSV. */
  private async buildBackupCsvs(
    clinicId: string,
    day: string,
  ): Promise<Array<{ filename: string; content: string }>> {
    const admin = this.supabase.admin();
    const dayStart = `${day}T00:00:00+05:00`;
    const dayEnd = `${day}T23:59:59.999+05:00`;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const files: Array<{ filename: string; content: string }> = [];

    const { data: txs } = await admin
      .from('transactions')
      .select('created_at, amount_uzs, kind, payment_method, is_void, patient:patients(full_name)')
      .eq('clinic_id', clinicId)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .order('created_at');
    const txRows = (txs ?? []) as unknown as Array<{
      created_at: string;
      amount_uzs: number;
      kind: string;
      payment_method: string;
      is_void: boolean;
      patient: { full_name?: string } | null;
    }>;
    files.push({
      filename: `kassa-${day}.csv`,
      content:
        '﻿Vaqt,Bemor,Turi,Usul,Summa,Bekor\n' +
        txRows
          .map((r) =>
            [
              fmtTime(r.created_at),
              r.patient?.full_name,
              r.kind,
              r.payment_method,
              r.amount_uzs,
              r.is_void ? 'ha' : '',
            ]
              .map(esc)
              .join(','),
          )
          .join('\n'),
    });

    const { data: sales } = await admin
      .from('pharmacy_sales')
      .select('created_at, total_uzs, paid_uzs, debt_uzs, payment_method, is_void')
      .eq('clinic_id', clinicId)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .order('created_at');
    const saleRows = (sales ?? []) as Array<{
      created_at: string;
      total_uzs: number;
      paid_uzs: number;
      debt_uzs: number;
      payment_method: string;
      is_void: boolean;
    }>;
    if (saleRows.length > 0) {
      files.push({
        filename: `dorixona-${day}.csv`,
        content:
          "﻿Vaqt,Jami,To'langan,Qarz,Usul,Bekor\n" +
          saleRows
            .map((r) =>
              [
                fmtTime(r.created_at),
                r.total_uzs,
                r.paid_uzs,
                r.debt_uzs,
                r.payment_method,
                r.is_void ? 'ha' : '',
              ]
                .map(esc)
                .join(','),
            )
            .join('\n'),
      });
    }
    return files;
  }

  // ==========================================================================
  // PLATFORMA BACKUP — har kuni 02:20 (Asia/Tashkent) egasining botiga
  // ==========================================================================
  // Klinikaning O'Z boti 23:55 da faqat o'sha klinika ma'lumotini oladi. Bu esa
  // BUTUN platforma bo'yicha kechagi kunning to'liq kesimi — bitta joyda.
  // 02:20 tanlangan: kecha allaqachon yopilgan (smenalar, kunlik digest 23:55
  // o'tgan), tunda yuk yo'q.

  /** Kechagi kun (Toshkent) — YYYY-MM-DD. Cron tunda ishlagani uchun "kecha". */
  private yesterdayTashkent(): string {
    const now = new Date();
    const tashkent = new Date(now.getTime() + 5 * 3600 * 1000); // UTC+5, DST yo'q
    tashkent.setUTCDate(tashkent.getUTCDate() - 1);
    return tashkent.toISOString().slice(0, 10);
  }

  /**
   * Butun platforma bo'yicha kunlik backup CSV'lari:
   *   1) klinikalar-<kun>.csv  — har klinika kesimida yig'ma
   *   2) kassa-<kun>.csv       — barcha tranzaksiyalar (klinika nomi bilan)
   *   3) dorixona-<kun>.csv    — dori savdolari (bo'lsa)
   */
  async buildPlatformBackupCsvs(
    day: string,
  ): Promise<{ files: Array<{ filename: string; content: string }>; totals: PlatformTotals }> {
    const admin = this.supabase.admin();
    const dayStart = `${day}T00:00:00+05:00`;
    const dayEnd = `${day}T23:59:59.999+05:00`;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const [clinicsRes, txRes, salesRes, patientsRes] = await Promise.all([
      admin
        .from('clinics')
        .select('id, name, current_plan, subscription_status, subscription_ends_at')
        .is('deleted_at', null)
        .order('name'),
      admin
        .from('transactions')
        .select(
          'clinic_id, created_at, amount_uzs, kind, payment_method, register, is_void, ' +
            'patient:patients(full_name)',
        )
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at'),
      admin
        .from('pharmacy_sales')
        .select('clinic_id, created_at, total_uzs, paid_uzs, debt_uzs, payment_method, is_void')
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at'),
      admin
        .from('patients')
        .select('clinic_id')
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd),
    ]);

    const clinics = (clinicsRes.data ?? []) as Array<{
      id: string;
      name: string;
      current_plan: string | null;
      subscription_status: string | null;
      subscription_ends_at: string | null;
    }>;
    const nameById = new Map(clinics.map((c) => [c.id, c.name]));

    const txRows = (txRes.data ?? []) as unknown as Array<{
      clinic_id: string;
      created_at: string;
      amount_uzs: number;
      kind: string;
      payment_method: string;
      register: string | null;
      is_void: boolean;
      patient: { full_name?: string } | null;
    }>;
    const saleRows = (salesRes.data ?? []) as Array<{
      clinic_id: string;
      created_at: string;
      total_uzs: number;
      paid_uzs: number;
      debt_uzs: number;
      payment_method: string;
      is_void: boolean;
    }>;
    const patientRows = (patientsRes.data ?? []) as Array<{ clinic_id: string }>;

    // Klinika kesimida yig'ma. Inkasatsiya/tuzatish (adjustment) DAROMAD EMAS —
    // jurnal va kassa moduli bilan bir xil mantiq.
    type Agg = { revenue: number; refunds: number; txCount: number; meds: number; newPat: number };
    const agg = new Map<string, Agg>();
    const blank = (): Agg => ({ revenue: 0, refunds: 0, txCount: 0, meds: 0, newPat: 0 });
    for (const r of txRows) {
      if (r.is_void) continue;
      const a = agg.get(r.clinic_id) ?? blank();
      a.txCount += 1;
      const amt = Number(r.amount_uzs ?? 0);
      if (r.kind === 'refund') a.refunds += Math.abs(amt);
      else if (r.kind !== 'adjustment') a.revenue += amt;
      agg.set(r.clinic_id, a);
    }
    for (const s of saleRows) {
      if (s.is_void) continue;
      const a = agg.get(s.clinic_id) ?? blank();
      a.meds += Number(s.total_uzs ?? 0);
      agg.set(s.clinic_id, a);
    }
    for (const p of patientRows) {
      const a = agg.get(p.clinic_id) ?? blank();
      a.newPat += 1;
      agg.set(p.clinic_id, a);
    }

    const files: Array<{ filename: string; content: string }> = [];

    files.push({
      filename: `klinikalar-${day}.csv`,
      content:
        '﻿Klinika,Tarif,Obuna,Obuna tugashi,Tushum,Vozvrat,Tranzaksiya,Dorixona,Yangi bemor\n' +
        clinics
          .map((c) => {
            const a = agg.get(c.id) ?? blank();
            return [
              c.name,
              c.current_plan,
              c.subscription_status,
              c.subscription_ends_at ? String(c.subscription_ends_at).slice(0, 10) : '',
              a.revenue,
              a.refunds,
              a.txCount,
              a.meds,
              a.newPat,
            ]
              .map(esc)
              .join(',');
          })
          .join('\n'),
    });

    files.push({
      filename: `kassa-${day}.csv`,
      content:
        '﻿Klinika,Vaqt,Bemor,Turi,Usul,Registr,Summa,Bekor\n' +
        txRows
          .map((r) =>
            [
              nameById.get(r.clinic_id) ?? r.clinic_id,
              fmtTime(r.created_at),
              r.patient?.full_name,
              r.kind,
              r.payment_method,
              r.register,
              r.amount_uzs,
              r.is_void ? 'ha' : '',
            ]
              .map(esc)
              .join(','),
          )
          .join('\n'),
    });

    if (saleRows.length > 0) {
      files.push({
        filename: `dorixona-${day}.csv`,
        content:
          "﻿Klinika,Vaqt,Jami,To'langan,Qarz,Usul,Bekor\n" +
          saleRows
            .map((r) =>
              [
                nameById.get(r.clinic_id) ?? r.clinic_id,
                fmtTime(r.created_at),
                r.total_uzs,
                r.paid_uzs,
                r.debt_uzs,
                r.payment_method,
                r.is_void ? 'ha' : '',
              ]
                .map(esc)
                .join(','),
            )
            .join('\n'),
      });
    }

    const totals: PlatformTotals = {
      day,
      clinics: clinics.length,
      active_clinics: [...agg.entries()].filter(([, a]) => a.txCount > 0 || a.meds > 0).length,
      revenue_uzs: [...agg.values()].reduce((s, a) => s + a.revenue, 0),
      refunds_uzs: [...agg.values()].reduce((s, a) => s + a.refunds, 0),
      meds_uzs: [...agg.values()].reduce((s, a) => s + a.meds, 0),
      tx_count: txRows.length,
      new_patients: patientRows.length,
    };
    return { files, totals };
  }

  /** Backup'ni egasining boti (leads bot) chatiga yuboradi. */
  async sendPlatformBackup(day?: string): Promise<{ ok: boolean; day: string; files: number }> {
    const token = process.env.TELEGRAM_LEADS_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_LEADS_CHAT_ID;
    if (!token || !chatId) {
      this.log.warn('platform backup: TELEGRAM_LEADS_BOT_TOKEN/CHAT_ID sozlanmagan');
      return { ok: false, day: day ?? this.yesterdayTashkent(), files: 0 };
    }
    const targetDay = day ?? this.yesterdayTashkent();
    const started = Date.now();

    const { files, totals } = await this.buildPlatformBackupCsvs(targetDay);
    const fmtUzs = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

    const caption =
      `🗄 <b>Clary platforma backup</b> — ${targetDay}\n\n` +
      `Klinikalar: <b>${totals.clinics}</b> (faol: ${totals.active_clinics})\n` +
      `Tushum: <b>${fmtUzs(totals.revenue_uzs)}</b> so‘m\n` +
      (totals.refunds_uzs > 0 ? `Vozvrat: ${fmtUzs(totals.refunds_uzs)} so‘m\n` : '') +
      (totals.meds_uzs > 0 ? `Dorixona: ${fmtUzs(totals.meds_uzs)} so‘m\n` : '') +
      `Tranzaksiya: <b>${totals.tx_count}</b> · Yangi bemor: <b>${totals.new_patients}</b>`;

    await this.callTelegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: caption,
      parse_mode: 'HTML',
    }).catch((e) => this.log.warn(`backup caption failed: ${(e as Error).message}`));

    let sent = 0;
    for (const f of files) {
      try {
        await this.sendDocumentBuffer(token, Number(chatId), f.filename, f.content);
        sent += 1;
      } catch (e) {
        this.log.warn(`backup file ${f.filename} failed: ${(e as Error).message}`);
      }
    }

    // backup_runs — "backup tushdimi?" degan savolga javob beradigan yagona joy.
    await this.supabase
      .admin()
      .from('backup_runs')
      .insert({
        kind: 'platform_telegram',
        status: sent === files.length ? 'success' : 'partial',
        completed_at: new Date().toISOString(),
        summary: { ...totals, files: files.length, sent },
        duration_ms: Date.now() - started,
      } as never)
      .then(() => {});

    return { ok: sent > 0, day: targetDay, files: sent };
  }

  @Cron('20 2 * * *', { name: 'platform-backup', timeZone: TZ })
  async platformBackupCron(): Promise<void> {
    await this.sendPlatformBackup().catch((e) =>
      this.log.warn(`platform backup cron failed: ${(e as Error).message}`),
    );
  }

  // ── E2: API xato digest — egaga (leads bot orqali) kunlik hisobot ─────────
  // api_error_log'dan oxirgi 24 soat xatolarini jamlab yuboradi va 14 kundan
  // eski yozuvlarni tozalaydi. "Jim singan" endpointlar shu yerda ko'rinadi.
  @Cron('50 23 * * *', { timeZone: TZ })
  async apiErrorDigestCron(): Promise<void> {
    const token = process.env.TELEGRAM_LEADS_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_LEADS_CHAT_ID;
    if (!token || !chatId) return;

    const admin = this.supabase.admin();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from('api_error_log')
      .select('status, code, method, path')
      .gte('occurred_at', since)
      .limit(2000);
    const rows = (data ?? []) as Array<{
      status: number;
      code: string | null;
      method: string | null;
      path: string | null;
    }>;

    let text: string;
    if (rows.length === 0) {
      text = '✅ <b>API salomatlik</b> — oxirgi 24 soatda muhim xato yo‘q';
    } else {
      // Endpoint bo'yicha guruhlash (query stringsiz)
      const byKey = new Map<string, number>();
      let count5xx = 0;
      for (const r of rows) {
        if (r.status >= 500) count5xx += 1;
        const cleanPath = (r.path ?? '').split('?')[0];
        const key = `${r.status} ${r.method ?? ''} ${cleanPath}`;
        byKey.set(key, (byKey.get(key) ?? 0) + 1);
      }
      const top = [...byKey.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, n]) => `  ${n}× ${k}`)
        .join('\n');
      text =
        `⚠️ <b>API xato digest</b> — oxirgi 24 soat\n` +
        `Jami: <b>${rows.length}</b> ta (shundan 5xx: <b>${count5xx}</b>)\n\n` +
        `TOP endpointlar:\n${top}`;
    }

    await this.callTelegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }).catch((e) => this.log.warn(`error digest send failed: ${(e as Error).message}`));

    // Retensiya: 14 kundan eski yozuvlarni tozalash
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    await admin.from('api_error_log').delete().lt('occurred_at', cutoff);
  }

  @Cron('55 23 * * *', { timeZone: TZ })
  async dailyDigestCron(): Promise<void> {
    const { data } = await this.supabase
      .admin()
      .from('telegram_report_bots')
      .select('clinic_id')
      .eq('is_active', true);
    const clinicIds = ((data ?? []) as Array<{ clinic_id: string }>).map((r) => r.clinic_id);
    const day = todayTashkent();
    this.log.log(`Kunlik digest: ${clinicIds.length} klinika`);

    for (const clinicId of clinicIds) {
      try {
        const target = await this.getActiveBotWithChats(clinicId);
        if (!target) continue;
        const digest = await this.buildDailyDigest(clinicId, day);
        const files = await this.buildBackupCsvs(clinicId, day);
        for (const chatId of target.chatIds) {
          await this.callTelegramApi(target.bot.bot_token, 'sendMessage', {
            chat_id: chatId,
            text: digest,
            parse_mode: 'HTML',
          }).catch(() => undefined);
          for (const f of files) {
            await this.sendDocumentBuffer(
              target.bot.bot_token,
              chatId,
              f.filename,
              f.content,
              `📦 Kunlik backup — ${day}`,
            ).catch((e) => this.log.warn(`backup send failed: ${(e as Error).message}`));
          }
        }
      } catch (e) {
        this.log.warn(`digest failed (clinic ${clinicId}): ${(e as Error).message}`);
      }
    }
  }
}

// ============================================================================
// Controllers
// ============================================================================
@ApiTags('telegram-reports')
@Controller('telegram-reports')
class TelegramReportsController {
  constructor(private readonly svc: TelegramReportsService) {}

  // --- Klinika (clinic app) ---
  @Get('bot')
  getBot(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.getReportBot(u.clinicId);
  }

  @Post('bot/register')
  @Audit({ action: 'telegram.report_bot_registered', resourceType: 'telegram_report_bots' })
  register(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.registerReportBot(u.clinicId, RegisterReportBotSchema.parse(body));
  }

  @Post('bot/unregister')
  @Audit({ action: 'telegram.report_bot_unregistered', resourceType: 'telegram_report_bots' })
  unregister(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.unregisterReportBot(u.clinicId);
  }

  @Post('bot/bind-code')
  bindCode(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.newBindCode(u.clinicId);
  }

  @Get('chats')
  chats(@CurrentUser() u: { clinicId: string | null }) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.listOwnerChats(u.clinicId);
  }

  @Delete('chats/:id')
  removeChat(
    @CurrentUser() u: { clinicId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.removeOwnerChat(u.clinicId, id);
  }

  @Patch('events')
  updateEvents(@CurrentUser() u: { clinicId: string | null }, @Body() body: unknown) {
    if (!u.clinicId) throw new ForbiddenException();
    return this.svc.updateEvents(u.clinicId, EventsSchema.parse(body));
  }

  // --- Webhooks (public, secret header bilan) ---
  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 120 } })
  @Post('central-webhook')
  centralWebhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string,
    @Body() body: unknown,
  ) {
    return this.svc.handleCentralWebhook(secret, body);
  }

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 120 } })
  @Post('webhook/:botId')
  reportWebhook(
    @Param('botId') botId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string,
    @Body() body: unknown,
  ) {
    return this.svc.handleReportWebhook(botId, secret, body);
  }
}

@ApiTags('admin-telegram-reports')
@Controller('admin/telegram-reports')
@UseGuards(SuperAdminGuard)
@Throttle({ default: { ttl: 60_000, limit: 300 } })
class TelegramReportsAdminController {
  constructor(private readonly svc: TelegramReportsService) {}

  @Get('requests')
  requests(@Body() _b: unknown) {
    return this.svc.listRequests();
  }

  @Post('requests/:id/approve')
  approve(
    @CurrentUser() u: { userId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { clinic_id?: string },
  ) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.reviewRequest(id, u.userId, 'approve', body?.clinic_id);
  }

  @Post('requests/:id/reject')
  reject(@CurrentUser() u: { userId: string | null }, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.userId) throw new ForbiddenException();
    return this.svc.reviewRequest(id, u.userId, 'reject');
  }

  /** Markaziy bot webhook'ini o'rnatish — env qo'yilgach bir marta chaqiriladi. */
  @Post('central/setup')
  setupCentral() {
    return this.svc.setupCentralBot();
  }

  /**
   * Platforma backup'ini QO'LDA yuborish — 02:20 ni kutmasdan tekshirish uchun.
   * `?day=YYYY-MM-DD` bilan istalgan kunni qayta yuborish mumkin (tunda API
   * o'chib qolgan bo'lsa backup yo'qolmasin).
   */
  @Post('backup/send')
  sendBackup(@Query('day') day?: string) {
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))
      throw new BadRequestException('day formati: YYYY-MM-DD');
    return this.svc.sendPlatformBackup(day);
  }
}

@Module({
  imports: [CashierModule],
  controllers: [TelegramReportsController, TelegramReportsAdminController],
  providers: [TelegramReportsService, SupabaseService],
  exports: [TelegramReportsService],
})
export class TelegramReportsModule {}
