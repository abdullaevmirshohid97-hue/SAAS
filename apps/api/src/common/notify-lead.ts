import { Logger } from '@nestjs/common';

const log = new Logger('NotifyLead');

/**
 * Yangi lid haqida Telegram'ga xabar yuboradi (best-effort — xato yuborishni
 * bloklamaydi). TELEGRAM_LEADS_BOT_TOKEN + TELEGRAM_LEADS_CHAT_ID env kerak;
 * ular bo'lmasa umumiy TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID ishlatiladi
 * (telegram-reports moduli bilan bir xil fallback).
 * Barcha lid manbalari (contact/demo/instant demo/site) shu orqali xabar beradi.
 */
export async function notifyLeadTelegram(lead: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  clinicName?: string | null;
  message?: string | null;
  source: string;
  kind?: string;
}): Promise<void> {
  const token = process.env.TELEGRAM_LEADS_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_LEADS_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    // Jimgina yo'qotmaymiz — lid keldi, lekin ogohlantirish yo'li sozlanmagan.
    log.warn(
      `Lid keldi (${lead.source}) lekin Telegram sozlanmagan: TELEGRAM_LEADS_BOT_TOKEN/CHAT_ID (yoki TELEGRAM_BOT_TOKEN/CHAT_ID) yo'q`,
    );
    return;
  }

  const lines = [
    `🟢 *Yangi ${lead.kind ?? 'lid'}*`,
    lead.name ? `*Ism:* ${lead.name}` : null,
    lead.phone ? `*Telefon:* ${lead.phone}` : null,
    lead.email ? `*Email:* ${lead.email}` : null,
    lead.clinicName ? `*Klinika:* ${lead.clinicName}` : null,
    lead.message ? `*Xabar:* ${lead.message}` : null,
    `*Manba:* ${lead.source}`,
  ].filter(Boolean);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown' }),
    });
    // Telegram xato chat_id/token'da ham 200 qaytaradi — ok:false ni tekshiramiz,
    // aks holda lid jimgina yo'qoladi.
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!body.ok) {
      log.error(`Lid Telegram'ga yuborilmadi (${lead.source}): ${body.description ?? 'ok:false'}`);
    }
  } catch (e) {
    /* ogohlantirish best-effort — lidni bloklamaydi, lekin izsiz qolmaydi */
    log.error(`Lid Telegram xatosi (${lead.source}): ${(e as Error).message}`);
  }
}
