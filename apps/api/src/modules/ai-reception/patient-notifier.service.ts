import { Injectable, Logger } from '@nestjs/common';
import { localDateOf, localTimeOf, phoneKey, uzDateShort } from '@clary/utils';

import { SupabaseService } from '../../common/services/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramReportsService } from '../telegram-reports/telegram-reports.module';

import type { AiReceptionSettings, BookingSource, ClinicContext } from './ai-reception.types';

// =============================================================================
// Bemor va klinika egasiga xabarlar (AI qabulxona)
// =============================================================================
// - Bemor: Clary bemor boti (TELEGRAM_PATIENT_BOT_TOKEN) — raqami bog'langan
//   bo'lsa; bo'lmasa (sozlamada yoqilgan bo'lsa) SMS (Eskiz).
// - Egasi: TelegramReportsService.sendToOwners (klinika hisobot chatlari).
// Bu yerda TelegramPatientModule import QILINMAYDI (u bizni import qiladi —
// aylana bog'liqlik bo'lmasin), bot API'ga to'g'ridan-to'g'ri murojaat qilinadi.
// =============================================================================

export interface BookedInfo {
  appointment_id: string | null;
  patient_name: string;
  patient_phone: string | null;
  starts_at: string;
  doctor: { full_name: string; specialty_label: string };
  price_uzs: number | null;
}

const SOURCE_LABEL: Record<BookingSource, string> = {
  staff: 'qabulxona',
  ai_phone: 'AI telefon',
  telegram: 'Telegram bot',
  ai_chat: 'Telegram AI',
  portal: 'bemor portali',
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Lotin, emoji'siz qisqa SMS (Eskiz shablonida tasdiqlangan matnga mos bo'lsin). */
function smsWhen(iso: string): string {
  const d = localDateOf(iso);
  return `${d.slice(8, 10)}.${d.slice(5, 7)} soat ${localTimeOf(iso)}`;
}

@Injectable()
export class PatientNotifierService {
  private readonly log = new Logger('AiReceptionNotify');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
    private readonly reports: TelegramReportsService,
  ) {}

  private usernameCache: string | null = null;

  private token(): string | null {
    const t = process.env.TELEGRAM_PATIENT_BOT_TOKEN;
    return t && t.trim() && !/^<.*>$/.test(t.trim()) ? t.trim() : null;
  }

  /** Bemor botining @username'i (klinika havolasi uchun: t.me/<bot>?start=c_<slug>). */
  async botUsername(): Promise<string | null> {
    if (this.usernameCache) return this.usernameCache;
    const token = this.token();
    if (!token) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json()) as { ok: boolean; result?: { username?: string } };
      this.usernameCache = body.ok ? (body.result?.username ?? null) : null;
    } catch {
      return null;
    }
    return this.usernameCache;
  }

  /** Raqamga bog'langan faol bemor-bot chatlari. */
  async chatsForPhone(phone: string | null | undefined): Promise<number[]> {
    const key = phoneKey(phone);
    if (key.length !== 9 || !this.token()) return [];
    const { data } = await this.supabase
      .admin()
      .from('telegram_patient_links')
      .select('chat_id')
      .eq('phone', `+998${key}`)
      .eq('is_active', true);
    return ((data ?? []) as Array<{ chat_id: number }>).map((r) => r.chat_id);
  }

  async sendTelegram(chatId: number, html: string, replyMarkup?: unknown): Promise<boolean> {
    const token = this.token();
    if (!token) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
      const body = (await res.json()) as { ok: boolean; description?: string };
      if (!body.ok) this.log.warn(`telegram ${chatId}: ${body.description ?? 'xato'}`);
      return body.ok;
    } catch (e) {
      this.log.warn(`telegram ${chatId}: ${(e as Error).message}`);
      return false;
    }
  }

  async sms(clinicId: string, phone: string, text: string, key: string, templateKey: string) {
    await this.notifications.enqueue({
      clinicId,
      channel: 'sms',
      recipient: phone,
      body: text,
      templateKey,
      idempotencyKey: key,
    });
  }

  async ownerNotify(clinicId: string, html: string) {
    try {
      await this.reports.sendToOwners(clinicId, html);
    } catch (e) {
      this.log.warn(`egaga xabar: ${(e as Error).message}`);
    }
  }

  /** Navbat yozilgach: bemorga tasdiq + egaga xabar. */
  async bookingConfirmed(
    clinicId: string,
    settings: AiReceptionSettings,
    clinic: ClinicContext,
    info: BookedInfo,
    source: BookingSource,
  ) {
    const date = localDateOf(info.starts_at);
    const when = `${uzDateShort(date)} · ${localTimeOf(info.starts_at)}`;

    // Telegram bot oqimi o'zi tasdiq ko'rsatadi — takrorlamaymiz
    let delivered = false;
    if (settings.confirm_telegram && source !== 'telegram' && info.appointment_id) {
      const chats = await this.chatsForPhone(info.patient_phone);
      for (const chatId of chats) {
        const ok = await this.sendTelegram(
          chatId,
          `✅ <b>Navbatga yozildingiz</b>\n\n` +
            `🏥 ${esc(clinic.name)}\n` +
            `👨‍⚕️ ${esc(info.doctor.full_name)} — ${esc(info.doctor.specialty_label)}\n` +
            `🗓 ${esc(when)}\n` +
            `👤 ${esc(info.patient_name)}\n` +
            (clinic.address ? `📍 ${esc(clinic.address)}\n` : '') +
            `\nIltimos, 10–15 daqiqa oldin keling.`,
          {
            inline_keyboard: [
              [{ text: '❌ Bekor qilish', callback_data: `ncx:${info.appointment_id}` }],
            ],
          },
        );
        delivered = delivered || ok;
      }
    }
    if (!delivered && settings.confirm_sms && info.patient_phone && source !== 'staff') {
      await this.sms(
        clinicId,
        info.patient_phone,
        `${clinic.name}: ${info.doctor.full_name} qabuliga ${smsWhen(info.starts_at)} ga yozildingiz.` +
          (clinic.phone ? ` Tel: ${clinic.phone}` : ''),
        `booking-confirm:${info.appointment_id}`,
        'ai_booking_confirm',
      ).catch((e) => this.log.warn(`sms: ${(e as Error).message}`));
    }

    if (settings.notify_owner_telegram && source !== 'staff') {
      await this.ownerNotify(
        clinicId,
        `🤖 <b>Yangi navbat</b> (${esc(SOURCE_LABEL[source])})\n` +
          `👤 ${esc(info.patient_name)}${info.patient_phone ? ` · ${esc(info.patient_phone)}` : ''}\n` +
          `👨‍⚕️ ${esc(info.doctor.full_name)} — ${esc(info.doctor.specialty_label)}\n` +
          `🗓 ${esc(when)}`,
      );
    }
  }

  /** Qabuldan bir kun oldin eslatma. true — kamida bitta kanal orqali yuborildi. */
  async reminder(
    clinicId: string,
    settings: AiReceptionSettings,
    clinic: ClinicContext,
    appt: {
      id: string;
      scheduled_at: string;
      patient_name: string;
      patient_phone: string | null;
      doctor_name: string;
    },
  ): Promise<boolean> {
    const when = `${uzDateShort(localDateOf(appt.scheduled_at))} · ${localTimeOf(appt.scheduled_at)}`;
    let sent = false;
    for (const chatId of await this.chatsForPhone(appt.patient_phone)) {
      const ok = await this.sendTelegram(
        chatId,
        `⏰ <b>Eslatma: ertaga qabulingiz bor</b>\n\n` +
          `🏥 ${esc(clinic.name)}\n` +
          `👨‍⚕️ ${esc(appt.doctor_name)}\n` +
          `🗓 ${esc(when)}\n` +
          `👤 ${esc(appt.patient_name)}\n` +
          (clinic.address ? `📍 ${esc(clinic.address)}\n` : '') +
          `\nKela olasizmi?`,
        {
          inline_keyboard: [
            [
              { text: '✅ Kelaman', callback_data: `ncf:${appt.id}` },
              { text: '❌ Bekor qilish', callback_data: `ncx:${appt.id}` },
            ],
          ],
        },
      );
      sent = sent || ok;
    }
    if (!sent && settings.reminder_sms && appt.patient_phone) {
      try {
        await this.sms(
          clinicId,
          appt.patient_phone,
          `${clinic.name}: eslatma, ${smsWhen(appt.scheduled_at)} da ${appt.doctor_name} qabuli.` +
            (clinic.phone ? ` Bekor qilish: ${clinic.phone}` : ''),
          `booking-remind:${appt.id}`,
          'ai_booking_reminder',
        );
        sent = true;
      } catch (e) {
        this.log.warn(`eslatma sms: ${(e as Error).message}`);
      }
    }
    return sent;
  }

  /** Qayta qo'ng'iroq kerak — egasiga darhol. */
  async callbackNeeded(
    clinicId: string,
    info: { caller_phone: string | null; note: string | null; channel: string; mode: string },
  ) {
    await this.ownerNotify(
      clinicId,
      `📞 <b>Qayta qo'ng'iroq kerak</b>${info.mode === 'voicemail' ? ' (ovozli xabar)' : ''}\n` +
        `☎️ ${esc(info.caller_phone ?? 'raqam aniqlanmadi')}\n` +
        (info.note ? `📝 ${esc(info.note)}\n` : '') +
        `\nIlova → Qo'ng'iroqlar bo'limida yozuvi va matni bor.`,
    );
  }
}
