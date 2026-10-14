import { Injectable, Logger } from '@nestjs/common';

// =============================================================================
// Nutqni matnga o'girish (STT) — Telegram ovozli xabarlari uchun
// =============================================================================
// Telefon qo'ng'iroqlari STT'ni voice-agent o'zi qiladi; API faqat Telegram
// ovozli xabarini (OGG/Opus) matnga o'giradi. Provayderlar:
//   aisha  — https://back.aisha.group (X-Api-Key), o'zbek/rus/ingliz
//   openai — OpenAI-mos /v1/audio/transcriptions (o'zimiz ko'targan Whisper:
//            BuzzASR/uzbek, rubaiSTT — infra/voice-models/stt_server.py)
// Tanlov: AI_STT_PROVIDER (aisha|openai|none), bo'lmasa kalitga qarab.
// =============================================================================

export type SttLang = 'uz' | 'ru' | 'en';

@Injectable()
export class SttClient {
  private readonly log = new Logger('Stt');

  provider(): 'aisha' | 'openai' | 'none' {
    const p = (process.env.AI_STT_PROVIDER ?? '').trim().toLowerCase();
    if (p === 'aisha' || p === 'openai' || p === 'none') return p;
    if (process.env.AISHA_API_KEY) return 'aisha';
    if (process.env.STT_OPENAI_URL) return 'openai';
    return 'none';
  }

  get enabled(): boolean {
    return this.provider() !== 'none';
  }

  async transcribe(
    audio: Buffer,
    opts: { mime: string; filename: string; lang?: SttLang },
  ): Promise<string> {
    const provider = this.provider();
    const lang = opts.lang ?? 'uz';
    const blob = new Blob([new Uint8Array(audio)], { type: opts.mime });

    if (provider === 'aisha') {
      const form = new FormData();
      form.append('audio', blob, opts.filename);
      form.append('language', lang);
      form.append('has_diarization', 'false');
      const base = (process.env.AISHA_BASE_URL ?? 'https://back.aisha.group').replace(/\/$/, '');
      const res = await fetch(`${base}/api/v1/stt/post/`, {
        method: 'POST',
        headers: { 'X-Api-Key': process.env.AISHA_API_KEY ?? '' },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Aisha STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { transcript?: string; text?: string };
      return (json.transcript ?? json.text ?? '').trim();
    }

    if (provider === 'openai') {
      const form = new FormData();
      form.append('file', blob, opts.filename);
      form.append('model', process.env.STT_OPENAI_MODEL ?? 'whisper-1');
      form.append('language', lang);
      form.append('response_format', 'json');
      const base = (process.env.STT_OPENAI_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${base}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: process.env.STT_OPENAI_KEY
          ? { Authorization: `Bearer ${process.env.STT_OPENAI_KEY}` }
          : {},
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { text?: string };
      return (json.text ?? '').trim();
    }

    this.log.warn('STT sozlanmagan (AISHA_API_KEY yoki STT_OPENAI_URL)');
    return '';
  }
}
