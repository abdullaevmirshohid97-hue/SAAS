import { describe, expect, it } from 'vitest';

import type { SupabaseService } from '../../common/services/supabase.service';
import { DoctorService } from './doctor.module';

// Supabase query builder'ining kichik soxtasi: har chaqiruv yoziladi, natija
// jadval + amal bo'yicha `responses` dan olinadi.
type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

function fakeSupabase(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const result = () => {
      const v = responses[`${table}.${call.op}`];
      return {
        data: typeof v === 'function' ? (v as (c: Call) => unknown)(call) : (v ?? null),
        error: null,
      };
    };
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === 'insert' || name === 'update') {
          call.op = name;
          call.payload = args[0];
        } else if (['eq', 'in', 'gte', 'neq'].includes(name)) {
          call.filters.push([String(args[0]), args[1]]);
        }
        return b;
      };
    for (const n of ['select', 'insert', 'update', 'eq', 'in', 'gte', 'neq', 'order', 'limit'])
      b[n] = chain(n);
    b.maybeSingle = async () => result();
    b.single = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const admin = { from: (t: string) => builder(t) };
  return { svc: { admin: () => admin } as unknown as SupabaseService, calls };
}

describe('DoctorService.saveConsultation', () => {
  it('note_id berilsa qoralamani yangilaydi (yangi qator yaratmaydi)', async () => {
    const { svc, calls } = fakeSupabase({ 'treatment_notes.update': { id: 'n1' } });
    const r = await new DoctorService(svc).saveConsultation('c1', 'u1', {
      patient_id: '00000000-0000-0000-0000-000000000001',
      note_id: '00000000-0000-0000-0000-0000000000aa',
      soap_subjective: 'bosh og‘rig‘i',
      sign: false,
    });
    expect(r).toEqual({ id: 'n1' });
    expect(calls.map((c) => c.op)).toEqual(['update']);
    expect(calls[0]!.filters).toContainEqual(['is_final', false]);
  });

  it('qoralama topilmasa (imzolangan) — yangisi yoziladi', async () => {
    const { svc, calls } = fakeSupabase({
      'treatment_notes.update': null,
      'treatment_notes.insert': { id: 'n2' },
    });
    const r = await new DoctorService(svc).saveConsultation('c1', 'u1', {
      patient_id: '00000000-0000-0000-0000-000000000001',
      note_id: '00000000-0000-0000-0000-0000000000aa',
      sign: true,
    });
    expect(r).toEqual({ id: 'n2' });
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert']);
    expect((calls[1]!.payload as { is_final: boolean }).is_final).toBe(true);
  });
});

describe('DoctorService.finishVisit', () => {
  const base = {
    queue_id: '00000000-0000-0000-0000-0000000000q1',
    patient_id: '00000000-0000-0000-0000-000000000001',
  };

  it('xulosa imzolanadi, navbat ko‘rildi, yozuv yakunlandi', async () => {
    const { svc, calls } = fakeSupabase({
      'queues.select': {
        id: base.queue_id,
        status: 'called',
        patient_id: base.patient_id,
        appointment_id: 'a1',
      },
      'treatment_notes.insert': { id: 'n9' },
    });
    const r = await new DoctorService(svc).finishVisit('c1', 'u1', {
      ...base,
      diagnosis_text: 'ORVI',
      vitals: null,
    });
    expect(r).toEqual({ ok: true, note_id: 'n9' });
    const q = calls.find((c) => c.table === 'queues' && c.op === 'update')!;
    expect(q.payload).toMatchObject({ status: 'served' });
    expect((q.payload as Record<string, unknown>).started_at).toBeTruthy();
    const a = calls.find((c) => c.table === 'appointments' && c.op === 'update')!;
    expect(a.payload).toEqual({ status: 'completed' });
    expect(a.filters).toContainEqual(['id', 'a1']);
    expect(calls.some((c) => c.table === 'vital_signs')).toBe(false);
  });

  it('bo‘sh xulosa yozilmaydi, vitals bo‘lsa yoziladi', async () => {
    const { svc, calls } = fakeSupabase({
      'queues.select': {
        id: base.queue_id,
        status: 'serving',
        patient_id: base.patient_id,
        appointment_id: null,
      },
      'vital_signs.insert': { id: 'v1' },
    });
    const r = await new DoctorService(svc).finishVisit('c1', 'u1', {
      ...base,
      soap_plan: '   ',
      vitals: { pulse_bpm: 80, temperature_c: null },
    });
    expect(r.note_id).toBeNull();
    expect(calls.some((c) => c.table === 'treatment_notes')).toBe(false);
    expect(calls.find((c) => c.table === 'vital_signs')!.op).toBe('insert');
    expect(calls.some((c) => c.table === 'appointments')).toBe(false);
  });

  it('boshqa bemorning navbati — rad etiladi', async () => {
    const { svc } = fakeSupabase({
      'queues.select': {
        id: base.queue_id,
        status: 'serving',
        patient_id: 'other',
        appointment_id: null,
      },
    });
    await expect(new DoctorService(svc).finishVisit('c1', 'u1', { ...base })).rejects.toThrow(
      /mos emas/,
    );
  });
});
