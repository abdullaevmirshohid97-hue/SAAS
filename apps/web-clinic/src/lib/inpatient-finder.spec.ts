import { describe, expect, it } from 'vitest';

import { filterInpatients, stayDays, type FinderStay } from './inpatient-finder';

const stay = (
  id: string,
  name: string,
  room: string | null,
  floor: number | null,
  extra: Partial<FinderStay> = {},
): FinderStay => ({
  id,
  room_id: room ? `r${room}` : null,
  bed_no: null,
  admitted_at: '2026-10-08T09:00:00Z',
  patient: { id: `p${id}`, full_name: name, phone: null },
  room: room ? { id: `r${room}`, number: room, section: null, floor } : null,
  ...extra,
});

const stays = [
  stay('1', 'Aliyev Sardor Karimovich', '12', 2, {
    patient: { id: 'p1', full_name: 'Aliyev Sardor Karimovich', phone: '+998 90 123 45 67' },
  }),
  stay('2', 'Каримова Нилуфар', '3', 1),
  stay('3', 'Sardorova Malika', '10', 2),
  stay('4', 'Toshmatov Bekzod', '2', 1, { bed_no: '2' }),
  stay('5', 'Xonasiz Bemor', null, null),
];

const ids = (q: string) => filterInpatients(stays, q).map((s) => s.id);

describe('filterInpatients', () => {
  it('bo‘sh so‘rov — hammasi, qavat → xona tartibida (xonasizlar oxirida)', () => {
    expect(ids('')).toEqual(['4', '2', '3', '1', '5']);
  });
  it('ism so‘zlari istalgan tartibda', () => {
    expect(ids('sardor aliyev')).toEqual(['1']);
    expect(ids('sardor')).toEqual(['3', '1']);
  });
  it('kirill ↔ lotin farqsiz', () => {
    expect(ids('karimova')).toEqual(['2']);
    expect(ids('Алиев')).toEqual(['1']); // Aliyev ≈ Алиев
  });
  it('raqam — xona raqami yoki telefon', () => {
    expect(ids('12')).toEqual(['1']);
    expect(ids('4567')).toEqual(['1']);
    expect(ids('3')).toEqual(['2']);
  });
});

describe('stayDays', () => {
  it('qabul kuni — 1-kun', () => {
    expect(stayDays('2026-10-11T08:00:00', new Date('2026-10-11T20:00:00'))).toBe(1);
    expect(stayDays('2026-10-08T23:00:00', new Date('2026-10-11T08:00:00'))).toBe(4);
  });
});
