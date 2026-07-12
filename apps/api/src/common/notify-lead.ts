/**
 * Yangi lid haqida Telegram'ga xabar yuboradi (best-effort — xato yuborishni
 * bloklamaydi). TELEGRAM_LEADS_BOT_TOKEN + TELEGRAM_LEADS_CHAT_ID env kerak.
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
  const token = process.env.TELEGRAM_LEADS_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_LEADS_CHAT_ID;
  if (!token || !chatId) return;

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
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown' }),
    });
  } catch {
    /* ogohlantirish best-effort — lidni bloklamaydi */
  }
}
