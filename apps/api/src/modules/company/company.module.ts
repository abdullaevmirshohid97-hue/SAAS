import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';
import { CashierModule } from '../cashier/cashier.module';
import { TelegramReportsModule } from '../telegram-reports/telegram-reports.module';
import { CompanyController } from './company.controller';
import { NetworkAccessService } from './network-access.service';
import { NetworkDigestService } from './network-digest.service';
import { NetworkOpsService } from './network-ops.service';
import { NetworkService } from './network.service';

// =============================================================================
// Filial tarmog'i (kompaniya = tarmoq, klinika = filial; 1 HQ + 10 tagacha
// filial). Faza 2 almashtirish, Faza 3 markaz, Faza 4 HQ boshqaruvi, Faza 5
// filiallararo amallar. Super-admin qismi: admin/admin-network.module.ts.
// =============================================================================
@Module({
  imports: [CashierModule, TelegramReportsModule],
  controllers: [CompanyController],
  providers: [
    SupabaseService,
    NetworkAccessService,
    NetworkService,
    NetworkOpsService,
    NetworkDigestService,
  ],
  exports: [NetworkAccessService, NetworkService],
})
export class CompanyModule {}
