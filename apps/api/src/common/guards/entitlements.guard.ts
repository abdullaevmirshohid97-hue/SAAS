import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { moduleEnabled, normalizeApiPath, resolveApiModule } from '@clary/schemas';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getContext, isPharmacyAccount } from '../context/request-context';
import { DeviceRegistryService } from '../entitlements/device-registry.service';
import { EntitlementsService, moduleDisabled } from '../entitlements/entitlements.service';

// =============================================================================
// TARIF IMKONIYATLARI nazorati (SubscriptionGuard'dan keyin, ruxsatlardan oldin).
//   1) qurilma: ilova turi, bloklangan qurilma, qurilmalar limiti
//   2) modul: API yo'li tarifda yopiq modulga tegishli bo'lsa → MODULE_DISABLED
//   3) jurnal: tahrir / o'chirish tarifda yopiq bo'lsa
// Super-admin, ochiq endpointlar va alohida dorixona kirishi tekshirilmaydi.
// Imkoniyatlarni o'qib bo'lmasa — o'tkazib yuboriladi (fail-open).
// =============================================================================

const SKIP_PREFIXES = ['auth/', 'subscription', 'health', 'entitlements/me'];

const JOURNAL_RULES: ReadonlyArray<{
  method: string;
  re: RegExp;
  flag: 'allow_edit' | 'allow_delete';
}> = [
  { method: 'PATCH', re: /^transactions\/[^/]+\/items$/, flag: 'allow_edit' },
  { method: 'PATCH', re: /^transactions\/[^/]+\/payment-method$/, flag: 'allow_edit' },
  { method: 'PATCH', re: /^transactions\/[^/]+\/void$/, flag: 'allow_delete' },
  { method: 'DELETE', re: /^transactions\/[^/]+$/, flag: 'allow_delete' },
  { method: 'POST', re: /^journal\/void$/, flag: 'allow_delete' },
];

@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
    private readonly devices: DeviceRegistryService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const c = getContext();
    if (!c.clinicId || c.role === 'super_admin' || isPharmacyAccount(c)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const path = normalizeApiPath(req.originalUrl ?? req.url ?? '');
    if (path.startsWith('admin/')) return true;
    const skip = SKIP_PREFIXES.some((p) => path.startsWith(p));

    const ent = await this.entitlements.get(c.clinicId);

    // Super-admin klinika nomidan kirgan (impersonation) — uning brauzeri
    // klinika qurilmasi sifatida yozilmaydi.
    if (!skip && c.userId && !c.impersonatedBy) {
      await this.devices.touch(
        {
          clinicId: c.clinicId,
          userId: c.userId,
          fingerprint: header(req, 'x-clary-device'),
          client: header(req, 'x-clary-client'),
          appVersion: header(req, 'x-clary-app-version'),
          userAgent: c.userAgent,
          ip: c.ip,
        },
        ent,
      );
    }

    if (!ent || skip) return true;

    const mod = resolveApiModule(path);
    if (mod && !moduleEnabled(ent, mod)) throw moduleDisabled(mod);

    const method = (req.method ?? 'GET').toUpperCase();
    for (const r of JOURNAL_RULES) {
      if (r.method === method && r.re.test(path) && !ent.journal[r.flag]) {
        throw new ForbiddenException({
          error: 'JOURNAL_ACTION_NOT_ALLOWED',
          message:
            r.flag === 'allow_edit'
              ? 'Jurnal yozuvini tahrirlash tarifingizga kirmaydi'
              : "Jurnal yozuvini o'chirish/bekor qilish tarifingizga kirmaydi",
        });
      }
    }
    return true;
  }
}

function header(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}
