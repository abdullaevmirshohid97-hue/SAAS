/* eslint-disable no-console */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { encodeWav, wavToTelephone } from '../src/audio';
import { ClaryApi } from '../src/clary-api';
import { loadConfig } from '../src/config';
import { createStt } from '../src/providers/stt';
import { splitForSpeech, TtsEngine } from '../src/providers/tts';

// =============================================================================
// Asterisk'siz sinov: voice-agent → Clary API → AI miya → TTS
// =============================================================================
//   node dist/scripts/simulate-call.js --line goip1 --from 901234567 [--wav savol.wav]
//
// Klaviaturadan yozasiz (yoki --wav fayl STT orqali) → AI javobi matn + ovoz
// (out/sim-*.wav — 8 kHz, telefonda qanday eshitilsa shunday).
// DIQQAT: bu HAQIQIY qo'ng'iroq yozuvi (ai_calls) yaratadi va AI navbatga
// YOZADI. Klinikaning sinov shifokorida yoki ish vaqtidan tashqari sinang;
// keyin "Qo'ng'iroqlar" bo'limidan yozuvni bekor qiling. Xavfsiz sinov uchun —
// ilovadagi "Sinov suhbati" (Sozlamalar → AI qabulxona): u bazaga yozmaydi.
// =============================================================================

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cfg = loadConfig();
  const api = new ClaryApi(cfg.apiUrl, cfg.secret);
  const tts = new TtsEngine(cfg);
  const stt = createStt(cfg);
  const outDir = resolve('out');
  mkdirSync(outDir, { recursive: true });
  let n = 0;

  const say = async (text: string) => {
    console.log(`\n🤖 AI: ${text}\n`);
    try {
      const parts: Int16Array[] = [];
      for (const seg of splitForSpeech(text))
        parts.push((await tts.synthesize(seg.text, seg.lang)).pcm);
      const total = parts.reduce((s, p) => s + p.length, 0);
      const pcm = new Int16Array(total);
      let o = 0;
      for (const p of parts) {
        pcm.set(p, o);
        o += p.length;
      }
      const file = join(outDir, `sim-${String(++n).padStart(2, '0')}.wav`);
      writeFileSync(file, encodeWav(pcm));
      console.log(`   🔊 ${file}`);
    } catch (e) {
      console.log(`   (TTS xato: ${(e as Error).message})`);
    }
  };

  const start = await api.start({
    external_id: randomUUID(),
    line_key: arg('line') ?? null,
    did: arg('did') ?? null,
    caller: arg('from') ?? null,
  });
  console.log(
    `rejim: ${start.mode}, klinika: ${start.clinic_name ?? '-'}, call_id: ${start.call_id ?? '-'}`,
  );
  if (start.mode === 'reject' || !start.call_id) {
    await say(start.say ?? 'rad etildi');
    console.log('Liniya topilmadi yoki rejim o‘chiq — Sozlamalar → AI qabulxona → liniya kaliti.');
    return;
  }
  if (start.mode === 'voicemail') {
    await say(start.voicemail_prompt ?? '');
    console.log('Ovozli xabar rejimi (AI emas). Tugatildi.');
    await api.end({ call_id: start.call_id, duration_sec: 5, hangup_by: 'simulate' });
    return;
  }
  await say(start.greeting ?? '');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let first = arg('wav');
  for (;;) {
    let text: string;
    let alt: string | null = null;
    if (first && stt) {
      const wav = encodeWav(wavToTelephone(readFileSync(resolve(first))));
      const [uz, ru] = await Promise.all([stt.transcribe(wav, 'uz'), stt.transcribe(wav, 'ru')]);
      text = uz || ru;
      alt = uz && ru ? ru : null;
      console.log(`🎙 STT (uz): ${uz}\n🎙 STT (ru): ${ru}`);
      first = undefined;
    } else {
      text = (await rl.question('👤 Siz: ')).trim();
    }
    if (!text || text === 'exit' || text === 'chiqish') break;
    const r = await api.turn({ call_id: start.call_id, text, alt_text_ru: alt });
    await say(r.say);
    if (r.end) {
      console.log(`— suhbat tugadi (${r.action}${r.transfer_to ? ` → ${r.transfer_to}` : ''}) —`);
      break;
    }
  }
  rl.close();
  await api.end({ call_id: start.call_id, hangup_by: 'simulate' });
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
