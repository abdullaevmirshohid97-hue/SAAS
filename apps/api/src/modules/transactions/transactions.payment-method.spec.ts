import { describe, expect, it } from 'vitest';

import type { SupabaseService } from '../../common/services/supabase.service';
import { TransactionsService } from './transactions.module';

// Supabase query builder'ining kichik soxtasi (doctor.service.spec naqshida):
// har chaqiruv yoziladi, natija `jadval.amal` bo'yicha `responses` dan olinadi.
type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

function fakeSupabase(responses: Record<string, unknown>, errors: Record<string, string> = {}) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const result = () => {
      const key = `${table}.${call.op}`;
      const v = responses[key];
      return {
        data: typeof v === 'function' ? (v as (c: Call) => unknown)(call) : (v ?? null),
        error: errors[key] ? { message: errors[key] } : null,
      };
    };
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === 'insert' || name === 'update' || name === 'delete') {
          call.op = name;
          call.payload = args[0];
        } else if (name === 'eq') {
          call.filters.push([String(args[0]), args[1]]);
        }
        return b;
      };
    for (const n of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit'])
      b[n] = chain(n);
    b.maybeSingle = async () => result();
    b.single = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const admin = { from: (t: string) => builder(t) };
  return { svc: { admin: () => admin } as unknown as SupabaseService, calls };
}

const TX = 'tx-1';
const tx = (over: Record<string, unknown> = {}) => ({
  id: TX,
  kind: 'payment',
  amount_uzs: 150_000,
  payment_method: 'cash',
  is_void: false,
  notes: null,
  ...over,
});
const writes = (calls: Call[]) =>
  calls.filter((c) => c.op !== 'select').map((c) => `${c.table}.${c.op}`);

describe('TransactionsService.changePaymentMethod', () => {
  it('naqd → plastik: faqat usul yoziladi, xizmat/qarz/komissiyaga tegilmaydi', async () => {
    const { svc, calls } = fakeSupabase({
      'transactions.select': tx(),
      'transaction_payments.select': [],
    });
    const r = await new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
      payment_method: 'card',
    });
    expect(r).toMatchObject({ changed: true, old_method: 'cash', new_method: 'card' });
    expect(writes(calls)).toEqual(['transactions.update']);
    const upd = calls.find((c) => c.op === 'update')!.payload as Record<string, unknown>;
    expect(upd.payment_method).toBe('card');
    expect(Object.keys(upd).sort()).toEqual(['notes', 'payment_method']);
    expect(String(upd.notes)).toContain('USUL cash → card');
  });

  it("xizmatsiz yozuv (laboratoriya / qarz to'lovi) ham o'zgaradi", async () => {
    const { svc, calls } = fakeSupabase({
      'transactions.select': tx({ amount_uzs: 80_000 }),
      'transaction_payments.select': [],
    });
    await new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
      payment_method: 'transfer',
    });
    expect(calls.some((c) => c.table === 'transaction_items')).toBe(false);
    expect(calls.some((c) => c.table === 'doctor_commissions')).toBe(false);
    expect(calls.some((c) => c.table === 'patient_ledger')).toBe(false);
  });

  it("aralashdan bitta usulga: eski bo'laklar o'chiriladi", async () => {
    const { svc, calls } = fakeSupabase({
      'transactions.select': tx({ payment_method: 'mixed' }),
      'transaction_payments.select': [
        { method: 'cash', amount_uzs: 100_000, source: 'cash_drawer' },
        { method: 'card', amount_uzs: 50_000, source: 'bank' },
      ],
    });
    await new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
      payment_method: 'card',
    });
    expect(writes(calls)).toEqual(['transactions.update', 'transaction_payments.delete']);
  });

  it("aralashga bo'lish: bo'laklar yoziladi, keyin tranzaksiya 'mixed'", async () => {
    const { svc, calls } = fakeSupabase({
      'transactions.select': tx(),
      'transaction_payments.select': [],
    });
    const r = await new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
      payments: [
        { method: 'cash', amount_uzs: 100_000 },
        { method: 'card', amount_uzs: 50_000 },
      ],
    });
    expect(r.new_method).toBe('mixed');
    expect(writes(calls)).toEqual([
      'transaction_payments.delete',
      'transaction_payments.insert',
      'transactions.update',
    ]);
    const legs = calls.find((c) => c.op === 'insert')!.payload as Array<Record<string, unknown>>;
    expect(legs.map((l) => [l.method, l.amount_uzs, l.source])).toEqual([
      ['cash', 100_000, 'cash_drawer'],
      ['card', 50_000, 'bank'],
    ]);
  });

  it("bitta bo'lak yuborilsa — oddiy usul sifatida (jimgina yo'qolmaydi)", async () => {
    const { svc, calls } = fakeSupabase({
      'transactions.select': tx(),
      'transaction_payments.select': [],
    });
    const r = await new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
      payments: [{ method: 'card', amount_uzs: 150_000 }],
    });
    expect(r).toMatchObject({ changed: true, new_method: 'card' });
    expect(writes(calls)).toEqual(['transactions.update']);
  });

  it("bo'laklar yig'indisi to'langan summaga teng bo'lmasa — rad etiladi", async () => {
    const { svc, calls } = fakeSupabase({
      'transactions.select': tx(),
      'transaction_payments.select': [],
    });
    await expect(
      new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
        payments: [
          { method: 'cash', amount_uzs: 100_000 },
          { method: 'card', amount_uzs: 100_000 },
        ],
      }),
    ).rejects.toThrow(/teng bo'lishi kerak/);
    expect(writes(calls)).toEqual([]);
  });

  it("to'liq qarz, inkasatsiya va bekor qilingan yozuv o'zgartirilmaydi", async () => {
    for (const over of [{ amount_uzs: 0 }, { kind: 'adjustment' }, { is_void: true }]) {
      const { svc, calls } = fakeSupabase({ 'transactions.select': tx(over) });
      await expect(
        new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
          payment_method: 'card',
        }),
      ).rejects.toThrow();
      expect(writes(calls)).toEqual([]);
    }
  });

  it("usul o'zgarmagan bo'lsa — hech narsa yozilmaydi", async () => {
    const { svc, calls } = fakeSupabase({
      'transactions.select': tx({ payment_method: 'card' }),
      'transaction_payments.select': [],
    });
    const r = await new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
      payment_method: 'card',
    });
    expect(r.changed).toBe(false);
    expect(writes(calls)).toEqual([]);
  });

  it("aralash yozishda tranzaksiya yangilanmasa — eski bo'laklar tiklanadi", async () => {
    const old = [
      { method: 'cash', amount_uzs: 100_000, source: 'cash_drawer' },
      { method: 'card', amount_uzs: 50_000, source: 'bank' },
    ];
    const { svc, calls } = fakeSupabase(
      {
        'transactions.select': tx({ payment_method: 'mixed' }),
        'transaction_payments.select': old,
      },
      { 'transactions.update': "To'lov turi tarifingizda ruxsat etilmagan: click" },
    );
    await expect(
      new TransactionsService(svc).changePaymentMethod('c1', 'u1', TX, {
        payments: [
          { method: 'cash', amount_uzs: 75_000 },
          { method: 'click', amount_uzs: 75_000 },
        ],
      }),
    ).rejects.toThrow(/ruxsat etilmagan/);
    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(2);
    const restored = inserts[1]!.payload as Array<Record<string, unknown>>;
    expect(restored.map((l) => [l.method, l.amount_uzs])).toEqual([
      ['cash', 100_000],
      ['card', 50_000],
    ]);
  });
});
