// =============================================================================
// Asterisk AudioSocket protokoli
// =============================================================================
// https://docs.asterisk.org/Configuration/Channel-Drivers/AudioSocket/
// Har xabar: [turi: 1 bayt][uzunlik: 2 bayt, big-endian][ma'lumot]
//   0x00 — go'shak qo'yildi (ma'lumotsiz)
//   0x01 — qo'ng'iroq UUID'i (16 bayt) — ulanishdagi birinchi xabar
//   0x03 — DTMF (1 bayt, ASCII raqam) — Asterisk 20+
//   0x10 — audio: 16-bit, 8 kHz, mono, little-endian (20 ms = 320 bayt)
//   0xff — xato (1 bayt kod)
// =============================================================================

export const KIND = {
  HANGUP: 0x00,
  ID: 0x01,
  DTMF: 0x03,
  AUDIO: 0x10,
  ERROR: 0xff,
} as const;

export interface Frame {
  kind: number;
  payload: Buffer;
}

export function encodeFrame(kind: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(3);
  header.writeUInt8(kind, 0);
  header.writeUInt16BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** TCP oqimidan butun freymlarni ajratadi (bo'laklangan paketlarga chidamli). */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames: Frame[] = [];
    while (this.buf.length >= 3) {
      const kind = this.buf.readUInt8(0);
      const len = this.buf.readUInt16BE(1);
      if (this.buf.length < 3 + len) break;
      frames.push({ kind, payload: Buffer.from(this.buf.subarray(3, 3 + len)) });
      this.buf = this.buf.subarray(3 + len);
    }
    return frames;
  }
}

/** 16 bayt → "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" */
export function uuidFromBytes(b: Buffer): string {
  const h = b.toString('hex').padEnd(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}
