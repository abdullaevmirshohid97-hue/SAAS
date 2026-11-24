import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { getContext } from '../../common/context/request-context';
import { WarehouseService } from './warehouse.service';

@Injectable()
export class WarehouseMembershipGuard implements CanActivate {
  constructor(private readonly warehouse: WarehouseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = getContext().userId;
    await this.warehouse.tenantContextFromRequest(request.hostname, userId);
    return true;
  }
}
