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
