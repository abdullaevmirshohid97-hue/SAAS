import { describe, expect, it } from 'vitest';

import { searchNorm, searchScore, searchTokens } from './search-norm';
import {
  allowedUnitKinds,
  formatStock,
  markupPercentOf,
  roundPriceUp,
  salePriceFromCost,
  unitFactor,
  unitPrice,
} from './pharmacy-units';

describe('searchNorm', () => {
  it('kirill, o‘zbek lotin va inglizcha yozuv bitta kalitga tushadi', () => {
    const a = searchNorm('Амоксициллин 500мг №20');
    const b = searchNorm('Amoxicillin 500 mg N20');
    const c = searchNorm('Amoksitsillin 500mg №20');
    expect(a).toBe('amoksisilin 500 mg n 20');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('paratsetamol / paracetamol / парацетамол', () => {
    expect(searchNorm('Парацетамол')).toBe('parasetamol');
    expect(searchNorm('Paracetamol')).toBe('parasetamol');
    expect(searchNorm('Paratsetamol')).toBe('parasetamol');
  });

  it('apostrof va o‘zbek harflari', () => {
    expect(searchNorm("Ko'k choy")).toBe('kok choi');
    expect(searchNorm('Кўк чой')).toBe('kok choi');
    expect(searchNorm('Ғўза')).toBe('goza');
  });

  it('bo‘sh qiymat', () => {
    expect(searchNorm(null)).toBe('');
    expect(searchNorm('  ')).toBe('');
  });

  it('reyting: nom boshidan mos kelgan yuqori', () => {
    const t = searchTokens('para 500');
    const s1 = searchScore(searchNorm('Paracetamol 500mg'), t);
    const s2 = searchScore(searchNorm('Ibuprofen + paracetamol 500mg'), t);
    expect(s1).toBeGreaterThan(s2);
    expect(searchScore(searchNorm('Aspirin'), t)).toBe(-1);
  });
});

describe('pharmacy-units', () => {
  const med = { price_uzs: 500, pack_qty: 20, blister_qty: 10, sell_by_unit: true };

  it('koeffitsient va narx', () => {
    expect(unitFactor(med, 'pack')).toBe(20);
    expect(unitFactor(med, 'blister')).toBe(10);
    expect(unitFactor(med, 'unit')).toBe(1);
    expect(unitPrice(med, 'pack')).toBe(10000);
    expect(unitPrice({ ...med, pack_price_uzs: 9500 }, 'pack')).toBe(9500);
    expect(unitPrice(med, 'blister')).toBe(5000);
  });

  it('ruxsat etilgan birliklar', () => {
    expect(allowedUnitKinds(med)).toEqual(['pack', 'blister', 'unit']);
    expect(allowedUnitKinds({ ...med, sell_by_unit: false })).toEqual(['pack']);
    expect(allowedUnitKinds({ pack_qty: 1 })).toEqual(['unit']);
  });

  it('qoldiqni o‘qiladigan ko‘rinishda', () => {
    expect(formatStock(45, med)).toBe('2 qadoq + 5 dona');
    expect(formatStock(40, med)).toBe('2 qadoq');
    expect(formatStock(7, med)).toBe('7 dona');
    expect(formatStock(15, { pack_qty: 1, unit_name: 'ampula' })).toBe('15 ampula');
  });

  it('ustama va yaxlitlash', () => {
    expect(roundPriceUp(12345, 500)).toBe(12500);
    expect(roundPriceUp(12000, 500)).toBe(12000);
    expect(salePriceFromCost(10000, 25, 100)).toBe(12500);
    expect(markupPercentOf(10000, 12500)).toBe(25);
  });
});
