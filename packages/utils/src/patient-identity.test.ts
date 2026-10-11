import { describe, expect, it } from 'vitest';

import {
  identityNames,
  phoneIlikePattern,
  phoneKey,
  samePatientIdentity,
} from './patient-identity';

describe('phoneKey', () => {
  it('formatdan qat’i nazar oxirgi 9 raqam', () => {
    expect(phoneKey('+998 77 041-40-20')).toBe('770414020');
    expect(phoneKey('998770414020')).toBe('770414020');
    expect(phoneKey('77 041 40 20')).toBe('770414020');
    expect(phoneKey('123')).toBe('');
    expect(phoneKey(null)).toBe('');
  });
});

describe('samePatientIdentity', () => {
  const base = { last_name: 'Abdullaev', first_name: 'Mirshohid', phone: '+998770414020' };
  it('uchalasi mos — o‘sha bemor (kirill/lotin, format farqsiz)', () => {
    expect(
      samePatientIdentity(base, {
        last_name: 'Абдуллаев',
        first_name: 'Миршохид',
        phone: '77 041 40 20',
      }),
    ).toBe(true);
    expect(
      samePatientIdentity(base, {
        full_name: 'ABDULLAEV MIRSHOHID Akmalovich',
        phone: '998770414020',
      }),
    ).toBe(true);
  });
  it('rus yozuvi va -yev/-ev farqlari', () => {
    expect(
      samePatientIdentity(
        { last_name: 'Aliyev', first_name: 'Xurshid', phone: '901234567' },
        { last_name: 'Алиев', first_name: 'Хуршид', phone: '+998 90 123 45 67' },
      ),
    ).toBe(true);
    expect(
      samePatientIdentity(
        { last_name: 'Abdullayev', first_name: 'Khurshid', phone: '901234567' },
        { last_name: 'Abdullaev', first_name: 'Hurshid', phone: '901234567' },
      ),
    ).toBe(true);
  });
  it('bittasi farq qilsa — boshqa odam', () => {
    expect(samePatientIdentity(base, { ...base, phone: '+998770414021' })).toBe(false);
    expect(samePatientIdentity(base, { ...base, first_name: 'Mirjalol' })).toBe(false);
    expect(samePatientIdentity(base, { ...base, last_name: 'Abdullayeva' })).toBe(false);
    expect(samePatientIdentity(base, { ...base, phone: null })).toBe(false);
  });
});

describe('identityNames / phoneIlikePattern', () => {
  it('to‘liq ismdan familiya va ism', () => {
    expect(identityNames({ full_name: 'Karimova Nilufar Botirovna' })).toEqual({
      last: 'karimova',
      first: 'nilufar',
    });
  });
  it('telefon naqshi oxirgi 7 raqamdan', () => {
    expect(phoneIlikePattern('+998 77 041 40 20')).toBe('%0%4%1%4%0%2%0%');
    expect(phoneIlikePattern('12')).toBeNull();
  });
});
