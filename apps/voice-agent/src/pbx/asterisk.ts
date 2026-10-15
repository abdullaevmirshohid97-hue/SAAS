import { execFile } from 'node:child_process';

// =============================================================================
// Asterisk CLI (asterisk -rx) — buyruq va javobni o'qish
// =============================================================================

/** `asterisk -rx "<buyruq>"` — voice-agent root (yoki asterisk guruhi) nomidan ishlaydi. */
export function rx(command: string, bin = 'asterisk', timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['-rx', command],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`${command}: ${(stderr || err.message).toString().trim().slice(0, 300)}`),
          );
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

export interface RegistrationStatus {
  endpoint: string;
  status: string;
}

export interface ContactStatus {
  aor: string;
  status: string;
}

/**
 * `pjsip show registrations`:
 *   trunk-magnus/sip:sip.uztelecom.uz:5060   trunk-magnus-auth   Registered   (exp. 245s)
 */
export function parseRegistrations(text: string): RegistrationStatus[] {
  const out: RegistrationStatus[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m =
      /^\s*([A-Za-z0-9_.-]+)\/(sips?:\S+)\s+.*?\b(Unregistered|Registered|Rejected|Stopped|Unknown)\b/i.exec(
        line,
      );
    if (!m) continue;
    out.push({ endpoint: m[1] as string, status: m[3] as string });
  }
  return out;
}

/**
 * `pjsip show contacts`:
 *   Contact:  magnus201/sip:magnus201@10.0.0.5:5060    4f6d7a1c2b Avail        23.456
 */
export function parseContacts(text: string): ContactStatus[] {
  const out: ContactStatus[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*Contact:\s+([A-Za-z0-9_.-]+)\/(\S+)\s+(?:[0-9a-f]{6,}\s+)?([A-Za-z]+)/.exec(
      line,
    );
    if (!m) continue;
    out.push({ aor: m[1] as string, status: m[3] as string });
  }
  return out;
}
