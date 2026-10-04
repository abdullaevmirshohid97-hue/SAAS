import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getContext, isPharmacyAccount } from '../context/request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_ANY_PERM_KEY, REQUIRE_PERM_KEY } from '../decorators/require-perm.decorator';
import { type PermissionKey } from '../rbac/permissions';
import { PermissionsResolver } from '../services/permissions-resolver.service';

// Ruxsatlarni yechish mantiqi PermissionsResolver ga ko'chirildi — uni
// FieldSecurityInterceptor ham ishlatadi va ikkalasi bitta keshdan oziqlanadi
// (aks holda har so'rovda bazaga ikki marta murojaat bo'lardi).
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly perms: PermissionsResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_PERM_KEY,
      targets,
    );
    const any = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_ANY_PERM_KEY,
      targets,
    );
    if ((!required || required.length === 0) && (!any || any.length === 0)) return true;

    const c = getContext();

    if (c.role === 'super_admin' || c.role === 'clinic_owner' || c.role === 'clinic_admin') {
      return true;
    }

    // Dorixona akkaunti: huquq PIN operatordan keladi (admin / kassir ruxsatlari) —
    // PharmacyWorkspaceGuard uni faqat dorixona API'lariga qo'yadi va
    // @PharmacyAdmin / @PharmacyCapability qoidalarini tekshiradi.
    if (isPharmacyAccount(c)) return true;

    if (!c.userId) throw new ForbiddenException('Anonymous');

    const perms = await this.perms.resolve(c.userId);
    for (const k of required ?? []) {
      if (!perms[k]) {
        throw new ForbiddenException(`Missing permission: ${k}`);
      }
    }
    if (any && any.length > 0 && !any.some((k) => perms[k])) {
      throw new ForbiddenException(`Missing permission: ${any.join(' | ')}`);
    }
    return true;
  }
}
