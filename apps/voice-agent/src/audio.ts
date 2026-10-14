// =============================================================================
// Audio yordamchilari — telefon ovozi: 8 kHz, 16-bit, mono (Asterisk slin)
// =============================================================================
// Qo'shimcha paketsiz: WAV o'qish/yozish, chastota o'zgartirish (windowed-sinc),
// daraja (dBFS), ohang/sukunat, freymlarga bo'lish, aralashtirish.
// =============================================================================

export const SAMPLE_RATE = 8000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000; // 160
export const FRAME_BYTES = FRAME_SAMPLES * 2; // 320

/** Little-endian Int16 bayt → Int16Array (nusxa — Buffer'ning tekislanishiga bog'liq emas). */
export function pcmFromBuffer(buf: Buffer): Int16Array {
  const out = new Int16Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

export function bufferFromPcm(pcm: Int16Array): Buffer {
  const buf = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i] ?? 0, i * 2);
  return buf;
}

/** O'rtacha kvadratik daraja, dBFS (-∞..0). Sukunat ≈ -90. */
export function dbfs(pcm: Int16Array): number {
  if (pcm.length === 0) return -90;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = (pcm[i] ?? 0) / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / pcm.length);
  return rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90;
}

export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const data = bufferFromPcm(pcm);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  /** Mono, -1..1 */
  samples: Float32Array;
}

/** WAV (PCM 8/16/24/32-bit, float32, extensible) → mono float. */
export function decodeWav(buf: Buffer): DecodedWav {
  if (
    buf.length < 12 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('WAV emas');
  }
  let pos = 12;
  let format = 1;
  let channels = 1;
  let sampleRate = SAMPLE_RATE;
  let bits = 16;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'data' && (size === 0 || size === 0xffffffff || body + size > buf.length)) {
      size = buf.length - body; // oqimli (streaming) WAV — o'lcham noma'lum
    }
    if (id === 'fmt ') {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
      break;
    }
    pos = body + size + (size % 2);
  }
  if (!data) throw new Error('WAV: data bo‘limi yo‘q');
  if (channels < 1) channels = 1;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = (f * channels + c) * bytes;
      let v = 0;
      if (format === 3 && bits === 32) v = data.readFloatLE(o);
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 8) v = ((data[o] ?? 128) - 128) / 128;
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648;
      else throw new Error(`WAV: ${bits}-bit qo‘llanmaydi`);
      acc += v;
    }
    out[f] = acc / channels;
  }
  return { sampleRate, channels, samples: out };
}

/**
 * Chastotani o'zgartirish — Hann oynali sinc (pastga tushirishda past-o'tkazgich
 * filtr ham shu: telefon diapazonidan yuqori chastotalar "aliasing" bermaydi).
 */
export function resampleFloat(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const ratio = to / from;
  const outLen = Math.floor(input.length * ratio);
  const out = new Float32Array(outLen);
  const cutoff = Math.min(1, ratio) * 0.92;
  const width = Math.ceil(12 / Math.min(1, ratio));
  for (let i = 0; i < outLen; i++) {
    const center = i / ratio;
    const base = Math.floor(center);
    let sum = 0;
    let norm = 0;
    for (let k = base - width + 1; k <= base + width; k++) {
      if (k < 0 || k >= input.length) continue;
      const d = center - k;
      const x = d * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / (width + 1));
      const c = sinc * w;
      sum += (input[k] ?? 0) * c;
      norm += c;
    }
    out[i] = norm !== 0 ? sum / norm : 0;
  }
  return out;
}

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i] ?? 0));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

export function int16ToFloat(p: Int16Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = (p[i] ?? 0) / 32768;
  return out;
}

/** Istalgan WAV → telefon PCM (8 kHz, int16, mono). */
export function wavToTelephone(buf: Buffer): Int16Array {
  const w = decodeWav(buf);
  return floatToInt16(resampleFloat(w.samples, w.sampleRate, SAMPLE_RATE));
}

export function silence(ms: number): Int16Array {
  return new Int16Array(Math.round((SAMPLE_RATE * ms) / 1000));
}

/** Signal ("bip") — ovozli xabar oldidan. */
export function tone(freq: number, ms: number, amp = 0.25): Int16Array {
  const n = Math.round((SAMPLE_RATE * ms) / 1000);
  const out = new Int16Array(n);
  const fade = Math.min(80, Math.floor(n / 4));
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - i) / fade);
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * amp * env * 32767);
  }
  return out;
}

export function concatPcm(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 320 baytli (20 ms) freymlar; oxirgisi sukunat bilan to'ldiriladi. */
export function splitFrames(pcm: Int16Array): Buffer[] {
  const frames: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += FRAME_SAMPLES) {
    const chunk = new Int16Array(FRAME_SAMPLES);
    chunk.set(pcm.subarray(i, Math.min(i + FRAME_SAMPLES, pcm.length)));
    frames.push(bufferFromPcm(chunk));
  }
  return frames;
}

/** Ikki signalni qo'shish (yozuv uchun: bemor + AI), to'yinish bilan. */
export function mix(a: Int16Array, b: Int16Array): Int16Array {
  const n = Math.max(a.length, b.length);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = (a[i] ?? 0) + (b[i] ?? 0);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
}

/** RBJ biquad (benchmark: telefon kanalini taqlid qilish — 300–3400 Hz). */
function biquad(input: Float32Array, rate: number, freq: number, type: 'lp' | 'hp'): Float32Array {
  const w0 = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const b0 = type === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = type === 'lp' ? 1 - cos : -(1 + cos);
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] ?? 0;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Yuqori sifatli yozuvni telefon sifatiga tushirish (8 kHz, 300–3400 Hz). */
export function simulateTelephone(buf: Buffer): Int16Array {
  const w = decodeWav(buf);
  const narrow = resampleFloat(w.samples, w.sampleRate, SAMPLE_RATE);
  return floatToInt16(biquad(biquad(narrow, SAMPLE_RATE, 300, 'hp'), SAMPLE_RATE, 3400, 'lp'));
}
