// =============================================================================
// Qabulxonadan tezkor statsionar qabul — bo'limlar va bo'sh xonalar
// =============================================================================
// Sozlama `clinics.settings.inpatient_quick_admit`da saqlanadi (migratsiyasiz):
//   { enabled: boolean, departments: [{ id, name, room_ids }] }
// Bo'limlar ko'rsatilmagan bo'lsa — barcha xonalar bitta guruhda chiqadi.
// =============================================================================

export interface QuickAdmitDepartment {
  id: string;
  name: string;
  room_ids: string[];
}

export interface QuickAdmitSettings {
  enabled: boolean;
  departments: QuickAdmitDepartment[];
}

export const MAX_DEPARTMENTS = 20;

/** room-map'dagi xona (faqat bizga keraklilari). */
export interface QuickAdmitRoom {
  id: string;
  number: string;
  floor: number | null;
  section: string | null;
  building: string | null;
  capacity: number;
  daily_price_uzs: number | null;
  half_day_price_uzs: number | null;
  meal_daily_uzs: number | null;
  status: string;
  type: string | null;
  tier: string | null;
  includes_meals: boolean;
  occupants: Array<{ id: string; bed_no: string | null }>;
  occupied: number;
  vacancy: number;
}

export interface QuickAdmitGroup<R extends QuickAdmitRoom = QuickAdmitRoom> {
  id: string;
  name: string;
  rooms: R[];
  /** Bo'sh joylar soni (yaroqli xonalar bo'yicha). */
  freeBeds: number;
  /** Kamida bitta bo'sh joyi bor xonalar soni. */
  freeRooms: number;
}

/** Sozlamani o'qish. Belgilanmagan bo'lsa — tugma yoqilgan, bo'limlar yo'q. */
export function readQuickAdmit(settings: unknown): QuickAdmitSettings {
  const raw = (settings as { inpatient_quick_admit?: unknown } | null | undefined)
    ?.inpatient_quick_admit as Partial<QuickAdmitSettings> | undefined;
  const departments = Array.isArray(raw?.departments)
    ? raw!.departments
        .filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string')
        .map((d) => ({
          id: d.id,
          name: d.name,
          room_ids: Array.isArray(d.room_ids)
            ? d.room_ids.filter((x) => typeof x === 'string')
            : [],
        }))
    : [];
  return { enabled: raw?.enabled !== false, departments };
}

/** Xonaga yangi bemor joylash mumkinmi (ta'mirda/tozalanayotgan emas, joy bor). */
export function isRoomFree(r: QuickAdmitRoom): boolean {
  return r.vacancy > 0 && r.status !== 'maintenance' && r.status !== 'cleaning';
}

/** "2" < "10", "2a" < "2b" — xona raqamlari tabiiy tartibda. */
export function compareRoomNumber(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function group<R extends QuickAdmitRoom>(id: string, name: string, rooms: R[]): QuickAdmitGroup<R> {
  const sorted = [...rooms].sort((x, y) => compareRoomNumber(x.number, y.number));
  const free = sorted.filter(isRoomFree);
  return {
    id,
    name,
    rooms: sorted,
    freeBeds: free.reduce((s, r) => s + r.vacancy, 0),
    freeRooms: free.length,
  };
}

/**
 * Xonalarni bo'limlarga ajratish. Bo'limlar sozlanmagan bo'lsa — bitta
 * "Barcha xonalar" guruhi. Sozlangan bo'lsa — faqat biriktirilgan xonalar
 * (arxivlangan/o'chirilgan xona id'lari jimgina tushib qoladi).
 */
export function groupRooms<R extends QuickAdmitRoom>(
  rooms: R[],
  departments: QuickAdmitDepartment[],
): QuickAdmitGroup<R>[] {
  if (departments.length === 0) return rooms.length ? [group('all', 'Barcha xonalar', rooms)] : [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  return departments.map((d) =>
    group(
      d.id,
      d.name,
      d.room_ids.map((id) => byId.get(id)).filter((r): r is R => !!r),
    ),
  );
}

/** Hech bir bo'limga biriktirilmagan xonalar (sozlamada ogohlantirish uchun). */
export function unassignedRooms<R extends { id: string }>(
  rooms: R[],
  departments: QuickAdmitDepartment[],
): R[] {
  const used = new Set(departments.flatMap((d) => d.room_ids));
  return rooms.filter((r) => !used.has(r.id));
}

/** Xona faqat bitta bo'limda bo'lishi uchun: boshqa bo'limlardan olib, shu bo'limga qo'shadi. */
export function assignRoom(
  departments: QuickAdmitDepartment[],
  deptId: string,
  roomId: string,
  on: boolean,
): QuickAdmitDepartment[] {
  return departments.map((d) => {
    const rest = d.room_ids.filter((id) => id !== roomId);
    if (d.id === deptId && on) return { ...d, room_ids: [...rest, roomId] };
    return rest.length === d.room_ids.length ? d : { ...d, room_ids: rest };
  });
}

export function newDepartmentId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function autoGroups<R extends { id: string; number: string }>(
  rooms: R[],
  keyOf: (r: R) => { key: string; name: string; order: number },
): QuickAdmitDepartment[] {
  const map = new Map<string, { name: string; order: number; ids: string[] }>();
  for (const r of [...rooms].sort((a, b) => compareRoomNumber(a.number, b.number))) {
    const k = keyOf(r);
    const g = map.get(k.key) ?? { name: k.name, order: k.order, ids: [] };
    g.ids.push(r.id);
    map.set(k.key, g);
  }
  return [...map.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((g, i) => ({ id: `auto${i + 1}`, name: g.name, room_ids: g.ids }));
}

/**
 * Xonadagi "Bo'lim" (section) maydoni bo'yicha avtomatik bo'limlar. Boshidagi
 * raqam hal qiladi: "1- bolim", "1-bolim oldi" → "1-bo'lim"; "2-bolip orqa" →
 * "2-bo'lim". Raqamsizlari matni bo'yicha, bo'shlari "Boshqa xonalar"ga.
 */
export function autoDepartmentsBySection(
  rooms: Array<{ id: string; number: string; section: string | null }>,
): QuickAdmitDepartment[] {
  return autoGroups(rooms, (r) => {
    const s = (r.section ?? '').trim();
    const m = /^(\d{1,3})/.exec(s);
    if (m) return { key: `n${Number(m[1])}`, name: `${Number(m[1])}-bo'lim`, order: Number(m[1]) };
    if (s) return { key: `s${s.toLowerCase()}`, name: s, order: 1000 };
    return { key: '-', name: 'Boshqa xonalar', order: 2000 };
  });
}

/** Bino bo'yicha avtomatik bo'limlar ("A bino", "a bino " — bitta guruh). */
export function autoDepartmentsByBuilding(
  rooms: Array<{ id: string; number: string; building: string | null }>,
): QuickAdmitDepartment[] {
  return autoGroups(rooms, (r) => {
    const b = (r.building ?? '').trim();
    if (!b) return { key: '-', name: 'Asosiy bino', order: 1 };
    return {
      key: b.toLowerCase(),
      name: b.charAt(0).toUpperCase() + b.slice(1),
      order: 0,
    };
  });
}

/** Xonadagi bo'sh yotoq raqamlari (1..capacity, band bed_no'lardan tashqari). */
export function freeBedNumbers(r: Pick<QuickAdmitRoom, 'capacity' | 'occupants'>): string[] {
  const taken = new Set(r.occupants.map((o) => (o.bed_no ?? '').trim()).filter(Boolean));
  const out: string[] = [];
  for (let i = 1; i <= Math.min(r.capacity, 50); i++) {
    if (!taken.has(String(i))) out.push(String(i));
  }
  return out;
}

export const TIER_LABEL: Record<string, string> = {
  lyuks: 'Lyuks',
  comfort: 'Komfort',
  standart: 'Standart',
  depozit: 'Depozit',
};

/** Tarif tartibi: lyuks → komfort → standart → boshqa. */
export function tierOrder(tier: string | null): number {
  return tier === 'lyuks' ? 0 : tier === 'comfort' ? 1 : tier === 'standart' ? 2 : 3;
}
