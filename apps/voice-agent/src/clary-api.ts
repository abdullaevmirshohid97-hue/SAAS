// =============================================================================
// Clary API (apps/api/src/modules/ai-reception/voice.controller.ts) mijozi
// =============================================================================

export interface StartRequest {
  external_id: string;
  line_key?: string | null;
  did?: string | null;
  caller?: string | null;
  diversion?: string | null;
}

export interface StartResponse {
  mode: 'ai' | 'voicemail' | 'reject';
  call_id?: string;
  say?: string;
  clinic_name?: string;
  lang?: 'uz' | 'ru';
  greeting?: string | null;
  voicemail_prompt?: string | null;
  voicemail_thanks?: string;
  voice?: string | null;
  speech_speed?: number;
  max_seconds?: number;
  record?: boolean;
  caller_known?: boolean;
  transfer_available?: boolean;
}

export interface TurnResponse {
  say: string;
  lang: 'uz' | 'ru';
  end: boolean;
  action: 'none' | 'transfer' | 'hangup';
  transfer_to: string | null;
  outcome: string | null;
  appointment_id: string | null;
}

export interface EndRequest {
  call_id: string;
  duration_sec?: number;
  stt_seconds?: number;
  tts_chars?: number;
  hangup_by?: string;
  error?: string | null;
  voicemail_transcript?: string | null;
  has_recording?: boolean;
}

export class ClaryApi {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1/ai-reception/voice/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-voice-agent-key': this.secret,
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${path} ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  ping() {
    return this.call<{ ok: boolean; model: string }>('GET', 'ping', undefined, 5000);
  }

  start(body: StartRequest) {
    return this.call<StartResponse>('POST', 'start', body, 8000);
  }

  turn(body: { call_id: string; text: string; alt_text_ru?: string | null; stt_seconds?: number }) {
    // AI tool-use (bir necha aylanish) — 30 s gacha
    return this.call<TurnResponse>('POST', 'turn', body, 30_000);
  }

  end(body: EndRequest) {
    return this.call<{ ok: boolean }>('POST', 'end', body, 10_000);
  }

  recording(callId: string, wav: Buffer) {
    return this.call<{ ok: boolean; path: string }>(
      'POST',
      'recording',
      { call_id: callId, wav_base64: wav.toString('base64') },
      60_000,
    );
  }
}
