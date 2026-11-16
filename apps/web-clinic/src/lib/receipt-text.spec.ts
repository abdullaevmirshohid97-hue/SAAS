import { describe, expect, it } from 'vitest';

import { padRow, receiptCharsPerLine } from './receipt-text';
import { toPrinterAscii } from './escpos-raster';

describe('padRow — chap/o‘ng ustunli chek qatori', () => {
  it('qatorni qog‘oz kengligiga to‘ldiradi', () => {
    const r = padRow('JAMI:', '230 000', receiptCharsPerLine('58mm'));
    expect(r).toHaveLength(32);
    expect(r.startsWith('JAMI:')).toBe(true);
    expect(r.endsWith('230 000')).toBe(true);
  });

  it('sig‘masa bitta bo‘shliq bilan ulaydi, bo‘sh tomonni tashlaydi', () => {
    expect(padRow('a'.repeat(30), '12345', 32)).toBe(`${'a'.repeat(30)} 12345`);
    expect(padRow('', '150 000', 48)).toBe('150 000');
    expect(padRow('Bemor:', '', 48)).toBe('Bemor:');
  });

  it('80mm — 48 belgi, 58mm — 32 belgi', () => {
    expect(receiptCharsPerLine('80mm')).toBe(48);
    expect(receiptCharsPerLine('58mm')).toBe(32);
  });
});

describe('toPrinterAscii — miqdor belgisi', () => {
  it('× → x', () => {
    expect(toPrinterAscii('Paratsetamol ×2')).toBe('Paratsetamol x2');
  });
});
