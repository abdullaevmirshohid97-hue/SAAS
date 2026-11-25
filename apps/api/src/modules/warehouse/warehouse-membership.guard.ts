import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { getContext } from '../../common/context/request-context';
import { WarehouseService } from './warehouse.service';

export type WarehouseRequestContext = Awaited<
  ReturnType<WarehouseService['tenantContextFromRequest']>
>;
export type WarehouseRequest = Request & { warehouse?: WarehouseRequestContext };

/**
 * Subdomen (Host) → kompaniya → foydalanuvchi a'zoligi. Natija so'rovga
 * yoziladi — controller uni qayta so'ramaydi (ilgari ikki marta bazaga borardi).
 */
@Injectable()
export class WarehouseMembershipGuard implements CanActivate {
  constructor(private readonly warehouse: WarehouseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WarehouseRequest>();
    request.warehouse = await this.warehouse.tenantContextFromRequest(
      request.hostname,
      getContext().userId,
    );
    return true;
  }
}
