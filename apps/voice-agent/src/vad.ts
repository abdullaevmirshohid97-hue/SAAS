import { dbfs, FRAME_MS } from './audio';

// =============================================================================
// Nutqni aniqlash (VAD) — energiyaga asoslangan, moslashuvchan shovqin darajasi
// =============================================================================
// Telefon liniyasida fon shovqini -55..-40 dBFS, nutq -30..-10 dBFS. Shovqin
// darajasi sukunatda sekin kuzatiladi; nutq "shovqin + startDb" dan baland
// bo'lib ketma-ket 3 freym (60 ms) tursa — boshlandi; "shovqin + startDb - 4"
// dan past bo'lib `endSilenceMs` davom etsa — tugadi.
// =============================================================================

export interface VadOptions {
  /** Shovqindan necha dB baland bo'lsa nutq (default 12) */
  startDb: number;
  /** Shuncha ms sukunatdan keyin gap tugadi (default 700) */
  endSilenceMs: number;
  /** Bundan qisqa "gap" — yo'tal/shitirlash, e'tiborsiz (default 250) */
  minSpeechMs: number;
  /** Bitta gap maksimal uzunligi (default 15 s) */
  maxUtteranceMs: number;
  /** Mutlaq past chegara — juda jim liniyada shovqinni nutq deb olmaslik */
  absMinDb?: number;
}

export type VadEvent =
  | { type: 'start' }
  | { type: 'end'; speechMs: number; forced: boolean; tooShort: boolean };

export class Vad {
  private noiseDb = -55;
  private speaking = false;
  private loudFrames = 0;
  private silenceMs = 0;
  private speechMs = 0;
  private framesSeen = 0;

  constructor(private readonly opts: VadOptions) {}

  get inSpeech(): boolean {
    return this.speaking;
  }

  get noiseFloor(): number {
    return this.noiseDb;
  }

  private threshold(extra = 0): number {
    return Math.max(this.noiseDb + this.opts.startDb + extra, this.opts.absMinDb ?? -48);
  }

  /** Bitta 20 ms freym. Hodisa bo'lsa qaytaradi. */
  process(frame: Int16Array): VadEvent | null {
    const level = dbfs(frame);
    this.framesSeen++;

    if (!this.speaking) {
      if (level > this.threshold()) {
        this.loudFrames++;
        if (this.loudFrames >= 3) {
          this.speaking = true;
          this.silenceMs = 0;
          this.speechMs = this.loudFrames * FRAME_MS;
          this.loudFrames = 0;
          return { type: 'start' };
        }
      } else {
        this.loudFrames = 0;
        // Shovqin darajasini faqat sukunatda yangilaymiz; boshida tezroq moslashadi
        const rate = this.framesSeen < 25 ? 0.2 : 0.03;
        if (level < this.noiseDb + 6 || this.framesSeen < 25) {
          this.noiseDb = this.noiseDb * (1 - rate) + level * rate;
        }
      }
      return null;
    }

    this.speechMs += FRAME_MS;
    if (level > this.threshold(-4)) this.silenceMs = 0;
    else this.silenceMs += FRAME_MS;

    const forced = this.speechMs >= this.opts.maxUtteranceMs;
    if (this.silenceMs >= this.opts.endSilenceMs || forced) {
      const speechMs = this.speechMs - this.silenceMs;
      this.speaking = false;
      this.silenceMs = 0;
      this.speechMs = 0;
      return { type: 'end', speechMs, forced, tooShort: speechMs < this.opts.minSpeechMs };
    }
    return null;
  }

  /** AI gapirayotganda "gap bo'lyapti"mi (barge-in) — qattiqroq chegara. */
  isLoud(frame: Int16Array, extraDb = 6): boolean {
    return dbfs(frame) > this.threshold(extraDb);
  }

  reset() {
    this.speaking = false;
    this.loudFrames = 0;
    this.silenceMs = 0;
    this.speechMs = 0;
  }
}
