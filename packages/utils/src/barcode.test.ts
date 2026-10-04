import { describe, expect, it } from 'vitest';

import {
  GS,
  barcodeLookupKeys,
  cyrillicLayoutToLatin,
  gs1Date,
  internalEan13,
  isValidGtin,
  normalizeBarcode,
  parseScan,
  toGtin14,
} from './barcode';

describe('GTIN', () => {
  it('nazorat raqamini tekshiradi (EAN-13 / EAN-8 / UPC-A)', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('73513537')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
  });

  it('14 xonaga keltiradi — EAN-13 va DataMatrix GTIN bitta kalit', () => {
    expect(toGtin14('4006381333931')).toBe('04006381333931');
    expect(normalizeBarcode(' 4006381333931 ')).toBe('04006381333931');
    expect(normalizeBarcode('ab-12')).toBe('AB-12');
  });

  it('ichki EAN-13 "2" bilan boshlanadi va to‘g‘ri', () => {
    const code = internalEan13(42);
    expect(code).toHaveLength(13);
    expect(code.startsWith('2')).toBe(true);
    expect(isValidGtin(code)).toBe(true);
  });
});

describe('GS1 DataMatrix', () => {
  it('GS ajratgich bilan: GTIN + muddat + partiya + seriya', () => {
    const p = parseScan(`01040063813339311727123110AB12C${GS}21XYZ123`);
    expect(p.kind).toBe('gs1');
    expect(p.gtin).toBe('04006381333931');
    expect(p.expiry).toBe('2027-12-31');
    expect(p.batch).toBe('AB12C');
    expect(p.serial).toBe('XYZ123');
    expect(p.ambiguous).toBeUndefined();
  });

  it('GS siz dori markirovkasi (21{13} 91{4} 92{44})', () => {
    const p = parseScan(`010400638133393121ABCDEFGHIJKLM91EE0792${'x'.repeat(44)}`);
    expect(p.gtin).toBe('04006381333931');
    expect(p.serial).toBe('ABCDEFGHIJKLM');
    expect(p.ambiguous).toBe(true);
  });

  it('GS siz partiyadan keyin 17 muddat', () => {
    const p = parseScan('010400638133393110LOT77A17280630');
    expect(p.batch).toBe('LOT77A');
    expect(p.expiry).toBe('2028-06-30');
  });

  it('qavsli ko‘rinish va AIM prefiksi', () => {
    const p = parseScan('(01)04006381333931(17)280630(10)L-77');
    expect(p.expiry).toBe('2028-06-30');
    expect(p.batch).toBe('L-77');
    const q = parseScan(']d2010400638133393117271231');
    expect(q.gtin).toBe('04006381333931');
    expect(q.expiry).toBe('2027-12-31');
  });

  it('kun 00 → oy oxiri; noto‘g‘ri oy → undefined', () => {
    expect(gs1Date('271200')).toBe('2027-12-31');
    expect(gs1Date('260200')).toBe('2026-02-28');
    expect(gs1Date('271331')).toBeUndefined();
  });
});

describe('parseScan boshqa turlar', () => {
  it('oddiy EAN-13', () => {
    const p = parseScan('4006381333931');
    expect(p.kind).toBe('gtin');
    expect(p.code).toBe('04006381333931');
  });

  it('Code128 / ichki matn', () => {
    expect(parseScan('abc-123').code).toBe('ABC-123');
    expect(parseScan('abc-123').kind).toBe('text');
  });

  it('Clary chek QR', () => {
    const p = parseScan('PHS:5f0c2b1a-1111-4222-8333-944455556666');
    expect(p.kind).toBe('clary-sale');
    expect(p.saleId).toBe('5f0c2b1a-1111-4222-8333-944455556666');
  });

  it('qidiruv kalitlari eski EAN-13 yozuvlarini ham topadi', () => {
    expect(barcodeLookupKeys('4006381333931')).toEqual(
      expect.arrayContaining(['04006381333931', '4006381333931']),
    );
  });
});

describe('raskladka', () => {
  it('kirill raskladkada kelgan kodni lotinga qaytaradi', () => {
    expect(cyrillicLayoutToLatin('ФИС123')).toBe('ABC123');
    expect(cyrillicLayoutToLatin('ищырдфвшльш')).toBe('boshladikmi');
  });
});
