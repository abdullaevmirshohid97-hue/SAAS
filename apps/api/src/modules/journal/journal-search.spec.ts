import { describe, expect, it } from 'vitest';

import { journalSearchMatcher } from './journal.module';

const row = (over: Partial<Parameters<ReturnType<typeof journalSearchMatcher>>[0]> = {}) => ({
  patient_name: 'Aliyev Vali',
  patient_phone: '+998 90 123 45 67',
  diagnosis: null,
  doctor_name: 'Karimova Dilnoza',
  description: null,
  note: null,
  cashier_name: 'magnus qabulxona',
  department: 'Qabulxona',
  items: [{ name: 'УЗИ общий', quantity: 1, amount_uzs: 150000 }],
  amount_uzs: 150000,
  ...over,
});

describe('journalSearchMatcher — jurnal qidiruvi', () => {
  it('xizmat nomini lotincha yozsa ham kirillcha nomni topadi', () => {
    expect(journalSearchMatcher('uzi')(row())).toBe(true);
    expect(journalSearchMatcher('UZI obshiy')(row())).toBe(true);
    expect(journalSearchMatcher('узи')(row())).toBe(true);
  });

  it('"uzi statsionar" — "УЗИ стационар беморга" ni topadi, "УЗИ общий" ni emas', () => {
    const stat = row({ items: [{ name: 'УЗИ стационар беморга', quantity: 1, amount_uzs: 1 }] });
    expect(journalSearchMatcher('uzi statsionar')(stat)).toBe(true);
    expect(journalSearchMatcher('uzi statsionar')(row())).toBe(false);
  });

  it('bemor, shifokor, kassir va bo‘lim bo‘yicha qidiradi', () => {
    expect(journalSearchMatcher('aliyev')(row())).toBe(true);
    expect(journalSearchMatcher('dilnoza')(row())).toBe(true);
    expect(journalSearchMatcher('qabulxona')(row())).toBe(true);
  });

  it('telefon raqami va summa bo‘yicha qidiradi', () => {
    expect(journalSearchMatcher('901234567')(row())).toBe(true);
    expect(journalSearchMatcher('150 000')(row())).toBe(true);
    expect(journalSearchMatcher('777')(row())).toBe(false);
  });

  it('mos kelmasa — yozuv chiqmaydi', () => {
    expect(journalSearchMatcher('rentgen')(row())).toBe(false);
  });
});
