import { describe, expect, it } from 'vitest';

import { bytesToBase64, toPrinterAscii } from './escpos-raster';

describe('toPrinterAscii — matnli termal chek uchun', () => {
  it('kirillni lotinga o‘giradi (katta harf saqlanadi)', () => {
    expect(toPrinterAscii('УЗИ общий')).toBe('UZI obshiy');
    expect(toPrinterAscii('УЗИ стационар беморга')).toBe('UZI statsionar bemorga');
    expect(toPrinterAscii('Ўзбекистон, Қарши, Ғиждувон, Ҳамза')).toBe(
      "O'zbekiston, Qarshi, G'ijduvon, Hamza",
    );
  });

  it('tipografik belgilarni ASCII ga almashtiradi, qolganini tashlaydi', () => {
    expect(toPrinterAscii('To‘lov — 150 000 so‘m № 12…')).toBe("To'lov - 150 000 so'm N 12...");
    expect(toPrinterAscii('💊 Paracetamol')).toBe(' Paracetamol');
  });
});

describe('bytesToBase64', () => {
  it('ESC/POS baytlarini to‘g‘ri kodlaydi', () => {
    expect(bytesToBase64(Uint8Array.from([0x1b, 0x40, 0xff, 0x00]))).toBe('G0D/AA==');
  });
});

describe('kalibrlash yordamchilari', () => {
  it('o‘lchov qatorlari aniq 32/42/48 belgi', async () => {
    const { calibrationRulerLines } = await import('./escpos-raster');
    const lines = calibrationRulerLines();
    expect(lines).toEqual([
      '32:',
      expect.any(String),
      '42:',
      expect.any(String),
      '48:',
      expect.any(String),
    ]);
    expect(lines[1]).toHaveLength(32);
    expect(lines[3]).toHaveLength(42);
    expect(lines[5]).toHaveLength(48);
  });

  it('bir nechta raster bo‘lagi — faqat oxirida kesiladi', async () => {
    const { concatEscPos } = await import('./escpos-raster');
    const part = Uint8Array.from([0x1b, 0x40, 1, 2, 0x1d, 0x56, 0x00]);
    const out = Array.from(concatEscPos([part, part, part]));
    const cuts = out.filter((_, i) => out[i] === 0x1d && out[i + 1] === 0x56).length;
    expect(cuts).toBe(1);
    expect(out.slice(-3)).toEqual([0x1d, 0x56, 0x00]);
  });
});
