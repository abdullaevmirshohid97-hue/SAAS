import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  baseTenantCode,
  endpointFromChannel,
  EXTENSION_RE,
  generatePassword,
  mapCallStatus,
  nextExtension,
  nextTenantCode,
  normalizeDid,
  sipHa1,
  turnCredentials,
  validHost,
} from './pbx-utils';

describe('pbx-utils', () => {
  it('klinika kodi', () => {
    expect(baseTenantCode('magnus')).toBe('magnus');
    expect(baseTenantCode('Shifo-Med 24')).toBe('shifomed24');
    expect(baseTenantCode('123clinic')).toBe('clinic');
    expect(baseTenantCode('ab')).toMatch(/^[a-z][a-z0-9]{2,15}$/);
    expect(baseTenantCode('juda-uzun-klinika-nomi-toshkent')).toHaveLength(12);
    expect(nextTenantCode('magnus', new Set(['magnus', 'magnus2']))).toBe('magnus3');
    expect(nextTenantCode('magnus', new Set())).toBe('magnus');
  });

  it('parol va HA1', () => {
    const p = generatePassword(14);
    expect(p).toHaveLength(14);
    expect(p).not.toMatch(/[0O1lI]/);
    expect(sipHa1('magnus101', 'secret')).toBe(
      createHash('md5').update('magnus101:clary:secret').digest('hex'),
    );
  });

  it('TURN vaqtinchalik login (coturn REST)', () => {
    const now = Date.UTC(2026, 9, 15, 10, 0, 0);
    const c = turnCredentials('s3cret', 'user-1', 3600, now);
    expect(c.username).toBe(`${Math.floor(now / 1000) + 3600}:user-1`);
    expect(c.credential).toBe(createHmac('sha1', 's3cret').update(c.username).digest('base64'));
  });

  it('ichki raqam', () => {
    expect(nextExtension([])).toBe('201');
    expect(nextExtension(['201', '202', '204'])).toBe('203');
    // 1XX — favqulodda raqamlar bilan to'qnashmasin
    expect(EXTENSION_RE.test('103')).toBe(false);
    expect(EXTENSION_RE.test('201')).toBe(true);
  });

  it('kanal nomidan endpoint', () => {
    expect(endpointFromChannel('PJSIP/magnus101w-0000002a')).toBe('magnus101w');
    expect(endpointFromChannel('magnus101')).toBe('magnus101');
    expect(endpointFromChannel('')).toBe(null);
    expect(endpointFromChannel('PJSIP/../etc')).toBe(null);
  });

  it('qo‘ng‘iroq holati', () => {
    expect(mapCallStatus('in', 'ANSWER', false)).toBe('answered');
    expect(mapCallStatus('in', 'NOANSWER', false)).toBe('missed');
    expect(mapCallStatus('in', 'CHANUNAVAIL', true)).toBe('ai');
    expect(mapCallStatus('in', 'ANSWER', true)).toBe('answered');
    expect(mapCallStatus('in', 'NOANSWER', false, true)).toBe('voicemail');
    expect(mapCallStatus('out', 'BUSY', false)).toBe('busy');
    expect(mapCallStatus('out', 'CONGESTION', false)).toBe('failed');
  });

  it('raqam va host', () => {
    expect(normalizeDid('71 200 00 00')).toBe('+998712000000');
    expect(normalizeDid('+998 90 123 45 67')).toBe('+998901234567');
    expect(normalizeDid('12345')).toBe(null);
    expect(validHost('sip.uztelecom.uz')).toBe(true);
    expect(validHost('195.158.1.10')).toBe(true);
    expect(validHost('sip://bad host')).toBe(false);
  });
});
