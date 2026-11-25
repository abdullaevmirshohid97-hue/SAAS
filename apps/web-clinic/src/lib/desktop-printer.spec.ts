import { describe, expect, it } from 'vitest';

import { isThermalName } from './desktop-printer';

describe('isThermalName — chek printerini nomidan tanish', () => {
  it.each([
    'XP-80C',
    'POS-80',
    'POS58 Printer',
    'EPSON TM-T20II Receipt',
    'Xprinter XP-58IIH',
    'RONGTA RP80',
    'Gprinter GP-L80160',
    'BIXOLON SRP-350III',
    'Thermal Printer 80mm',
    'Generic / Text Only',
    'GP-80250 Series',
    'GP-58',
    'SPRT SP-POS88V',
    '80mm Series Printer',
    'Printer-80',
    'Чек принтер',
  ])('%s — chek printeri', (name) => {
    expect(isThermalName(name)).toBe(true);
  });

  it.each([
    'Microsoft Print to PDF',
    'Microsoft XPS Document Writer',
    'OneNote (Desktop)',
    'Fax',
    'HP LaserJet M1132 MFP',
    'Canon LBP2900',
    'Brother HL-L2300D series',
    'Canon G3030 series',
    'AnyDesk Printer',
    'Kyocera ECOSYS P2040dn',
    'HP LaserJet Pro MFP M428',
    'ZDesigner GK420t',
  ])('%s — chek printeri emas', (name) => {
    expect(isThermalName(name)).toBe(false);
  });
});

describe('chek printeri kalibrlash profili', () => {
  it('printer nomi bo‘yicha saqlanadi, noto‘g‘ri qiymat tashlanadi', async () => {
    const mem = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    } as Storage;
    const { receiptPrinterProfile, setReceiptPrinterProfile, defaultReceiptGeometry } =
      await import('./desktop-printer');
    expect(receiptPrinterProfile('XP-80C')).toEqual({});
    setReceiptPrinterProfile('XP-80C', { cols: 42, dots: 512 });
    expect(receiptPrinterProfile('XP-80C')).toEqual({ cols: 42, dots: 512 });
    expect(receiptPrinterProfile('POS-58')).toEqual({});
    mem.set('clary.desktop.printer.profile:BAD', JSON.stringify({ cols: 7, dots: 999 }));
    expect(receiptPrinterProfile('BAD')).toEqual({});
    expect(defaultReceiptGeometry('58mm')).toEqual({ cols: 32, dots: 384 });
    expect(defaultReceiptGeometry('80mm')).toEqual({ cols: 48, dots: 576 });
  });
});
