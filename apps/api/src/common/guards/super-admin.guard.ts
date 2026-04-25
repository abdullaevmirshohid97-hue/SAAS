import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { getContext } from '../context/request-context';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    const c = getContext();
    if (c.role !== 'super_admin') {
      throw new ForbiddenException('Super admin only');
    }
    return true;
  }
}
