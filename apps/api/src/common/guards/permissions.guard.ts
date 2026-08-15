import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getContext } from '../context/request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERM_KEY } from '../decorators/require-perm.decorator';
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
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_PERM_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const c = getContext();

    if (c.role === 'super_admin' || c.role === 'clinic_owner' || c.role === 'clinic_admin') {
      return true;
    }

    if (!c.userId) throw new ForbiddenException('Anonymous');

    const perms = await this.perms.resolve(c.userId);
    for (const k of required) {
      if (!perms[k]) {
        throw new ForbiddenException(`Missing permission: ${k}`);
      }
    }
    return true;
  }
}
