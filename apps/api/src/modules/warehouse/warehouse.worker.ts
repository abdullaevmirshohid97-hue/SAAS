import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { WarehouseService } from './warehouse.service';

/**
 * Baza yaratish navbati ishchisi — har 15 soniyada navbatni tekshiradi.
 * Redis/BullMQ YO'Q: navbat control-plane bazasida (claim_warehouse_provisioning).
 * Bir tikda ketma-ket ko'pi bilan 3 ta ish; bir vaqtda faqat bitta tik.
 * O'chirish: WAREHOUSE_WORKER=off (masalan, ikkinchi API nusxasida).
 */
@Injectable()
export class WarehouseProvisioningWorker implements OnApplicationShutdown {
  private readonly log = new Logger('WarehouseWorker');
  private running = false;
  private stopping = false;

  constructor(private readonly warehouse: WarehouseService) {}

  @Interval('warehouse-provisioning', 15_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping || process.env.WAREHOUSE_WORKER === 'off') return;
    this.running = true;
    try {
      for (let i = 0; i < 3 && !this.stopping; i++) {
        if (!(await this.warehouse.runNextProvisioningJob())) break;
      }
    } catch (e) {
      this.log.warn(`Navbat tiki xato: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  onApplicationShutdown(): void {
    this.stopping = true;
  }
}
