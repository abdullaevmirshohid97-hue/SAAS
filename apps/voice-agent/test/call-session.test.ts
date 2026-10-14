import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { splitFrames, tone } from '../src/audio';
import { KIND, uuidToBytes } from '../src/audiosocket';
import { CallSession } from '../src/call-session';
import type { ClaryApi } from '../src/clary-api';
import type { Config } from '../src/config';
import type { SttProvider } from '../src/providers/stt';
import type { TtsEngine } from '../src/providers/tts';
import { CallRegistry } from '../src/registry';

const UUID = '0b6f7f3c-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

const cfg = {
  vadStartDb: 12,
  vadEndSilenceMs: 400,
  vadMinSpeechMs: 200,
  vadMaxUtteranceMs: 15000,
  noInputMs: 5000,
  fillerAfterMs: 1300,
  voicemailMaxMs: 60000,
  sttDualFirst: false,
  transferFormat: 'e164',
  transferEndpoint: '',
  recordingsDir: '',
} as unknown as Config;

function noiseFrame(): Buffer {
  const b = Buffer.alloc(320);
  for (let i = 0; i < 160; i++) b.writeInt16LE(Math.round((Math.random() - 0.5) * 60), i * 2);
  return b;
}

function setup(turnReply: Record<string, unknown>) {
  const sent: Array<{ kind: number; len: number }> = [];
  let closed = false;
  const api = {
    start: vi.fn(async () => ({
      mode: 'ai',
      call_id: 'call-1',
      greeting: 'Assalomu alaykum',
      max_seconds: 300,
      record: true,
      voice: null,
      speech_speed: 1,
    })),
    turn: vi.fn(async () => turnReply),
    end: vi.fn(async () => ({ ok: true })),
    recording: vi.fn(async () => ({ ok: true, path: 'x' })),
  } as unknown as ClaryApi;
  const stt = {
    name: 'fake',
    transcribe: vi.fn(async () => 'Kardiologga yozilmoqchiman'),
  } as unknown as SttProvider;
  const tts = {
    name: 'fake',
    synthesize: vi.fn(async () => ({ pcm: tone(400, 200), billedChars: 10, cached: false })),
  } as unknown as TtsEngine;
  const registry = new CallRegistry();
  registry.register({
    uuid: UUID,
    line: 'goip1',
    did: null,
    from: '998901234567',
    diversion: null,
  });
  const session = new CallSession({
    cfg,
    api,
    stt,
    tts,
    registry,
    send: (kind, payload) => sent.push({ kind, len: payload?.length ?? 0 }),
    close: () => {
      closed = true;
    },
  });
  return { session, api, stt, tts, registry, sent, isClosed: () => closed };
}

/** `ms` davomida har 20 ms da freym beradi (Asterisk kabi). */
async function feed(session: CallSession, ms: number, frame: (i: number) => Buffer) {
  for (let i = 0; i < ms / 20; i++) {
    session.onFrame({ kind: KIND.AUDIO, payload: frame(i) });
    await vi.advanceTimersByTimeAsync(20);
  }
}

describe('CallSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("salomlashuv → bemor gapi → STT → AI → javob → go'shak", async () => {
    const { session, api, stt, registry, sent, isClosed } = setup({
      say: 'Ertaga soat o‘nga yozdim. Sog‘ bo‘ling!',
      lang: 'uz',
      end: true,
      action: 'hangup',
      transfer_to: null,
      outcome: 'booked',
      appointment_id: 'a1',
    });

    session.onFrame({ kind: KIND.ID, payload: uuidToBytes(UUID) });
    // salomlashuv o'qiladi (200 ms) — shovqin bilan VAD moslashadi
    await feed(session, 1200, () => noiseFrame());
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: UUID, line_key: 'goip1', caller: '998901234567' }),
    );
    expect(session.status).toBe('listening');
    expect(sent.filter((s) => s.kind === KIND.AUDIO).length).toBeGreaterThanOrEqual(10);

    // bemor 600 ms gapiradi, keyin jim
    const speech = splitFrames(tone(300, 600, 0.3));
    await feed(session, 600, (i) => speech[i] ?? noiseFrame());
    await feed(session, 1500, () => noiseFrame());

    expect(stt.transcribe).toHaveBeenCalledTimes(1);
    expect(api.turn).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-1', text: 'Kardiologga yozilmoqchiman' }),
    );

    // javob o'qiladi va go'shak qo'yiladi
    await feed(session, 1500, () => noiseFrame());
    expect(sent.some((s) => s.kind === KIND.HANGUP)).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(isClosed()).toBe(true);
    expect(api.recording).toHaveBeenCalledTimes(1);
    expect(api.end).toHaveBeenCalledWith(
      expect.objectContaining({ call_id: 'call-1', hangup_by: 'agent', has_recording: true }),
    );
    expect(registry.takeNext(UUID)).toBe('hangup');
  });

  it('odamga ulash — dialplan uchun keyingi amal', async () => {
    const { session, registry } = setup({
      say: 'Hozir ulayman',
      lang: 'uz',
      end: true,
      action: 'transfer',
      transfer_to: '+998901112233',
      outcome: 'transferred',
      appointment_id: null,
    });
    session.onFrame({ kind: KIND.ID, payload: uuidToBytes(UUID) });
    await feed(session, 1200, () => noiseFrame());
    const speech = splitFrames(tone(300, 600, 0.3));
    await feed(session, 600, (i) => speech[i] ?? noiseFrame());
    await feed(session, 3000, () => noiseFrame());
    expect(registry.takeNext(UUID)).toBe('transfer:+998901112233');
  });

  it('bemor go‘shakni qo‘ysa — API end chaqiriladi', async () => {
    const { session, api } = setup({ say: '', lang: 'uz', end: false, action: 'none' });
    session.onFrame({ kind: KIND.ID, payload: uuidToBytes(UUID) });
    await feed(session, 600, () => noiseFrame());
    session.onFrame({ kind: KIND.HANGUP, payload: Buffer.alloc(0) });
    await vi.advanceTimersByTimeAsync(100);
    expect(api.end).toHaveBeenCalledWith(expect.objectContaining({ hangup_by: 'caller' }));
  });
});
