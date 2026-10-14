// =============================================================================
// Asterisk dialplan ↔ voice-agent: qo'ng'iroq ma'lumoti va keyingi amal
// =============================================================================
// AudioSocket faqat UUID beradi. Shuning uchun dialplan AudioSocket'dan OLDIN
// CURL bilan /calls/register?uuid=..&line=..&did=..&from=.. yuboradi (bu yerda
// saqlanadi), AudioSocket tugagach /calls/next?uuid=.. bilan keyingi amalni
// so'raydi: "hangup" yoki "transfer:<raqam>[:<endpoint>]".
// =============================================================================

export interface CallMeta {
  uuid: string;
  line: string | null;
  did: string | null;
  from: string | null;
  diversion: string | null;
  at: number;
}

const META_TTL_MS = 2 * 60_000;
const NEXT_TTL_MS = 10 * 60_000;

export class CallRegistry {
  private readonly meta = new Map<string, CallMeta>();
  private readonly next = new Map<string, { action: string; at: number }>();
  private active = 0;

  register(m: Omit<CallMeta, 'at'>) {
    this.gc();
    this.meta.set(m.uuid.toLowerCase(), { ...m, at: Date.now() });
  }

  take(uuid: string): CallMeta | null {
    const key = uuid.toLowerCase();
    const m = this.meta.get(key) ?? null;
    this.meta.delete(key);
    return m;
  }

  setNext(uuid: string, action: string) {
    this.next.set(uuid.toLowerCase(), { action, at: Date.now() });
  }

  takeNext(uuid: string): string {
    const key = uuid.toLowerCase();
    const n = this.next.get(key);
    this.next.delete(key);
    return n?.action ?? 'hangup';
  }

  callStarted() {
    this.active++;
  }

  callEnded() {
    this.active = Math.max(0, this.active - 1);
  }

  get activeCalls(): number {
    return this.active;
  }

  private gc() {
    const now = Date.now();
    for (const [k, v] of this.meta) if (now - v.at > META_TTL_MS) this.meta.delete(k);
    for (const [k, v] of this.next) if (now - v.at > NEXT_TTL_MS) this.next.delete(k);
  }
}
