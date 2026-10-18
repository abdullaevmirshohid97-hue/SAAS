import { CAST_VOICE_CLIPS, castAnnouncementPlan } from '@clary/schemas';

// =============================================================================
// Clary Cast — navbat chaqiruvi ovozi (TV va yozib olish sahifasi uchun umumiy).
//
// Ustuvorlik:
//   1) YOZIB OLINGAN iboralar (odam ovozi) — bo'laklar WebAudio'da uzilishsiz
//      ketma-ket qo'yiladi; har bo'lakning boshidagi/oxiridagi sukunat kesiladi
//      va balandligi tenglashtiriladi — shuning uchun "yopishtirilgan" eshitilmaydi.
//   2) Qurilmaning TABIIY o'zbek ovozi (masalan, Microsoft Edge'dagi "Madina"/
//      "Sardor") — faqat lang=uz bo'lsa. Rus ovozida o'zbekcha o'qitish
//      (robot) ATAYLAB ishlatilmaydi.
//   3) Ikkalasi ham yo'q bo'lsa — faqat yoqimli qo'ng'iroq, ma'lumot ekranda.
// =============================================================================

export type CastVoiceMode = 'pack' | 'device' | 'chime';

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Boshidagi/oxiridagi sukunatni kesadi va cho'qqini ~-1 dBFS ga keltiradi. */
export function trimAndNormalize(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  const sr = buf.sampleRate;
  const chs = buf.numberOfChannels;
  const len = buf.length;
  const data = Array.from({ length: chs }, (_, c) => buf.getChannelData(c));

  let peak = 0;
  for (const d of data) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak < 0.005) return buf; // deyarli jim yozuv — tegmaymiz

  const win = Math.max(1, Math.round(sr * 0.01));
  const thr = peak * 0.06;
  const rms = (from: number) => {
    let sum = 0;
    for (let c = 0; c < chs; c++) {
      const d = data[c]!;
      for (let i = from; i < from + win; i++) sum += d[i]! * d[i]!;
    }
    return Math.sqrt(sum / (win * chs));
  };
  let start = 0;
  let end = len;
  for (let i = 0; i + win <= len; i += win) {
    if (rms(i) > thr) {
      start = i;
      break;
    }
  }
  for (let i = len - win; i >= 0; i -= win) {
    if (rms(i) > thr) {
      end = i + win;
      break;
    }
  }
  start = Math.max(0, start - Math.round(sr * 0.04));
  end = Math.min(len, end + Math.round(sr * 0.09));
  if (end - start < win * 3) return buf;

  const outLen = end - start;
  const out = ctx.createBuffer(chs, outLen, sr);
  const gain = Math.min(8, 0.89 / peak);
  const fade = Math.min(Math.round(sr * 0.012), Math.floor(outLen / 2));
  for (let c = 0; c < chs; c++) {
    const src = data[c]!;
    const dst = out.getChannelData(c);
    for (let i = 0; i < outLen; i++) {
      let v = src[start + i]! * gain;
      if (i < fade) v *= i / fade;
      else if (i > outLen - fade) v *= (outLen - i) / fade;
      dst[i] = v;
    }
  }
  return out;
}

export class CastVoice {
  private ctx: AudioContext | null = null;
  private pack: Record<string, string> = {};
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private voice: SpeechSynthesisVoice | null = null;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    const synth = window.speechSynthesis;
    if (synth) {
      this.pickVoice();
      synth.addEventListener?.('voiceschanged', () => {
        this.pickVoice();
        this.emit();
      });
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((f) => f());
  }

  private pickVoice() {
    const all = window.speechSynthesis?.getVoices?.() ?? [];
    const uz = all.filter((v) => /^uz/i.test(v.lang));
    this.voice = uz.find((v) => /natural|online|neural/i.test(v.name)) ?? uz[0] ?? null;
  }

  /** Qurilmadagi o'zbek ovozi nomi (yo'q bo'lsa null). */
  get deviceVoiceName(): string | null {
    return this.voice?.name ?? null;
  }

  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.ctx.addEventListener?.('statechange', () => this.emit());
    return this.ctx;
  }

  /** Brauzer ovozga ruxsat berganmi (avtoplay cheklovi). */
  get unlocked(): boolean {
    return this.audio()?.state === 'running';
  }

  /** Foydalanuvchi bosganda chaqiriladi — ovoz cheklovini ochadi. */
  async unlock(): Promise<void> {
    try {
      await this.audio()?.resume();
    } catch {
      /* e'tiborsiz */
    }
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis?.speak(u);
    } catch {
      /* e'tiborsiz */
    }
    this.emit();
  }

  setPack(clips: Record<string, string>) {
    this.pack = { ...clips };
    for (const url of Object.values(this.pack)) void this.load(url);
    this.emit();
  }

  get packCount(): number {
    return CAST_VOICE_CLIPS.filter((c) => !!this.pack[c.key]).length;
  }

  get packComplete(): boolean {
    return this.packCount === CAST_VOICE_CLIPS.length;
  }

  mode(): CastVoiceMode {
    if (this.packComplete) return 'pack';
    if (this.voice) return 'device';
    return 'chime';
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.cache.get(url);
    if (!p) {
      p = (async () => {
        const ctx = this.audio();
        if (!ctx) return null;
        const res = await fetch(url);
        if (!res.ok) return null;
        return trimAndNormalize(ctx, await ctx.decodeAudioData(await res.arrayBuffer()));
      })().catch(() => null);
      this.cache.set(url, p);
    }
    return p;
  }

  /** Uch notali yumshoq qo'ng'iroq (G4–C5–E5). Ovoz boshlanadigan vaqtni qaytaradi. */
  private chime(ctx: AudioContext, at: number): number {
    const master = ctx.createGain();
    master.gain.value = 0.2;
    master.connect(ctx.destination);
    const notes = [392.0, 523.25, 659.25];
    notes.forEach((f, i) => {
      const t = at + i * 0.3;
      for (const [mult, g] of [
        [1, 1],
        [2, 0.16],
        [3, 0.05],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * mult;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(g, t + 0.015);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        osc.connect(env).connect(master);
        osc.start(t);
        osc.stop(t + 1.65);
      }
    });
    return at + (notes.length - 1) * 0.3 + 1.0;
  }

  private async waitUntil(t: number) {
    const ctx = this.ctx;
    if (ctx) await sleep((t - ctx.currentTime) * 1000);
  }

  private async playBuffers(bufs: AudioBuffer[], keys: string[], at: number): Promise<void> {
    const ctx = this.audio();
    if (!ctx) return;
    let t = Math.max(at, ctx.currentTime + 0.05);
    bufs.forEach((b, i) => {
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(t);
      // "raqamli bemor" dan keyin vergul pauzasi
      t += b.duration + (keys[i] === 'p_patient' || keys[i] === 'p_next' ? 0.3 : 0.03);
    });
    await sleep((t - ctx.currentTime) * 1000);
  }

  private speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth || !this.voice) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = this.voice;
      u.lang = this.voice.lang;
      u.rate = 0.92;
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      u.onend = finish;
      u.onerror = finish;
      setTimeout(finish, 12_000);
      synth.speak(u);
    });
  }

  /**
   * "To'rt raqamli bemor, sakkizinchi xonaga marhamat." — qo'ng'iroq + ovoz.
   * Chaqiruvlar navbat bilan aytiladi (bir vaqtda ikki shifokor chaqirsa ham
   * ustma-ust tushmaydi).
   */
  announce(input: { seq?: number | null; room?: string | null }, opts: { repeat?: number } = {}) {
    const run = async () => {
      try {
        const ctx = this.audio();
        const plan = castAnnouncementPlan(input);
        const repeat = Math.max(1, opts.repeat ?? 2);
        let at = ctx ? this.chime(ctx, ctx.currentTime + 0.05) : 0;
        const keys = plan.clips;
        const bufs =
          keys && keys.every((k) => !!this.pack[k])
            ? await Promise.all(keys.map((k) => this.load(this.pack[k]!)))
            : null;
        const usable = bufs && bufs.every(Boolean) ? (bufs as AudioBuffer[]) : null;
        for (let i = 0; i < repeat; i++) {
          if (usable && keys) {
            await this.playBuffers(usable, keys, at);
          } else if (this.voice) {
            await this.waitUntil(at);
            await this.speak(plan.text);
          } else {
            await this.waitUntil(at);
            break; // faqat qo'ng'iroq
          }
          at = ctx ? ctx.currentTime + 0.8 : 0;
        }
      } catch {
        /* ovoz chiqmasa ham ekran ishlayveradi */
      }
    };
    this.chain = this.chain.then(run);
    return this.chain;
  }

  /** Bitta yozuvni (kesilgan, tenglashtirilgan holda) eshittirish. */
  async preview(source: string | Blob): Promise<void> {
    const ctx = this.audio();
    if (!ctx) return;
    await this.unlock();
    const buf =
      typeof source === 'string'
        ? await this.load(source)
        : trimAndNormalize(ctx, await ctx.decodeAudioData(await source.arrayBuffer()));
    if (buf) await this.playBuffers([buf], [''], ctx.currentTime + 0.05);
  }
}
