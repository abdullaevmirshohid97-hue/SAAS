import { afterEach, describe, expect, it, vi } from 'vitest';
import { castAnnouncementPlan, castRoomDisplay, castSeq, CAST_VOICE_CLIPS } from '@clary/schemas';

import { CastAnnouncer } from '../../common/services/cast-announcer.service';
import type { SupabaseService } from '../../common/services/supabase.service';
import { CastService } from './cast.module';

// Supabase query builder'ining kichik soxtasi: natija jadval nomi bo'yicha
// (funksiya bo'lsa — yozilgan filtrlar bilan chaqiriladi).
type Call = { table: string; filters: Array<[string, unknown]> };
function fakeSupabase(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const result = () => {
      const v = responses[table];
      return {
        data: typeof v === 'function' ? (v as (c: Call) => unknown)(call) : (v ?? null),
        error: null,
        count: 0,
      };
    };
    const b: Record<string, unknown> = {};
    for (const n of ['select', 'order', 'limit']) b[n] = () => b;
    for (const n of ['eq', 'in']) {
      b[n] = (col: string, val: unknown) => {
        call.filters.push([col, val]);
        return b;
      };
    }
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const admin = { from: (t: string) => builder(t) };
  return { svc: { admin: () => admin } as unknown as SupabaseService, calls };
}

const cast = (svc: SupabaseService) => new CastService(svc, new CastAnnouncer(svc));

describe('CastService.board', () => {
  it("bog'lanmagan TV navbatni ko'rmaydi", async () => {
    const { svc, calls } = fakeSupabase({
      queue_displays: { clinic_id: 'c1', is_paired: false },
    });
    const r = await cast(svc).board('dev-1');
    expect(r).toEqual({ paired: false, clinic_name: null, called: [], waiting: [] });
    expect(calls.map((c) => c.table)).toEqual(['queue_displays']);
  });

  it('ism qisqartiriladi, xona shifokor profilidan, chaqirilganlar yangisi birinchi', async () => {
    const { svc } = fakeSupabase({
      queue_displays: { clinic_id: 'c1', is_paired: true },
      clinics: { name: 'MAGNUS' },
      profiles: [
        { id: 'd1', room_label: '7' },
        { id: 'd2', room_label: '  ' },
      ],
      queues: [
        {
          id: 'q1',
          ticket_code: 'A-001',
          ticket_color: null,
          status: 'called',
          queue_seq: 1,
          doctor_id: 'd1',
          called_at: '2026-10-18T05:00:00Z',
          started_at: null,
          doctor: { full_name: 'Aliyev Bobur' },
          patient: { full_name: 'Karimova Dilnoza Rustamovna' },
        },
        {
          id: 'q2',
          ticket_code: 'T-002',
          ticket_color: null,
          status: 'serving',
          queue_seq: 2,
          doctor_id: 'd2',
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
          queue_seq: 3,
          doctor_id: 'd1',
          called_at: null,
          started_at: null,
          doctor: { full_name: 'Aliyev Bobur' },
          patient: { full_name: '  Rahimov   Jasur ' },
        },
      ],
    });
    const r = await cast(svc).board('dev-1');
    expect(r.paired).toBe(true);
    expect(r.clinic_name).toBe('MAGNUS');
    expect(r.called.map((x) => x.id)).toEqual(['q2', 'q1']);
    expect(r.called[1]).toMatchObject({ patient: 'Karimova D.', room: '7', seq: 1 });
    expect(r.called[0]).toMatchObject({ patient: 'Toshmatov', doctor: null, room: null });
    expect(r.waiting).toEqual([
      expect.objectContaining({ id: 'q3', patient: 'Rahimov J.', room: '7', ticket_color: '#f00' }),
    ]);
  });
});

describe('CastAnnouncer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("chaqiruvni xona bilan Realtime REST orqali yuboradi, to'liq ism chiqmaydi", async () => {
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co/');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srv');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const { svc } = fakeSupabase({
      queues: {
        id: 'q1',
        ticket_code: 'A-004',
        queue_seq: 4,
        doctor_id: 'd1',
        doctor: { full_name: 'Aliyev Bobur' },
        patient: { full_name: 'Abdullaev Mirshohid' },
      },
      profiles: [{ id: 'd1', room_label: '8' }],
    });
    const p = await new CastAnnouncer(svc).announce('c1', 'q1');
    expect(p).toMatchObject({ seq: 4, room: '8', patient_name: 'Abdullaev M.' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/realtime/v1/api/broadcast');
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ topic: string; event: string; payload: Record<string, unknown> }>;
    };
    expect(body.messages[0]).toMatchObject({ topic: 'clinic-c1-cast', event: 'call' });
    expect(JSON.stringify(body)).not.toContain('Mirshohid');
  });

  it("xona ustuni yo'q (migratsiyagacha) — xonasiz e'lon qilinadi", async () => {
    const svc = {
      admin: () => ({
        from: () => {
          const b: Record<string, unknown> = {};
          for (const n of ['select', 'in']) b[n] = () => b;
          b.then = (res: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { message: 'column room_label does not exist' },
            }).then(res);
          return b;
        },
      }),
    } as unknown as SupabaseService;
    expect(await new CastAnnouncer(svc).roomsFor(['d1'])).toEqual({});
  });
});

describe('castAnnouncementPlan', () => {
  it("raqam va xona bo'laklardan yig'iladi", () => {
    expect(castAnnouncementPlan({ seq: 4, room: '8' })).toEqual({
      text: "To'rt raqamli bemor, sakkizinchi xonaga marhamat.",
      clips: ['n4', 'p_patient', 'o8', 'p_room'],
    });
    expect(castAnnouncementPlan({ seq: 25, room: '7-xona' }).clips).toEqual([
      'n20',
      'n5',
      'p_patient',
      'o7',
      'p_room',
    ]);
    expect(castAnnouncementPlan({ seq: 245, room: '210' })).toEqual({
      text: "Ikki yuz qirq besh raqamli bemor, ikki yuz o'ninchi xonaga marhamat.",
      clips: ['n2', 'n100', 'n40', 'n5', 'p_patient', 'n2', 'n100', 'o10', 'p_room'],
    });
    expect(castAnnouncementPlan({ seq: 100, room: '20' }).clips).toEqual([
      'n100',
      'p_patient',
      'o20',
      'p_room',
    ]);
  });

  it("xona yo'q / nomli xona / raqamsiz navbat", () => {
    expect(castAnnouncementPlan({ seq: 3, room: null })).toEqual({
      text: 'Uch raqamli bemor, qabulga marhamat.',
      clips: ['n3', 'p_patient', 'p_welcome'],
    });
    expect(castAnnouncementPlan({ seq: 3, room: 'UZI' })).toEqual({
      text: 'Uch raqamli bemor, UZI xonasiga marhamat.',
      clips: null,
    });
    expect(castAnnouncementPlan({ seq: null, room: '5' }).clips).toEqual([
      'p_next',
      'o5',
      'p_room',
    ]);
  });

  it('har bir rejadagi bo‘lak ro‘yxatda bor', () => {
    const keys = new Set(CAST_VOICE_CLIPS.map((c) => c.key));
    for (let seq = 1; seq <= 999; seq++) {
      const p = castAnnouncementPlan({ seq, room: String(((seq * 7) % 999) + 1) });
      for (const k of p.clips ?? []) expect(keys.has(k), k).toBe(true);
    }
    expect(CAST_VOICE_CLIPS).toHaveLength(42);
  });

  it('yordamchilar', () => {
    expect(castSeq('A-004', null)).toBe(4);
    expect(castSeq('A-004', 9)).toBe(9);
    expect(castSeq(null, null)).toBeNull();
    expect(castRoomDisplay('7')).toBe('7-xona');
    expect(castRoomDisplay('№12')).toBe('12-xona');
    expect(castRoomDisplay('UZI')).toBe('UZI');
  });
});
