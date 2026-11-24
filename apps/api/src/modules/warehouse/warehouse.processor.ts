import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { WAREHOUSE_PROVISION_QUEUE, WarehouseService } from './warehouse.service';

@Processor(WAREHOUSE_PROVISION_QUEUE)
export class WarehouseProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(WarehouseProvisioningProcessor.name);

  constructor(private readonly warehouse: WarehouseService) {
    super();
  }

  async process(job: Job<{ tenantId: string }>): Promise<void> {
    if (job.name !== 'provision-tenant') return;
    try {
      await this.warehouse.provisionTenant(job.data.tenantId);
    } catch (error) {
      await this.warehouse.markProvisioningFailed(job.data.tenantId, error);
      this.logger.error(`Warehouse provisioning failed for tenant ${job.data.tenantId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw error;
    }
  }
}
