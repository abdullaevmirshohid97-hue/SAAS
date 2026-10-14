import { describe, expect, it } from 'vitest';

import {
  bufferFromPcm,
  dbfs,
  decodeWav,
  encodeWav,
  floatToInt16,
  FRAME_BYTES,
  mix,
  pcmFromBuffer,
  resampleFloat,
  silence,
  simulateTelephone,
  splitFrames,
  tone,
  wavToTelephone,
} from '../src/audio';
import { encodeFrame, FrameParser, KIND, uuidFromBytes, uuidToBytes } from '../src/audiosocket';
import { formatTransferNumber } from '../src/config';
import { cer, wer } from '../src/metrics';
import { splitForSpeech } from '../src/providers/tts';
import { Vad } from '../src/vad';

function sine(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * amp;
  return out;
}

/** 16-bit stereo WAV (TTS provayderlari shunday qaytarishi mumkin) */
function stereoWav(f: Float32Array, rate: number): Buffer {
  const pcm = floatToInt16(f);
  const data = Buffer.alloc(pcm.length * 4);
  for (let i = 0; i < pcm.length; i++) {
    data.writeInt16LE(pcm[i] ?? 0, i * 4);
    data.writeInt16LE(pcm[i] ?? 0, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe('audio', () => {
  it('WAV yozish/o‘qish', () => {
    const pcm = tone(440, 100);
    const back = decodeWav(encodeWav(pcm));
    expect(back.sampleRate).toBe(8000);
    expect(back.samples.length).toBe(pcm.length);
    expect(Math.abs((back.samples[100] ?? 0) - (pcm[100] ?? 0) / 32768)).toBeLessThan(1e-4);
  });

  it('24 kHz stereo → 8 kHz mono, chastota saqlanadi', () => {
    const wav = stereoWav(sine(440, 24000, 0.5), 24000);
    const pcm = wavToTelephone(wav);
    expect(pcm.length).toBe(4000);
    // 440 Hz: nol kesishmalar soni ≈ 2 * 440 * 0.5 = 440
    let zc = 0;
    for (let i = 1; i < pcm.length; i++) if ((pcm[i - 1] ?? 0) < 0 !== (pcm[i] ?? 0) < 0) zc++;
    expect(Math.abs(zc - 440)).toBeLessThan(12);
  });

  it('pastga tushirishda 3.4 kHz dan yuqorisi so‘nadi (aliasing yo‘q)', () => {
    const high = resampleFloat(sine(6000, 24000, 0.3), 24000, 8000);
    const low = resampleFloat(sine(1000, 24000, 0.3), 24000, 8000);
    expect(dbfs(floatToInt16(high))).toBeLessThan(dbfs(floatToInt16(low)) - 20);
  });

  it('telefon taqlidi 8 kHz qaytaradi', () => {
    const pcm = simulateTelephone(stereoWav(sine(1000, 16000, 0.2), 16000));
    expect(pcm.length).toBe(1600);
  });

  it('freymlar, aralashtirish, daraja', () => {
    const frames = splitFrames(tone(300, 50));
    expect(frames).toHaveLength(3);
    expect(frames.every((f) => f.length === FRAME_BYTES)).toBe(true);
    expect(pcmFromBuffer(bufferFromPcm(new Int16Array([1, -2, 3])))).toEqual(
      new Int16Array([1, -2, 3]),
    );
    expect(mix(new Int16Array([30000]), new Int16Array([10000]))[0]).toBe(32767);
    expect(dbfs(silence(20))).toBe(-90);
  });
});

describe('AudioSocket protokoli', () => {
  it('bo‘laklangan oqimdan freymlar', () => {
    const uuid = '0b6f7f3c-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    const data = Buffer.concat([
      encodeFrame(KIND.ID, uuidToBytes(uuid)),
      encodeFrame(KIND.AUDIO, Buffer.alloc(320, 1)),
      encodeFrame(KIND.HANGUP),
    ]);
    const p = new FrameParser();
    const a = p.push(data.subarray(0, 10));
    const b = p.push(data.subarray(10, 200));
    const c = p.push(data.subarray(200));
    const all = [...a, ...b, ...c];
    expect(all.map((f) => f.kind)).toEqual([KIND.ID, KIND.AUDIO, KIND.HANGUP]);
    expect(uuidFromBytes(all[0]!.payload)).toBe(uuid);
    expect(all[1]!.payload.length).toBe(320);
  });
});

describe('VAD', () => {
  const opts = { startDb: 12, endSilenceMs: 400, minSpeechMs: 200, maxUtteranceMs: 15000 };
  const noise = () => {
    const f = new Int16Array(160);
    for (let i = 0; i < 160; i++) f[i] = Math.round((Math.random() - 0.5) * 60);
    return f;
  };
  const speech = (i: number) => tone(300 + (i % 5) * 40, 20, 0.3);

  it('shovqin → nutq → sukunat: start va end', () => {
    const v = new Vad(opts);
    const events: string[] = [];
    for (let i = 0; i < 50; i++) if (v.process(noise())) events.push('?');
    for (let i = 0; i < 30; i++) {
      const e = v.process(speech(i));
      if (e) events.push(e.type);
    }
    let end: ReturnType<Vad['process']> = null;
    for (let i = 0; i < 40 && !end; i++) end = v.process(noise());
    expect(events).toEqual(['start']);
    expect(end?.type).toBe('end');
    if (end?.type === 'end') {
      expect(end.tooShort).toBe(false);
      expect(end.speechMs).toBeGreaterThanOrEqual(500);
    }
  });

  it('qisqa "chiq" — tooShort', () => {
    const v = new Vad(opts);
    for (let i = 0; i < 50; i++) v.process(noise());
    for (let i = 0; i < 5; i++) v.process(speech(i));
    let end: ReturnType<Vad['process']> = null;
    for (let i = 0; i < 40 && !end; i++) end = v.process(noise());
    expect(end?.type === 'end' && end.tooShort).toBe(true);
  });
});

describe('boshqalar', () => {
  it('WER / CER', () => {
    expect(wer('kardiologga ertaga yozilmoqchiman', 'kardiologga ertaga yozilmoqchiman')).toBe(0);
    expect(wer('ertaga soat o‘nda', "ertaga soat o'nda")).toBe(0);
    expect(wer('bir ikki uch to‘rt', 'bir ikki besh')).toBe(0.5);
    expect(cer('abc', 'abd')).toBeCloseTo(1 / 3);
  });

  it('matnni til bo‘yicha bo‘lish', () => {
    expect(splitForSpeech('Assalomu alaykum! Klinika. Можете говорить по-русски.')).toEqual([
      { text: 'Assalomu alaykum! Klinika.', lang: 'uz' },
      { text: 'Можете говорить по-русски.', lang: 'ru' },
    ]);
  });

  it('ulash raqami formati', () => {
    expect(formatTransferNumber('+998901234567', 'e164')).toBe('+998901234567');
    expect(formatTransferNumber('+998901234567', 'digits12')).toBe('998901234567');
    expect(formatTransferNumber('+998901234567', 'local9')).toBe('901234567');
  });
});
