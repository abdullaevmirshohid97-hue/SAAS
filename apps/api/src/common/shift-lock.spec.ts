import { describe, expect, it } from 'vitest';

import { auditDetails } from './interceptors/audit.interceptor';
import { shiftEditDecision } from './shift-lock';

describe('shiftEditDecision — yopilgan smena qulfi', () => {
  it('ochiq smena / smenasiz yozuv — hamma uchun ochiq', () => {
    expect(shiftEditDecision(null, 'cashier')).toBe('allow');
    expect(shiftEditDecision(null, 'receptionist')).toBe('allow');
  });

  it.each(['cashier', 'receptionist', 'doctor', 'staff', null, undefined])(
    'yopilgan smena — %s o‘zgartira olmaydi',
    (role) => {
      expect(shiftEditDecision('2026-11-20T18:00:00Z', role)).toBe('deny');
    },
  );

  it.each(['clinic_owner', 'clinic_admin', 'super_admin'])(
    'yopilgan smena — %s (rahbar) o‘zgartira oladi, audit belgisi bilan',
    (role) => {
      expect(shiftEditDecision('2026-11-20T18:00:00Z', role)).toBe('override');
    },
  );
});

describe('auditDetails — eski/yangi qiymat audit jurnaliga', () => {
  it('javobdagi audit obyektini oladi', () => {
    const audit = { before: { payment: 'cash' }, after: { payment: 'card' } };
    expect(auditDetails({ ok: true, audit })).toEqual({ details: audit });
  });
  it('audit bo‘lmasa — hech narsa qo‘shmaydi', () => {
    expect(auditDetails({ ok: true })).toEqual({});
    expect(auditDetails(null)).toEqual({});
  });
  it('juda katta obyekt jurnalni to‘ldirmaydi', () => {
    const audit = { blob: 'x'.repeat(10_000) };
    expect(auditDetails({ audit })).toEqual({ details: { truncated: true } });
  });
});
