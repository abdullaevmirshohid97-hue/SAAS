import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  concatPcm,
  dbfs,
  encodeWav,
  FRAME_MS,
  FRAME_SAMPLES,
  mix,
  pcmFromBuffer,
  SAMPLE_RATE,
  splitFrames,
  tone,
} from './audio';
import { KIND, type Frame, uuidFromBytes } from './audiosocket';
import type { ClaryApi, StartResponse, TurnResponse } from './clary-api';
import { formatTransferNumber, type Config } from './config';
import { logger, type Logger } from './log';
import type { SttProvider } from './providers/stt';
import { splitForSpeech, type TtsEngine, type TtsLang } from './providers/tts';
import type { CallMeta, CallRegistry } from './registry';
import { Vad } from './vad';

// =============================================================================
// BITTA QO'NG'IROQ — AudioSocket ↔ VAD ↔ STT ↔ Clary API ↔ TTS
// =============================================================================
// Holatlar:
//   waiting_id → starting → speaking (salomlashuv) → listening ⇄ thinking → speaking
//   voicemail (ovozli xabar yozilmoqda) · ending · closed
// Qoidalar:
//   - Bemor AI gapirayotganda gapirib yuborsa (≥ ~250 ms) — AI to'xtaydi (barge-in).
//   - Javob kechiksa (FILLER_AFTER_MS) — "Bir daqiqa, qarab beraman".
//   - Jimlik: 2 marta "Eshityapman", keyin xayrlashib go'shak qo'yiladi.
//   - Birinchi gap o'zbek VA rus tilida parallel tanib olinadi — AI tilni tanlaydi.
//   - Qo'ng'iroq oxirida: yozuv (bemor + AI aralash, WAV) + xarajat API'ga.
// =============================================================================

type State =
  | 'waiting_id'
  | 'starting'
  | 'speaking'
  | 'listening'
  | 'thinking'
  | 'voicemail'
  | 'ending'
  | 'closed';

const PHRASES = {
  filler: {
    uz: ['Bir daqiqa, qarab beraman.', 'Hozir tekshiraman.', 'Bir soniya.'],
    ru: ['Одну минуту, сейчас посмотрю.', 'Секунду, проверяю.'],
  },
  repeat: {
    uz: 'Kechirasiz, eshitmadim. Iltimos, qaytaring.',
    ru: 'Извините, не расслышала. Повторите, пожалуйста.',
  },
  reprompt: { uz: 'Eshityapman, gapiravering.', ru: 'Я вас слушаю, говорите.' },
  bye: { uz: "Qo'ng'iroq uchun rahmat. Sog' bo'ling!", ru: 'Спасибо за звонок. До свидания!' },
  apology: {
    uz: "Kechirasiz, texnik nosozlik bo'ldi. Qabulxona sizga o'zi qo'ng'iroq qiladi.",
    ru: 'Извините, произошла техническая ошибка. Администратор вам перезвонит.',
  },
  timeout: {
    uz: "Qo'ng'iroq vaqti tugadi. Qabulxona sizga qayta qo'ng'iroq qiladi. Sog' bo'ling!",
    ru: 'Время звонка истекло. Администратор вам перезвонит. До свидания!',
  },
  reject:
    "Kechirasiz, hozir qo'ng'iroqqa javob bera olmaymiz. Iltimos, keyinroq qayta qo'ng'iroq qiling.",
} as const;

/** Oldindan sintez qilib keshga qo'yiladigan iboralar (birinchi qo'ng'iroq kechikmasin). */
export function staticPhrases(): Array<{ text: string; lang: TtsLang }> {
  return [
    ...PHRASES.filler.uz.map((text) => ({ text, lang: 'uz' as const })),
    ...PHRASES.filler.ru.map((text) => ({ text, lang: 'ru' as const })),
    ...(['repeat', 'reprompt', 'bye', 'apology', 'timeout'] as const).flatMap((k) => [
      { text: PHRASES[k].uz, lang: 'uz' as const },
      { text: PHRASES[k].ru, lang: 'ru' as const },
    ]),
    { text: PHRASES.reject, lang: 'uz' },
  ];
}

export interface SessionDeps {
  cfg: Config;
  api: ClaryApi;
  stt: SttProvider | null;
  tts: TtsEngine;
  registry: CallRegistry;
  send: (kind: number, payload?: Buffer) => void;
  close: () => void;
}

const PRE_ROLL_FRAMES = 10; // 200 ms gap boshidan oldin
const BARGE_IN_FRAMES = 12; // ~240 ms + start (60 ms)

export class CallSession {
  private state: State = 'waiting_id';
  private readonly log: Logger;
  private uuid = '';
  private meta: CallMeta | null = null;
  private start: StartResponse | null = null;
  private callId: string | null = null;
  private lang: 'uz' | 'ru' = 'uz';
  private firstUtterance = true;
  private emptyCount = 0;
  private noInputCount = 0;
  private fillerIdx = 0;

  private readonly vad: Vad;
  private preRoll: Int16Array[] = [];
  private capture: Int16Array[] | null = null;
  private pending: Int16Array[] = [];

  private outQueue: Buffer[] = [];
  private playEpoch = 0;
  private drainWaiters: Array<(interrupted: boolean) => void> = [];
  private tickTimer: NodeJS.Timeout | null = null;
  private tickBase = 0;
  private ticksDone = 0;

  private noInputTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private hardTimer: NodeJS.Timeout | null = null;
  private timeUp = false;

  private recordEnabled = false;
  private inbound: Int16Array[] = [];
  private rec: Int16Array[] = [];
  private recCapFrames = 0;

  private voicemail: {
    frames: Int16Array[];
    startedAt: number;
    silentMs: number;
    heard: boolean;
  } | null = null;

  private startedAt = Date.now();
  private sttSeconds = 0;
  private ttsChars = 0;
  private finished = false;
  private ending = false;

  constructor(private readonly d: SessionDeps) {
    this.log = logger('call');
    this.vad = new Vad({
      startDb: d.cfg.vadStartDb,
      endSilenceMs: d.cfg.vadEndSilenceMs,
      minSpeechMs: d.cfg.vadMinSpeechMs,
      maxUtteranceMs: d.cfg.vadMaxUtteranceMs,
    });
  }

  get status(): State {
    return this.state;
  }

  // ==========================================================================
  // Kiruvchi freymlar
  // ==========================================================================
  onFrame(f: Frame) {
    switch (f.kind) {
      case KIND.ID:
        if (this.state === 'waiting_id') {
          this.uuid = uuidFromBytes(f.payload);
          void this.begin();
        }
        break;
      case KIND.AUDIO:
        if (f.payload.length >= 2) this.onAudio(pcmFromBuffer(f.payload));
        break;
      case KIND.DTMF:
        this.onDtmf(f.payload.toString('ascii'));
        break;
      case KIND.HANGUP:
        void this.finish('caller');
        break;
      case KIND.ERROR:
        this.log.warn(`${this.tag()} Asterisk xato kodi: ${f.payload.readUInt8(0)}`);
        void this.finish('asterisk_error');
        break;
      default:
        break;
    }
  }

  /** TCP ulanish uzildi (bemor go'shakni qo'ydi yoki Asterisk yopdi). */
  onSocketClosed() {
    void this.finish('caller');
  }

  private tag(): string {
    return `[${this.uuid.slice(0, 8)}${this.callId ? `/${this.callId.slice(0, 8)}` : ''}]`;
  }

  // ==========================================================================
  // Boshlanish
  // ==========================================================================
  private async begin() {
    this.state = 'starting';
    this.startedAt = Date.now();
    this.d.registry.callStarted();
    this.meta = this.d.registry.take(this.uuid);
    this.startTicker();
    this.log.info(
      `${this.tag()} yangi qo'ng'iroq: kimdan=${this.meta?.from ?? '?'} liniya=${this.meta?.line ?? '?'} did=${this.meta?.did ?? '-'}`,
    );

    try {
      this.start = await this.d.api.start({
        external_id: this.uuid,
        line_key: this.meta?.line ?? null,
        did: this.meta?.did ?? null,
        caller: this.meta?.from ?? null,
        diversion: this.meta?.diversion ?? null,
      });
    } catch (e) {
      this.log.error(`${this.tag()} API start xato: ${(e as Error).message}`);
      this.d.registry.setNext(this.uuid, 'fallback');
      await this.speak(PHRASES.apology.uz, 'uz').catch(() => undefined);
      return this.hangup('api_error');
    }

    const s = this.start;
    if (s.mode === 'reject' || !s.call_id) {
      await this.speak(s.say ?? PHRASES.reject, 'uz');
      return this.hangup('reject');
    }
    this.callId = s.call_id;
    this.recordEnabled = !!s.record;
    const maxMs = Math.max(60, s.max_seconds ?? 300) * 1000;
    this.recCapFrames = Math.ceil((maxMs + 60_000) / FRAME_MS);
    this.maxTimer = setTimeout(() => {
      this.timeUp = true;
      if (this.state === 'listening') void this.timeoutBye();
    }, maxMs);
    // Har qanday holatda ham go'shak qo'yilsin (osilib qolmasin)
    this.hardTimer = setTimeout(() => void this.hangup('hard_timeout'), maxMs + 45_000);

    if (s.mode === 'voicemail') {
      await this.speak(s.voicemail_prompt ?? '', 'uz');
      await this.playPcm(tone(1000, 350));
      this.voicemail = { frames: [], startedAt: Date.now(), silentMs: 0, heard: false };
      this.state = 'voicemail';
      return;
    }

    const interrupted = await this.speak(s.greeting ?? '', 'uz');
    if (!interrupted) this.listen();
  }

  // ==========================================================================
  // Audio: VAD, gap yig'ish, barge-in
  // ==========================================================================
  private onAudio(pcm: Int16Array) {
    if (this.state === 'closed' || this.state === 'waiting_id') return;
    if (this.recordEnabled) {
      this.inbound.push(pcm);
      if (this.inbound.length > 12) this.inbound.splice(0, this.inbound.length - 3);
    }

    if (this.state === 'voicemail' && this.voicemail) {
      const vm = this.voicemail;
      vm.frames.push(pcm);
      this.vad.process(pcm);
      if (this.vad.inSpeech) vm.heard = true;
      vm.silentMs = dbfs(pcm) < this.vad.noiseFloor + 8 ? vm.silentMs + FRAME_MS : 0;
      const elapsed = Date.now() - vm.startedAt;
      if (
        (vm.heard && vm.silentMs >= 4000) ||
        elapsed >= this.d.cfg.voicemailMaxMs ||
        (!vm.heard && elapsed > 15_000)
      ) {
        void this.finishVoicemail();
      }
      return;
    }

    const ev = this.vad.process(pcm);
    if (ev?.type === 'start') {
      this.capture = [...this.preRoll, pcm];
      this.preRoll = [];
      this.clearNoInput();
    } else if (ev?.type === 'end') {
      const frames = this.capture ?? [];
      this.capture = null;
      if (!ev.tooShort) {
        // Oxiridagi sukunatni kesamiz (STT daqiqasi bilan to'lanadi)
        const trim = Math.max(0, Math.floor(this.d.cfg.vadEndSilenceMs / FRAME_MS) - 5);
        this.onUtterance(concatPcm(frames.slice(0, Math.max(1, frames.length - trim))));
      } else if (this.state === 'listening') {
        this.armNoInput();
      }
    } else if (this.vad.inSpeech && this.capture) {
      this.capture.push(pcm);
      // AI gapirayotganda bemor gapirishda davom etsa — to'xtatamiz
      if (this.state === 'speaking' && this.capture.length >= PRE_ROLL_FRAMES + BARGE_IN_FRAMES) {
        this.log.debug(`${this.tag()} barge-in`);
        this.interruptPlayback();
        this.state = 'listening';
      }
    }
    if (!this.vad.inSpeech) {
      this.preRoll.push(pcm);
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
    }
  }

  private onUtterance(pcm: Int16Array) {
    if (this.state === 'listening') void this.handleUtterance(pcm);
    else if (this.state === 'thinking' || this.state === 'speaking') this.pending.push(pcm);
  }

  private onDtmf(digit: string) {
    this.log.info(`${this.tag()} DTMF ${digit}`);
    if (digit !== '0' || !this.callId) return;
    if (this.state === 'speaking') this.interruptPlayback();
    if (this.state === 'speaking' || this.state === 'listening') {
      void this.handleText(
        '[Bemor 0 tugmasini bosdi — qabulxona xodimi bilan gaplashmoqchi]',
        null,
        0,
      );
    }
  }

  // ==========================================================================
  // Gap → STT → AI → javob
  // ==========================================================================
  private async handleUtterance(pcm: Int16Array) {
    if (!this.callId || this.ending) return;
    this.state = 'thinking';
    this.clearNoInput();
    const seconds = pcm.length / SAMPLE_RATE;
    const wav = encodeWav(pcm);
    const filler = this.scheduleFiller();

    let text = '';
    let alt: string | null = null;
    const stt = this.d.stt;
    try {
      if (!stt) throw new Error('STT sozlanmagan');
      if (this.firstUtterance && this.d.cfg.sttDualFirst) {
        const [uz, ru] = await Promise.all([
          stt.transcribe(wav, 'uz').catch(() => ''),
          stt.transcribe(wav, 'ru').catch(() => ''),
        ]);
        this.sttSeconds += seconds * 2;
        text = uz || ru;
        alt = uz && ru ? ru : null;
      } else {
        this.sttSeconds += seconds;
        text = await stt.transcribe(wav, this.lang);
      }
    } catch (e) {
      this.log.warn(`${this.tag()} STT xato: ${(e as Error).message}`);
    }
    this.firstUtterance = false;

    if (!text.trim()) {
      clearTimeout(filler);
      this.emptyCount++;
      if (this.emptyCount >= 3) {
        await this.speak(PHRASES.apology[this.lang], this.lang);
        return this.hangup('stt_empty');
      }
      const interrupted = await this.speak(PHRASES.repeat[this.lang], this.lang);
      if (!interrupted) this.listen();
      return;
    }
    this.emptyCount = 0;
    this.log.info(`${this.tag()} bemor: "${text}"${alt ? ` | ru: "${alt}"` : ''}`);
    // "Bir daqiqa" taymeri AI javobigacha davom etadi (handleText to'xtatadi)
    await this.handleText(text, alt, seconds, filler);
  }

  private async handleText(
    text: string,
    alt: string | null,
    seconds: number,
    filler?: NodeJS.Timeout,
  ) {
    if (!this.callId || this.ending) return;
    this.state = 'thinking';
    this.clearNoInput();
    const fillerTimer = filler ?? this.scheduleFiller();
    let reply: TurnResponse;
    try {
      reply = await this.d.api.turn({
        call_id: this.callId,
        text,
        alt_text_ru: alt,
        stt_seconds: Math.round(seconds * 10) / 10,
      });
    } catch (e) {
      clearTimeout(fillerTimer);
      this.log.error(`${this.tag()} API turn xato: ${(e as Error).message}`);
      await this.speak(PHRASES.apology[this.lang], this.lang);
      return this.hangup('api_error');
    }
    clearTimeout(fillerTimer);
    this.lang = reply.lang === 'ru' ? 'ru' : 'uz';
    this.log.info(
      `${this.tag()} AI: "${reply.say}"${reply.action !== 'none' ? ` [${reply.action}]` : ''}`,
    );

    const interrupted = await this.speak(reply.say, this.lang);
    if (reply.end || reply.action !== 'none') {
      if (reply.action === 'transfer' && reply.transfer_to) {
        if (reply.transfer_to === 'group') {
          // Bulutli ATS: klinikaning ichki qabulxona guruhi (dialplan t-<kod>-in,xfer)
          this.d.registry.setNext(this.uuid, 'transfer:group');
        } else {
          const num = formatTransferNumber(reply.transfer_to, this.d.cfg.transferFormat);
          const ep = this.d.cfg.transferEndpoint;
          this.d.registry.setNext(this.uuid, `transfer:${num}${ep ? `:${ep}` : ''}`);
        }
        return this.hangup('transfer');
      }
      return this.hangup('agent');
    }
    if (this.timeUp) return this.timeoutBye();
    const next = this.pending.pop();
    this.pending = [];
    if (next) return this.handleUtterance(next);
    if (!interrupted || this.status === 'listening') this.listen();
  }

  private scheduleFiller(): NodeJS.Timeout {
    return setTimeout(() => {
      if (this.state !== 'thinking') return;
      const list = PHRASES.filler[this.lang];
      const text = list[this.fillerIdx++ % list.length] ?? list[0] ?? '';
      void this.d.tts
        .synthesize(text, this.lang, { voice: this.start?.voice, speed: this.start?.speech_speed })
        .then((r) => {
          if (this.state === 'thinking') this.enqueue(r.pcm);
        })
        .catch(() => undefined);
    }, this.d.cfg.fillerAfterMs);
  }

  // ==========================================================================
  // Tinglash / jimlik
  // ==========================================================================
  private listen() {
    if (this.ending) return;
    this.state = 'listening';
    if (this.timeUp) {
      void this.timeoutBye();
      return;
    }
    const next = this.pending.pop();
    this.pending = [];
    if (next) {
      void this.handleUtterance(next);
      return;
    }
    this.armNoInput();
  }

  private armNoInput() {
    this.clearNoInput();
    this.noInputTimer = setTimeout(() => void this.onNoInput(), this.d.cfg.noInputMs);
  }

  private clearNoInput() {
    if (this.noInputTimer) clearTimeout(this.noInputTimer);
    this.noInputTimer = null;
  }

  private async onNoInput() {
    if (this.state !== 'listening' || this.vad.inSpeech) return;
    this.noInputCount++;
    if (this.noInputCount > 2) {
      await this.speak(PHRASES.bye[this.lang], this.lang);
      return this.hangup('no_input');
    }
    const interrupted = await this.speak(PHRASES.reprompt[this.lang], this.lang);
    if (!interrupted) this.listen();
  }

  private async timeoutBye() {
    if (this.ending) return;
    await this.speak(PHRASES.timeout[this.lang], this.lang);
    return this.hangup('timeout');
  }

  // ==========================================================================
  // Ovozli xabar
  // ==========================================================================
  private async finishVoicemail() {
    if (this.state !== 'voicemail') return;
    this.state = 'speaking';
    await this.speak(this.start?.voicemail_thanks ?? PHRASES.bye.uz, 'uz');
    return this.hangup('voicemail');
  }

  // ==========================================================================
  // Ovoz chiqarish
  // ==========================================================================
  /** Matnni o'qiydi. true — bemor gapirib to'xtatdi (barge-in). */
  private async speak(text: string, lang: 'uz' | 'ru'): Promise<boolean> {
    if (!text.trim() || this.state === 'closed') return false;
    const epoch = this.playEpoch;
    if (this.state !== 'ending') this.state = 'speaking';
    for (const seg of splitForSpeech(text)) {
      if (epoch !== this.playEpoch || this.status === 'closed') return true;
      try {
        const r = await this.d.tts.synthesize(seg.text, seg.lang || lang, {
          voice: this.start?.voice,
          speed: this.start?.speech_speed,
        });
        this.ttsChars += r.billedChars;
        if (epoch !== this.playEpoch) return true;
        this.enqueue(r.pcm);
      } catch (e) {
        this.log.error(`${this.tag()} TTS xato: ${(e as Error).message}`);
        this.d.registry.setNext(this.uuid, 'fallback');
      }
    }
    return this.waitDrain();
  }

  private playPcm(pcm: Int16Array): Promise<boolean> {
    this.enqueue(pcm);
    return this.waitDrain();
  }

  private enqueue(pcm: Int16Array) {
    if (pcm.length === 0) return;
    this.outQueue.push(...splitFrames(pcm));
  }

  private waitDrain(): Promise<boolean> {
    if (this.outQueue.length === 0) return Promise.resolve(false);
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  private interruptPlayback() {
    this.playEpoch++;
    this.outQueue = [];
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const w of waiters) w(true);
  }

  private startTicker() {
    this.tickBase = Date.now();
    this.ticksDone = 0;
    this.tickTimer = setInterval(() => this.tick(), FRAME_MS);
  }

  /** Har 20 ms: navbatdagi freymni yuboradi, yozuvni aralashtiradi. */
  private tick() {
    const due = Math.floor((Date.now() - this.tickBase) / FRAME_MS) - this.ticksDone;
    const n = Math.min(Math.max(due, 0), 3);
    for (let i = 0; i < n; i++) {
      this.ticksDone++;
      const out = this.outQueue.shift();
      if (out) this.d.send(KIND.AUDIO, out);
      if (this.recordEnabled && this.rec.length < this.recCapFrames && this.state !== 'starting') {
        const inbound = this.inbound.shift() ?? new Int16Array(FRAME_SAMPLES);
        this.rec.push(out ? mix(inbound, pcmFromBuffer(out)) : inbound);
      }
      if (!out && this.drainWaiters.length) {
        const waiters = this.drainWaiters;
        this.drainWaiters = [];
        for (const w of waiters) w(false);
      }
    }
    if (due > 3) this.ticksDone += due - 3; // juda orqada qolsak — yetib olamiz
  }

  // ==========================================================================
  // Yakun
  // ==========================================================================
  private async hangup(reason: string) {
    if (this.ending) return;
    this.ending = true;
    this.state = 'ending';
    this.clearNoInput();
    // Oxirgi gap tugashini kutamiz (ko'pi bilan 15 s)
    await Promise.race([this.waitDrain(), new Promise((r) => setTimeout(r, 15_000))]);
    try {
      this.d.send(KIND.HANGUP);
    } catch {
      /* ulanish allaqachon yopilgan */
    }
    setTimeout(() => this.d.close(), 300);
    await this.finish(reason);
  }

  async finish(reason: string) {
    if (this.finished) return;
    this.finished = true;
    this.state = 'closed';
    this.clearNoInput();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.interruptPlayback();
    if (this.uuid) this.d.registry.callEnded();

    const duration = Math.round((Date.now() - this.startedAt) / 1000);
    this.log.info(`${this.tag()} tugadi (${reason}), ${duration} s`);
    if (!this.callId) return;

    // Ovozli xabar matni
    let vmText: string | null = null;
    if (this.voicemail?.heard && this.d.stt) {
      const pcm = concatPcm(this.voicemail.frames);
      try {
        vmText = (await this.d.stt.transcribe(encodeWav(pcm), 'uz')) || null;
        this.sttSeconds += pcm.length / SAMPLE_RATE;
      } catch (e) {
        this.log.warn(`${this.tag()} ovozli xabar STT: ${(e as Error).message}`);
      }
    }

    // Yozuv
    let hasRecording = false;
    if (this.recordEnabled && this.rec.length * FRAME_MS > 2000) {
      const wav = encodeWav(concatPcm(this.rec));
      if (this.d.cfg.recordingsDir) {
        try {
          mkdirSync(this.d.cfg.recordingsDir, { recursive: true });
          writeFileSync(join(this.d.cfg.recordingsDir, `${this.callId}.wav`), wav);
        } catch (e) {
          this.log.warn(`${this.tag()} lokal yozuv: ${(e as Error).message}`);
        }
      }
      try {
        await this.d.api.recording(this.callId, wav);
        hasRecording = true;
      } catch (e) {
        this.log.warn(`${this.tag()} yozuv yuklanmadi: ${(e as Error).message}`);
      }
    }

    try {
      await this.d.api.end({
        call_id: this.callId,
        duration_sec: duration,
        stt_seconds: Math.round(this.sttSeconds * 10) / 10,
        tts_chars: this.ttsChars,
        hangup_by: reason,
        voicemail_transcript: vmText,
        has_recording: hasRecording,
      });
    } catch (e) {
      this.log.error(`${this.tag()} API end xato: ${(e as Error).message}`);
    }
  }
}
