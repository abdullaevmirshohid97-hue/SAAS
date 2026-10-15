import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type { Logger } from '../log';

import type { PbxApi, PbxCdr } from './api';

// =============================================================================
// Bulutli ATS — qo'ng'iroq yakuni (dialplan [clary-pbx-hangup] → CURL)
// =============================================================================
//   GET /pbx/cdr?uuid&tenant&dir&from&to&status&peer&start&end&answered&ai&xfer&vm&rec&cause
// Javob darhol "OK" (Asterisk kutmasin), keyin fonda: yozuv (MixMonitor WAV)
// Clary'ga yuklanadi → qo'ng'iroq qatori yuboriladi. API ishlamasa — qayta urinish.
// =============================================================================

const UUID_RE = /^[0-9a-f-]{36}$/i;
const CODE_RE = /^[a-z][a-z0-9]{2,15}$/;
const RETRY_SEC = [5, 30, 120, 600];
/** 0.5 s dan qisqa yozuv (8 kHz 16-bit) — saqlanmaydi */
const MIN_WAV_BYTES = 44 + 8000;

interface Job {
  cdr: PbxCdr;
  rec: boolean;
  attempt: number;
  uploadTries: number;
}

function int(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function text(v: string | null, max: number): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/** Dialplan so'rovidan CDR (noto'g'ri bo'lsa null). */
export function parseCdrQuery(q: URLSearchParams): { cdr: PbxCdr; rec: boolean } | null {
  const uuid = q.get('uuid') ?? '';
  const tenant = q.get('tenant') ?? '';
  const dir = q.get('dir') ?? '';
  if (!UUID_RE.test(uuid) || !CODE_RE.test(tenant)) return null;
  if (dir !== 'in' && dir !== 'out' && dir !== 'internal') return null;
  const status = (q.get('status') ?? '').trim().toUpperCase();
  const voicemail = q.get('vm') === '1';
  return {
    rec: q.get('rec') === '1' || voicemail,
    cdr: {
      uuid: uuid.toLowerCase(),
      tenant,
      direction: dir,
      from: text(q.get('from'), 80),
      to: text(q.get('to'), 80),
      dial_status: /^[A-Z_]{1,20}$/.test(status) ? status : null,
      peer: text(q.get('peer'), 200),
      started: int(q.get('start')),
      ended: int(q.get('end')),
      answered: int(q.get('answered')),
      ai: q.get('ai') === '1',
      xfer: q.get('xfer') === '1',
      voicemail,
      recording_path: null,
      hangup_cause: text(q.get('cause'), 40),
    },
  };
}

export class PbxCdrQueue {
  private pending = 0;

  constructor(
    private readonly api: PbxApi,
    private readonly opts: { recordingsDir: string; keepRecordings: boolean },
    private readonly log: Logger,
  ) {}

  get queued(): number {
    return this.pending;
  }

  push(q: URLSearchParams): boolean {
    const parsed = parseCdrQuery(q);
    if (!parsed) return false;
    this.pending++;
    void this.run({ cdr: parsed.cdr, rec: parsed.rec, attempt: 0, uploadTries: 0 });
    return true;
  }

  /** Ovozli xabar — Record() fayli; aks holda MixMonitor (odam gaplashgan qism). */
  private file(job: Job): string {
    const name = job.cdr.voicemail ? `${job.cdr.uuid}-vm.wav` : `${job.cdr.uuid}.wav`;
    return join(this.opts.recordingsDir, job.cdr.tenant, name);
  }

  /** MixMonitor faylni yopib bo'lguncha kutamiz (hajmi o'zgarmay qolsin). */
  private async waitStable(file: string): Promise<number> {
    let last = -1;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!existsSync(file)) {
        if (i >= 5) return 0;
        continue;
      }
      const size = statSync(file).size;
      if (size === last && size > 0) return size;
      last = size;
    }
    return Math.max(last, 0);
  }

  private async run(job: Job): Promise<void> {
    const { cdr } = job;
    if (job.rec && !cdr.recording_path && job.uploadTries < 3) {
      const file = this.file(job);
      try {
        const size = job.uploadTries === 0 ? await this.waitStable(file) : statSync(file).size;
        if (size >= MIN_WAV_BYTES) {
          const r = await this.api.recording(cdr.tenant, cdr.uuid, readFileSync(file));
          cdr.recording_path = r.path;
          if (!this.opts.keepRecordings) unlinkSync(file);
        } else {
          if (size > 0) unlinkSync(file);
          // Signaldan keyin hech narsa demay go'shakni qo'ygan — "o'tkazib yuborilgan"
          cdr.voicemail = false;
        }
        job.rec = false;
      } catch (e) {
        job.uploadTries++;
        this.log.warn(`[${cdr.uuid.slice(0, 8)}] ATS yozuvi yuklanmadi: ${(e as Error).message}`);
        if (job.uploadTries < 3) return this.retry(job);
      }
    }
    try {
      const r = await this.api.call(cdr);
      this.pending--;
      this.log.info(
        `[${cdr.uuid.slice(0, 8)}] ATS ${cdr.tenant} ${cdr.direction} ${cdr.from ?? '?'} → ${cdr.to ?? '?'}: ${r.status}`,
      );
    } catch (e) {
      this.log.warn(`[${cdr.uuid.slice(0, 8)}] ATS qo'ng'iroq qatori: ${(e as Error).message}`);
      this.retry(job);
    }
  }

  private retry(job: Job) {
    const delay = RETRY_SEC[job.attempt];
    if (delay === undefined) {
      this.pending--;
      this.log.error(
        `[${job.cdr.uuid.slice(0, 8)}] ATS qo'ng'iroq qatori yo'qoldi (API ${RETRY_SEC.length} marta javob bermadi)`,
      );
      return;
    }
    job.attempt++;
    setTimeout(() => void this.run(job), delay * 1000).unref();
  }
}
