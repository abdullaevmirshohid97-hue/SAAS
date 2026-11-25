import { describe, expect, it } from 'vitest';

import { requestContextStorage } from '../context/request-context';
import { requestPath, SubscriptionGuard } from './subscription.guard';

// Bloklangan (suspended) klinika — obuna istisnolarini query orqali aylanib
// o'tib bo'lmasligi kerak (`/patients?x=/auth/` ilgari o'tib ketardi).
function guard() {
  const reflector = { getAllAndOverride: () => false } as never;
  const supabase = {
    admin: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                subscription_status: 'unpaid',
                is_suspended: true,
                trial_ends_at: null,
                deleted_at: null,
                is_hq: false,
                company_id: null,
              },
            }),
          }),
        }),
      }),
    }),
  } as never;
  return new SubscriptionGuard(reflector, supabase);
}

function run(url: string) {
  const ctx = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ url, originalUrl: url }) }),
  } as never;
  return requestContextStorage.run(
    { clinicId: 'c1', userId: 'u1', role: 'clinic_admin' } as never,
    () => guard().canActivate(ctx),
  );
}

describe('requestPath', () => {
  it('query va fragmentni olib tashlaydi', () => {
    expect(requestPath('/api/v1/patients?x=/auth/')).toBe('/api/v1/patients');
    expect(requestPath('/api/v1/a#/health')).toBe('/api/v1/a');
    expect(requestPath(undefined)).toBe('');
  });
});

describe('SubscriptionGuard — bloklangan klinika', () => {
  it('oddiy so‘rov bloklanadi', async () => {
    await expect(run('/api/v1/patients')).rejects.toThrow();
  });

  it.each(['?x=/auth/', '?x=/subscription', '?x=/health', '#/auth/'])(
    'query/fragment %s bilan aylanib o‘tib bo‘lmaydi',
    async (suffix) => {
      await expect(run(`/api/v1/patients${suffix}`)).rejects.toThrow();
    },
  );

  it('haqiqiy istisno yo‘llar ochiq qoladi (to‘lov deadlock bo‘lmasin)', async () => {
    await expect(run('/api/v1/subscription/status')).resolves.toBe(true);
    await expect(run('/api/v1/auth/me')).resolves.toBe(true);
    await expect(run('/api/v1/health')).resolves.toBe(true);
  });
});
