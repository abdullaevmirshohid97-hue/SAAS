import { View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../lib/api';

export type Schedule = Awaited<ReturnType<typeof staffApi.nurse.listSchedules>>[number];
export type Segment = 'clinic' | 'home';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** "HH:MM" oralig'ida ekanini tekshiradi (tungi navbat — end < start — ham qo'llab) */
function inRange(now: string, start: string, end: string) {
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  if (s <= e) return now >= s && now <= e;
  return now >= s || now <= e; // overnight
}

export interface ShiftStatus {
  onShift: boolean;
  current: Schedule | null;
  defaultSegment: Segment;
}

/**
 * Joriy vaqt (qurilma local vaqti — klinika Tashkent UTC+5) hamshira
 * navbatchilik jadvaliga to'g'ri kelishini hisoblaydi.
 */
export function computeShiftStatus(
  schedules: Schedule[],
  userId: string | null,
  now: Date = new Date(),
): ShiftStatus {
  if (!userId) return { onShift: false, current: null, defaultSegment: 'home' };
  const mine = schedules.filter((s) => s.nurse_id === userId && s.is_active);
  const dow = now.getDay(); // 0=Yakshanba ... 6=Shanba (DB day_of_week bilan mos)
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const current =
    mine.find((s) => s.day_of_week === dow && inRange(hhmm, s.start_time, s.end_time)) ?? null;
  return { onShift: !!current, current, defaultSegment: current ? 'clinic' : 'home' };
}

export function ShiftBanner({ status }: { status: ShiftStatus }) {
  if (status.onShift && status.current) {
    const c = status.current;
    return (
      <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3 dark:bg-emerald-950">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
          <Feather name="briefcase" size={18} color="#059669" />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Hozir: Klinika navbati
          </Text>
          <Text className="text-xs text-emerald-700 dark:text-emerald-300">
            {c.start_time.slice(0, 5)}–{c.end_time.slice(0, 5)} · {c.floor}-qavat
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-900">
      <View className="h-9 w-9 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <Feather name="home" size={18} color="#6B7280" />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Navbatdan tashqari
        </Text>
        <Text className="text-xs text-gray-500 dark:text-gray-400">Uy chaqiruvlari vaqti</Text>
      </View>
    </View>
  );
}
