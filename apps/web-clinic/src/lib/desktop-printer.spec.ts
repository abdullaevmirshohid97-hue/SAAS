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
  ])('%s — chek printeri emas', (name) => {
    expect(isThermalName(name)).toBe(false);
  });
});
