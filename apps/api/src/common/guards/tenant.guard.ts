import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_WITHOUT_CLINIC_KEY } from '../decorators/allow-without-clinic.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY, type Role } from '../decorators/roles.decorator';
import { getContext } from '../context/request-context';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const allowWithoutClinic = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_CLINIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const c = getContext();

    // super_admin bypasses clinic check
    if (c.role === 'super_admin') return this.checkRoles(ctx, c.role);

    if (!c.clinicId && !allowWithoutClinic) {
      throw new ForbiddenException('No clinic context on token');
    }
    return this.checkRoles(ctx, c.role);
  }

  private checkRoles(ctx: ExecutionContext, role: string): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    if (required.includes(role as Role)) return true;
    throw new ForbiddenException(`Role '${role}' not in [${required.join(', ')}]`);
  }
}
