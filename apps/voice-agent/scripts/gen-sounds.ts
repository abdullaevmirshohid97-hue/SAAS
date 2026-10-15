/* eslint-disable no-console */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { encodeWav } from '../src/audio';
import { aiConfigProblems, loadConfig } from '../src/config';
import { TtsEngine } from '../src/providers/tts';

// =============================================================================
// Asterisk ovozli xabarlari (Playback(clary/<nom>)) — 8 kHz, 16-bit, mono WAV
// =============================================================================
// Ikki yo'l (uchinchi tomon kerak emas):
//   1) O'zingiz yozib olasiz (telefon diktofoni — eng tabiiy ovoz):
//        node dist/scripts/gen-sounds.js --list      → nima deyish kerakligi
//        fayllarni /opt/clary-sounds/<nom>.m4a|mp3|ogg|wav ga qo'ying →
//        bash infra/asterisk/sounds.sh               (ffmpeg bilan o'giradi)
//   2) O'zimizning TTS serveri (infra/voice-models, TTS_PROVIDER=http):
//        node dist/scripts/gen-sounds.js --out /var/lib/asterisk/sounds/clary [--missing]
// --missing — faqat yo'q fayllar (yozib olinganlari ustiga yozilmaydi).
// =============================================================================

export const SOUNDS: Record<string, string> = {
  fallback:
    "Assalomu alaykum! Kechirasiz, hozir qo'ng'iroqqa javob bera olmaymiz. Iltimos, birozdan so'ng qayta qo'ng'iroq qiling. Sog' bo'ling!",
  transfer_fail:
    "Kechirasiz, xodimga ulab bo'lmadi. Qabulxona sizga o'zi qo'ng'iroq qiladi. Sog' bo'ling!",
  // Bulutli ATS
  pbx_noanswer:
    "Assalomu alaykum! Hozir barcha xodimlarimiz band. Qo'ng'irog'ingiz qayd etildi — qabulxona sizga o'zi qo'ng'iroq qiladi. Sog' bo'ling!",
  vm_prompt:
    "Assalomu alaykum! Hozir barcha xodimlarimiz band. Signaldan keyin ismingizni va nima uchun qo'ng'iroq qilganingizni ayting — tez orada o'zimiz qo'ng'iroq qilamiz.",
  vm_thanks: "Rahmat, xabaringiz qabul qilindi. Sog' bo'ling!",
  ext_unavailable: "Bu ichki raqam hozir javob bera olmaydi. Keyinroq qayta urinib ko'ring.",
  out_denied: "Bu raqamdan tashqi qo'ng'iroq qilish mumkin emas.",
  out_busy: "Hozir barcha tashqi liniyalar band. Birozdan so'ng qayta urinib ko'ring.",
};

async function main() {
  if (process.argv.includes('--list')) {
    console.log(
      'Yozib olinadigan iboralar (fayl nomi → matn). Fayllar: /opt/clary-sounds/<nom>.m4a\n',
    );
    for (const [name, text] of Object.entries(SOUNDS)) console.log(`${name}\n  ${text}\n`);
    return;
  }
  const i = process.argv.indexOf('--out');
  const out = resolve(i >= 0 ? (process.argv[i + 1] ?? '.') : './sounds');
  const missingOnly = process.argv.includes('--missing');
  mkdirSync(out, { recursive: true });

  const todo = Object.entries(SOUNDS).filter(
    ([name]) => !(missingOnly && existsSync(join(out, `${name}.wav`))),
  );
  if (todo.length === 0) {
    console.log(`Hamma ovoz tayyor: ${out}`);
    return;
  }
  const cfg = loadConfig();
  const ttsReady =
    (cfg.ttsProvider === 'http' && !!cfg.ttsHttpUrl) ||
    (cfg.ttsProvider === 'aisha' && !!cfg.aishaKey);
  if (!ttsReady) {
    console.error(
      `TTS sozlanmagan — ${todo.length} ta ovoz yo'q: ${todo.map(([n]) => n).join(', ')}\n` +
        "O'zingiz yozib oling (node dist/scripts/gen-sounds.js --list) va bash infra/asterisk/sounds.sh,\n" +
        "yoki o'zimizning TTS serveri: bash infra/voice-models/install.sh",
    );
    process.exit(2);
  }
  if (aiConfigProblems(cfg).some((p) => p.startsWith('TTS'))) {
    console.error(aiConfigProblems(cfg).join('\n'));
    process.exit(2);
  }
  const tts = new TtsEngine(cfg);
  for (const [name, text] of todo) {
    const file = join(out, `${name}.wav`);
    const r = await tts.synthesize(text, 'uz');
    writeFileSync(file, encodeWav(r.pcm));
    console.log(`✓ ${file} (${(r.pcm.length / 8000).toFixed(1)} s)`);
  }
  console.log('\nAsterisk: chown -R asterisk:asterisk ' + out);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
