import { describe, expect, it } from 'vitest';

import { mergeWithSavedOrder } from './nav-order';

// =============================================================================
// Sidebar tartibi — yangi sahifa YO'QOLIB QOLMASLIGI kerak
// =============================================================================
// Regressiya: "Hisobot quruvchi" qo'shilgandan keyin, sidebar tartibini bir
// marta o'zgartirgan foydalanuvchida u guruh oxiriga tushib ketdi va "deploy
// o'tmabdi" degan xulosaga olib keldi. Bu shunchaki kosmetik emas — yangi
// funksiyani hech kim topa olmaydi.
// =============================================================================

const key = (s: string) => s;
const run = (items: string[], saved: string[]) => mergeWithSavedOrder(items, saved, key);

describe('mergeWithSavedOrder', () => {
  it('tartib saqlanmagan bo‘lsa default tartib qoladi', () => {
    expect(run(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it('saqlangan tartibni qo‘llaydi', () => {
    expect(run(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('YANGI element default joyida qoladi (oxiriga tushmaydi)', () => {
    // default: kassa, hisobot(YANGI), jurnal — saqlangan tartibda hisobot yo'q
    const out = run(['kassa', 'hisobot', 'jurnal'], ['kassa', 'jurnal']);
    expect(out).toEqual(['kassa', 'hisobot', 'jurnal']);
  });

  it('yangi element saqlangan tartib o‘zgartirilgan bo‘lsa ham qo‘shnisi bilan yuradi', () => {
    // foydalanuvchi jurnalni birinchi qilib qo'ygan; hisobot baribir kassadan keyin
    const out = run(['kassa', 'hisobot', 'jurnal'], ['jurnal', 'kassa']);
    expect(out).toEqual(['jurnal', 'kassa', 'hisobot']);
  });

  it('ketma-ket bir nechta yangi element o‘z ketma-ketligini saqlaydi', () => {
    const out = run(['a', 'yangi1', 'yangi2', 'b'], ['a', 'b']);
    expect(out).toEqual(['a', 'yangi1', 'yangi2', 'b']);
  });

  it('eng boshdagi yangi element boshida qoladi', () => {
    const out = run(['yangi', 'a', 'b'], ['a', 'b']);
    expect(out).toEqual(['yangi', 'a', 'b']);
  });

  it('saqlangan tartibdagi endi mavjud bo‘lmagan kalit natijaga qo‘shilmaydi', () => {
    // eski sahifa olib tashlangan — u saqlangan tartibda qolgan bo'lishi mumkin
    const out = run(['a', 'b'], ['a', 'olib-tashlangan', 'b']);
    expect(out).toEqual(['a', 'b']);
  });

  it('hamma element yangi bo‘lsa default tartib buzilmaydi', () => {
    expect(run(['a', 'b', 'c'], ['x', 'y'])).toEqual(['a', 'b', 'c']);
  });

  it('obyektlar bilan ham ishlaydi (keyOf orqali)', () => {
    const items = [{ to: '/a' }, { to: '/yangi' }, { to: '/b' }];
    const out = mergeWithSavedOrder(items, ['/a', '/b'], (x) => x.to);
    expect(out.map((x) => x.to)).toEqual(['/a', '/yangi', '/b']);
  });
});
