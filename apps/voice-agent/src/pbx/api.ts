import type { ContactStatus, RegistrationStatus } from './asterisk';
import type { PbxAgentConfig } from './types';

// =============================================================================
// Clary API (apps/api/src/modules/telephony/telephony-agent.controller.ts) mijozi
// =============================================================================

export interface PbxCdr {
  uuid: string;
  tenant: string;
  direction: 'in' | 'out' | 'internal';
  from: string | null;
  to: string | null;
  dial_status: string | null;
  peer: string | null;
  started: number | null;
  ended: number | null;
  answered: number | null;
  ai: boolean;
  xfer: boolean;
  recording_path: string | null;
  hangup_cause: string | null;
}

export class PbxApi {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    timeoutMs: number,
    raw?: { data: Buffer; type: string },
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1/telephony/agent/${path}`, {
      method,
      headers: {
        'Content-Type': raw ? raw.type : 'application/json',
        'x-voice-agent-key': this.secret,
      },
      body: raw ? raw.data : method === 'POST' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`API telephony/${path.split('?')[0]} ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  config() {
    return this.request<PbxAgentConfig>('GET', 'config', undefined, 20_000);
  }

  status(body: { registrations: RegistrationStatus[]; contacts: ContactStatus[] }) {
    return this.request<{ ok: boolean; changed: number }>('POST', 'status', body, 20_000);
  }

  call(body: PbxCdr) {
    return this.request<{ ok: boolean; status: string }>('POST', 'call', body, 15_000);
  }

  recording(tenant: string, uuid: string, wav: Buffer) {
    const qs = new URLSearchParams({ tenant, uuid });
    return this.request<{ ok: boolean; path: string }>(
      'POST',
      `recording?${qs.toString()}`,
      undefined,
      180_000,
      { data: wav, type: 'audio/wav' },
    );
  }
}
