import { createHash, createHmac, randomBytes } from 'node:crypto';

// =============================================================================
// Bulutli ATS — sof yordamchilar (bazasiz, testlanadi)
// =============================================================================

/** SIP digest realm — Asterisk auth bo'limlari va softfon (JsSIP ha1) bir xil. */
export const PBX_REALM = 'clary';

/** Klinika slug'idan Asterisk uchun qisqa kod: faqat a-z0-9, harf bilan boshlanadi, 3–12 belgi. */
export function baseTenantCode(slug: string | null | undefined): string {
  let s = String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  s = s.replace(/^[0-9]+/, '');
  if (s.length < 3) s = `c${s}clinic`.slice(0, 8);
  return s.slice(0, 12);
}

/** Band bo'lsa — oxiriga raqam: magnus → magnus2 → magnus3 ... (16 belgidan oshmaydi). */
export function nextTenantCode(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const cand = `${base.slice(0, 16 - String(i).length)}${i}`;
    if (!taken.has(cand)) return cand;
  }
  return `${base.slice(0, 8)}${randomBytes(3).toString('hex')}`;
}

const PASS_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Telefon panelida qo'lda yozish oson bo'lsin: o'xshash belgilar (0/O, 1/l/I) yo'q. */
export function generatePassword(length = 14): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += PASS_ALPHABET[(bytes[i] ?? 0) % PASS_ALPHABET.length];
  return out;
}

/** SIP digest HA1 = MD5(username:realm:password) — Asterisk md5_cred va JsSIP ha1. */
export function sipHa1(username: string, password: string, realm = PBX_REALM): string {
  return createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
}

/**
 * coturn "REST API" vaqtinchalik login: username = "<tugash vaqti>:<id>",
 * credential = base64(HMAC-SHA1(static-auth-secret, username)).
 */
export function turnCredentials(
  secret: string,
  userId: string,
  ttlSec = 12 * 3600,
  nowMs = Date.now(),
): { username: string; credential: string } {
  const username = `${Math.floor(nowMs / 1000) + ttlSec}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/**
 * Bo'sh ichki raqam: 201 dan boshlab. 1XX ishlatilmaydi — O'zbekistonda 101–104 va
 * 112 favqulodda xizmatlar (stol telefonidan 103 terilsa tez yordamga chiqishi kerak).
 */
export function nextExtension(used: Iterable<string>): string {
  const set = new Set(used);
  for (let n = 201; n <= 899; n++) {
    const ext = String(n);
    if (!set.has(ext)) return ext;
  }
  throw new Error('Bo‘sh ichki raqam qolmadi');
}

/** "PJSIP/magnus101w-0000002a" → "magnus101w"; "magnus101" → "magnus101". */
export function endpointFromChannel(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const noTech = v.includes('/') ? v.slice(v.indexOf('/') + 1) : v;
  const name = noTech.replace(/-[0-9a-f]{8}$/i, '');
  return /^[a-z0-9_-]{2,40}$/i.test(name) ? name.toLowerCase() : null;
}

/** Ichki raqam formati: 201–899. */
export const EXTENSION_RE = /^[2-8][0-9]{2}$/;

export type PbxCallStatus = 'answered' | 'missed' | 'ai' | 'voicemail' | 'busy' | 'failed';

/** Asterisk DIALSTATUS + yo'nalish + AI / ovozli xabar belgisi → jurnal holati. */
export function mapCallStatus(
  direction: 'in' | 'out' | 'internal',
  dialStatus: string | null | undefined,
  ai: boolean,
  voicemail = false,
): PbxCallStatus {
  const s = String(dialStatus ?? '').toUpperCase();
  if (direction === 'in') {
    // AI olib, keyin xodimga ulagan va xodim javob bergan bo'lsa ham — "javob berildi"
    if (s === 'ANSWER') return 'answered';
    if (voicemail) return 'voicemail';
    return ai ? 'ai' : 'missed';
  }
  if (s === 'ANSWER') return 'answered';
  if (s === 'BUSY') return 'busy';
  return 'failed';
}

/** O'zbekiston raqami → '+998XXXXXXXXX' (aks holda null). */
export function normalizeDid(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return null;
}

/** SIP server manzili: host yoki IP (port/sxemasiz). */
export function validHost(host: string | null | undefined): boolean {
  const h = String(host ?? '').trim();
  return /^(?=.{1,253}$)([a-z0-9-]+\.)*[a-z0-9-]+$/i.test(h) && !h.startsWith('-');
}
