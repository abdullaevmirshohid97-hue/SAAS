import type { Config } from '../config';

// =============================================================================
// Nutq → matn (STT)
// =============================================================================
//   openai — OpenAI-mos /v1/audio/transcriptions: o'zimizning Whisper serveri
//            (infra/voice-models/stt_server.py) — BEPUL, standart; jonli suhbatda
//            tez ishlashi uchun GPU tavsiya etiladi
//   aisha  — tashqi pullik provayder (ixtiyoriy, faqat STT_PROVIDER=aisha)
// =============================================================================

export type Lang = 'uz' | 'ru' | 'en';

export interface SttProvider {
  readonly name: string;
  transcribe(wav: Buffer, lang: Lang): Promise<string>;
}

class AishaStt implements SttProvider {
  readonly name = 'aisha';
  constructor(
    private readonly base: string,
    private readonly key: string,
  ) {}

  async transcribe(wav: Buffer, lang: Lang): Promise<string> {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.append('language', lang);
    form.append('has_diarization', 'false');
    const res = await fetch(`${this.base}/api/v1/stt/post/`, {
      method: 'POST',
      headers: { 'X-Api-Key': this.key },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Aisha STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { transcript?: string; text?: string };
    return (json.transcript ?? json.text ?? '').trim();
  }
}

class OpenAiCompatibleStt implements SttProvider {
  readonly name = 'openai';
  constructor(
    private readonly base: string,
    private readonly key: string,
    private readonly model: string,
  ) {}

  async transcribe(wav: Buffer, lang: Lang): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', this.model);
    form.append('language', lang);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const res = await fetch(`${this.base}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: this.key ? { Authorization: `Bearer ${this.key}` } : {},
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { text?: string };
    return (json.text ?? '').trim();
  }
}

export function createStt(cfg: Config, name = cfg.sttProvider): SttProvider | null {
  if (name === 'aisha' && cfg.aishaKey) return new AishaStt(cfg.aishaBase, cfg.aishaKey);
  if (name === 'openai' && cfg.sttOpenaiUrl) {
    return new OpenAiCompatibleStt(cfg.sttOpenaiUrl, cfg.sttOpenaiKey, cfg.sttOpenaiModel);
  }
  return null;
}
