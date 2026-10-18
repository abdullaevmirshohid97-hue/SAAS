import { describe, expect, it } from 'vitest';

import type { SupabaseService } from '../../common/services/supabase.service';
import { CastService } from './cast.module';

// Supabase query builder'ining kichik soxtasi: natija jadval nomi bo'yicha.
function fakeSupabase(responses: Record<string, unknown>) {
  const tables: string[] = [];
  const builder = (table: string) => {
    tables.push(table);
    const result = () => ({ data: responses[table] ?? null, error: null });
    const b: Record<string, unknown> = {};
    for (const n of ['select', 'eq', 'in', 'order', 'limit']) b[n] = () => b;
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const admin = { from: (t: string) => builder(t) };
  return { svc: { admin: () => admin } as unknown as SupabaseService, tables };
}

describe('CastService.board', () => {
  it("bog'lanmagan TV navbatni ko'rmaydi", async () => {
    const { svc, tables } = fakeSupabase({
      queue_displays: { clinic_id: 'c1', is_paired: false },
    });
    const r = await new CastService(svc).board('dev-1');
    expect(r).toEqual({ paired: false, called: [], waiting: [] });
    expect(tables).toEqual(['queue_displays']);
  });

  it("ism qisqartiriladi, chaqirilganlar yangisi birinchi", async () => {
    const { svc } = fakeSupabase({
      queue_displays: { clinic_id: 'c1', is_paired: true },
      queues: [
        {
          id: 'q1',
          ticket_code: 'A-001',
          ticket_color: null,
          status: 'called',
          called_at: '2026-10-18T05:00:00Z',
          started_at: null,
          doctor: { full_name: 'Aliyev Bobur' },
          patient: { full_name: 'Karimova Dilnoza Rustamovna' },
        },
        {
          id: 'q2',
          ticket_code: 'A-002',
          ticket_color: null,
          status: 'serving',
          called_at: '2026-10-18T05:10:00Z',
          started_at: '2026-10-18T05:12:00Z',
          doctor: null,
          patient: { full_name: 'Toshmatov' },
        },
        {
          id: 'q3',
          ticket_code: 'A-003',
          ticket_color: '#f00',
          status: 'waiting',
          called_at: null,
          started_at: null,
          doctor: { full_name: 'Aliyev Bobur' },
          patient: { full_name: '  Rahimov   Jasur ' },
        },
      ],
    });
    const r = await new CastService(svc).board('dev-1');
    expect(r.paired).toBe(true);
    expect(r.called.map((x) => x.id)).toEqual(['q2', 'q1']);
    expect(r.called[1]).toMatchObject({ patient: 'Karimova D.', doctor: 'Aliyev Bobur' });
    expect(r.called[0]).toMatchObject({ patient: 'Toshmatov', doctor: null });
    expect(r.waiting).toEqual([
      expect.objectContaining({ id: 'q3', patient: 'Rahimov J.', ticket_color: '#f00' }),
    ]);
  });
});
