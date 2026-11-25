import { ForbiddenException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getContextSafe } from './context/request-context';
import { SHIFT_OVERRIDE_ROLES } from './shift-lock';

// =============================================================================
// RAHBAR TASDIG'I (A3) — katta summadagi pul chiqimi faqat rahbar orqali
// =============================================================================
// Klinika sozlamasi (Pul markazi → Nazorat): `expense_approval_limit_uzs`,
// `refund_approval_limit_uzs`. Limitdan katta rasxot/vozvratni kassir yoki
// qabulxona kirita olmaydi — rahbar (owner/admin) kiritadi. 0/berilmagan —
// cheklov yo'q (eski xatti-harakat). Har bir rahbar kiritgan katta summa
// baribir Telegram'ga "🔴 KATTA" bo'lib ketadi (A4).
// =============================================================================

export type ApprovalKind = 'expense' | 'refund';

const KEY: Record<ApprovalKind, string> = {
  expense: 'expense_approval_limit_uzs',
  refund: 'refund_approval_limit_uzs',
};

const LABEL: Record<ApprovalKind, string> = {
  expense: 'rasxot',
  refund: 'vozvrat (pul qaytarish)',
};

/** Sof qaror (test qilinadi). */
export function approvalDecision(
  amount: number,
  limit: number | null | undefined,
  role: string | null | undefined,
): 'allow' | 'deny' {
  if (!limit || limit <= 0) return 'allow';
  if (Math.abs(amount) <= limit) return 'allow';
  return role && SHIFT_OVERRIDE_ROLES.has(role) ? 'allow' : 'deny';
}

export async function readClinicNumberSetting(
  admin: SupabaseClient,
  clinicId: string,
  key: string,
): Promise<number | null> {
  const { data } = await admin.from('clinics').select('settings').eq('id', clinicId).maybeSingle();
  const v = (data as { settings?: Record<string, unknown> } | null)?.settings?.[key];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Limitdan oshsa va foydalanuvchi rahbar bo'lmasa — 403 APPROVAL_REQUIRED. */
export async function assertWithinApprovalLimit(
  admin: SupabaseClient,
  clinicId: string,
  kind: ApprovalKind,
  amount: number,
): Promise<void> {
  const limit = await readClinicNumberSetting(admin, clinicId, KEY[kind]);
  if (approvalDecision(amount, limit, getContextSafe()?.role) === 'deny') {
    throw new ForbiddenException({
      error: 'APPROVAL_REQUIRED',
      message:
        `${Math.round(limit!).toLocaleString('uz-UZ')} so'mdan katta ${LABEL[kind]}ni faqat rahbar ` +
        'kirita oladi — rahbarga murojaat qiling.',
    });
  }
}
