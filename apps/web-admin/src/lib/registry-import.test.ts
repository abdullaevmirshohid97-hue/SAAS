import { describe, expect, it } from 'vitest';

import {
  detectColumns,
  findHeaderRow,
  parseRegistryMatrix,
  toActive,
  toIsoDate,
  toProductType,
  toRx,
} from './registry-import';

describe('reestr Excel — ustunlar', () => {
  it('ruscha sarlavhalar', () => {
    const map = detectColumns([
      '№',
      'Регистрационный номер',
      'Торговое наименование',
      'МНН',
      'Код АТХ',
      'Производитель',
      'Страна производителя',
      'Тип',
      'Статус',
      'Дата регистрации',
      'Срок действия',
      'Отпуск по рецепту',
    ]);
    expect(map).toEqual({
      reg_number: 1,
      trade_name: 2,
      generic_name: 3,
      atc_code: 4,
      manufacturer: 5,
      country: 6,
      product_type: 7,
      status: 8,
      reg_date: 9,
      valid_until: 10,
      rx: 11,
    });
  });

  it('API kalitlari (trade_name, main_manufacturer_name …)', () => {
    const map = detectColumns([
      'reg_number',
      'drug_type',
      'trade_name',
      'main_manufacturer_name',
      'main_manufacturer_country',
      'inn',
      'atc_code',
      'is_active',
    ]);
    expect(map).toMatchObject({
      reg_number: 0,
      product_type: 1,
      trade_name: 2,
      manufacturer: 3,
      country: 4,
      generic_name: 5,
      atc_code: 6,
      status: 7,
    });
  });

  it('o‘zbekcha sarlavhalar, "Mamlakat" va "Ishlab chiqaruvchi" adashmaydi', () => {
    const map = detectColumns(['Savdo nomi', 'Ishlab chiqaruvchi', 'Mamlakat', 'Ro‘yxat raqami']);
    expect(map).toEqual({ trade_name: 0, manufacturer: 1, country: 2, reg_number: 3 });
  });

  it('tepada rekvizitlar — sarlavha qatori topiladi', () => {
    const m = [
      ['Государственный реестр лекарственных средств'],
      ['Дата выгрузки: 01.10.2026'],
      [],
      ['Рег. номер', 'Торговое наименование', 'Производитель'],
      ['DV/M 00200/07/15', 'СЕНА-МИГ Таблетки №20(2x10)', 'ООО Sharq Darmon'],
    ];
    expect(findHeaderRow(m)).toBe(3);
  });
});

describe('reestr Excel — qiymatlar', () => {
  it('sana', () => {
    expect(toIsoDate('15.07.2015')).toBe('2015-07-15');
    expect(toIsoDate('2030-01-31')).toBe('2030-01-31');
    expect(toIsoDate(new Date(2027, 4, 3))).toBe('2027-05-03');
    expect(toIsoDate(45658)).toBe('2025-01-01');
    expect(toIsoDate('Бессрочно')).toBeNull();
    expect(toIsoDate('31.13.2020')).toBeNull();
  });
  it('holat, retsept, turi', () => {
    expect(toActive('Действующий')).toBe(true);
    expect(toActive('Недействующий')).toBe(false);
    expect(toActive('Аннулирован')).toBe(false);
    expect(toActive(true)).toBe(true);
    expect(toActive('')).toBeNull();
    expect(toRx('По рецепту врача')).toBe(true);
    expect(toRx('Без рецепта')).toBe(false);
    expect(toRx('')).toBeNull();
    expect(toProductType('ЛС')).toBe('drug');
    expect(toProductType('МИ')).toBe('device');
    expect(toProductType('Медицинское изделие')).toBe('device');
  });

  it('to‘liq o‘qish: bo‘sh nomli qator tashlanadi', () => {
    const r = parseRegistryMatrix([
      ['Рег. номер', 'Торговое наименование', 'Производитель', 'Статус', 'Срок действия'],
      ['DV/M 1', 'СЕНА-МИГ Таблетки №20', 'Sharq Darmon', 'Действующий', '15.07.2030'],
      ['DV/M 2', '', 'X', 'Действующий', ''],
      ['', '', '', '', ''],
      ['DV/M 3', 'ПАРАЦЕТАМОЛ 500 мг №10', 'Nika Pharm', 'Недействующий', ''],
    ]);
    expect(r.headerRow).toBe(0);
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.rows[0]).toMatchObject({
      reg_number: 'DV/M 1',
      trade_name: 'СЕНА-МИГ Таблетки №20',
      manufacturer: 'Sharq Darmon',
      is_active: true,
      valid_until: '2030-07-15',
    });
    expect(r.rows[1]!.is_active).toBe(false);
  });

  it('qo‘lda moslangan ustunlar ishlatiladi', () => {
    const r = parseRegistryMatrix(
      [
        ['A', 'B'],
        ['Nomi1', 'Zavod1'],
      ],
      { trade_name: 0, manufacturer: 1 },
      0,
    );
    expect(r.rows[0]).toMatchObject({ trade_name: 'Nomi1', manufacturer: 'Zavod1' });
  });
});
