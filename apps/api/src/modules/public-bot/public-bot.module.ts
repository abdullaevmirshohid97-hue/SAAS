import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Logger,
  Module,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

import { SupabaseService } from '../../common/services/supabase.service';
import { Public } from '../../common/decorators/public.decorator';

// ============================================================================
// Umumiy Clary Telegram bot — bemorlar uchun
//
// Oqim:
//   /start  → "Klinikangiz nomini yozing"
//   <text>  → klinikalar qidiruvi (top 5)
//   tugma   → klinika tanlandi → "Username yuboring"
//   <text>  → username saqlandi → "Parol yuboring"
//   <text>  → parol verify → magic link yuboriladi
//
// Token: process.env.CLARY_PUBLIC_BOT_TOKEN
// Webhook secret: process.env.CLARY_PUBLIC_BOT_WEBHOOK_SECRET
// App URL: process.env.CLARY_APP_URL (default https://app.clary.uz)
// ============================================================================

const TG_API = 'https://api.telegram.org';
const MAX_ATTEMPTS = 5;
const BAN_MINUTES = 15;
const MAGIC_TTL_SECONDS = 5 * 60;

type SessionState =
  | 'idle'
  | 'awaiting_clinic_choice'
  | 'awaiting_username'
  | 'awaiting_password'
  | 'authenticated'
  | 'banned';

type Session = {
  telegram_chat_id: number;
  patient_login_id: string | null;
  clinic_id: string | null;
  state: SessionState;
  search_query: string | null;
  selected_clinic_id: string | null;
  pending_username: string | null;
  attempt_count: number;
  banned_until: string | null;
};

@Injectable()
export class PublicBotService {
  private readonly log = new Logger(PublicBotService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get token(): string | null {
    return process.env.CLARY_PUBLIC_BOT_TOKEN ?? null;
  }

  private get appUrl(): string {
    return process.env.CLARY_APP_URL ?? 'https://app.clary.uz';
  }

  // -- Telegram API helpers ---------------------------------------------------
  private async tg(method: string, body: Record<string, unknown>): Promise<unknown> {
    const token = this.token;
    if (!token) {
      this.log.warn('CLARY_PUBLIC_BOT_TOKEN o\'rnatilmagan');
      return null;
    }
    try {
      const res = await fetch(`${TG_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
      if (!json.ok) this.log.warn(`Telegram ${method}: ${json.description}`);
      return json.result;
    } catch (e) {
      this.log.warn(`Telegram ${method} xato: ${(e as Error).message}`);
      return null;
    }
  }

  private async sendMessage(chatId: number, text: string, opts: Record<string, unknown> = {}): Promise<void> {
    await this.tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...opts });
  }

  // -- Session helpers --------------------------------------------------------
  private async getSession(chatId: number): Promise<Session> {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('public_bot_sessions')
      .select('*')
      .eq('telegram_chat_id', chatId)
      .maybeSingle();
    if (data) return data as Session;
    const fresh: Session = {
      telegram_chat_id: chatId,
      patient_login_id: null,
      clinic_id: null,
      state: 'idle',
      search_query: null,
      selected_clinic_id: null,
      pending_username: null,
      attempt_count: 0,
      banned_until: null,
    };
    await admin.from('public_bot_sessions').insert({
      telegram_chat_id: chatId,
      state: 'idle',
    });
    return fresh;
  }

  private async updateSession(chatId: number, patch: Partial<Session>): Promise<void> {
    await this.supabase
      .admin()
      .from('public_bot_sessions')
      .update({ ...patch, last_activity_at: new Date().toISOString() })
      .eq('telegram_chat_id', chatId);
  }

  // -- Webhook handler --------------------------------------------------------
  async handleUpdate(update: Record<string, unknown>): Promise<void> {
    // Callback (inline keyboard tugma bosildi)
    const cb = update.callback_query as
      | { id: string; from: { id: number }; data: string; message?: { chat?: { id: number } } }
      | undefined;
    if (cb && cb.message?.chat?.id != null) {
      await this.tg('answerCallbackQuery', { callback_query_id: cb.id });
      await this.handleCallback(cb.message.chat.id, cb.data ?? '');
      return;
    }

    // Oddiy xabar
    const msg = update.message as
      | { chat: { id: number }; text?: string; from?: { id: number; first_name?: string } }
      | undefined;
    if (!msg || !msg.chat?.id) return;
    const chatId = msg.chat.id;
    const text = (msg.text ?? '').trim();

    if (text === '/start') {
      // Sessiyani tozalash
      await this.supabase.admin().from('public_bot_sessions').delete().eq('telegram_chat_id', chatId);
      await this.getSession(chatId);
      await this.sendMessage(
        chatId,
        '👋 <b>Clary\'ga xush kelibsiz!</b>\n\nKlinikangiz nomini yozing, men sizga klinikalar ro\'yxatidan tanlash imkonini beraman.',
      );
      return;
    }

    if (text === '/logout' || text === '/cancel') {
      await this.supabase.admin().from('public_bot_sessions').delete().eq('telegram_chat_id', chatId);
      await this.sendMessage(chatId, 'Sessiya tozalandi. Boshlash uchun /start yuboring.');
      return;
    }

    const sess = await this.getSession(chatId);

    // Ban check
    if (sess.state === 'banned' && sess.banned_until) {
      const banUntil = new Date(sess.banned_until);
      if (banUntil > new Date()) {
        const mins = Math.ceil((banUntil.getTime() - Date.now()) / 60_000);
        await this.sendMessage(chatId, `⛔ Juda ko\'p urinish. ${mins} daqiqadan keyin urinib ko\'ring.`);
        return;
      }
      // Ban tugagan — qayta tiklash
      await this.updateSession(chatId, { state: 'idle', attempt_count: 0, banned_until: null });
      sess.state = 'idle';
    }

    if (sess.state === 'idle' || sess.state === 'awaiting_clinic_choice') {
      await this.searchClinics(chatId, text);
      return;
    }

    if (sess.state === 'awaiting_username') {
      if (text.length < 2 || text.length > 60) {
        await this.sendMessage(chatId, 'Username 2 dan 60 belgigacha bo\'lishi kerak.');
        return;
      }
      await this.updateSession(chatId, { pending_username: text, state: 'awaiting_password' });
      await this.sendMessage(chatId, '🔑 Endi parolingizni yuboring.\n\n<i>Maslahat: yuborgandan keyin xabarni o\'chirib qo\'ying.</i>');
      return;
    }

    if (sess.state === 'awaiting_password') {
      await this.verifyAndIssueLink(chatId, sess, text);
      return;
    }

    if (sess.state === 'authenticated') {
      await this.sendMessage(
        chatId,
        'Siz allaqachon tizimga kirgansiz. Yangi sessiya uchun /logout, keyin /start yuboring.',
      );
      return;
    }
  }

  // -- Clinic search ----------------------------------------------------------
  private async searchClinics(chatId: number, query: string): Promise<void> {
    if (query.length < 2) {
      await this.sendMessage(chatId, 'Iltimos, klinika nomidan kamida 2 ta harf yozing.');
      return;
    }
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('clinics')
      .select('id, name')
      .ilike('name', `%${query.replace(/[%,]/g, ' ')}%`)
      .is('deleted_at', null)
      .limit(5);
    const list = (data ?? []) as Array<{ id: string; name: string }>;
    if (list.length === 0) {
      await this.sendMessage(chatId, `❌ "${query}" bo\'yicha klinika topilmadi. Boshqa nom bilan urinib ko\'ring.`);
      return;
    }
    await this.updateSession(chatId, {
      state: 'awaiting_clinic_choice',
      search_query: query,
    });
    const buttons = list.map((c) => [{ text: c.name, callback_data: `clinic:${c.id}` }]);
    await this.sendMessage(chatId, '🏥 <b>Quyidagi klinikalardan birini tanlang:</b>', {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // -- Callback (clinic tanlandi) ---------------------------------------------
  private async handleCallback(chatId: number, data: string): Promise<void> {
    if (data.startsWith('clinic:')) {
      const clinicId = data.slice(7);
      await this.updateSession(chatId, {
        selected_clinic_id: clinicId,
        state: 'awaiting_username',
        attempt_count: 0,
      });
      const { data: clinic } = await this.supabase
        .admin()
        .from('clinics')
        .select('name')
        .eq('id', clinicId)
        .maybeSingle();
      const name = (clinic as { name: string } | null)?.name ?? '';
      await this.sendMessage(
        chatId,
        `✅ Tanlandi: <b>${name}</b>\n\nEndi <b>username</b>ingizni yuboring (klinikangizdan olingan).`,
      );
    }
  }

  // -- Login verify + magic link ----------------------------------------------
  private async verifyAndIssueLink(chatId: number, sess: Session, password: string): Promise<void> {
    if (!sess.selected_clinic_id || !sess.pending_username) {
      await this.sendMessage(chatId, 'Sessiya xato. /start dan boshlang.');
      return;
    }
    const admin = this.supabase.admin();

    const { data: login } = await admin
      .from('patient_logins')
      .select('id, patient_id, password_hash, is_active')
      .eq('clinic_id', sess.selected_clinic_id)
      .eq('username', sess.pending_username)
      .maybeSingle();
    const row = login as
      | { id: string; patient_id: string; password_hash: string; is_active: boolean }
      | null;

    let ok = false;
    if (row && row.is_active) {
      try {
        ok = await argon2.verify(row.password_hash, password);
      } catch {
        ok = false;
      }
    }

    if (!ok) {
      const attempts = sess.attempt_count + 1;
      if (attempts >= MAX_ATTEMPTS) {
        const banUntil = new Date(Date.now() + BAN_MINUTES * 60_000).toISOString();
        await this.updateSession(chatId, {
          state: 'banned',
          attempt_count: attempts,
          banned_until: banUntil,
        });
        await this.sendMessage(
          chatId,
          `⛔ Juda ko\'p noto\'g\'ri urinish. ${BAN_MINUTES} daqiqaga bloklandingiz.`,
        );
        return;
      }
      await this.updateSession(chatId, { attempt_count: attempts, state: 'awaiting_username', pending_username: null });
      await this.sendMessage(
        chatId,
        `❌ Login yoki parol noto\'g\'ri. Qolgan urinishlar: ${MAX_ATTEMPTS - attempts}\n\nUsername'ni qayta yuboring.`,
      );
      return;
    }

    // Muvaffaqiyatli login — magic link generatsiya
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + MAGIC_TTL_SECONDS * 1000).toISOString();
    await admin.from('patient_magic_tokens').insert({
      token,
      patient_login_id: row!.id,
      clinic_id: sess.selected_clinic_id,
      expires_at: expiresAt,
    });

    await admin
      .from('patient_logins')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', row!.id);

    await this.updateSession(chatId, {
      state: 'authenticated',
      patient_login_id: row!.id,
      clinic_id: sess.selected_clinic_id,
      attempt_count: 0,
      pending_username: null,
    });

    const url = `${this.appUrl}/patient-login?token=${token}`;
    await this.sendMessage(
      chatId,
      `✅ <b>Muvaffaqiyatli kirildi!</b>\n\nQuyidagi tugmani bosing va o\'z kabinetingizga o\'ting (5 daqiqa amal qiladi):`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🌐 Kabinetga kirish', url }]],
        },
      },
    );
  }

  // -- Bildirishnoma yuborish (NotificationsService dan chaqiriladi) ----------
  async sendToPatient(patientId: string, text: string): Promise<boolean> {
    const admin = this.supabase.admin();
    const { data: login } = await admin
      .from('patient_logins')
      .select('id')
      .eq('patient_id', patientId)
      .maybeSingle();
    const loginId = (login as { id: string } | null)?.id;
    if (!loginId) return false;
    const { data: sess } = await admin
      .from('public_bot_sessions')
      .select('telegram_chat_id')
      .eq('patient_login_id', loginId)
      .eq('state', 'authenticated')
      .maybeSingle();
    const chatId = (sess as { telegram_chat_id: number } | null)?.telegram_chat_id;
    if (!chatId) return false;
    await this.sendMessage(chatId, text);
    return true;
  }

  // -- Magic link consume (web tomondan chaqiriladi) --------------------------
  async consumeMagicToken(token: string): Promise<{
    patient_id: string;
    clinic_id: string;
    patient_login_id: string;
  }> {
    const admin = this.supabase.admin();
    const { data } = await admin
      .from('patient_magic_tokens')
      .select('token, patient_login_id, clinic_id, expires_at, consumed_at')
      .eq('token', token)
      .maybeSingle();
    const row = data as
      | { token: string; patient_login_id: string; clinic_id: string; expires_at: string; consumed_at: string | null }
      | null;
    if (!row) throw new BadRequestException('Token topilmadi');
    if (row.consumed_at) throw new BadRequestException('Token allaqachon ishlatilgan');
    if (new Date(row.expires_at) < new Date()) throw new BadRequestException('Token muddati o\'tgan');

    await admin
      .from('patient_magic_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('token', token);

    const { data: login } = await admin
      .from('patient_logins')
      .select('patient_id')
      .eq('id', row.patient_login_id)
      .maybeSingle();
    const patientId = (login as { patient_id: string } | null)?.patient_id;
    if (!patientId) throw new BadRequestException('Bemor topilmadi');

    return {
      patient_id: patientId,
      clinic_id: row.clinic_id,
      patient_login_id: row.patient_login_id,
    };
  }
}

@ApiTags('public-bot')
@Controller('public-bot')
class PublicBotController {
  private readonly log = new Logger(PublicBotController.name);
  constructor(private readonly svc: PublicBotService) {}

  @Public()
  @Post('webhook')
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: Record<string, unknown>,
  ) {
    const expected = process.env.CLARY_PUBLIC_BOT_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      this.log.warn('Public bot webhook: noto\'g\'ri secret');
      return { ok: false };
    }
    try {
      await this.svc.handleUpdate(update);
    } catch (e) {
      this.log.error('handleUpdate xato:', (e as Error).message);
    }
    return { ok: true };
  }

  @Public()
  @Post('magic-token/consume')
  consume(@Body() body: { token: string }) {
    return this.svc.consumeMagicToken(body?.token ?? '');
  }

  @Get('health')
  health() {
    return { ok: true, token_configured: !!process.env.CLARY_PUBLIC_BOT_TOKEN };
  }
}

@Module({
  controllers: [PublicBotController],
  providers: [PublicBotService, SupabaseService],
  exports: [PublicBotService],
})
export class PublicBotModule {}
