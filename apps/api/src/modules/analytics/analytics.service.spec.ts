import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseService } from '../../common/services/supabase.service';
import { AnalyticsService } from './analytics.module';

type Res = { data: unknown; error: { message: string } | null };

// Soxta Supabase: from() zanjiri jadval bo'yicha javob beradi, rpc() — funksiya bo'yicha
function fake(opts: {
  table?: (name: string) => Res;
  rpc?: (fn: string, args: Record<string, unknown>) => Res;
}) {
  const builder = (name: string) => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const res = opts.table?.(name) ?? { data: [], error: null };
            return (ok: (v: Res) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve(res).then(ok, fail);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  const admin = {
    from: builder,
    rpc: async (fn: string, args: Record<string, unknown>) =>
      opts.rpc?.(fn, args) ?? { data: null, error: null },
  };
  return new AnalyticsService({ admin: () => admin } as unknown as SupabaseService);
}

describe('AnalyticsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-10-07 (chorshanba) 02:00 Toshkent = 2026-10-06 21:00 UTC
    vi.setSystemTime(new Date('2026-10-06T21:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('heatmap: qator = hafta kuni (0 yakshanba), ustun = soat', async () => {
    const svc = fake({
      rpc: () => ({
        data: [
          { dow: 1, hour: 10, n: 4 },
          { dow: 0, hour: 23, n: 1 },
        ],
        error: null,
      }),
    });
    const { grid } = await svc.heatmap('c', '2026-10-01', '2026-10-07');
    expect(grid).toHaveLength(7);
    expect(grid[1]![10]).toBe(4);
    expect(grid[0]![23]).toBe(1);
  });

  it('overview: bo‘sh kunlar 0 bilan, sof foyda maoshni ham ayiradi', async () => {
    const svc = fake({
      table: (name) => {
        if (name === 'daily_revenue_view')
          return { data: [{ day: '2026-10-02', revenue_uzs: 300, transactions: 3 }], error: null };
        if (name === 'daily_expense_view')
          return { data: [{ day: '2026-10-03', expenses_uzs: 50 }], error: null };
        return { data: [], error: null };
      },
      rpc: () => ({
        data: { payroll_uzs: 100, new_patients: 2, appointments: 5, appointment_status: {} },
        error: null,
      }),
    });
    const o = await svc.overview('c', '2026-10-01', '2026-10-04');
    expect(o.daily.map((d) => d.day)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(o.totals.profit_uzs).toBe(300 - 50 - 100);
    expect(o.totals.avg_check_uzs).toBe(100);
    expect(o.range).toEqual({ from: '2026-10-01', to: '2026-10-04' });
  });

  it('cashForecast: bugun hisobga olinmaydi, bo‘sh kunlar 0, ertadan 7 kun', async () => {
    const svc = fake({
      table: () => ({
        // faqat bitta kun ma'lumot — qolganlari 0 bo'lishi kerak
        data: [{ day: '2026-10-05', dow: 1, revenue_uzs: 700, tx_count: 7 }],
        error: null,
      }),
    });
    const f = await svc.cashForecast('c');
    expect(f.history).toHaveLength(28);
    expect(f.history.at(-1)!.day).toBe('2026-10-06'); // kecha (Toshkent)
    expect(f.history.find((h) => h.day === '2026-10-05')!.revenue_uzs).toBe(700);
    expect(f.forecast[0]!.day).toBe('2026-10-08');
    expect(f.forecast[0]!.dow).toBe(4); // payshanba
    expect(f.forecast).toHaveLength(7);
  });

  it('upcomingBirthdays: Toshkent bugungi kuni, 29-fevral kabisasiz yilda 28-fevral', async () => {
    vi.setSystemTime(new Date('2027-02-25T20:00:00Z')); // 2027-02-26 Toshkent
    const svc = fake({
      table: () => ({
        data: [
          { id: 'a', full_name: 'A', phone: null, dob: '1990-02-29' },
          { id: 'b', full_name: 'B', phone: null, dob: '1985-02-26' },
          { id: 'c', full_name: 'C', phone: null, dob: '1985-03-20' },
        ],
        error: null,
      }),
    });
    const list = await svc.upcomingBirthdays('c', 7);
    expect(list.map((r) => [r.id, r.next_birthday, r.days_until])).toEqual([
      ['b', '2027-02-26', 0],
      ['a', '2027-02-28', 2],
    ]);
  });

  it('allDoctors: faol yoki faoliyati bor; doctors: faqat faoliyati borlar', async () => {
    const rows = [
      {
        doctor_id: 'd1',
        doctor_name: 'A',
        visits: 3,
        patients: 2,
        revenue_uzs: 900,
        commission_uzs: 90,
        is_active: true,
      },
      {
        doctor_id: 'd2',
        doctor_name: 'B',
        visits: 0,
        patients: 0,
        revenue_uzs: 0,
        commission_uzs: 0,
        is_active: true,
      },
      {
        doctor_id: 'd3',
        doctor_name: 'C',
        visits: 0,
        patients: 0,
        revenue_uzs: 0,
        commission_uzs: 0,
        is_active: false,
      },
    ];
    const svc = fake({ rpc: () => ({ data: rows, error: null }) });
    expect((await svc.allDoctors('c', '2026-10-01', '2026-10-07')).map((r) => r.doctor_id)).toEqual(
      ['d1', 'd2'],
    );
    expect((await svc.doctors('c', '2026-10-01', '2026-10-07')).map((r) => r.doctor_id)).toEqual([
      'd1',
    ]);
  });

  it('RPC xatosi yutilmaydi', async () => {
    const svc = fake({ rpc: () => ({ data: null, error: { message: 'funksiya yo‘q' } }) });
    await expect(svc.heatmap('c', '2026-10-01', '2026-10-07')).rejects.toThrow('funksiya yo‘q');
  });
});
