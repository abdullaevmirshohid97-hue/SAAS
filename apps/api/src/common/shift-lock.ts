import { ForbiddenException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getContextSafe } from './context/request-context';

// =============================================================================
// YOPILGAN SMENA QULFI (A0, 2026-11-25)
// =============================================================================
// Smena yopilganda kassir pulni sanab topshiradi va smena hisoboti chop etiladi.
// Shundan keyin o'sha smenadagi chekni tahrirlash/o'chirish tarixni orqaga qarab
// qayta yozadi: kechagi chop etilgan hisobot bugungisiga to'g'ri kelmay qoladi
// (MAGNUS: 75 kunda 142 smenadan 5 tasi yopilgandan keyin o'zgargan).
//
// Qoida: yopilgan smenadagi yozuvni FAQAT rahbar (owner/admin) o'zgartira
// oladi — o'zgarish audit jurnaliga eski va yangi qiymat bilan yoziladi.
// Kassir/qabulxona uchun xato aniq: "rahbarga murojaat qiling".
// =============================================================================

export const SHIFT_OVERRIDE_ROLES = new Set(['clinic_owner', 'clinic_admin', 'super_admin']);

export type ShiftLockState = {
  shift_id: string | null;
  shift_closed_at: string | null;
  /** Yopilgan smena, lekin rahbar o'zgartirmoqda. */
  override: boolean;
};

/** Sof qaror (test qilinadi): yopilgan smena + rahbar emas → taqiq. */
export function shiftEditDecision(
  shiftClosedAt: string | null,
  role: string | null | undefined,
): 'allow' | 'override' | 'deny' {
  if (!shiftClosedAt) return 'allow';
  return role && SHIFT_OVERRIDE_ROLES.has(role) ? 'override' : 'deny';
}

/**
 * Tranzaksiya yopilgan smenaga tegishli bo'lsa va foydalanuvchi rahbar
 * bo'lmasa — 403 SHIFT_CLOSED. Smenasiz yozuv (eski/import) — ochiq.
 */
export async function assertShiftEditable(
  admin: SupabaseClient,
  clinicId: string,
  transactionId: string,
  action: string,
): Promise<ShiftLockState> {
  const { data: tx } = await admin
    .from('transactions')
    .select('shift_id')
    .eq('clinic_id', clinicId)
    .eq('id', transactionId)
    .maybeSingle();
  const shiftId = (tx as { shift_id: string | null } | null)?.shift_id ?? null;
  if (!shiftId) return { shift_id: null, shift_closed_at: null, override: false };

  const { data: shift } = await admin
    .from('shifts')
    .select('closed_at')
    .eq('clinic_id', clinicId)
    .eq('id', shiftId)
    .maybeSingle();
  const closedAt = (shift as { closed_at: string | null } | null)?.closed_at ?? null;

  const decision = shiftEditDecision(closedAt, getContextSafe()?.role);
  if (decision === 'deny') {
    throw new ForbiddenException({
      error: 'SHIFT_CLOSED',
      message:
        `Bu yozuv yopilgan smenaga tegishli — ${action} faqat rahbar (admin) ruxsati bilan. ` +
        'Smena hisoboti allaqachon topshirilgan; tuzatish kerak bo‘lsa rahbarga murojaat qiling.',
    });
  }
  return { shift_id: shiftId, shift_closed_at: closedAt, override: decision === 'override' };
}
