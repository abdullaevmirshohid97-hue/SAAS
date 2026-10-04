import { describe, expect, it } from 'vitest';

import {
  addToCart,
  cartSubtotal,
  changeFor,
  lineBaseQty,
  maxQtyFor,
  quickCashAmounts,
  remainingDue,
  setLineQty,
  setLineUnit,
  totalAfterDiscount,
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
