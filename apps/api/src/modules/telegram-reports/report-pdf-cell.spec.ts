import { describe, expect, it } from 'vitest';

import { formatCell } from './report-pdf';

// =============================================================================
// PDF jadval katagi — "ma'lumot yo'q" NOL deb ko'rsatilmasin
// =============================================================================
// KRITIK BAG (2026-08-11, MAGNUS): moliyaviy hisobot PDF'ida "Soni" ustuni
// bo'sh qiymat uchun `Number('') = 0` bo'lib chiqardi. Natijada hujjatda
// «Naqd savdo — 0 ta — 12 000 000 so'm» deb yozilardi. O'quvchi buni
// "savdo bor, lekin amallar yo'q" deb o'qiydi va butun hisobotga ishonchi
// yo'qoladi.
//
// Qoida: nol — bu O'LCHOV natijasi, bo'shliq esa MA'LUMOT YO'QLIGI. Ular
// hech qachon bir xil ko'rinmasligi kerak.
// =============================================================================

describe('formatCell — raqamli ustun', () => {
  it('haqiqiy nolni «0» deb ko‘rsatadi', () => {
    expect(formatCell(0, true)).toBe('0');
  });

  it('null / undefined / bo‘sh satrni «—» deb ko‘rsatadi (nol EMAS)', () => {
    expect(formatCell(null, true)).toBe('—');
    expect(formatCell(undefined, true)).toBe('—');
    expect(formatCell('', true)).toBe('—');
  });

  it('sonlarni mingliklar bilan ajratadi', () => {
    expect(formatCell(12_000_000, true).replace(/ /g, ' ')).toBe('12 000 000');
    expect(formatCell(45, true)).toBe('45');
  });

  it('manfiy sonni saqlaydi', () => {
    expect(formatCell(-250, true)).toBe('-250');
  });

  it('raqamga aylanmaydigan matnni o‘zgartirmaydi', () => {
    expect(formatCell('n/a', true)).toBe('n/a');
  });
});

describe('formatCell — matnli ustun', () => {
  it('matnni o‘zgartirmaydi', () => {
    expect(formatCell('Naqd savdo', false)).toBe('Naqd savdo');
    expect(formatCell('Naqd savdo')).toBe('Naqd savdo');
  });

  it('bo‘sh qiymat bo‘sh satr bo‘ladi (matnda «—» kerak emas)', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('raqamni matn sifatida chizadi', () => {
    expect(formatCell(0)).toBe('0');
  });
});
