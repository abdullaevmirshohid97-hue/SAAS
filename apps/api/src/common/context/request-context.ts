import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Alohida "Dorixona" kirishi (dorixona akkaunti) uchun so'rov konteksti.
 * PharmacyWorkspaceGuard qurilma va PIN sessiyasini tekshirib to'ldiradi.
 */
export interface PharmacyWorkspaceContext {
  deviceId: string | null;
  deviceName: string | null;
  registerNo: number | null;
  operatorId: string | null;
  operatorName: string | null;
  operatorRole: 'admin' | 'cashier' | null;
  canReturn: boolean;
  canReceive: boolean;
  canDiscount: boolean;
}

export interface ClaryRequestContext {
  requestId: string;
  userId: string | null;
  email: string | null;
  clinicId: string | null;
  role: string;
  ip: string | null;
  userAgent: string | null;
  idempotencyKey: string | null;
  impersonatedBy?: string | null;
  /** JWT app_metadata.workspace — 'pharmacy' bo'lsa bu dorixona akkaunti. */
  workspace?: string | null;
  /** X-Pharmacy-Device sarlavhasi (qurilma kaliti, xom). */
  pharmacyDeviceKey?: string | null;
  /** X-Pharmacy-Operator sarlavhasi (PIN sessiya tokeni, xom). */
  pharmacyOperatorToken?: string | null;
  /** Guard tekshirib bo'lgach to'ldiriladi. */
  pharmacy?: PharmacyWorkspaceContext | null;
}

export const requestContextStorage = new AsyncLocalStorage<ClaryRequestContext>();

export function getContext(): ClaryRequestContext {
  const ctx = requestContextStorage.getStore();
  if (!ctx) {
    throw new Error('RequestContext accessed outside of an HTTP request');
  }
  return ctx;
}

export function getContextSafe(): ClaryRequestContext | null {
  return requestContextStorage.getStore() ?? null;
}

/** So'rov dorixona akkauntidanmi (alohida dorixona kirishi). */
export function isPharmacyAccount(c: ClaryRequestContext | null | undefined): boolean {
  return !!c && c.workspace === 'pharmacy';
}
