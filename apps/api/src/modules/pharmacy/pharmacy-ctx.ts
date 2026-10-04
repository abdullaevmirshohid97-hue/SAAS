import { ForbiddenException } from '@nestjs/common';

import {
  getContextSafe,
  isPharmacyAccount,
  type PharmacyWorkspaceContext,
} from '../../common/context/request-context';

/**
 * Joriy so'rov alohida "Dorixona" kirishidanmi va (bo'lsa) qaysi kassa /
 * operator. Klinika foydalanuvchisi uchun `null`.
 */
export function pharmacyWs(): PharmacyWorkspaceContext | null {
  const c = getContextSafe();
  if (!isPharmacyAccount(c)) return null;
  return c?.pharmacy ?? null;
}

export function isPharmacyWorkspace(): boolean {
  return isPharmacyAccount(getContextSafe());
}

/** Dorixona kirishida operator majburiy (guard odatda buni ta'minlaydi). */
export function requireOperator(): PharmacyWorkspaceContext {
  const ws = pharmacyWs();
  if (!ws || !ws.operatorId) {
    throw new ForbiddenException({ error: 'OPERATOR_PIN_REQUIRED', message: 'PIN kodni kiriting' });
  }
  return ws;
}
