import {
  Body,
  Controller,
  Headers,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

import { Public } from '../../common/decorators/public.decorator';
import { SupabaseService } from '../../common/services/supabase.service';
import { PatientPortalModule } from '../patient-portal/patient-portal.module';
import { PatientPortalService } from '../patient-portal/patient-portal.service';
import { TelegramReportsModule } from '../telegram-reports/telegram-reports.module';
import { TelegramReportsService } from '../telegram-reports/telegram-reports.module';

// =============================================================================
// BEMOR BOTI (@Clary_app_bot) — chek → bot → navbat + tahlil javobi
// =============================================================================
// Klinika boti (TELEGRAM_APP_BOT_TOKEN) bilan QAT'IY ajratilgan: alohida token,
// alohida webhook, alohida jadvallar. Sabab — klinika boti kassani boshqaradi
// (rasxot, inkasatsiya); bemor chati u yerga hech qanday yo'l bilan tushmasligi
// kerak.
//
// Ro'yxatdan o'tish faqat Telegram TASDIQLAGAN raqam bilan: qo'lda yozilgan
// raqamga ishonib bo'lmaydi — birovning tahlil javobi ketib qolishi mumkin.
// =============================================================================

const TZ = 'Asia/Tashkent';

/** +998901234567 ko'rinishiga keltiradi; solishtirish oxirgi 9 raqam bo'yicha. */
function normalizePhone(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length >= 9) return `+998${d.slice(-9)}`;
  return `+${d}`;
}

function phoneTail(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .slice(-9);
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDayTime(iso: string): string {
  return new Date(iso).toLocaleString('uz-UZ', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type TgUser = { id: number; username?: string; first_name?: string };
type TgContact = { phone_number: string; user_id?: number };
type TgMessage = {
  chat: { id: number };
  from?: TgUser;
  text?: string;
  contact?: TgContact;
};
type TgUpdate = {
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; message?: TgMessage; data?: string };
};

type PatientLink = {
  chat_id: number;
  portal_user_id: string | null;
  phone: string;
  lab_results_enabled: boolean;
};

@Injectable()
export class TelegramPatientService implements OnModuleInit {
  private readonly log = new Logger('TelegramPatient');
  private usernameCache: string | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly portal: PatientPortalService,
    private readonly reports: TelegramReportsService,
  ) {}

  onModuleInit() {
    if (!this.token()) {
      this.log.warn('TELEGRAM_PATIENT_BOT_TOKEN sozlanmagan — bemor boti o‘chiq');
      return;
    }
    void this.ensureWebhook().catch((e) =>
      this.log.error(`webhook o‘rnatilmadi: ${(e as Error).message}`),
    );
  }

  private token(): string | null {
    const t = process.env.TELEGRAM_PATIENT_BOT_TOKEN;
    return t && t.trim() && !/^<.*>$/.test(t.trim()) ? t.trim() : null;
  }

  /** Webhook maxfiy tokeni — token'dan hosil qilinadi, alohida env kerak emas. */
  private secret(): string {
    return createHash('sha256')
      .update(`patient:${this.token() ?? 'none'}`)
      .digest('hex')
      .slice(0, 32);
  }

  private async api(
    method: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    const token = this.token();
    if (!token) return { ok: false, description: 'token yo‘q' };
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  }

  private async send(chatId: number, text: string, replyMarkup?: unknown) {
    const r = await this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!r.ok) this.log.warn(`sendMessage: ${r.description ?? 'xato'}`);
    return r;
  }

  /** PDF yuborish — multipart (Buffer'dan). */
  private async sendPdf(chatId: number, filename: string, content: Buffer, caption: string) {
    const token = this.token();
    if (!token) return { ok: false };
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption.slice(0, 1000));
    form.append('parse_mode', 'HTML');
    form.append(
      'document',
      new Blob([new Uint8Array(content)], { type: 'application/pdf' }),
      filename,
    );
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!body.ok) this.log.warn(`sendDocument: ${body.description ?? 'xato'}`);
    return body;
  }

  async botUsername(): Promise<string | null> {
    if (this.usernameCache) return this.usernameCache;
    if (!this.token()) return null;
    const me = await this.api('getMe', {});
    this.usernameCache = me.ok ? ((me.result as { username?: string })?.username ?? null) : null;
    return this.usernameCache;
  }

  private async ensureWebhook() {
    // Nom va default butun repoda bir xil: API_PUBLIC_URL (.env.example:148),
    // telegram-reports moduli ham aynan shuni ishlatadi. Ilgari bu yerda
    // boshqa nom (PUBLIC_API_URL) va defaultsiz tekshiruv turgani uchun
    // webhook o'rnatilmay qolgandi.
    const base = process.env.API_PUBLIC_URL ?? 'https://api.clary.uz';
    const url = `${base.replace(/\/$/, '')}/api/v1/telegram-patient/webhook`;
    const r = await this.api('setWebhook', {
      url,
      secret_token: this.secret(),
      allowed_updates: ['message', 'callback_query'],
    });
    const username = await this.botUsername();
    this.log.log(
      r.ok
        ? `bemor boti tayyor: @${username ?? '?'} → ${url}`
        : `webhook xato: ${r.description ?? '?'}`,
    );
    await this.api('setMyCommands', {
      commands: [
        { command: 'start', description: 'Boshlash' },
        { command: 'navbat', description: 'Online navbat olish' },
        { command: 'tahlillar', description: 'Tahlil javoblarim' },
        { command: 'sozlamalar', description: 'Sozlamalar' },
      ],
    });
  }

  // ==========================================================================
  // Webhook
  // ==========================================================================
  async handleWebhook(secret: string, body: unknown) {
    if (!this.token() || secret !== this.secret()) return { ok: true };
    const update = body as TgUpdate;
    try {
      if (update.callback_query) await this.onCallback(update.callback_query);
      else if (update.message) await this.onMessage(update.message);
    } catch (e) {
      this.log.error(`update xato: ${(e as Error).message}`);
    }
    return { ok: true };
  }

  private async link(chatId: number): Promise<PatientLink | null> {
    const { data } = await this.supabase
      .admin()
      .from('telegram_patient_links')
      .select('chat_id, portal_user_id, phone, lab_results_enabled')
      .eq('chat_id', chatId)
      .eq('is_active', true)
      .maybeSingle();
    return (data as PatientLink | null) ?? null;
  }

  private sharePhoneKeyboard() {
    return {
      keyboard: [[{ text: '📱 Raqamimni ulashish', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  }

  private mainMenu() {
    return {
      keyboard: [
        [{ text: '🩺 Online navbat' }, { text: '🧪 Tahlil javoblarim' }],
        [{ text: '🏥 Klinikalarim' }, { text: '⚙️ Sozlamalar' }],
      ],
      resize_keyboard: true,
    };
  }

  private async onMessage(msg: TgMessage) {
    const chatId = msg.chat.id;
    const text = (msg.text ?? '').trim();

    // 1) Kontakt ulashildi — ro'yxatdan o'tish shu yerda yakunlanadi.
    if (msg.contact) return this.onContact(msg);

    // 2) /start [payload]
    if (text.startsWith('/start')) {
      const payload = text.slice(6).trim();
      if (payload) await this.rememberPendingStart(chatId, payload);
      const existing = await this.link(chatId);
      if (!existing) {
        return this.send(
          chatId,
          '👋 <b>Clary</b> — bemorlar uchun bot.\n\n' +
            'Bu yerda siz:\n' +
            '• online navbat olasiz\n' +
            '• tahlil javoblaringizni PDF holida olasiz\n' +
            '• davolanayotgan klinikangiz bilan bog‘lanasiz\n\n' +
            'Boshlash uchun telefon raqamingizni ulashing — javoblaringiz ayni shu ' +
            'raqamga bog‘lanadi.',
          this.sharePhoneKeyboard(),
        );
      }
      if (payload) await this.bindFromPayload(chatId, payload);
      return this.send(chatId, 'Xush kelibsiz! Kerakli bo‘limni tanlang:', this.mainMenu());
    }

    const lnk = await this.link(chatId);
    if (!lnk) {
      return this.send(chatId, 'Avval telefon raqamingizni ulashing.', this.sharePhoneKeyboard());
    }

    if (text === '🩺 Online navbat' || text === '/navbat') return this.showClinicsForQueue(chatId);
    if (text === '🧪 Tahlil javoblarim' || text === '/tahlillar')
      return this.showLabOrders(chatId, lnk);
    if (text === '🏥 Klinikalarim') return this.showClinics(chatId);
    if (text === '⚙️ Sozlamalar' || text === '/sozlamalar') return this.showSettings(chatId, lnk);

    return this.send(chatId, 'Kerakli bo‘limni tanlang:', this.mainMenu());
  }

  /**
   * /start payload'ini vaqtincha saqlaymiz: foydalanuvchi avval raqam ulashadi,
   * bog'lash esa undan keyin bo'ladi. Alohida jadval qurmaslik uchun link
   * yaratilgunga qadar xotirada turadi (jarayon qayta ishga tushsa yo'qoladi —
   * bunda bemor chekdagi havolani qayta bosadi, zarari yo'q).
   */
  private pendingStart = new Map<number, string>();

  private async rememberPendingStart(chatId: number, payload: string) {
    this.pendingStart.set(chatId, payload);
  }

  private async onContact(msg: TgMessage) {
    const chatId = msg.chat.id;
    const contact = msg.contact!;
    // XAVFSIZLIK: Telegram'da BOShQA odamning kontaktini ham yuborish mumkin.
    // Faqat o'z raqami qabul qilinadi, aks holda birovning tibbiy natijasi
    // begona chatga ulanib qolardi.
    if (!contact.user_id || contact.user_id !== msg.from?.id) {
      return this.send(
        chatId,
        '⚠️ Faqat <b>o‘z</b> raqamingizni ulashing — pastdagi tugmadan foydalaning.',
        this.sharePhoneKeyboard(),
      );
    }

    const phone = normalizePhone(contact.phone_number);
    const admin = this.supabase.admin();

    // portal_users — bemor portali akkaunti (SMS OTP bilan ham shu ishlatiladi).
    let portalUserId: string | null = null;
    const { data: pu } = await admin
      .from('portal_users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    if (pu) {
      portalUserId = (pu as { id: string }).id;
    } else {
      const { data: created } = await admin
        .from('portal_users')
        .insert({ phone, full_name: msg.from?.first_name ?? null })
        .select('id')
        .maybeSingle();
      portalUserId = (created as { id: string } | null)?.id ?? null;
    }

    await admin.from('telegram_patient_links').upsert(
      {
        chat_id: chatId,
        portal_user_id: portalUserId,
        phone,
        username: msg.from?.username ?? null,
        first_name: msg.from?.first_name ?? null,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' },
    );

    await this.send(chatId, `✅ Raqam tasdiqlandi: <b>${escapeHtml(phone)}</b>`, this.mainMenu());

    // Chek havolasidan kelgan bo'lsa — klinikaga bog'laymiz.
    const payload = this.pendingStart.get(chatId);
    if (payload) {
      this.pendingStart.delete(chatId);
      await this.bindFromPayload(chatId, payload);
    } else {
      // Havolasiz kelgan bo'lsa — raqam bo'yicha topilgan klinikalarga bog'laymiz.
      await this.bindByPhone(chatId, phone);
    }
    return this.showClinics(chatId);
  }

  /**
   * Chek deep-link: `t_<transactions.public_token>`. Chek qaysi klinikada
   * berilgan bo'lsa, bemor o'sha klinikaga bog'lanadi.
   */
  private async bindFromPayload(chatId: number, payload: string) {
    if (!payload.startsWith('t_')) return;
    const token = payload.slice(2);
    if (!/^[0-9a-f-]{36}$/i.test(token)) return;
    const { data } = await this.supabase
      .admin()
      .from('transactions')
      .select('clinic_id, patient_id')
      .eq('public_token', token)
      .maybeSingle();
    const tx = data as { clinic_id: string; patient_id: string | null } | null;
    if (!tx) return;
    await this.supabase
      .admin()
      .from('telegram_patient_clinics')
      .upsert(
        { chat_id: chatId, clinic_id: tx.clinic_id, patient_id: tx.patient_id },
        { onConflict: 'chat_id,clinic_id' },
      );
  }

  /** Raqam bo'yicha bemor kartasi bor klinikalarga bog'lash. */
  private async bindByPhone(chatId: number, phone: string) {
    const tail = phoneTail(phone);
    if (tail.length < 9) return;
    const { data } = await this.supabase
      .admin()
      .from('patients')
      .select('id, clinic_id, phone')
      .ilike('phone', `%${tail}`)
      .limit(20);
    const rows = (data ?? []) as Array<{ id: string; clinic_id: string; phone: string | null }>;
    const seen = new Set<string>();
    for (const p of rows) {
      if (phoneTail(p.phone) !== tail || seen.has(p.clinic_id)) continue;
      seen.add(p.clinic_id);
      await this.supabase
        .admin()
        .from('telegram_patient_clinics')
        .upsert(
          { chat_id: chatId, clinic_id: p.clinic_id, patient_id: p.id },
          { onConflict: 'chat_id,clinic_id' },
        );
    }
  }

  private async myClinics(chatId: number) {
    const { data } = await this.supabase
      .admin()
      .from('telegram_patient_clinics')
      .select('clinic_id, patient_id, clinic:clinics(id, name, slug)')
      .eq('chat_id', chatId);
    return (data ?? []) as unknown as Array<{
      clinic_id: string;
      patient_id: string | null;
      clinic: { id: string; name: string; slug: string } | null;
    }>;
  }

  private async showClinics(chatId: number) {
    const rows = await this.myClinics(chatId);
    if (rows.length === 0) {
      return this.send(
        chatId,
        'Hozircha birorta klinikaga bog‘lanmagansiz.\n\n' +
          'Klinikada olgan <b>chekingiz tagidagi havolani</b> bosing yoki QR kodni ' +
          'skanerlang — o‘sha klinika avtomatik qo‘shiladi.',
        this.mainMenu(),
      );
    }
    const list = rows
      .map((r, i) => `${i + 1}. <b>${escapeHtml(r.clinic?.name ?? '—')}</b>`)
      .join('\n');
    return this.send(chatId, `🏥 <b>Sizning klinikalaringiz</b>\n\n${list}`, this.mainMenu());
  }

  // ── Online navbat ─────────────────────────────────────────────────────────
  private async showClinicsForQueue(chatId: number) {
    const rows = await this.myClinics(chatId);
    if (rows.length === 0) return this.showClinics(chatId);
    return this.send(chatId, 'Qaysi klinikaga navbat olasiz?', {
      inline_keyboard: rows
        .filter((r) => r.clinic?.slug)
        .map((r) => [{ text: r.clinic!.name, callback_data: `q:${r.clinic!.slug}`.slice(0, 64) }]),
    });
  }

  private async showSlots(chatId: number, slug: string) {
    const from = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    const to = new Date(Date.now() + 7 * 86400_000).toLocaleDateString('en-CA', { timeZone: TZ });
    let slots: Array<{ id: string; starts_at?: string; start_at?: string }> = [];
    try {
      const res = (await this.portal.getSlots(slug, { from, to })) as unknown;
      slots = (Array.isArray(res) ? res : ((res as { data?: unknown[] })?.data ?? [])) as Array<{
        id: string;
        starts_at?: string;
        start_at?: string;
      }>;
    } catch (e) {
      this.log.warn(`slot olishda xato: ${(e as Error).message}`);
    }
    const usable = slots.filter((s) => s.id).slice(0, 12);
    if (usable.length === 0) {
      return this.send(
        chatId,
        'Yaqin 7 kunda bo‘sh navbat topilmadi. Klinikaga qo‘ng‘iroq qilishingiz mumkin.',
        this.mainMenu(),
      );
    }
    return this.send(chatId, 'Bo‘sh vaqtni tanlang:', {
      inline_keyboard: usable.map((s) => [
        {
          text: fmtDayTime((s.starts_at ?? s.start_at)!),
          callback_data: `b:${s.id}`.slice(0, 64),
        },
      ]),
    });
  }

  private async book(chatId: number, slotId: string) {
    const lnk = await this.link(chatId);
    if (!lnk?.portal_user_id) {
      return this.send(chatId, 'Avval raqamingizni ulashing.', this.sharePhoneKeyboard());
    }
    try {
      const booking = (await this.portal.createBooking(lnk.portal_user_id, {
        slot_id: slotId,
      })) as { id?: string };
      const portalUrl = process.env.WEB_PATIENT_URL ?? 'https://patient.clary.uz';
      return this.send(
        chatId,
        '✅ <b>Navbat band qilindi!</b>' +
          (booking?.id ? `\n\n🔗 Holati: ${portalUrl}/q/${booking.id}` : ''),
        this.mainMenu(),
      );
    } catch (e) {
      return this.send(
        chatId,
        `❌ Navbat olinmadi: ${escapeHtml((e as Error).message)}`,
        this.mainMenu(),
      );
    }
  }

  // ── Tahlil javoblari ──────────────────────────────────────────────────────
  private async showLabOrders(chatId: number, lnk: PatientLink) {
    const clinics = await this.myClinics(chatId);
    const patientIds = clinics.map((c) => c.patient_id).filter((x): x is string => !!x);
    if (patientIds.length === 0) {
      return this.send(
        chatId,
        'Tahlil javoblari topilmadi. Chek havolasi orqali klinikangizga bog‘laning.',
        this.mainMenu(),
      );
    }
    const { data } = await this.supabase
      .admin()
      .from('lab_orders')
      .select('id, clinic_id, status, reported_at, created_at')
      .in('patient_id', patientIds)
      .in('status', ['reported', 'delivered'])
      .order('reported_at', { ascending: false })
      .limit(10);
    const orders = (data ?? []) as Array<{ id: string; clinic_id: string; reported_at: string }>;
    if (orders.length === 0) {
      return this.send(chatId, 'Hozircha tayyor tahlil javobi yo‘q.', this.mainMenu());
    }
    void lnk;
    return this.send(chatId, '🧪 Tayyor javoblar — yuklab olish uchun tanlang:', {
      inline_keyboard: orders.map((o) => [
        {
          text: o.reported_at ? fmtDayTime(o.reported_at) : 'Tahlil',
          callback_data: `l:${o.id}`.slice(0, 64),
        },
      ]),
    });
  }

  /**
   * Tahlil javobini PDF holida yuborish. Lab moduli natijani "reported" qilganda
   * ham shu metod chaqiriladi — bemor hech narsa bosmasdan javobni oladi.
   */
  async sendLabResult(clinicId: string, orderId: string, patientId: string | null) {
    if (!this.token() || !patientId) return;
    const admin = this.supabase.admin();

    const { data: links } = await admin
      .from('telegram_patient_clinics')
      .select('chat_id, link:telegram_patient_links(chat_id, is_active, lab_results_enabled)')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId);
    const targets = (
      (links ?? []) as unknown as Array<{
        chat_id: number;
        link: { is_active: boolean; lab_results_enabled: boolean } | null;
      }>
    )
      .filter((r) => r.link?.is_active && r.link?.lab_results_enabled)
      .map((r) => r.chat_id);
    if (targets.length === 0) return;

    const { data: c } = await admin.from('clinics').select('name').eq('id', clinicId).maybeSingle();
    const clinicName = (c as { name?: string } | null)?.name ?? 'Klinika';
    const doc = await this.reports.buildLabResultDocument(clinicId, clinicName, orderId);
    if (!doc) return;

    for (const chatId of targets) {
      // Ikki marta yubormaslik — holat qayta 'reported' bo'lsa ham.
      const { error } = await admin
        .from('telegram_lab_deliveries')
        .insert({ lab_order_id: orderId, chat_id: chatId });
      if (error) continue; // PK konflikti = allaqachon yuborilgan
      await this.sendPdf(chatId, doc.filename, doc.content, doc.caption);
    }
  }

  // ── Sozlamalar ────────────────────────────────────────────────────────────
  private async showSettings(chatId: number, lnk: PatientLink) {
    return this.send(
      chatId,
      `⚙️ <b>Sozlamalar</b>\n\nRaqam: <b>${escapeHtml(lnk.phone)}</b>\n` +
        `Tahlil javobi Telegramga: <b>${lnk.lab_results_enabled ? 'yoqilgan' : 'o‘chirilgan'}</b>`,
      {
        inline_keyboard: [
          [
            {
              text: lnk.lab_results_enabled
                ? '🔕 Tahlil javobini yubormaslik'
                : '🔔 Tahlil javobini yuborish',
              callback_data: 's:lab',
            },
          ],
        ],
      },
    );
  }

  private async onCallback(cq: NonNullable<TgUpdate['callback_query']>) {
    const chatId = cq.message?.chat.id;
    const data = cq.data ?? '';
    await this.api('answerCallbackQuery', { callback_query_id: cq.id });
    if (!chatId) return undefined;

    if (data.startsWith('q:')) return this.showSlots(chatId, data.slice(2));
    if (data.startsWith('b:')) return this.book(chatId, data.slice(2));

    if (data.startsWith('l:')) {
      const orderId = data.slice(2);
      const clinics = await this.myClinics(chatId);
      for (const c of clinics) {
        const doc = await this.reports.buildLabResultDocument(
          c.clinic_id,
          c.clinic?.name ?? 'Klinika',
          orderId,
        );
        if (doc) return this.sendPdf(chatId, doc.filename, doc.content, doc.caption);
      }
      return this.send(chatId, 'Javob topilmadi yoki hali tayyor emas.');
    }

    if (data === 's:lab') {
      const lnk = await this.link(chatId);
      if (!lnk) return;
      const next = !lnk.lab_results_enabled;
      await this.supabase
        .admin()
        .from('telegram_patient_links')
        .update({ lab_results_enabled: next })
        .eq('chat_id', chatId);
      return this.send(
        chatId,
        next
          ? '🔔 Tahlil javoblari Telegramga yuboriladi.'
          : '🔕 Tahlil javoblari Telegramga yuborilmaydi.',
        this.mainMenu(),
      );
    }
    return undefined;
  }
}

@ApiTags('telegram-patient')
@Controller({ path: 'telegram-patient', version: '1' })
class TelegramPatientController {
  constructor(private readonly svc: TelegramPatientService) {}

  @Public()
  @Throttle({ public: { ttl: 60_000, limit: 300 } })
  @Post('webhook')
  webhook(@Headers('x-telegram-bot-api-secret-token') secret: string, @Body() body: unknown) {
    return this.svc.handleWebhook(secret, body);
  }
}

@Module({
  imports: [PatientPortalModule, TelegramReportsModule],
  controllers: [TelegramPatientController],
  providers: [TelegramPatientService, SupabaseService],
  exports: [TelegramPatientService],
})
export class TelegramPatientModule {}
