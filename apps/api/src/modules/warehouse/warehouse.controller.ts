import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { WarehouseMembershipGuard, type WarehouseRequest } from './warehouse-membership.guard';
import { WarehouseService } from './warehouse.service';
import { WAREHOUSE_SLUG_PATTERN } from './warehouse-utils';

const CreateWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(1).max(60).regex(WAREHOUSE_SLUG_PATTERN),
  owner_user_id: z.string().uuid(),
  plan_code: z.string().trim().min(1).max(40).optional(),
});

/** Super Admin — `sklad.clary.uz/api/v1/admin/warehouses` (admin.clary.uz chaqiradi). */
@ApiTags('warehouse-admin')
@Controller({ path: 'admin/warehouses', version: '1' })
@UseGuards(SuperAdminGuard)
export class WarehouseAdminController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get()
  list() {
    return this.warehouse.listTenants();
  }

  @Post(':id/retry')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouse.retryProvisioning(id);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouse.getTenant(id);
  }

  @Post()
  create(@CurrentUser() user: { userId: string | null }, @Body() body: unknown) {
    if (!user.userId) throw new ForbiddenException('Authenticated Super Admin required');
    return this.warehouse.createTenant(CreateWarehouseSchema.parse(body), user.userId);
  }
}

/** Kompaniya xodimlari — `<slug>.sklad.clary.uz/api/v1/warehouse/*`. */
@ApiTags('warehouse')
@Controller({ path: 'warehouse', version: '1' })
@UseGuards(WarehouseMembershipGuard)
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('context')
  context(@Req() req: WarehouseRequest) {
    const resolved = req.warehouse!;
    return { tenant: resolved.tenant, role: resolved.membership.role };
  }

  @Get('products')
  products(@Req() req: WarehouseRequest) {
    return this.warehouse.withTenantPool(req.warehouse!.tenant.id, async (pool) => {
      const result = await pool.query(
        'SELECT id, sku, barcode, name, base_unit, purchase_price, sale_price, is_active FROM products ORDER BY name LIMIT 500',
      );
      return result.rows;
    });
  }
}
