import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SupabaseService } from '../../common/services/supabase.service';
import { WAREHOUSE_PROVISION_QUEUE, WarehouseService } from './warehouse.service';
import { WarehouseAdminController, WarehouseController } from './warehouse.controller';
import { WarehouseMembershipGuard } from './warehouse-membership.guard';
import { WarehouseProvisioningProcessor } from './warehouse.processor';

@Module({
  imports: [BullModule.registerQueue({ name: WAREHOUSE_PROVISION_QUEUE })],
  controllers: [WarehouseAdminController, WarehouseController],
  providers: [SupabaseService, WarehouseService, WarehouseMembershipGuard, WarehouseProvisioningProcessor],
  exports: [WarehouseService],
})
export class WarehouseModule {}
