import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  normalizeEntitlements,
  paymentMethodAllowed,
  resolveApiModule,
  resolveRouteModule,
  roleAllowed,
} from '@clary/schemas';
import { describe, expect, it, vi } from 'vitest';

import { requestContextStorage, type ClaryRequestContext } from '../context/request-context';
import { EntitlementsGuard } from '../guards/entitlements.guard';
import { DeviceRegistryService } from './device-registry.service';
import type { EntitlementsService } from './entitlements.service';

describe('resolveApiModule', () => {
  it('eng uzun prefiks, segment bo‘yicha', () => {
    expect(resolveApiModule('/api/v1/accounting/tax/2026')).toBe('tax');
    expect(resolveApiModule('/api/v1/accounting/pnl?from=1')).toBe('accounting');
    expect(resolveApiModule('/api/v1/accounting/executive')).toBe('executive');
    expect(resolveApiModule('/api/v1/analytics/doctors')).toBe('analytics');
    expect(resolveApiModule('/api/v1/analytics/query')).toBe('analytics_builder');
    expect(resolveApiModule('/api/v1/pharmacy/sales/1')).toBe('pharmacy');
    expect(resolveApiModule('/api/v1/clinic/appointment-requests/x')).toBe('online_booking');
  });
  it('asosiy yo‘llar va boshqa segmentlar yopilmaydi', () => {
    expect(resolveApiModule('/api/v1/analytics/overview')).toBeNull();
    expect(resolveApiModule('/api/v1/company/my')).toBeNull();
    expect(resolveApiModule('/api/v1/pharmacy-ws/status')).toBeNull();
    expect(resolveApiModule('/api/v1/patients')).toBeNull();
    expect(resolveApiModule('/api/v1/aiReception')).toBeNull();
    expect(resolveApiModule('/api/v1/ai/copilot')).toBe('ai_copilot');
    expect(resolveApiModule('/api/v1/ai-reception/settings')).toBe('ai_reception');
  });
});

describe('resolveRouteModule', () => {
  it('web marshrutlar', () => {
    expect(resolveRouteModule('/analytics/builder')).toBe('analytics_builder');
    expect(resolveRouteModule('/analytics/doctors')).toBe('analytics');
    expect(resolveRouteModule('/nurse-requests')).toBe('home_nurse');
    expect(resolveRouteModule('/nurse')).toBe('nurse');
    expect(resolveRouteModule('/settings/telephony')).toBe('telephony');
    expect(resolveRouteModule('/dashboard')).toBeNull();
    expect(resolveRouteModule('/doctor/kabinet/1')).toBe('doctor');
  });
});

describe('normalizeEntitlements', () => {
  it('bo‘sh — hammasi ochiq', () => {
    const e = normalizeEntitlements({});
    expect(e.modules).toEqual({});
    expect(e.payments.methods).toBeNull();
    expect(e.journal.allow_edit).toBe(true);
    expect(e.devices.clients.mobile).toBe(true);
    expect(paymentMethodAllowed(e, 'click')).toBe(true);
    expect(roleAllowed(e, 'cashier')).toBe(true);
  });
  it('qisman va noma‘lum kalitlar', () => {
    const e = normalizeEntitlements({
      modules: { pharmacy: false, nope: false },
      payments: { methods: ['cash', 1] },
      roles: { allowed: ['doctor'] },
      limits: { max_staff: 5, max_devices: -1 },
      journal: { history_days: 30, allow_delete: false },
    });
    expect(e.modules).toEqual({ pharmacy: false });
    expect(e.payments.methods).toEqual(['cash']);
    expect(paymentMethodAllowed(e, 'click')).toBe(false);
    expect(paymentMethodAllowed(e, 'mixed')).toBe(true);
    expect(roleAllowed(e, 'cashier')).toBe(false);
    expect(roleAllowed(e, 'clinic_owner')).toBe(true);
    expect(e.limits.max_staff).toBe(5);
    expect(e.limits.max_devices).toBeNull();
    expect(e.journal).toMatchObject({ history_days: 30, allow_delete: false, allow_edit: true });
  });
});

describe('DeviceRegistryService.describe', () => {
  it('UA dan qisqa nom', () => {
    const d = DeviceRegistryService.describe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
      'web',
    );
    expect(d.name).toBe('Windows · Chrome');
    expect(DeviceRegistryService.describe(null, 'mobile').name).toBe('Clary Mobile');
    expect(DeviceRegistryService.parseFingerprint('abc')).toBeNull();
    expect(DeviceRegistryService.parseFingerprint('a1b2c3d4-e5f6')).toBe('a1b2c3d4-e5f6');
    expect(DeviceRegistryService.parseClient('Desktop')).toBe('desktop');
    expect(DeviceRegistryService.parseClient('tv')).toBeNull();
  });
});

describe('EntitlementsGuard', () => {
  const ctxFor = (method: string, url: string, headers: Record<string, string> = {}) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ method, originalUrl: url, headers }) }),
    }) as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const base: ClaryRequestContext = {
    requestId: 'r',
    userId: 'u1',
    email: null,
    clinicId: 'c1',
    role: 'receptionist',
    ip: null,
    userAgent: null,
    idempotencyKey: null,
  };
  const make = (raw: unknown) => {
    const ent = { get: vi.fn().mockResolvedValue(raw ? normalizeEntitlements(raw) : null) };
    const devices = { touch: vi.fn().mockResolvedValue(undefined) };
    const guard = new EntitlementsGuard(
      reflector,
      ent as unknown as EntitlementsService,
      devices as unknown as DeviceRegistryService,
    );
    return { guard, ent, devices };
  };
  const run = (c: Partial<ClaryRequestContext>, fn: () => Promise<boolean>) =>
    requestContextStorage.run({ ...base, ...c }, fn);

  it('yopiq modul — MODULE_DISABLED', async () => {
    const { guard } = make({ modules: { pharmacy: false } });
    await expect(
      run({}, () => guard.canActivate(ctxFor('GET', '/api/v1/pharmacy/sales'))),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run({}, () => guard.canActivate(ctxFor('GET', '/api/v1/patients')))).resolves.toBe(
      true,
    );
  });

  it('jurnal tahriri/o‘chirish tarifga bog‘liq', async () => {
    const { guard } = make({ journal: { allow_edit: false, allow_delete: true } });
    await expect(
      run({}, () => guard.canActivate(ctxFor('PATCH', '/api/v1/transactions/abc/items'))),
    ).rejects.toThrow(/tahrirlash/);
    await expect(
      run({}, () => guard.canActivate(ctxFor('DELETE', '/api/v1/transactions/abc'))),
    ).resolves.toBe(true);
  });

  it('super-admin, dorixona akkaunti va imkoniyat o‘qilmasa — o‘tadi', async () => {
    const { guard, devices } = make({ modules: { pharmacy: false } });
    await expect(
      run({ role: 'super_admin' }, () => guard.canActivate(ctxFor('GET', '/api/v1/pharmacy/x'))),
    ).resolves.toBe(true);
    await expect(
      run({ workspace: 'pharmacy' }, () => guard.canActivate(ctxFor('GET', '/api/v1/pharmacy/x'))),
    ).resolves.toBe(true);
    const failOpen = make(null);
    await expect(
      run({}, () => failOpen.guard.canActivate(ctxFor('GET', '/api/v1/pharmacy/x'))),
    ).resolves.toBe(true);
    expect(devices.touch).not.toHaveBeenCalled();
  });

  it('qurilma sarlavhalari uzatiladi, impersonation yozilmaydi', async () => {
    const { guard, devices } = make({});
    await run({}, () =>
      guard.canActivate(
        ctxFor('GET', '/api/v1/patients', {
          'x-clary-device': 'dev-12345678',
          'x-clary-client': 'web',
        }),
      ),
    );
    expect(devices.touch).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: 'dev-12345678', client: 'web', clinicId: 'c1' }),
      expect.anything(),
    );
    devices.touch.mockClear();
    await run({ impersonatedBy: 'admin' }, () =>
      guard.canActivate(ctxFor('GET', '/api/v1/patients', { 'x-clary-device': 'dev-12345678' })),
    );
    expect(devices.touch).not.toHaveBeenCalled();
  });
});
