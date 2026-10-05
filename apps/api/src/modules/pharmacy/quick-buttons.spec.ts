import { describe, expect, it } from 'vitest';

import { QuickButtonsSchema } from './pharmacy.schemas';

const MED = '11111111-1111-4111-8111-111111111111';

describe('QuickButtonsSchema', () => {
  it('standart: miqdor oynasi, rang va son', () => {
    const r = QuickButtonsSchema.parse({ buttons: [{ medication_id: MED }] });
    expect(r.mode).toBe('dialog');
    expect(r.buttons[0]).toMatchObject({ color: 'emerald', qty: 1 });
  });

  it('eski format { instant } → mode', () => {
    expect(QuickButtonsSchema.parse({ buttons: [], instant: true }).mode).toBe('cart');
    expect(QuickButtonsSchema.parse({ buttons: [], instant: false }).mode).toBe('dialog');
    const r = QuickButtonsSchema.parse({ buttons: [], instant: true, mode: 'sell' });
    expect(r.mode).toBe('sell');
    expect('instant' in r).toBe(false);
  });

  it('noto‘g‘ri qiymatlar rad etiladi', () => {
    expect(QuickButtonsSchema.safeParse({ buttons: [], mode: 'x' }).success).toBe(false);
    expect(
      QuickButtonsSchema.safeParse({ buttons: [{ medication_id: MED, qty: 0 }] }).success,
    ).toBe(false);
    expect(QuickButtonsSchema.safeParse({}).success).toBe(false);
  });
});
