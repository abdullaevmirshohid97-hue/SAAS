import { describe, expect, it } from 'vitest';

import {
  detectHeader,
  extractRows,
  mapColumns,
  matchHeader,
  parseDate,
  parseNumber,
  parseTsv,
  parseUnitKind,
} from './excel-import';

describe('parseNumber', () => {
  it('har xil formatlar', () => {
    expect(parseNumber('1 250,50')).toBe(1250.5);
    expect(parseNumber('1,250.50')).toBe(1250.5);
    expect(parseNumber('1.250,50')).toBe(1250.5);
    expect(parseNumber('12 500')).toBe(12500);
    expect(parseNumber('12,500')).toBe(12500);
    expect(parseNumber('12.500')).toBe(12500);
    expect(parseNumber('3,5')).toBe(3.5);
    expect(parseNumber("15 000 so'm")).toBe(15000);
    expect(parseNumber(42)).toBe(42);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('parseDate', () => {
  it('kun.oy.yil, ISO, oy/yil (oy oxiri), Excel seriya', () => {
    expect(parseDate('31.12.2027')).toBe('2027-12-31');
    expect(parseDate('05/03/28')).toBe('2028-03-05');
    expect(parseDate('2027-12-31')).toBe('2027-12-31');
    expect(parseDate('12.2027')).toBe('2027-12-31');
    expect(parseDate('02/28')).toBe('2028-02-29');
    expect(parseDate('2027-06')).toBe('2027-06-30');
    expect(parseDate(46387)).toBe('2026-12-31');
    expect(parseDate('31.02.2027')).toBeNull();
  });
});

describe('ustunlar', () => {
  it('ruscha faktura sarlavhalari', () => {
    expect(matchHeader('Наименование товаров')?.field).toBe('name');
    expect(matchHeader('Кол-во')?.field).toBe('quantity');
    expect(matchHeader('Цена с НДС')?.field).toBe('cost');
    expect(matchHeader('Сумма НДС')?.field).toBe('vat');
    expect(matchHeader('Срок годности')?.field).toBe('expiry');
    expect(matchHeader('Код ИКПУ')?.field).toBe('mxik');
    expect(matchHeader('Штрих-код')?.field).toBe('barcode');
  });

  it('QQS bilan narx ustuni tanlanadi', () => {
    const m = mapColumns(['Наименование', 'Кол-во', 'Цена без НДС', 'Цена с НДС', 'Сумма с НДС']);
    expect(m.name).toBe(0);
    expect(m.quantity).toBe(1);
    expect(m.cost).toBe(3);
    expect(m.total).toBe(4);
  });

  it('o‘lchov birligi', () => {
    expect(parseUnitKind('уп.')).toBe('pack');
    expect(parseUnitKind('qadoq')).toBe('pack');
    expect(parseUnitKind('таб.')).toBe('unit');
    // 'шт' fakturada ko'pincha quti — aniqlanmaydi (qadoq standart)
    expect(parseUnitKind('шт')).toBeNull();
    expect(parseUnitKind('')).toBeNull();
  });
});

describe('faktura qatorlari', () => {
  const sheet: unknown[][] = [
    ['ООО "Grand Pharm"', '', '', '', '', ''],
    ['ИНН 301234567', '', '', '', '', ''],
    ['Счёт-фактура № 1245 от 28.09.2026', '', '', '', '', ''],
    [],
    ['№', 'Наименование товара', 'Ед. изм', 'Кол-во', 'Цена', 'Сумма', 'Серия', 'Срок годности'],
    [1, 'Парацетамол 500мг №20', 'уп', '200', '3 100,00', '620 000,00', 'A123', '12.2027'],
    [2, 'Цефтриаксон 1г фл.', 'фл', 50, 8900, 445000, '', '31.03.2027'],
    ['', 'Итого:', '', '', '', '1 065 000,00', '', ''],
  ];

  it('sarlavhani topadi va qatorlarni ajratadi', () => {
    const h = detectHeader(sheet);
    expect(h.headerRow).toBe(4);
    const { rows, fileTotal } = extractRows(sheet, h.headerRow, h.mapping);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      row: 6,
      name: 'Парацетамол 500мг №20',
      quantity: 200,
      cost: 3100,
      total: 620000,
      batch: 'A123',
      expiry: '2027-12-31',
      unit_kind: 'pack',
    });
    expect(rows[1]!.unit_kind).toBe('pack');
    expect(fileTotal).toBe(1065000);
  });

  it('narx yo‘q bo‘lsa summa / soni', () => {
    const s: unknown[][] = [
      ['Nomi', 'Soni', 'Summa'],
      ['Aspirin', 10, 25000],
    ];
    const h = detectHeader(s);
    const { rows } = extractRows(s, h.headerRow, h.mapping);
    expect(rows[0]!.cost).toBe(2500);
  });

  it('Excel’dan nusxa (TSV)', () => {
    expect(parseTsv('A\t1\t2\r\nB\t3\t4\n')).toEqual([
      ['A', '1', '2'],
      ['B', '3', '4'],
    ]);
  });
});
