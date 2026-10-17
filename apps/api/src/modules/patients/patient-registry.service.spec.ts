import { describe, expect, it } from 'vitest';

import type { SupabaseService } from '../../common/services/supabase.service';
import { PatientRegistryService, stayDays } from './patient-registry.service';
import type { PatientsService } from './patients.service';

// Soxta Supabase: so'rov zanjirini yozadi, javobni jadval bo'yicha handler beradi
type Op = [string, ...unknown[]];
type Res = { data: unknown; error: { message: string } | null; count?: number };

function fakeSupabase(table: (name: string, ops: Op[]) => Res) {
  const calls: Array<{ name: string; ops: Op[] }> = [];
  const builder = (name: string) => {
    const ops: Op[] = [];
    calls.push({ name, ops });
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const res = table(name, ops);
            return (ok: (v: Res) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve(res).then(ok, fail);
          }
          return (...args: unknown[]) => {
            ops.push([prop, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return {
    svc: { admin: () => ({ from: builder }) } as unknown as SupabaseService,
    calls,
  };
}

const patients = {
  branchScope: async (id: string) => [id],
  create: async (_c: string, _u: string, input: Record<string, unknown>) => ({
    id: 'new',
    ...input,
  }),
} as unknown as PatientsService;

const op = (ops: Op[], name: string) => ops.find((o) => o[0] === name);

describe('PatientRegistryService.createOrReuse — "qayta keldi"', () => {
  const existing = {
    id: 'p1',
    full_name: 'Abdullaev Mirshohid',
    last_name: 'Abdullaev',
    first_name: 'Mirshohid',
    phone: '+998 77 041 40 20',
    dob: null,
    address: null,
  };

  it('familiya + ism + telefon mos — yangi karta ochilmaydi, bo‘sh maydon to‘ladi', async () => {
    const db = fakeSupabase((name, ops) => {
      if (name === 'patients' && op(ops, 'update')) {
        return { data: { ...existing, ...(op(ops, 'update')![1] as object) }, error: null };
      }
      if (name === 'patients') {
        // telefon ILIKE naqshi oxirgi 7 raqamdan
        expect(op(ops, 'ilike')).toEqual(['ilike', 'phone', '%0%4%1%4%0%2%0%']);
        return { data: [existing], error: null };
      }
      return { data: null, error: null };
    });
    const svc = new PatientRegistryService(db.svc, patients);
    const r = (await svc.createOrReuse('c1', 'u1', {
      last_name: 'Абдуллаев',
      first_name: 'Миршохид',
      phone: '770414020',
      dob: '1997-01-01',
    })) as Record<string, unknown>;
    expect(r.id).toBe('p1');
    expect(r.returning).toBe(true);
    expect(r.dob).toBe('1997-01-01');
  });

  it('telefon boshqa — yangi bemor yaratiladi', async () => {
    const db = fakeSupabase((name) =>
      name === 'patients' ? { data: [existing], error: null } : { data: null, error: null },
    );
    const svc = new PatientRegistryService(db.svc, patients);
    const r = (await svc.createOrReuse('c1', 'u1', {
      last_name: 'Abdullaev',
      first_name: 'Mirshohid',
      phone: '+998 90 111 22 33',
    })) as Record<string, unknown>;
    expect(r.id).toBe('new');
    expect(r.returning).toBeUndefined();
  });

  it('telefon kiritilmagan — moslash yo‘q, bazaga so‘rov ham yo‘q', async () => {
    const db = fakeSupabase(() => ({ data: [existing], error: null }));
    const svc = new PatientRegistryService(db.svc, patients);
    const r = (await svc.createOrReuse('c1', 'u1', {
      last_name: 'Abdullaev',
      first_name: 'Mirshohid',
    })) as Record<string, unknown>;
    expect(r.id).toBe('new');
    expect(db.calls).toHaveLength(0);
  });
});

describe('PatientRegistryService.stats', () => {
  it('tashrif = alohida kunlar; statsionar kassasi va depozit tashrif emas; qarz = manfiy balans', async () => {
    const db = fakeSupabase((name) => {
      if (name === 'transactions') {
        return {
          data: [
            // bir kunda ikki chek — bitta tashrif
            {
              patient_id: 'p1',
              created_at: '2026-10-01T05:00:00Z',
              amount_uzs: 100,
              kind: 'payment',
              register: 'reception',
            },
            {
              patient_id: 'p1',
              created_at: '2026-10-01T09:00:00Z',
              amount_uzs: 50,
              kind: 'payment',
              register: 'reception',
            },
            {
              patient_id: 'p1',
              created_at: '2026-10-05T06:00:00Z',
              amount_uzs: 70,
              kind: 'payment',
              register: 'reception',
            },
            {
              patient_id: 'p1',
              created_at: '2026-10-07T06:00:00Z',
              amount_uzs: 30,
              kind: 'payment',
              register: 'inpatient',
            },
            {
              patient_id: 'p1',
              created_at: '2026-10-08T06:00:00Z',
              amount_uzs: 20,
              kind: 'refund',
              register: 'reception',
            },
          ],
          error: null,
        };
      }
      if (name === 'patient_balance') {
        return { data: [{ patient_id: 'p1', balance_uzs: -40 }], error: null };
      }
      if (name === 'inpatient_stays') {
        return {
          data: [{ patient_id: 'p1', admitted_at: '2026-10-06T07:00:00Z', status: 'admitted' }],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const svc = new PatientRegistryService(db.svc, patients);
    const s = (await svc.stats('c1', ['p1', 'p2'])).get('p1')!;
    expect(s.visits).toBe(3); // 1-okt, 5-okt, 6-okt (yotqizildi)
    expect(s.paid_uzs).toBe(100 + 50 + 70 + 30 - 20);
    expect(s.debt_uzs).toBe(40);
    expect(s.stays).toBe(1);
    expect(s.in_stay).toBe(true);
    expect(s.last_visit_at).toBe('2026-10-06T07:00:00Z');
  });
});

describe('PatientRegistryService.stats — filial tarmog‘i', () => {
  it('boshqa filialdagi qarz alohida ko‘rsatiladi (o‘sha filial nomi bilan)', async () => {
    const db = fakeSupabase((name) => {
      if (name === 'patient_balance') {
        return {
          data: [
            { patient_id: 'p1', clinic_id: 'c1', balance_uzs: -10 },
            { patient_id: 'p1', clinic_id: 'c2', balance_uzs: -30 },
            { patient_id: 'p1', clinic_id: 'c3', balance_uzs: 5 },
          ],
          error: null,
        };
      }
      if (name === 'clinics') return { data: [{ id: 'c2', name: 'Chilonzor' }], error: null };
      return { data: [], error: null };
    });
    const scoped = {
      ...patients,
      branchScope: async () => ['c1', 'c2', 'c3'],
    } as unknown as PatientsService;
    const svc = new PatientRegistryService(db.svc, scoped);
    const s = (await svc.stats('c1', ['p1'])).get('p1')!;
    expect(s.debt_uzs).toBe(35); // -10 - 30 + 5
    expect(s.debt_elsewhere).toEqual([{ clinic_id: 'c2', clinic_name: 'Chilonzor', debt_uzs: 30 }]);
  });

  it('bitta filialda debt_elsewhere bo‘lmaydi', async () => {
    const db = fakeSupabase((name) =>
      name === 'patient_balance'
        ? { data: [{ patient_id: 'p1', clinic_id: 'c1', balance_uzs: -10 }], error: null }
        : { data: [], error: null },
    );
    const s = (await new PatientRegistryService(db.svc, patients).stats('c1', ['p1'])).get('p1')!;
    expect(s.debt_elsewhere).toBeUndefined();
  });
});

describe('stayDays', () => {
  it('qabul kuni — 1-kun, Toshkent sanasi bo‘yicha', () => {
    expect(stayDays('2026-10-01T05:00:00Z', '2026-10-01T15:00:00Z')).toBe(1);
    expect(stayDays('2026-10-01T05:00:00Z', '2026-10-04T05:00:00Z')).toBe(4);
    // 20:00 UTC = Toshkentda ertasi kun
    expect(stayDays('2026-10-01T20:00:00Z', '2026-10-02T05:00:00Z')).toBe(1);
  });
});

describe('PatientRegistryService.history', () => {
  it('xizmatlar, shifokorlar, to‘lov usullari (aralash qismlari), statsionar tashxislari', async () => {
    const db = fakeSupabase((name) => {
      switch (name) {
        case 'patients':
          return { data: { id: 'p1', full_name: 'Abdullaev Mirshohid' }, error: null };
        case 'transactions':
          return {
            data: [
              {
                id: 't2',
                created_at: '2026-10-05T06:00:00Z',
                amount_uzs: 300,
                kind: 'payment',
                payment_method: 'mixed',
                register: 'reception',
                doctor: null,
                appointment: { doctor: { full_name: 'Dr. Karimov' } },
                items: [{ service_name_snapshot: 'EKG', quantity: 1, final_amount_uzs: 300 }],
                legs: [
                  { method: 'cash', amount_uzs: 100 },
                  { method: 'card', amount_uzs: 200 },
                ],
              },
              {
                id: 't1',
                created_at: '2026-10-01T06:00:00Z',
                amount_uzs: 150,
                kind: 'payment',
                payment_method: 'cash',
                register: 'reception',
                doctor: { full_name: 'Dr. Karimov' },
                appointment: null,
                items: [
                  { service_name_snapshot: 'EKG', quantity: 1, final_amount_uzs: 100 },
                  { service_name_snapshot: 'Konsultatsiya', quantity: 1, final_amount_uzs: 50 },
                ],
                legs: [],
              },
            ],
            error: null,
          };
        case 'inpatient_stays':
          return {
            data: [
              {
                id: 's1',
                admitted_at: '2026-10-06T07:00:00Z',
                discharged_at: '2026-10-09T07:00:00Z',
                status: 'discharged',
                admission_reason: 'kardiologiya: bosim',
                discharge_summary: null,
                attending_notes: 'Sog‘aydi',
                discharge_reason: 'recovered',
                total_cost_uzs: 900,
                discharged_with_debt: false,
                bed_no: '2',
                room: { number: '12', floor: 2, building: null, section: null },
                doctor: { full_name: 'Dr. Aliyeva' },
              },
            ],
            error: null,
          };
        case 'treatment_notes':
          return {
            data: [
              {
                id: 'n1',
                created_at: '2026-10-07T07:00:00Z',
                signed_at: null,
                diagnosis_code: 'I10',
                diagnosis_text: 'Gipertoniya',
                soap_assessment: null,
                stay_id: 's1',
                author: { full_name: 'Dr. Aliyeva' },
              },
            ],
            error: null,
          };
        case 'patient_balance':
          return { data: [{ balance_uzs: -50 }], error: null };
        default:
          return { data: [], error: null };
      }
    });
    const svc = new PatientRegistryService(db.svc, patients);
    const h = await svc.history('c1', 'p1');
    expect(h.summary.visits).toBe(3); // 1-okt, 5-okt, 6-okt (yotqizildi)
    expect(h.summary.debt_uzs).toBe(50);
    expect(h.services[0]).toMatchObject({ name: 'EKG', count: 2, amount_uzs: 400 });
    expect(h.doctors).toEqual([
      { name: 'Dr. Karimov', visits: 2, last_at: '2026-10-05T06:00:00Z' },
    ]);
    expect(Object.fromEntries(h.payment_methods.map((m) => [m.method, m.amount_uzs]))).toEqual({
      cash: 250,
      card: 200,
    });
    expect(h.stays[0]).toMatchObject({
      days: 4,
      diagnoses: [{ code: 'I10', text: 'Gipertoniya' }],
    });
    expect(h.diagnoses.map((d) => d.source)).toEqual(['inpatient', 'admission']);
    expect(h.warnings).toEqual([]);
  });
});
