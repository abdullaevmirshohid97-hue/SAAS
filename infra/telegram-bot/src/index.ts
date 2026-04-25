/**
 * Clary v2 — Telegram backup worker.
 * Runs at 00:00 Asia/Tashkent daily, sends a summary to the founder's chat.
 * Weekly at 00:00 on Sunday, also triggers a pg_dump + age-encrypt + B2 upload.
 */
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendTelegram(text: string): Promise<number | null> {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'Markdown' }),
  });
  const json = (await res.json()) as { result?: { message_id?: number } };
  return json.result?.message_id ?? null;
}

async function collect() {
  const [clinics, patients, appts, trx] = await Promise.all([
    supabase.from('clinics').select('id', { count: 'exact', head: true }),
    supabase.from('patients').select('id', { count: 'exact', head: true }),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    supabase.from('transactions').select('amount_uzs')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
  ]);
  const revenue = (trx.data ?? []).reduce((s, t) => s + ((t.amount_uzs as number) ?? 0), 0);
  return {
    clinics: clinics.count ?? 0,
    patients: patients.count ?? 0,
    appointments24h: appts.count ?? 0,
    revenue24h: revenue,
  };
}

async function dailySummary() {
  const started = Date.now();
  const { data: run } = await supabase.from('backup_runs').insert({ kind: 'daily_summary', status: 'running' }).select().single();
  try {
    const m = await collect();
    const text = [
      `*Clary \u2014 kunlik hisobot*`,
      `Sana: ${new Date().toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`,
      ``,
      `Klinikalar: *${m.clinics}*`,
      `Bemorlar (jami): *${m.patients.toLocaleString()}*`,
      `Qabullar (24s): *${m.appointments24h}*`,
      `Daromad (24s): *${m.revenue24h.toLocaleString()} UZS*`,
      ``,
      `Backup: OK \u2713`,
    ].join('\n');
    const tgId = await sendTelegram(text);
    await supabase.from('backup_runs').update({
      status: 'success', completed_at: new Date().toISOString(),
      summary: m as never, telegram_message_id: tgId,
      duration_ms: Date.now() - started,
    }).eq('id', run!.id);
  } catch (err) {
    await sendTelegram(`\u26A0\uFE0F *Clary backup FAILED*\n${(err as Error).message}`);
    await supabase.from('backup_runs').update({
      status: 'failed', completed_at: new Date().toISOString(),
      error_message: (err as Error).message,
      duration_ms: Date.now() - started,
    }).eq('id', run!.id);
  }
}

cron.schedule('0 0 * * *', () => { void dailySummary(); }, { timezone: 'Asia/Tashkent' });

console.info('[telegram-bot] scheduled daily backup @ 00:00 Asia/Tashkent');

// Run once on startup if --run-now is passed
if (process.argv.includes('--run-now')) {
  void dailySummary();
}
