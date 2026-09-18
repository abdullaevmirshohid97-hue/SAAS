import { CalendarDays, CalendarRange, Lock, Sun, type LucideIcon } from 'lucide-react';

import { cycleRange, prevCycleRange, rangeFor } from '@/lib/finance-periods';

// =============================================================================
// ROBOT VAZIFALARI — deklarativ ro'yxat
// =============================================================================
// Yangi vazifa qo'shish = shu massivga bitta yozuv. Panel kodi o'zgarmaydi.
// (Ilgari bu tugma AI chat edi: foydalanuvchi savolni yozardi, model esa har
// safar boshqacha javob berardi. Bu yerda esa har tugma AYNAN bitta ishni
// bajaradi — natija takrorlanadigan va tekshiriladigan.)
// =============================================================================

export type RobotAction = 'pdf' | 'telegram' | 'close';

export type RobotTask = {
  id: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  /** Davr — yopish kuni klinika sozlamasidan keladi. */
  range: (closingDay: number) => { from: string; to: string };
  actions: RobotAction[];
};

const today = (): { from: string; to: string } => rangeFor('today', 1) ?? { from: '', to: '' };

export const ROBOT_TASKS: RobotTask[] = [
  {
    id: 'today',
    icon: Sun,
    label: 'Bugungi hisobot',
    hint: 'Bugun ertalabdan hozirgacha',
    range: today,
    actions: ['pdf', 'telegram'],
  },
  {
    id: 'week',
    icon: CalendarDays,
    label: 'Haftalik hisobot',
    hint: 'Dushanbadan bugungacha',
    range: () => rangeFor('week', 1)!,
    actions: ['pdf', 'telegram'],
  },
  {
    id: 'cycle',
    icon: CalendarRange,
    label: 'Oylik hisobot',
    hint: 'Joriy yopish davri',
    range: (d) => cycleRange(d),
    actions: ['pdf', 'telegram'],
  },
  {
    id: 'prev_cycle',
    icon: CalendarRange,
    label: "O'tgan oy",
    hint: 'Oldingi yopish davri',
    range: (d) => prevCycleRange(d),
    actions: ['pdf', 'telegram'],
  },
  {
    id: 'close',
    icon: Lock,
    // ⚠️ "Kassa" so'zi ataylab: loyihada ikkita oy yopish bor —
    // /month-closing = BUXGALTERIYA davri (GL, amortizatsiya, soliq),
    // bu esa KASSA yopish (naqd → seyf, period_closings). Nomlari
    // ajratilmasa operator qaysi biri ekanini bilmaydi.
    label: 'Kassa oyini yopish',
    hint: 'Naqd → seyf, naqdsiz → bank. Davr qulflanadi',
    range: (d) => cycleRange(d),
    actions: ['close'],
  },
];
