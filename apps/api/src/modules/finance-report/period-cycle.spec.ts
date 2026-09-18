import { describe, expect, it } from 'vitest';

import { clampClosingDay, cycleRange, prevCycleRange } from '@clary/utils';

// Manba: packages/utils/src/period.ts (veb ham shu yerdan foydalanadi).
// Test shu yerda, chunki @clary/utils da test yuruvchisi yo'q.
// =============================================================================
// YOPISH DAVRI — veb, API va Telegram bot bitta natijani ko'rsatishi shart
// =============================================================================
// MAGNUS har oyning 10-sanasida yopadi: davr = 11-iyul … 10-avgust. Agar bu
// matematika ikki joyda ikki xil bo'lsa, "Oylik hisobot" tugmasi vebda bir,
// botda boshqa raqam chiqaradi va qaysi biri to'g'ri ekani bilinmaydi.
// =============================================================================

describe('cycleRange', () => {
  it('yopish kuni O‘TGAN bo‘lsa — sikl shu oyda tugaydi', () => {
    expect(cycleRange(10, '2026-09-18')).toEqual({ from: '2026-08-11', to: '2026-09-10' });
  });

  it('yopish kuni hali KELMAGAN bo‘lsa — oldingi sikl davom etadi', () => {
    expect(cycleRange(10, '2026-09-05')).toEqual({ from: '2026-07-11', to: '2026-08-10' });
  });

  it('aynan yopish kunida — sikl hali yopilmagan deb qaraladi', () => {
    // Kun bo'yi kassa ishlaydi; 10-sana tugamaguncha uni "o'tgan davr" deb
    // hisoblash kassirning bugungi ishini davrdan tashqarida qoldirardi.
    expect(cycleRange(10, '2026-09-10')).toEqual({ from: '2026-07-11', to: '2026-08-10' });
  });

  it('yil chegarasidan to‘g‘ri o‘tadi', () => {
    expect(cycleRange(10, '2026-01-05')).toEqual({ from: '2025-11-11', to: '2025-12-10' });
    expect(cycleRange(10, '2026-01-20')).toEqual({ from: '2025-12-11', to: '2026-01-10' });
  });

  it('yopish kuni 28 va fevral — 29-fevral YASALMAYDI', () => {
    // Regressiya: "d+1" usuli bu yerda 2026-02-29 ni chiqarardi. Bunday sana
    // yo'q, lekin regex tekshiruvidan o'tib bazaga tushardi.
    expect(cycleRange(28, '2026-03-29')).toEqual({ from: '2026-03-01', to: '2026-03-28' });
  });

  it('fevralda tugaydigan davr yanvarning 29-kunidan boshlanadi', () => {
    // Yanvar 31 kunlik — 28-yanvarda davr yopilgan, ertasi 29-yanvar.
    expect(cycleRange(28, '2026-03-10')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });

  it('uzun oylarda odatdagidek d+1 dan boshlanadi', () => {
    expect(cycleRange(28, '2026-04-29')).toEqual({ from: '2026-03-29', to: '2026-04-28' });
  });
});

describe('prevCycleRange', () => {
  it('joriy sikldan aynan bitta davr orqada', () => {
    expect(cycleRange(10, '2026-09-18')).toEqual({ from: '2026-08-11', to: '2026-09-10' });
    expect(prevCycleRange(10, '2026-09-18')).toEqual({ from: '2026-07-11', to: '2026-08-10' });
  });

  it('yopish kunining O‘ZIDA ham bitta davr orqada (ikki emas)', () => {
    // Regressiya: "joriy sikl boshidan bir kun oldin" usuli bu yerda ikki
    // davr orqaga sirg'alib ketardi.
    expect(cycleRange(10, '2026-09-10')).toEqual({ from: '2026-07-11', to: '2026-08-10' });
    expect(prevCycleRange(10, '2026-09-10')).toEqual({ from: '2026-06-11', to: '2026-07-10' });
  });

  it('yil chegarasi', () => {
    expect(prevCycleRange(10, '2026-01-20')).toEqual({ from: '2025-11-11', to: '2025-12-10' });
  });

  it('joriy sikl boshi = oldingi sikl oxiridan keyingi kun (bo‘shliq yo‘q)', () => {
    for (const ref of ['2026-09-18', '2026-01-05', '2026-03-29', '2026-12-31']) {
      const cur = cycleRange(10, ref);
      const prev = prevCycleRange(10, ref);
      const nextDay = new Date(`${prev.to}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      expect(nextDay.toISOString().slice(0, 10)).toBe(cur.from);
    }
  });
});

describe('clampClosingDay', () => {
  it('chegaradan chiqqan qiymatni qisadi', () => {
    expect(clampClosingDay(0)).toBe(1);
    expect(clampClosingDay(31)).toBe(28);
    expect(clampClosingDay(10)).toBe(10);
  });

  it('yaroqsiz qiymatda standartga tushadi', () => {
    expect(clampClosingDay(undefined)).toBe(10);
    expect(clampClosingDay('salom')).toBe(10);
  });
});
