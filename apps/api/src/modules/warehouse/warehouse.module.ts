import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';
import { WarehouseAdminController, WarehouseController } from './warehouse.controller';
import { WarehouseMembershipGuard } from './warehouse-membership.guard';
import { WarehouseService } from './warehouse.service';
import { WarehouseProvisioningWorker } from './warehouse.worker';

/**
 * CLARY Sklad moduli. FAQAT SkladAppModule (sklad-main.ts, alohida pm2 jarayoni)
 * import qiladi — CLARY Clinic AppModule'ga QO'SHILMAYDI.
 */
@Module({
  controllers: [WarehouseAdminController, WarehouseController],
  providers: [
    SupabaseService,
    WarehouseService,
    WarehouseMembershipGuard,
    WarehouseProvisioningWorker,
  ],
  exports: [WarehouseService],
})
export class WarehouseModule {}
