import { describe, expect, it } from 'vitest';

import {
  methodLabel,
  normalizeSettlePlan,
  settleStepLabel,
  validateSettlePlan,
  type MethodAvailability,
  type SettlePlanRow,
} from './settle-plan';

// =============================================================================
// OY YOPISH REJASI — pul qayerga ketishini hal qiladigan qism
// =============================================================================
// Bu yerdagi har bir tekshiruv bitta aniq zarar stsenariysini to'sadi:
// usul qoldig'idan ortiq yozish (usul bo'yicha qoldiq MANFIY bo'lib qoladi),
// bitta usulni ikki marta yozish (chegarani chetlab o'tish) va butun
// qoldiqdan ortiq yozish.
// =============================================================================

const row = (
  p: Partial<SettlePlanRow> & { method: string; amount_uzs: number },
): SettlePlanRow => ({
  destination: 'bank',
  ...p,
});

const avail = (...xs: Array<[string, number]>): MethodAvailability[] =>
  xs.map(([method, pending_uzs]) => ({ method, pending_uzs }));

// `toLocaleString('uz-UZ')` mingliklarni UZILMAS probel (U+00A0) bilan ajratadi.
// Kutilgan matnga oddiy probel yozilsa test lokalga bog'lanib mo'rt bo'ladi —
// shuning uchun raqam kutilmada ham xuddi shu formatlagichdan o'tadi.
const f = (n: number) => n.toLocaleString('uz-UZ');

describe('normalizeSettlePlan', () => {
  it('nol va manfiy qatorlarni tashlaydi — ular yozuv yaratmaydi', () => {
    const out = normalizeSettlePlan([
      row({ method: 'card', amount_uzs: 100 }),
      row({ method: 'click', amount_uzs: 0 }),
      row({ method: 'payme', amount_uzs: -50 }),
    ]);
    expect(out.map((r) => r.method)).toEqual(['card']);
  });

  it('reja berilmagan bo‘lsa bo‘sh massiv', () => {
    expect(normalizeSettlePlan(undefined)).toEqual([]);
  });
});

describe('validateSettlePlan', () => {
  it('to‘g‘ri reja o‘tadi', () => {
    const plan = [
      row({ method: 'card', amount_uzs: 5_100_000 }),
      row({ method: 'click', amount_uzs: 800_000, destination: 'safe' }),
    ];
    expect(
      validateSettlePlan(plan, avail(['card', 5_100_000], ['click', 800_000]), 5_900_000),
    ).toBe(null);
  });

  it('usul qoldig‘idan ortiq summani rad etadi', () => {
    const plan = [row({ method: 'click', amount_uzs: 900_000 })];
    // Umumiy qoldiq yetarli (10 mln), lekin AYNAN click bo'yicha 800k bor.
    // Eski kod faqat umumiy chegarani tekshirar edi va buni o'tkazib yuborardi.
    const err = validateSettlePlan(
      plan,
      avail(['card', 9_200_000], ['click', 800_000]),
      10_000_000,
    );
    expect(err).toContain('Click');
    expect(err).toContain('yetarli emas');
  });

  it('bitta usul ikki marta kelsa rad etadi', () => {
    const plan = [
      row({ method: 'card', amount_uzs: 600_000 }),
      row({ method: 'card', amount_uzs: 600_000 }),
    ];
    // Har qatori alohida chegaradan o'tadi (1 mln bor), lekin yig'indi oshib ketadi.
    const err = validateSettlePlan(plan, avail(['card', 1_000_000]), 1_000_000);
    expect(err).toContain('ikki marta');
  });

  it('jami qoldiqdan ortiq bo‘lsa rad etadi', () => {
    const plan = [
      row({ method: 'card', amount_uzs: 700_000 }),
      row({ method: 'click', amount_uzs: 700_000 }),
    ];
    const err = validateSettlePlan(plan, avail(['card', 700_000], ['click', 700_000]), 1_000_000);
    expect(err).toContain("ko'p");
  });

  it('usul kesimi bo‘sh bo‘lsa (migratsiya qo‘llanmagan) faqat umumiy chegara ishlaydi', () => {
    const plan = [row({ method: 'click', amount_uzs: 900_000 })];
    expect(validateSettlePlan(plan, [], 10_000_000)).toBe(null);
    expect(validateSettlePlan(plan, [], 100_000)).toContain('ko');
  });

  it('nomi noma’lum usul ham qoldiq bo‘yicha tekshiriladi', () => {
    const err = validateSettlePlan(
      [row({ method: 'sqb', amount_uzs: 10 })],
      avail(['sqb', 5]),
      100,
    );
    expect(err).toContain('sqb');
  });
});

describe('settleStepLabel', () => {
  it('bank nomi bo‘lsa uni ko‘rsatadi', () => {
    expect(settleStepLabel(row({ method: 'card', amount_uzs: 5_100_000 }), 'Asosiy hisob')).toBe(
      `Plastik → Asosiy hisob: ${f(5_100_000)} so'm`,
    );
  });

  it('seyf yo‘nalishi naqd yechilganini aytadi', () => {
    expect(
      settleStepLabel(row({ method: 'payme', amount_uzs: 400_000, destination: 'safe' }), null),
    ).toBe(`Payme → seyfga (naqd yechildi): ${f(400_000)} so'm`);
  });

  it('bank nomi yo‘q, kategoriya bor — kategoriya ko‘rinadi', () => {
    expect(
      settleStepLabel(
        row({ method: 'transfer', amount_uzs: 1_900_000, category: 'Egasining hisobi' }),
        null,
      ),
    ).toBe(`O'tkazma → Egasining hisobi: ${f(1_900_000)} so'm`);
  });
});

describe('methodLabel', () => {
  it('tanish usullarni tarjima qiladi', () => {
    expect(methodLabel('card')).toBe('Plastik');
    expect(methodLabel('click')).toBe('Click');
  });

  it('notanish usulni o‘zgartirmaydi', () => {
    expect(methodLabel('kapitalbank')).toBe('kapitalbank');
  });
});
