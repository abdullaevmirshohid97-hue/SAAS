import { describe, expect, it } from 'vitest';

import {
  assignRoom,
  autoDepartmentsByBuilding,
  autoDepartmentsBySection,
  freeBedNumbers,
  groupRooms,
  readQuickAdmit,
  unassignedRooms,
  type QuickAdmitRoom,
} from './inpatient-quick-admit';

const room = (p: Partial<QuickAdmitRoom> & { id: string; number: string }): QuickAdmitRoom => ({
  floor: 1,
  section: null,
  building: null,
  capacity: 2,
  daily_price_uzs: 100_000,
  half_day_price_uzs: null,
  meal_daily_uzs: null,
  status: 'available',
  type: 'ward',
  tier: 'standart',
  includes_meals: false,
  occupants: [],
  occupied: 0,
  vacancy: p.capacity ?? 2,
  ...p,
});

describe('readQuickAdmit', () => {
  it('belgilanmagan bo‘lsa — yoqilgan, bo‘limsiz', () => {
    expect(readQuickAdmit(undefined)).toEqual({ enabled: true, departments: [] });
    expect(readQuickAdmit({})).toEqual({ enabled: true, departments: [] });
  });
  it('o‘chirilgan va buzuq bo‘limlar', () => {
    const s = readQuickAdmit({
      inpatient_quick_admit: {
        enabled: false,
        departments: [{ id: 'a', name: '1-bo‘lim', room_ids: ['r1', 5] }, { name: 'x' }, null],
      },
    });
    expect(s.enabled).toBe(false);
    expect(s.departments).toEqual([{ id: 'a', name: '1-bo‘lim', room_ids: ['r1'] }]);
  });
});

describe('groupRooms', () => {
  const rooms = [
    room({ id: 'r10', number: '10' }),
    room({ id: 'r2', number: '2', vacancy: 0, occupied: 2 }),
    room({ id: 'r3', number: '3', capacity: 3, vacancy: 1, occupied: 2 }),
    room({ id: 'r4', number: '4', status: 'maintenance' }),
  ];
  it('bo‘limsiz — bitta guruh, tabiiy tartib, bo‘sh joylar hisobi', () => {
    const [g, ...rest] = groupRooms(rooms, []);
    expect(rest).toHaveLength(0);
    expect(g!.rooms.map((r) => r.number)).toEqual(['2', '3', '4', '10']);
    expect(g!.freeRooms).toBe(2); // 3 (1 joy) + 10 (2 joy); 2 — to'la, 4 — ta'mirda
    expect(g!.freeBeds).toBe(3);
  });
  it('bo‘limlar bo‘yicha, o‘chirilgan xona id‘lari tushib qoladi', () => {
    const ds = [
      { id: 'a', name: '1-bo‘lim', room_ids: ['r10', 'gone', 'r2'] },
      { id: 'b', name: '2-bo‘lim', room_ids: ['r3'] },
    ];
    const gs = groupRooms(rooms, ds);
    expect(gs.map((g) => [g.name, g.rooms.map((r) => r.id), g.freeBeds])).toEqual([
      ['1-bo‘lim', ['r2', 'r10'], 2],
      ['2-bo‘lim', ['r3'], 1],
    ]);
    expect(unassignedRooms(rooms, ds).map((r) => r.id)).toEqual(['r4']);
  });
  it('xona yo‘q — guruh ham yo‘q', () => {
    expect(groupRooms([], [])).toEqual([]);
  });
});

describe('assignRoom', () => {
  it('xona faqat bitta bo‘limda bo‘ladi', () => {
    const ds = [
      { id: 'a', name: 'A', room_ids: ['r1', 'r2'] },
      { id: 'b', name: 'B', room_ids: [] },
    ];
    const moved = assignRoom(ds, 'b', 'r1', true);
    expect(moved).toEqual([
      { id: 'a', name: 'A', room_ids: ['r2'] },
      { id: 'b', name: 'B', room_ids: ['r1'] },
    ]);
    expect(assignRoom(moved, 'b', 'r1', false)[1]!.room_ids).toEqual([]);
  });
});

describe('avtomatik bo‘limlar', () => {
  // Magnus: bo'lim nomlari qo'lda, turlicha yozilgan
  const rooms = [
    { id: '1', number: '1', section: '1- bolim', building: 'A bino' },
    { id: '2', number: '12', section: '1-bolim oldi', building: 'a bino ' },
    { id: '3', number: '21', section: '2- bolim orqa', building: 'B bino' },
    { id: '4', number: '22', section: '2-bolip', building: 'B bino' },
    { id: '5', number: '30', section: 'Reanimatsiya', building: null },
    { id: '6', number: '31', section: null, building: null },
  ];
  it('section boshidagi raqam bo‘yicha', () => {
    expect(autoDepartmentsBySection(rooms).map((d) => [d.name, d.room_ids])).toEqual([
      ["1-bo'lim", ['1', '2']],
      ["2-bo'lim", ['3', '4']],
      ['Reanimatsiya', ['5']],
      ['Boshqa xonalar', ['6']],
    ]);
  });
  it('bino bo‘yicha (katta-kichik harf, bo‘shliq farqi bitta guruh)', () => {
    expect(autoDepartmentsByBuilding(rooms).map((d) => [d.name, d.room_ids])).toEqual([
      ['A bino', ['1', '2']],
      ['B bino', ['3', '4']],
      ['Asosiy bino', ['5', '6']],
    ]);
  });
});

describe('freeBedNumbers', () => {
  it('band yotoqlar chiqarib tashlanadi', () => {
    expect(
      freeBedNumbers({
        capacity: 3,
        occupants: [
          { id: 's', bed_no: ' 2 ' },
          { id: 't', bed_no: null },
        ],
      }),
    ).toEqual(['1', '3']);
  });
});
