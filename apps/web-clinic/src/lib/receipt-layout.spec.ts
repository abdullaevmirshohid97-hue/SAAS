import { describe, expect, it } from 'vitest';

import { columnRows, fmtMoney, layoutThermalContent, wrapText } from './receipt-layout';

describe('fmtMoney', () => {
  it('mingliklarni bo‘shliq bilan ajratadi', () => {
    expect(fmtMoney(1234567)).toBe('1 234 567');
    expect(fmtMoney(0)).toBe('0');
    expect(fmtMoney(-45000)).toBe('-45 000');
  });
});

describe('wrapText', () => {
  it('so‘z bo‘yicha bo‘ladi, kenglikdan oshmaydi', () => {
    const out = wrapText('Ultratovush tekshiruvi qorin bo‘shlig‘i a’zolari', 16);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(16);
    expect(out.join(' ')).toBe('Ultratovush tekshiruvi qorin bo‘shlig‘i a’zolari');
  });
  it('juda uzun so‘zni majburan bo‘ladi', () => {
    expect(wrapText('ABCDEFGHIJ', 4)).toEqual(['ABCD', 'EFGH', 'IJ']);
  });
});

describe('columnRows', () => {
  it('sig‘sa — bitta qator, summa o‘ng chetda', () => {
    expect(columnRows('UZI', '150 000', 20)).toEqual(['UZI          150 000']);
  });
  it('sig‘masa — nom o‘raladi, summa oxirgi qatorda o‘ngda (ustun buzilmaydi)', () => {
    const rows = columnRows('Ultratovush tekshiruvi qorin bo‘shlig‘i', '150 000', 32);
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(32);
    expect(rows[rows.length - 1]!.endsWith('150 000')).toBe(true);
    expect(rows[rows.length - 1]!.length).toBe(32);
  });
});

describe('layoutThermalContent', () => {
  const content = {
    header: 'MAGNUS XUSUSIY KO‘P TARMOQLI KLINIKASI',
    subheader: "TO'LOV CHEKI",
    lines: [{ text: 'Bemor: Karimov Alisher' }],
    items: [
      { name: 'Ultratovush tekshiruvi qorin bo‘shlig‘i a’zolari', qty: 1, amount: 150000 },
      { name: 'Qon tahlili', qty: 2, amount: 60000 },
    ],
    total_uzs: 210000,
    paid_uzs: 200000,
    debt_uzs: 10000,
    footer: "Rahmat! Sog'ligingizga shifo tilaymiz! Bizni yana kutib qolamiz",
    qr: 'https://patient.clary.uz/t/abc',
  };

  it.each(['58mm', '80mm'] as const)('%s: hech bir qator kenglikdan oshmaydi', (paper) => {
    const width = paper === '58mm' ? 32 : 48;
    const out = layoutThermalContent(content, paper);
    for (const l of out.lines ?? []) {
      expect(l.text.length).toBeLessThanOrEqual(l.double ? Math.floor(width / 2) : width);
    }
    for (const f of (out.footer ?? '').split('\n')) expect(f.length).toBeLessThanOrEqual(width);
  });

  it('Rust qayta chizmasin: items/summa maydonlari yo‘q, QR saqlanadi', () => {
    const out = layoutThermalContent(content, '80mm');
    expect(out.items).toBeUndefined();
    expect(out.total_uzs).toBeUndefined();
    expect(out.paid_uzs).toBeUndefined();
    expect(out.debt_uzs).toBeUndefined();
    expect(out.qr).toBe(content.qr);
    const text = (out.lines ?? []).map((l) => l.text);
    expect(text.some((t) => t.startsWith('JAMI') && t.endsWith("210 000 so'm"))).toBe(true);
    expect(text.some((t) => t.startsWith('Qon tahlili x2') && t.endsWith('60 000'))).toBe(true);
    expect(text.some((t) => t.startsWith('Qarz') && t.endsWith('10 000'))).toBe(true);
  });

  it('qarz 0 bo‘lsa qarz qatori chiqmaydi', () => {
    const out = layoutThermalContent({ ...content, debt_uzs: 0 }, '80mm');
    expect((out.lines ?? []).some((l) => l.text.startsWith('Qarz'))).toBe(false);
  });
});
