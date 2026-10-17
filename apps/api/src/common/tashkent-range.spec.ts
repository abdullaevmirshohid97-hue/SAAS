import { describe, expect, it } from 'vitest';

import {
  addDays,
  presetRange,
  tashkentBounds,
  tashkentDate,
  tashkentDayOf,
  tashkentDowHour,
} from './tashkent-range';

describe('tashkent-range', () => {
  it('00:00–05:00 Toshkentda ham bugungi sana (UTC kechagi kun bo‘lsa ham)', () => {
    // 2026-10-01 02:00 Toshkent = 2026-09-30 21:00 UTC
    expect(tashkentDate(new Date('2026-09-30T21:00:00Z'))).toBe('2026-10-01');
    expect(tashkentDate(new Date('2026-09-30T18:59:59Z'))).toBe('2026-09-30');
  });

  it('presetlar: today, 7d/week, 30d, month, year', () => {
    const now = new Date('2026-10-01T00:30:00Z'); // Toshkent 05:30, 1-oktabr
    expect(presetRange('today', undefined, undefined, 'today', now)).toEqual({
      from: '2026-10-01',
      to: '2026-10-01',
    });
    expect(presetRange('7d', undefined, undefined, 'today', now).from).toBe('2026-09-25');
    expect(presetRange('week', undefined, undefined, 'today', now).from).toBe('2026-09-25');
    expect(presetRange('30d', undefined, undefined, 'today', now).from).toBe('2026-09-02');
    expect(presetRange('month', undefined, undefined, 'today', now).from).toBe('2026-10-01');
    expect(presetRange('year', undefined, undefined, 'today', now).from).toBe('2026-01-01');
  });

  it('noma’lum preset — fallback; aniq sanalar tartiblanadi', () => {
    const now = new Date('2026-10-16T10:00:00Z');
    expect(presetRange('xyz', undefined, undefined, 'month', now)).toEqual({
      from: '2026-10-01',
      to: '2026-10-16',
    });
    expect(presetRange(undefined, '2026-10-10', '2026-10-01')).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
    });
    expect(presetRange('today', '2026-13-01', 'yomon', 'today', now).from).toBe('2026-10-16');
  });

  it('chegaralar Toshkent yarim tunida (UTC 19:00)', () => {
    expect(tashkentBounds('2026-10-01', '2026-10-01')).toEqual({
      startIso: '2026-09-30T19:00:00.000Z',
      endIso: '2026-10-01T19:00:00.000Z',
    });
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('hafta kuni va soat Toshkent bo‘yicha', () => {
    // 2026-10-04 (yakshanba) 20:30 UTC = 2026-10-05 dushanba 01:30 Toshkent
    expect(tashkentDowHour('2026-10-04T20:30:00Z')).toEqual({ dow: 1, hour: 1 });
    expect(tashkentDayOf('2026-10-04T20:30:00Z')).toBe('2026-10-05');
  });
});
