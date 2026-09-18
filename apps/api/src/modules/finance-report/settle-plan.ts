// =============================================================================
// OY YOPISHDA NAQDSIZ PUL REJASI — sof mantiq (bazasiz)
// =============================================================================
// Nega alohida fayl: `closePeriod` Supabase'ga bog'langan va uni unit test
// bilan qoplab bo'lmaydi. Pul qayerga ketishini hal qiladigan qism esa aynan
// xato qilinmasligi kerak bo'lgan joy — shuning uchun u toza funksiyalarga
// ajratilgan va testlar shu yerni qoplaydi.
//
// ⚠️ ASOSIY QOIDA: hech narsa yozilmasdan OLDIN butun reja tekshiriladi.
// Aks holda uchta usuldan ikkitasi yozilib, uchinchisida xato chiqsa — davr
// yopilmagan, lekin pul allaqachon ko'chgan yarim holat qolardi va uni
// qo'lda tozalash kerak bo'lardi.
// =============================================================================

export type SettlePlanRow = {
  method: string;
  amount_uzs: number;
  destination: 'bank' | 'safe';
  bank_account_id?: string | null;
  category?: string | null;
};

export type MethodAvailability = { method: string; pending_uzs: number };

const f = (n: number) => Number(n ?? 0).toLocaleString('uz-UZ');

/** Yopish qadamlari matnida usul nomi o'zbekcha ko'rinsin. */
export const METHOD_LABEL: Record<string, string> = {
  card: 'Plastik',
  humo: 'Humo',
  uzcard: 'UzCard',
  transfer: "O'tkazma",
  mbank: 'MBank',
  click: 'Click',
  payme: 'Payme',
  uzum: 'Uzum',
  kaspi: 'Kaspi',
  stripe: 'Stripe',
  insurance: "Sug'urta",
  aralash: 'Aralash (usuli yozilmagan)',
};

export const methodLabel = (m: string): string => METHOD_LABEL[m] ?? m;

/** Rejadagi nol/manfiy qatorlar tashlanadi — ular yozuv yaratmaydi. */
export function normalizeSettlePlan(plan: readonly SettlePlanRow[] | undefined): SettlePlanRow[] {
  return (plan ?? []).filter((r) => Number(r.amount_uzs) > 0);
}

/**
 * Rejani tekshiradi. Xato bo'lsa matn, bo'lmasa `null` qaytaradi.
 *
 * @param avail  usul kesimidagi qoldiq. BO'SH bo'lsa (migratsiya hali
 *               qo'llanmagan) usul tekshiruvi o'tkazib yuboriladi va faqat
 *               umumiy chegara ishlaydi — ekran ishlamay qolgandan ko'ra
 *               kamroq tekshiruv bilan ishlagani yaxshi.
 * @param totalPending  butun naqdsiz qoldiq (barcha usullar bo'yicha).
 */
export function validateSettlePlan(
  plan: readonly SettlePlanRow[],
  avail: readonly MethodAvailability[],
  totalPending: number,
): string | null {
  // Bitta usul ikki marta kelsa yig'indi chegaradan oshib ketishi mumkin,
  // lekin har qatori alohida tekshiruvdan o'tib ketardi.
  const seen = new Set<string>();
  for (const row of plan) {
    if (seen.has(row.method)) {
      return `"${methodLabel(row.method)}" rejada ikki marta kelgan — har usul bir marta bo'lsin.`;
    }
    seen.add(row.method);
  }

  if (avail.length > 0) {
    for (const row of plan) {
      const have = avail.find((a) => a.method === row.method)?.pending_uzs ?? 0;
      if (row.amount_uzs > have) {
        return (
          `"${methodLabel(row.method)}" bo'yicha bankka o'tmagan summa yetarli emas. ` +
          `Mavjud: ${f(have)} so'm, so'ralgan: ${f(row.amount_uzs)} so'm`
        );
      }
    }
  }

  const total = plan.reduce((acc, r) => acc + Number(r.amount_uzs), 0);
  if (total > totalPending) {
    return (
      `Rejadagi jami (${f(total)} so'm) bankka o'tmagan puldan ` + `(${f(totalPending)} so'm) ko'p.`
    );
  }

  return null;
}

/** Yopish natijasidagi "nima bo'ldi" qatori. */
export function settleStepLabel(row: SettlePlanRow, bankName: string | null): string {
  const where =
    row.destination === 'safe' ? 'seyfga (naqd yechildi)' : (bankName ?? row.category ?? 'bank');
  return `${methodLabel(row.method)} → ${where}: ${f(row.amount_uzs)} so'm`;
}
