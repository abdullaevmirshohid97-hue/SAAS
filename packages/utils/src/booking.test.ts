import { describe, expect, it } from 'vitest';

import {
  computeFreeSlots,
  doctorCredentials,
  isWithinSchedule,
  localDateOf,
  localTimeOf,
  matchSpecialtyQuery,
  scheduleSummary,
  shortDoctorName,
  speakableUz,
  specialtyGroupKey,
  specialtyKey,
  splitFullName,
  uzClock,
  uzDateWords,
  uzNumber,
  uzOrdinal,
  uzRelativeDay,
  uzTimeAt,
  weekdayOf,
} from './booking';

// 2026-10-14 — chorshanba (weekday 3). Toshkent = UTC+5.
const WED = '2026-10-14';

describe('sana yordamchilari', () => {
  it('weekdayOf: 0 = yakshanba', () => {
    expect(weekdayOf(WED)).toBe(3);
    expect(weekdayOf('2026-10-18')).toBe(0);
  });
  it('Toshkent vaqti: UTC 04:30 → mahalliy 09:30', () => {
    expect(localTimeOf('2026-10-14T04:30:00Z')).toBe('09:30');
    expect(localDateOf('2026-10-14T19:30:00Z')).toBe('2026-10-15');
  });
});

describe('computeFreeSlots', () => {
  const rules = [{ weekday: 3, start_time: '09:00', end_time: '11:00' }];
  const base = {
    rules,
    slotMinutes: 30,
    fromDate: WED,
    days: 1,
    now: new Date('2026-10-13T00:00:00Z'),
  };

  it('jadval bo‘yicha slotlar (mahalliy 09:00 = UTC 04:00)', () => {
    const s = computeFreeSlots(base);
    expect(s.map((x) => x.time)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(s[0]?.start).toBe('2026-10-14T04:00:00.000Z');
    expect(s[0]?.date).toBe(WED);
  });

  it('band qabul slotni yopadi (capacity 1)', () => {
    const s = computeFreeSlots({
      ...base,
      busy: [{ scheduled_at: '2026-10-14T04:30:00Z', duration_min: 30 }],
    });
    expect(s.map((x) => x.time)).toEqual(['09:00', '10:00', '10:30']);
  });

  it('capacity > 1 — to‘lguncha ochiq', () => {
    const s = computeFreeSlots({
      ...base,
      rules: [{ weekday: 3, start_time: '09:00', end_time: '09:30', capacity: 2 }],
      busy: [{ scheduled_at: '2026-10-14T04:00:00Z', duration_min: 30 }],
    });
    expect(s).toHaveLength(1);
    expect(s[0]?.taken).toBe(1);
    const full = computeFreeSlots({
      ...base,
      rules: [{ weekday: 3, start_time: '09:00', end_time: '09:30', capacity: 2 }],
      busy: [
        { scheduled_at: '2026-10-14T04:00:00Z', duration_min: 30 },
        { scheduled_at: '2026-10-14T04:10:00Z', duration_min: 15 },
      ],
    });
    expect(full).toHaveLength(0);
  });

  it('hozirdan oldingi va lead vaqt ichidagilar chiqmaydi', () => {
    // hozir mahalliy 09:20 → +60 daqiqa = 10:20 dan keyin
    const s = computeFreeSlots({
      ...base,
      now: new Date('2026-10-14T04:20:00Z'),
      minLeadMinutes: 60,
    });
    expect(s.map((x) => x.time)).toEqual(['10:30']);
  });

  it('ta‘til va yopiq kun', () => {
    const off = computeFreeSlots({
      ...base,
      timeOff: [{ starts_at: '2026-10-14T04:00:00Z', ends_at: '2026-10-14T05:00:00Z' }],
    });
    expect(off.map((x) => x.time)).toEqual(['10:00', '10:30']);
    expect(computeFreeSlots({ ...base, closedDates: [WED] })).toHaveLength(0);
  });

  it('bir necha kun, boshqa hafta kuni qoidasi ishlamaydi', () => {
    const s = computeFreeSlots({ ...base, days: 7 });
    // faqat chorshanbalar: 14-okt (7 kun ichida bitta)
    expect(new Set(s.map((x) => x.date))).toEqual(new Set([WED]));
  });

  it('ustma-ust qoidalar takrorlanmaydi, limit ishlaydi', () => {
    const s = computeFreeSlots({
      ...base,
      rules: [...rules, { weekday: 3, start_time: '10:00', end_time: '12:00' }],
      limit: 3,
    });
    expect(s.map((x) => x.time)).toEqual(['09:00', '09:30', '10:00']);
  });

  it('isWithinSchedule: slot chegarasi', () => {
    expect(isWithinSchedule(rules, 30, '2026-10-14T04:30:00Z')).toBe(true);
    expect(isWithinSchedule(rules, 30, '2026-10-14T04:40:00Z')).toBe(false);
    expect(isWithinSchedule(rules, 30, '2026-10-14T05:30:00Z')).toBe(true);
    expect(isWithinSchedule(rules, 30, '2026-10-14T06:00:00Z')).toBe(false);
    expect(isWithinSchedule(rules, 30, '2026-10-15T04:00:00Z')).toBe(false);
  });

  it('scheduleSummary', () => {
    expect(
      scheduleSummary([
        { weekday: 1, start_time: '09:00:00', end_time: '14:00:00' },
        { weekday: 3, start_time: '09:00', end_time: '14:00' },
        { weekday: 6, start_time: '09:00', end_time: '12:00' },
      ]),
    ).toBe('Du, Ch 09:00–14:00; Sh 09:00–12:00');
  });
});

describe('mutaxassislik', () => {
  it('kirill/lotin/xalq tili → bitta kalit', () => {
    expect(specialtyKey('Кардиолог')).toBe('cardiology');
    expect(specialtyKey('kardiolog')).toBe('cardiology');
    expect(specialtyKey('Nevropatolog')).toBe('neurology');
    expect(specialtyKey('LOR')).toBe('ent');
    expect(specialtyKey('Bolalar shifokori (pediatr)')).toBe('pediatrics');
    expect(specialtyKey("Ko'z shifokori")).toBe('ophthalmology');
    expect(specialtyKey('Dermatovenerolog')).toBe('dermatology');
    expect(specialtyKey('УЗИ')).toBe('ultrasound');
  });
  it('qisqa so‘z boshqa so‘z ichida mos kelmaydi', () => {
    expect(specialtyKey('kolor terapiya')).toBe(null);
  });
  it('bemor shikoyati → taxminiy mutaxassislik', () => {
    expect(matchSpecialtyQuery('yuragim og‘riyapti')).toContain('cardiology');
    expect(matchSpecialtyQuery('tishim og‘riyapti')).toContain('dentistry');
    expect(matchSpecialtyQuery('мне нужен лор')).toContain('ent');
  });
  it('lug‘atda yo‘q mutaxassislik — barqaror qisqa kalit', () => {
    const k = specialtyGroupKey('Akupunktura ustasi');
    expect(k).toMatch(/^x[0-9a-z]+$/);
    expect(specialtyGroupKey('akupunktura  ustasi')).toBe(k);
  });
});

describe('unvonlar', () => {
  it('doctorCredentials', () => {
    expect(
      doctorCredentials({
        medical_category: 'highest',
        academic_degree: 'phd',
        academic_title: 'docent',
        experience_years: 12,
      }),
    ).toBe('oliy toifali, PhD, dotsent, 12 yil tajriba');
    expect(doctorCredentials({ medical_category: 'none' })).toBe('');
  });
  it('ism', () => {
    expect(splitFullName('Karimova Dilnoza Akramovna')).toEqual({
      last_name: 'Karimova',
      first_name: 'Dilnoza',
      patronymic: 'Akramovna',
    });
    expect(shortDoctorName('Karimova Dilnoza Akramovna')).toBe('Karimova D. A.');
  });
});

describe("o'zbekcha so'z bilan", () => {
  it('uzNumber', () => {
    expect(uzNumber(0)).toBe('nol');
    expect(uzNumber(15)).toBe("o'n besh");
    expect(uzNumber(100)).toBe('yuz');
    expect(uzNumber(150000)).toBe('yuz ellik ming');
    expect(uzNumber(1250)).toBe('ming ikki yuz ellik');
    expect(uzNumber(2_500_000)).toBe('ikki million besh yuz ming');
  });
  it('uzOrdinal', () => {
    expect(uzOrdinal(1)).toBe('birinchi');
    expect(uzOrdinal(2)).toBe('ikkinchi');
    expect(uzOrdinal(15)).toBe("o'n beshinchi");
    expect(uzOrdinal(20)).toBe('yigirmanchi');
    expect(uzOrdinal(30)).toBe("o'ttizinchi");
  });
  it('vaqt', () => {
    expect(uzClock(10, 30)).toBe("o'n o'ttiz");
    expect(uzClock(9, 0, 'da')).toBe("to'qqizda");
    expect(uzClock(9, 5)).toBe("to'qqiz nol besh");
    expect(uzTimeAt('14:00')).toBe("soat o'n to'rtda");
  });
  it('sana', () => {
    expect(uzDateWords(WED)).toBe("o'n to'rtinchi oktabr, chorshanba");
    expect(uzRelativeDay('2026-10-15', WED)).toBe('ertaga');
    expect(uzRelativeDay('2026-10-20', WED)).toBe(null);
  });
  it('speakableUz', () => {
    expect(speakableUz('Ertaga soat 10:30 da kutamiz.')).toBe("Ertaga soat o'n o'ttizda kutamiz.");
    expect(speakableUz('15-oktabr, narxi 150 000 so‘m.')).toBe(
      "o'n beshinchi oktabr, narxi yuz ellik ming so'm.",
    );
    expect(speakableUz('3-qavat')).toBe('uchinchi qavat');
    expect(speakableUz('+998 90 123 45 67')).toBe(
      "to'qson, yuz yigirma uch, qirq besh, oltmish yetti",
    );
  });
});
