/* eslint-disable no-console */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { encodeWav, simulateTelephone, SAMPLE_RATE, wavToTelephone } from '../src/audio';
import { loadConfig, type SttProviderName } from '../src/config';
import { cer, wer } from '../src/metrics';
import { createStt, type Lang } from '../src/providers/stt';

// =============================================================================
// FAZA 0 — O'zbekcha STT sinovi (qaysi provayder telefon ovozini yaxshi taniydi)
// =============================================================================
// Ishlatish:
//   1) samples/ papkaga yozuvlar: ism.wav + ism.txt (aytilgan matn, aniq).
//      Masalan: 01-navbat.wav / 01-navbat.txt = "Kardiologga ertaga yozilmoqchiman"
//      Kamida 20 ta: turli ovoz (erkak/ayol/keksa), shovqinli joy, o'zbek-rus aralash,
//      ism-familiyalar, telefon raqamlari.
//   2) pnpm --filter @clary/voice-agent build
//   3) node dist/scripts/stt-benchmark.js --dir ./samples --providers aisha,openai --phone
//
//   --phone   yozuvni telefon sifatiga tushiradi (8 kHz, 300–3400 Hz) — HAQIQIY
//             qo'ng'iroq shunday eshitiladi. Telefondan yozilgan bo'lsa shart emas.
//   --lang    uz (default) | ru
//   --out     natija CSV (default: stt-benchmark.csv)
// Natija: har provayder uchun WER (so'z xatosi) va CER (harf xatosi), kechikish.
// Mo'ljal: WER < 20% va kechikish < 1.5 s — telefon suhbati uchun yetarli.
// =============================================================================

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

async function main() {
  const cfg = loadConfig();
  const dir = resolve(arg('dir', './samples')!);
  const lang = (arg('lang', 'uz') as Lang) ?? 'uz';
  const phone = arg('phone') === 'true';
  const out = resolve(arg('out', 'stt-benchmark.csv')!);
  const names = (arg('providers', cfg.sttProvider) ?? '')
    .split(',')
    .map((s) => s.trim()) as SttProviderName[];

  if (!existsSync(dir)) {
    console.error(`Papka yo'q: ${dir}`);
    process.exit(1);
  }
  const providers = names
    .map((n) => ({ n, p: createStt(cfg, n) }))
    .filter((x): x is { n: SttProviderName; p: NonNullable<ReturnType<typeof createStt>> } => {
      if (!x.p) console.warn(`⚠ ${x.n}: sozlanmagan (.env) — o'tkazib yuborildi`);
      return !!x.p;
    });
  if (providers.length === 0) {
    console.error('Birorta STT provayder sozlanmagan (AISHA_API_KEY / STT_OPENAI_URL).');
    process.exit(1);
  }

  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .sort();
  console.log(
    `${files.length} ta yozuv · til: ${lang} · telefon taqlidi: ${phone ? 'ha' : "yo'q"}\n`,
  );

  const rows: string[] = ['file,provider,seconds,latency_ms,wer,cer,reference,hypothesis'];
  const agg = new Map<string, { wer: number; cer: number; lat: number; n: number; sec: number }>();

  for (const f of files) {
    const raw = readFileSync(join(dir, f));
    const refFile = join(dir, f.replace(/\.wav$/i, '.txt'));
    const reference = existsSync(refFile) ? readFileSync(refFile, 'utf8').trim() : '';
    let pcm: Int16Array;
    try {
      pcm = phone ? simulateTelephone(raw) : wavToTelephone(raw);
    } catch (e) {
      console.warn(`⚠ ${f}: ${(e as Error).message}`);
      continue;
    }
    const wav = encodeWav(pcm);
    const seconds = pcm.length / SAMPLE_RATE;
    for (const { n, p } of providers) {
      const t0 = Date.now();
      let hyp = '';
      try {
        hyp = await p.transcribe(wav, lang);
      } catch (e) {
        hyp = `[XATO: ${(e as Error).message}]`;
      }
      const lat = Date.now() - t0;
      const w = reference ? wer(reference, hyp) : Number.NaN;
      const c = reference ? cer(reference, hyp) : Number.NaN;
      const a = agg.get(n) ?? { wer: 0, cer: 0, lat: 0, n: 0, sec: 0 };
      if (reference) {
        a.wer += w;
        a.cer += c;
      }
      a.lat += lat;
      a.n += 1;
      a.sec += seconds;
      agg.set(n, a);
      console.log(
        `${basename(f).padEnd(28)} ${n.padEnd(7)} WER ${reference ? `${(w * 100).toFixed(0)}%`.padStart(4) : '  - '} ` +
          `CER ${reference ? `${(c * 100).toFixed(0)}%`.padStart(4) : '  - '} ${String(lat).padStart(5)} ms  ${hyp.slice(0, 70)}`,
      );
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      rows.push(
        [f, n, seconds.toFixed(1), lat, w.toFixed(3), c.toFixed(3), esc(reference), esc(hyp)].join(
          ',',
        ),
      );
    }
  }

  console.log('\n=== Natija ===');
  for (const [n, a] of agg) {
    const cost = n === 'aisha' ? Math.round((a.sec / 60) * 425) : 0;
    console.log(
      `${n.padEnd(8)} o'rtacha WER ${((a.wer / a.n) * 100).toFixed(1)}% · CER ${((a.cer / a.n) * 100).toFixed(1)}% · ` +
        `kechikish ${Math.round(a.lat / a.n)} ms · ${a.sec.toFixed(0)} s audio` +
        (cost ? ` · ≈${cost} so'm` : ''),
    );
  }
  writeFileSync(out, rows.join('\n'));
  console.log(`\nCSV: ${out}`);
}

void main();
