// =============================================================================
// Softfon ovozlari (WebAudio — fayl kerak emas): kiruvchi qo'ng'iroq jiringi va
// chiquvchida "gudok" (425 Hz — O'zbekiston/MDH standarti).
// =============================================================================

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nodes: Array<{ osc: OscillatorNode; gain: GainNode }> = [];

function audio(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Brauzer ovozni faqat foydalanuvchi bosganidan keyin ruxsat beradi — birinchi bosishda tayyorlab qo'yamiz. */
export function unlockAudio() {
  audio();
}

function beep(freqs: number[], ms: number, volume: number) {
  const c = audio();
  if (!c) return;
  const now = c.currentTime;
  for (const f of freqs) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.setValueAtTime(volume, now + ms / 1000 - 0.02);
    gain.gain.linearRampToValueAtTime(0, now + ms / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + ms / 1000 + 0.05);
    const entry = { osc, gain };
    nodes.push(entry);
    osc.onended = () => {
      nodes = nodes.filter((n) => n !== entry);
    };
  }
}

export function stopTones() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const n of nodes) {
    try {
      n.osc.stop();
    } catch {
      /* allaqachon to'xtagan */
    }
  }
  nodes = [];
}

/** Kiruvchi qo'ng'iroq: ikki tovushli jiring, har 3 soniyada. */
export function startRingtone() {
  stopTones();
  const ring = () => {
    beep([440, 480], 400, 0.16);
    setTimeout(() => beep([440, 480], 400, 0.16), 550);
  };
  ring();
  timer = setInterval(ring, 3000);
}

/** Chiquvchi: u tomonda jiringlayapti (operator "erta media" yubormasa). */
export function startRingback() {
  stopTones();
  const tone = () => beep([425], 1000, 0.08);
  tone();
  timer = setInterval(tone, 5000);
}
