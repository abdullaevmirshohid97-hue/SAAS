// =============================================================================
// Qabulxona checkout — sof hisob-kitob mantiqi (DB'siz, testlanadigan).
//
// Nega alohida fayl: bu mantiq ilgari `checkout()` ning 300 qatorlik tanasi
// ichida, Supabase chaqiruvlari orasiga singdirilgan edi va uni test qilishning
// yagona yo'li butun DB'ni ko'tarish bo'lardi. Bu yerdagi funksiyalar hech
// nimaga bog'liq emas — kirish → chiqish. Xatti-harakat asl koddan bir xil
// ko'chirilgan (`lab/analyzers/fhir-mapper.ts` uslubi: modul yonida sof fayl).
//
// Bu yerda qamrab olingan tarixiy baglar:
//   - frontend `unit_price_uzs: 0` yuborganda komissiya gross'i 0 bo'lib qolishi
//   - operator qarzga ortiqcha nol qo'shishi (270 000 → 2 700 000)
// =============================================================================

/** Checkout'ga kelgan bitta satr (CheckoutItemSchema bilan bir xil shakl). */
export interface CheckoutItemInput {
  service_id: string;
  quantity: number;
  unit_price_uzs?: number | undefined;
  discount_uzs?: number | undefined;
}

/** `services` jadvalidan olingan, hisob uchun zarur maydonlar. */
export interface CheckoutServiceRow {
  price_uzs: number;
  cost_uzs?: number | null | undefined;
  name_i18n: Record<string, string>;
}

/** Bitta to'lov oyog'i (aralash to'lovda bir nechta bo'ladi). */
export interface PaymentLegInput {
  method: string;
  amount_uzs: number;
}

/** `transaction_items` uchun tayyorlangan qator (clinic_id/transaction_id keyin qo'shiladi). */
export interface CheckoutItemRow {
  service_id: string;
  service_name_snapshot: string;
  service_price_snapshot: number;
  quantity: number;
  discount_snapshot: { amount: number } | null;
  final_amount_uzs: number;
  cost_snapshot_uzs: number;
}

/**
 * Xizmat nomini i18n obyektidan tanlaydi.
 * Tartib asl koddagidek: uz-Latn → ru → birinchi mavjud → 'service'.
 */
export function pickServiceName(nameI18n: Record<string, string> | null | undefined): string {
  const n = nameI18n ?? {};
  return n['uz-Latn'] ?? n['ru'] ?? Object.values(n)[0] ?? 'service';
}

/**
 * Satrlar bo'yicha jami summa va `transaction_items` qatorlarini hisoblaydi.
 *
 * MUHIM: frontend `unit_price_uzs` ni 0 yoki umuman yubormasa, jadvaldagi
 * haqiqiy narx olinadi. Aks holda summa 0 bo'lib, shifokor komissiyasi ham
 * 0 dan hisoblanardi.
 *
 * @throws Error — agar satrga mos xizmat topilmasa (chaqiruvchi uni
 *   BadRequestException'ga aylantiradi).
 */
export function computeItemTotals(
  items: readonly CheckoutItemInput[],
  services: ReadonlyMap<string, CheckoutServiceRow>,
): { total: number; itemRows: CheckoutItemRow[] } {
  let total = 0;
  const itemRows: CheckoutItemRow[] = [];

  for (const it of items) {
    const svc = services.get(it.service_id);
    if (!svc) throw new Error(`service ${it.service_id} not available`);

    const sentUnit = Number(it.unit_price_uzs ?? 0);
    const unit = sentUnit > 0 ? sentUnit : Number(svc.price_uzs);
    const discount = it.discount_uzs ?? 0;
    const itemTotal = unit * it.quantity - discount;
    total += itemTotal;

    itemRows.push({
      service_id: it.service_id,
      service_name_snapshot: pickServiceName(svc.name_i18n),
      service_price_snapshot: unit,
      quantity: it.quantity,
      discount_snapshot: discount ? { amount: discount } : null,
      final_amount_uzs: itemTotal,
      cost_snapshot_uzs: Number(svc.cost_uzs ?? 0) * it.quantity,
    });
  }

  return { total, itemRows };
}

/**
 * Aralash (split) to'lovni hal qiladi.
 *
 * - Oyoqlar berilsa: paid = Σ oyoqlar (`paid_amount_uzs` e'tiborga olinmaydi)
 * - 1 oyoq → o'sha usul; 2+ oyoq → 'mixed'
 * - Oyoq yo'q → eski xulq: `paid_amount_uzs` + berilgan `payment_method`
 */
export function resolvePayment(
  payments: readonly PaymentLegInput[] | undefined,
  paidAmountUzs: number,
  paymentMethod: string,
): { legs: PaymentLegInput[]; paidAmount: number; isMixed: boolean; effectiveMethod: string } {
  const legs = (payments ?? []).filter((p) => p.amount_uzs > 0);
  const paidAmount = legs.length > 0 ? legs.reduce((s, p) => s + p.amount_uzs, 0) : paidAmountUzs;
  const isMixed = legs.length > 1;
  const effectiveMethod = isMixed ? 'mixed' : legs.length === 1 ? legs[0]!.method : paymentMethod;

  return { legs, paidAmount, isMixed, effectiveMethod };
}

/**
 * To'lov jami'ni qoplashini tekshiradi.
 * `paid + debt + insurance` jami'dan kam bo'lsa — checkout rad etiladi.
 */
export function isCoverageSufficient(
  total: number,
  paidAmount: number,
  debtUzs: number,
  insuranceCovered: number,
): boolean {
  return paidAmount + debtUzs + insuranceCovered >= total;
}

/**
 * Yoziladigan qarz miqdorini hisoblaydi.
 *
 * XATODAN HIMOYA: qarz hech qachon haqiqiy qoldiqdan (total − paid − insurance)
 * osha olmaydi va manfiy bo'lmaydi. Operator ortiqcha nol kiritsa
 * (270 000 → 2 700 000) qiymat qoldiqqa qisiladi.
 */
export function computeDebtAmount(
  total: number,
  paidAmount: number,
  insuranceCovered: number,
  requestedDebtUzs: number | undefined,
): { remainingOwed: number; debtAmount: number } {
  const remainingOwed = Math.max(0, total - paidAmount - insuranceCovered);
  const debtAmount = Math.min(Math.max(0, requestedDebtUzs ?? 0), remainingOwed);
  return { remainingOwed, debtAmount };
}
