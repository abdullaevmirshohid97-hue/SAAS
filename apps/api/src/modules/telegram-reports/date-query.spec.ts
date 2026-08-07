import { describe, expect, it } from 'vitest';

import { MAX_RANGE_DAYS, fmtDayHuman, parseDayRange } from './date-query';

// Barcha testlar qat'iy nuqtaga bog'langan: 2026-08-07 12:00 Toshkent.
const NOW = new Date('2026-08-07T07:00:00Z');

describe('parseDayRange — bitta kun', () => {
  it('dd.mm.yyyy', () => {
    expect(parseDayRange('07.08.2026', NOW)).toEqual({ from: '2026-08-07', to: '2026-08-07' });
  });

  it('nol siz yozilgan kun/oy', () => {
    expect(parseDayRange('7.8.2026', NOW)).toEqual({ from: '2026-08-07', to: '2026-08-07' });
  });

  it('ikki xonali yil', () => {
    expect(parseDayRange('7.8.26', NOW)).toEqual({ from: '2026-08-07', to: '2026-08-07' });
  });

  it('yilsiz — joriy yil olinadi', () => {
    expect(parseDayRange('01.03', NOW)).toEqual({ from: '2026-03-01', to: '2026-03-01' });
  });

  it('ISO ko‘rinish', () => {
    expect(parseDayRange('2026-08-07', NOW)).toEqual({ from: '2026-08-07', to: '2026-08-07' });
  });

  it('slash bilan', () => {
    expect(parseDayRange('07/08/2026', NOW)).toEqual({ from: '2026-08-07', to: '2026-08-07' });
  });
});

describe('parseDayRange — nisbiy so‘zlar', () => {
  it('bugun', () => {
    expect(parseDayRange('bugun', NOW)).toEqual({ from: '2026-08-07', to: '2026-08-07' });
  });

  it('kecha', () => {
    expect(parseDayRange('kecha', NOW)).toEqual({ from: '2026-08-06', to: '2026-08-06' });
  });

  it('hafta — 7 kun, bugun bilan', () => {
    expect(parseDayRange('hafta', NOW)).toEqual({ from: '2026-08-01', to: '2026-08-07' });
  });

  it('oy — 30 kun', () => {
    expect(parseDayRange('oy', NOW)).toEqual({ from: '2026-07-09', to: '2026-08-07' });
  });

  it('katta-kichik harfga befarq', () => {
    expect(parseDayRange('KECHA', NOW)).toEqual({ from: '2026-08-06', to: '2026-08-06' });
  });
});

describe('parseDayRange — oraliq', () => {
  it('bo‘shliqsiz tire', () => {
    expect(parseDayRange('01.08.2026-07.08.2026', NOW)).toEqual({
      from: '2026-08-01',
      to: '2026-08-07',
    });
  });

  it('bo‘shliq bilan tire', () => {
    expect(parseDayRange('01.08.2026 - 07.08.2026', NOW)).toEqual({
      from: '2026-08-01',
      to: '2026-08-07',
    });
  });

  it('teskari kiritilsa to‘g‘rilanadi', () => {
    expect(parseDayRange('07.08.2026 - 01.08.2026', NOW)).toEqual({
      from: '2026-08-01',
      to: '2026-08-07',
    });
  });

  it(`juda uzun oraliq ${MAX_RANGE_DAYS} kunga qisqaradi`, () => {
    const r = parseDayRange('01.01.2020 - 07.08.2026', NOW);
    expect(r?.to).toBe('2026-08-07');
    const days = (Date.parse(`${r!.to}T00:00:00Z`) - Date.parse(`${r!.from}T00:00:00Z`)) / 86400000;
    expect(days).toBe(MAX_RANGE_DAYS);
  });
});

describe('parseDayRange — noto‘g‘ri kiritish null qaytaradi', () => {
  // MUHIM: null bo'lsa bot namuna ko'rsatadi. Agar bu yerda xato sana
  // "tushunilgan" bo'lib qolsa, foydalanuvchi bo'sh ro'yxatni ko'rib
  // "natija yo'q" deb o'ylaydi — eng yomon xatolik shu.
  it.each([
    ['salom'],
    [''],
    ['   '],
    ['32.01.2026'],
    ['31.02.2026'],
    ['01.13.2026'],
    ['2026-13-01'],
    ['07.08.1800'],
  ])('%s → null', (input) => {
    expect(parseDayRange(input, NOW)).toBeNull();
  });

  it('oraliqning bir tomoni buzuq bo‘lsa ham null', () => {
    expect(parseDayRange('01.08.2026 - salom', NOW)).toBeNull();
  });
});

describe('fmtDayHuman', () => {
  it('ISO → dd.mm.yyyy', () => {
    expect(fmtDayHuman('2026-08-07')).toBe('07.08.2026');
  });

  it('tanimagan ko‘rinishni o‘zgartirmaydi', () => {
    expect(fmtDayHuman('xato')).toBe('xato');
  });
});
