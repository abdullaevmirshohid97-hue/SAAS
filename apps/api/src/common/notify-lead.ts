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
  // `??` EMAS, `||` — env o'zgaruvchisi bo'sh satr bo'lishi mumkin, u holda
  // `??` bo'sh satrni qaytarib fallback'ni o'tkazib yuborardi. Placeholder
  // qiymatlar (`<BOT_TOKEN>`) ham yaroqsiz deb hisoblanadi.
  const usable = (v: string | undefined) =>
    v && v.trim() && !/^<.*>$/.test(v.trim()) ? v.trim() : undefined;
  const token = usable(process.env.TELEGRAM_LEADS_BOT_TOKEN) ?? usable(process.env.TELEGRAM_BOT_TOKEN);
  const chatId = usable(process.env.TELEGRAM_LEADS_CHAT_ID) ?? usable(process.env.TELEGRAM_CHAT_ID);
  if (!token || !chatId) {
    // Jimgina yo'qotmaymiz — lid keldi, lekin ogohlantirish yo'li sozlanmagan.
    // Diagnostika uchun qaysi o'zgaruvchi qanday holatda ekanini yozamiz.
    const holat = (n: string) => {
      const v = process.env[n];
      return `${n}=${v === undefined ? 'YO‘Q' : v.trim() === '' ? 'BO‘SH' : usable(v) ? `bor(${v.trim().length})` : 'PLACEHOLDER'}`;
    };
    log.warn(
      `Lid keldi (${lead.source}) lekin Telegram sozlanmagan — ` +
        [
          holat('TELEGRAM_LEADS_BOT_TOKEN'),
          holat('TELEGRAM_LEADS_CHAT_ID'),
          holat('TELEGRAM_BOT_TOKEN'),
          holat('TELEGRAM_CHAT_ID'),
        ].join(', '),
    );
    return;
  }

  // parse_mode ISHLATILMAYDI (quyida ham). Markdown'da manba nomlaridagi
  // pastki chiziq (demo_form, exit_intent) yopilmagan kursiv entity hosil
  // qilib, Telegram BUTUN xabarni rad etardi ("can't parse entities").
  // Lid matni foydalanuvchidan keladi — escape qilish ishonchsiz, oddiy
  // matn esa hech qachon yiqilmaydi.
  const lines = [
    `🟢 Yangi ${lead.kind ?? 'lid'}`,
    lead.name ? `Ism: ${lead.name}` : null,
    lead.phone ? `Telefon: ${lead.phone}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    lead.clinicName ? `Klinika: ${lead.clinicName}` : null,
    lead.message ? `Xabar: ${lead.message}` : null,
    `Manba: ${lead.source}`,
  ].filter(Boolean);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') }),
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
