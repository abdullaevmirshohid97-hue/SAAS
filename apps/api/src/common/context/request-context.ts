import { AsyncLocalStorage } from 'node:async_hooks';

export interface ClaryRequestContext {
  requestId: string;
  userId: string | null;
  clinicId: string | null;
  role: string;
  ip: string | null;
  userAgent: string | null;
  idempotencyKey: string | null;
  impersonatedBy?: string | null;
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
