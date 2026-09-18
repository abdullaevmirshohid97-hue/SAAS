import {
  DEFAULT_CLOSING_DAY as UTILS_DEFAULT_CLOSING_DAY,
  cycleRange as cycleRangeIso,
  prevCycleRange as prevCycleRangeIso,
} from '@clary/utils';

// =============================================================================
// MOLIYAVIY DAVR HISOBI — Hisobot quruvchi va Robot uchun YAGONA manba
// =============================================================================
// Ilgari bu funksiyalar `finance-report-panel.tsx` ichida, eksport qilinmagan
// holda turardi. Robot paneli ham xuddi shu davrlarni ko'rsatishi kerak —
// nusxa ko'chirilsa ikki ekran bir xil tugma uchun ikki xil sana oralig'ini
// hisoblab, "qaysi raqam to'g'ri?" degan chalkashlik tug'ilardi.
//
// SIKL matematikasi `@clary/utils` da — API va Telegram bot ham o'sha
// funksiyadan foydalanadi. Bu yerda faqat brauzerga xos qism (Date → ISO,
// localStorage zaxirasi) qoladi.
// =============================================================================

export const iso = (d: Date) => {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return t.toISOString().slice(0, 10);
};

export const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // dushanba = 0
  x.setDate(x.getDate() - dow);
  return x;
};

export type PresetId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'prev_month'
  | 'year'
  | 'cycle'
  | 'prev_cycle'
  | 'custom';

/**
 * "Yopish davri" — klinika oyni kalendar bo'yicha emas, masalan har oyning
 * 10-sanasida yopadi. Unda davr = o'tgan oyning 11-sanasidan shu oyning
 * 10-sanasigacha. Hisob `@clary/utils` da (u yerda testlar ham bor).
 */
export function cycleRange(closingDay: number, ref = new Date()): { from: string; to: string } {
  return cycleRangeIso(closingDay, iso(ref));
}

/** Joriy sikldan bir davr oldingisi ("o'tgan oy" — yopish kuni bo'yicha). */
export function prevCycleRange(closingDay: number, ref = new Date()): { from: string; to: string } {
  return prevCycleRangeIso(closingDay, iso(ref));
}

export function rangeFor(
  preset: PresetId,
  closingDay: number,
  now = new Date(),
): { from: string; to: string } | null {
  switch (preset) {
    case 'today':
      return { from: iso(now), to: iso(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: iso(y), to: iso(y) };
    }
    case 'week':
      return { from: iso(startOfWeek(now)), to: iso(now) };
    case 'month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    case 'prev_month':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'year':
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    case 'cycle':
      return cycleRange(closingDay, now);
    case 'prev_cycle':
      return prevCycleRange(closingDay, now);
    default:
      return null;
  }
}

export const DEFAULT_CLOSING_DAY = UTILS_DEFAULT_CLOSING_DAY;
const LS_KEY = 'clary.closingDay';

/**
 * Yopish kuni: klinika sozlamasi ustuvor, `localStorage` faqat zaxira.
 * Sozlama `clinics.settings.finance_closing_day` da — shu sababli u barcha
 * qurilmada va Telegram botda bir xil bo'ladi. localStorage eski klinikalar
 * uchun qoladi (sozlama hali kiritilmagan bo'lsa ekran buzilmasin).
 */
export function resolveClosingDay(fromSettings?: number | null): number {
  if (typeof fromSettings === 'number' && fromSettings >= 1 && fromSettings <= 28) {
    return fromSettings;
  }
  try {
    const raw = Number(localStorage.getItem(LS_KEY));
    if (raw >= 1 && raw <= 28) return raw;
  } catch {
    // localStorage yopiq bo'lishi mumkin (private rejim) — standartga tushamiz.
  }
  return DEFAULT_CLOSING_DAY;
}

export function rememberClosingDay(day: number) {
  try {
    localStorage.setItem(LS_KEY, String(day));
  } catch {
    // yozib bo'lmasa ham ish to'xtamaydi.
  }
}
