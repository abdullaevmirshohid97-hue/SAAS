import {
  Body, Controller, Get, Headers, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import { AllowWithoutClinic } from '../../common/decorators/allow-without-clinic.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { WarehouseMembershipGuard } from './warehouse-membership.guard';
import { WarehouseService } from './warehouse.service';

const CreateWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/),
  owner_user_id: z.string().uuid(),
  plan_code: z.string().trim().min(1).max(40).optional(),
});

@ApiTags('warehouse-admin')
@Controller({ path: 'admin/warehouses', version: '1' })
@UseGuards(SuperAdminGuard)
export class WarehouseAdminController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get()
  list() {
    return this.warehouse.listTenants();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.warehouse.getTenant(id);
  }

  @Post()
  create(@CurrentUser() user: { userId: string | null }, @Body() body: unknown) {
    if (!user.userId) throw new Error('Authenticated Super Admin required');
    return this.warehouse.createTenant(CreateWarehouseSchema.parse(body), user.userId);
  }
}

@ApiTags('warehouse')
@Controller({ path: 'warehouse', version: '1' })
@AllowWithoutClinic()
@UseGuards(WarehouseMembershipGuard)
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Get('context')
  async context(
    @Req() req: Request,
    @CurrentUser() user: { userId: string | null },
  ) {
    const resolved = await this.warehouse.tenantContextFromRequest(req.hostname, user.userId);
    return {
      tenant: resolved.tenant,
      role: resolved.membership.role,
    };
  }

  @Get('products')
  async products(@Req() req: Request, @CurrentUser() user: { userId: string | null }) {
    const { tenant } = await this.warehouse.tenantContextFromRequest(req.hostname, user.userId);
    return this.warehouse.withTenantPool(tenant.id, async (pool) => {
      const result = await pool.query(
        'SELECT id, sku, barcode, name, base_unit, purchase_price, sale_price, is_active FROM products ORDER BY name LIMIT 500',
      );
      return result.rows;
    });
  }
}
