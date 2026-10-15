import { describe, expect, it } from 'vitest';

import { normalizeDial, prettyNumber } from './numbers';

describe('softfon raqamlari', () => {
  it('terish: O‘zbekiston, ichki, favqulodda', () => {
    expect(normalizeDial('90 123-45-67')).toBe('901234567');
    expect(normalizeDial('998901234567')).toBe('998901234567');
    expect(normalizeDial('+998 (90) 123 45 67')).toBe('+998901234567');
    expect(normalizeDial('202')).toBe('202');
    expect(normalizeDial('103')).toBe('103');
    expect(normalizeDial('112')).toBe('112');
  });

  it('terish: xalqaro va noto‘g‘ri raqamlar rad etiladi', () => {
    expect(normalizeDial('+7 999 123 45 67')).toBe(null);
    expect(normalizeDial('105')).toBe(null);
    expect(normalizeDial('12345')).toBe(null);
    expect(normalizeDial('')).toBe(null);
  });

  it('ko‘rsatish', () => {
    expect(prettyNumber('998901234567')).toBe('+998 90 123 45 67');
    expect(prettyNumber('901234567')).toBe('+998 90 123 45 67');
    expect(prettyNumber('201')).toBe('201');
    expect(prettyNumber(null)).toBe('—');
  });
});
