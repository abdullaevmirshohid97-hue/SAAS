import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bufferFromPcm, pcmFromBuffer, wavToTelephone } from '../audio';
import type { Config } from '../config';
import { logger } from '../log';

// =============================================================================
// Matn → nutq (TTS) + disk keshi
// =============================================================================
//   http  — o'zimizning TTS server (infra/voice-models/tts_server.py — MMS/VITS
//           yoki boshqa): POST {text, lang, voice, speed} → audio/wav. BEPUL, standart.
//   aisha — tashqi pullik provayder (ixtiyoriy, faqat TTS_PROVIDER=aisha bo'lsa)
// Kesh: bir xil matn qayta sintez qilinmaydi (salomlashuv, "bir daqiqa", xayr...)
// — xarajat va kechikish kamayadi. Natija telefon formatida (8 kHz PCM) saqlanadi.
// =============================================================================

const log = logger('tts');

export type TtsLang = 'uz' | 'ru';

export interface TtsResult {
  pcm: Int16Array;
  /** Pullik belgilar soni (keshdan bo'lsa 0) */
  billedChars: number;
  cached: boolean;
}

interface TtsBackend {
  readonly name: string;
  synthesizeWav(text: string, lang: TtsLang, voice: string, speed: number): Promise<Buffer>;
}

class AishaTts implements TtsBackend {
  readonly name = 'aisha';
  constructor(
    private readonly base: string,
    private readonly key: string,
  ) {}

  async synthesizeWav(text: string, lang: TtsLang, voice: string, speed: number): Promise<Buffer> {
    const form = new FormData();
    form.append('transcript', text.slice(0, 1000));
    form.append('language', lang);
    if (lang === 'uz' && voice) form.append('model', voice);
    form.append('mood', 'Neutral');
    form.append('speed', String(speed));
    const res = await fetch(`${this.base}/api/v1/tts/post/`, {
      method: 'POST',
      headers: { 'X-Api-Key': this.key },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Aisha TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { audio_path?: string; audio_url?: string };
    const path = json.audio_path ?? json.audio_url;
    if (!path) throw new Error('Aisha TTS: audio_path yo‘q');
    const url = /^https?:/.test(path)
      ? path
      : `${this.base}${path.startsWith('/') ? '' : '/'}${path}`;
    const audio = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!audio.ok) throw new Error(`Aisha TTS audio ${audio.status}`);
    return Buffer.from(await audio.arrayBuffer());
  }
}

class HttpTts implements TtsBackend {
  readonly name = 'http';
  constructor(
    private readonly url: string,
    private readonly key = '',
  ) {}

  async synthesizeWav(text: string, lang: TtsLang, voice: string, speed: number): Promise<Buffer> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
      },
      body: JSON.stringify({ text, lang, voice, speed }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export class TtsEngine {
  private readonly backend: TtsBackend;
  private readonly inflight = new Map<string, Promise<Int16Array>>();

  constructor(private readonly cfg: Config) {
    this.backend =
      cfg.ttsProvider === 'http'
        ? new HttpTts(cfg.ttsHttpUrl, cfg.ttsHttpKey)
        : new AishaTts(cfg.aishaBase, cfg.aishaKey);
    mkdirSync(cfg.ttsCacheDir, { recursive: true });
  }

  get name(): string {
    return this.backend.name;
  }

  private key(text: string, lang: TtsLang, voice: string, speed: number): string {
    return createHash('sha1')
      .update(`${this.backend.name}|${lang}|${voice}|${speed}|${text}`)
      .digest('hex');
  }

  async synthesize(
    text: string,
    lang: TtsLang,
    opts: { voice?: string | null; speed?: number } = {},
  ): Promise<TtsResult> {
    const clean = text.trim();
    if (!clean) return { pcm: new Int16Array(0), billedChars: 0, cached: true };
    const voice = opts.voice || this.cfg.ttsDefaultVoice;
    const speed = opts.speed ?? 1;
    const key = this.key(clean, lang, voice, speed);
    const file = join(this.cfg.ttsCacheDir, `${key}.pcm`);
    if (existsSync(file)) {
      return { pcm: pcmFromBuffer(readFileSync(file)), billedChars: 0, cached: true };
    }
    // Bir vaqtda bir xil matn so'ralsa (ikki qo'ng'iroq) — bitta sintez
    let job = this.inflight.get(key);
    const owner = !job;
    if (!job) {
      job = (async () => {
        const started = Date.now();
        const wav = await this.backend.synthesizeWav(clean, lang, voice, speed);
        const pcm = wavToTelephone(wav);
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, bufferFromPcm(pcm));
        renameSync(tmp, file);
        log.debug(`sintez ${clean.length} belgi, ${Date.now() - started} ms (${lang})`);
        return pcm;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    const pcm = await job;
    return {
      pcm,
      billedChars: owner && this.backend.name === 'aisha' ? clean.length : 0,
      cached: !owner,
    };
  }
}

/** Matnni jumlalarga va tillarga bo'lish (o'zbekcha lotin / ruscha kirill). */
export function splitForSpeech(text: string): Array<{ text: string; lang: TtsLang }> {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Array<{ text: string; lang: TtsLang }> = [];
  for (const s of sentences) {
    const letters = s.replace(/[^\p{L}]/gu, '');
    const cyr = letters.replace(/[^Ѐ-ӿ]/g, '').length;
    const lang: TtsLang = letters && cyr / letters.length > 0.5 ? 'ru' : 'uz';
    const last = out[out.length - 1];
    // Bir tildagi qisqa jumlalar birlashtiriladi (kamroq so'rov, tabiiyroq intonatsiya)
    if (last && last.lang === lang && last.text.length + s.length < 220) last.text += ` ${s}`;
    else out.push({ text: s, lang });
  }
  return out;
}
