/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { encodeWav } from '../src/audio';
import { loadConfig } from '../src/config';
import { TtsEngine } from '../src/providers/tts';

// =============================================================================
// Asterisk uchun zaxira ovozlar (voice-agent ishlamasa ham bemor jim qolmasin)
// =============================================================================
//   node dist/scripts/gen-sounds.js --out /var/lib/asterisk/sounds/clary
// Natija: fallback.wav (8 kHz, 16-bit, mono — Asterisk Playback(clary/fallback)).
// =============================================================================

const SOUNDS: Record<string, string> = {
  fallback:
    "Assalomu alaykum! Kechirasiz, hozir qo'ng'iroqqa javob bera olmaymiz. Iltimos, birozdan so'ng qayta qo'ng'iroq qiling. Sog' bo'ling!",
  transfer_fail:
    "Kechirasiz, xodimga ulab bo'lmadi. Qabulxona sizga o'zi qo'ng'iroq qiladi. Sog' bo'ling!",
};

async function main() {
  const i = process.argv.indexOf('--out');
  const out = resolve(i >= 0 ? (process.argv[i + 1] ?? '.') : './sounds');
  mkdirSync(out, { recursive: true });
  const tts = new TtsEngine(loadConfig());
  for (const [name, text] of Object.entries(SOUNDS)) {
    const r = await tts.synthesize(text, 'uz');
    const file = join(out, `${name}.wav`);
    writeFileSync(file, encodeWav(r.pcm));
    console.log(`✓ ${file} (${(r.pcm.length / 8000).toFixed(1)} s)`);
  }
  console.log('\nAsterisk: chown -R asterisk:asterisk ' + out);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
