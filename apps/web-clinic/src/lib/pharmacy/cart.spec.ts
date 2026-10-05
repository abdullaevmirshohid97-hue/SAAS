import { describe, expect, it } from 'vitest';

import {
  addToCart,
  cartDiscount,
  cartSubtotal,
  changeFor,
  discountAmount,
  lineBaseQty,
  lineDiscount,
  lineNet,
  maxQtyFor,
  quickCashAmounts,
  remainingDue,
  roomFor,
  setLineQty,
  setLineUnit,
  stripDiscounts,
  totalAfterDiscount,
  updateLine,
  type CartMed,
} from './cart';

const paracetamol: CartMed = {
  medication_id: 'm1',
  name: 'Paratsetamol 500',
  price_uzs: 2000,
  pack_qty: 1,
  qty_sellable: 10,
};
const seftriakson: CartMed = {
  medication_id: 'm2',
  name: 'Seftriakson 1g',
  price_uzs: 1300,
  pack_qty: 20,
  blister_qty: 10,
  pack_price_uzs: 26000,
  sell_by_unit: true,
  qty_sellable: 45,
};

describe('savat', () => {
  it('qo‘shish va bir xil qatorni oshirish', () => {
    let r = addToCart([], paracetamol);
    r = addToCart(r.lines, paracetamol, { qty: 2 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.qty).toBe(3);
  });

  it('qoldiqdan oshmaydi', () => {
    const r = addToCart([], paracetamol, { qty: 50 });
    expect(r.lines[0]!.qty).toBe(10);
    expect(r.added).toBe(10);
    const r2 = addToCart(r.lines, paracetamol);
    expect(r2.added).toBe(0);
  });

  it('qadoq + dona bitta dori qoldig‘ini bo‘lishadi', () => {
    let r = addToCart([], seftriakson, { qty: 2 }); // 2 qadoq = 40 dona
    expect(r.lines[0]!.unit_kind).toBe('pack');
    expect(lineBaseQty(r.lines[0]!)).toBe(40);
    r = addToCart(r.lines, seftriakson, { unit_kind: 'unit', qty: 10 });
    // 45 - 40 = 5 dona qoldi
    expect(r.lines[1]!.qty).toBe(5);
    expect(maxQtyFor(r.lines, r.lines[0]!)).toBe(2);
  });

  it('narx: qadoq narxi + dona narxi', () => {
    let r = addToCart([], seftriakson, { qty: 1 });
    r = addToCart(r.lines, seftriakson, { unit_kind: 'unit', qty: 3 });
    expect(cartSubtotal(r.lines)).toBe(26000 + 3 * 1300);
  });

  it('birlikni almashtirish soni moslaydi', () => {
    const r = addToCart([], seftriakson, { qty: 2 });
    const changed = setLineUnit(r.lines, r.lines[0]!.key, 'blister');
    expect(changed[0]!.unit_kind).toBe('blister');
    expect(setLineQty(changed, changed[0]!.key, 99)[0]!.qty).toBe(4); // 45/10
  });
});

describe('miqdor oynasi', () => {
  it('roomFor: yangi va mavjud qator uchun bo‘sh joy', () => {
    expect(roomFor([], seftriakson, 'pack').room).toBe(2); // 45 dona → 2 qadoq
    expect(roomFor([], seftriakson, 'unit').room).toBe(45);
    const r = addToCart([], seftriakson, { qty: 1 }); // 20 dona band
    const pack = roomFor(r.lines, seftriakson, 'pack');
    expect(pack.existing?.key).toBe(r.lines[0]!.key);
    expect(pack.room).toBe(1);
    expect(roomFor(r.lines, seftriakson, 'unit').room).toBe(25);
  });

  it('updateLine: birlik + son + chegirma, qoldiqqa moslanadi', () => {
    const r = addToCart([], seftriakson, { qty: 1 });
    const key = r.lines[0]!.key;
    const next = updateLine(r.lines, key, {
      unit_kind: 'unit',
      qty: 99,
      disc_kind: 'pct',
      disc_value: 10,
    });
    expect(next[0]!.unit_kind).toBe('unit');
    expect(next[0]!.qty).toBe(45);
    expect(lineDiscount(next[0]!)).toBe(Math.round(45 * 1300 * 0.1));
  });
});

describe('qator chegirmasi', () => {
  it('foiz son bilan birga o‘zgaradi, summa qatordan oshmaydi', () => {
    let r = addToCart([], paracetamol, { qty: 2, disc_kind: 'pct', disc_value: 10 });
    expect(lineDiscount(r.lines[0]!)).toBe(400);
    expect(lineNet(r.lines[0]!)).toBe(3600);
    r = addToCart(r.lines, paracetamol, { qty: 2 }); // chegirma saqlanadi
    expect(lineDiscount(r.lines[0]!)).toBe(800);
    const big = updateLine(r.lines, r.lines[0]!.key, { disc_kind: 'sum', disc_value: 999_999 });
    expect(lineDiscount(big[0]!)).toBe(8000);
    expect(discountAmount(1000, 'pct', 150)).toBe(1000);
  });

  it('jami chegirma va tozalash', () => {
    let r = addToCart([], paracetamol, { qty: 1, disc_kind: 'sum', disc_value: 500 });
    r = addToCart(r.lines, seftriakson, { qty: 1 });
    expect(cartDiscount(r.lines)).toBe(500);
    expect(cartSubtotal(r.lines)).toBe(2000 + 26000);
    const clean = stripDiscounts(r.lines);
    expect(cartDiscount(clean)).toBe(0);
    expect(stripDiscounts(clean)).toBe(clean);
  });
});

describe('to‘lov', () => {
  it('chegirma va qaytim', () => {
    expect(totalAfterDiscount(33900, 900)).toBe(33000);
    expect(totalAfterDiscount(1000, 5000)).toBe(0);
    expect(changeFor(33000, 50000)).toBe(17000);
    expect(changeFor(33000, 20000)).toBe(0);
  });

  it('tez summalar', () => {
    expect(quickCashAmounts(37400)).toEqual([37400, 38000, 40000, 50000, 100000]);
    expect(quickCashAmounts(0)).toEqual([]);
  });

  it('bo‘lib to‘lashda qolgan', () => {
    expect(
      remainingDue(33000, 0, [
        { method: 'cash', amount: 20000 },
        { method: 'card', amount: 10000 },
      ]),
    ).toBe(3000);
  });
});
