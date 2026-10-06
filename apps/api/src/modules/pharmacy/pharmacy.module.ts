import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';
import { DrugReferenceModule } from '../drug-reference/drug-reference.module';
import { TrashModule } from '../trash/trash.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyFiscalService } from './pharmacy-fiscal.service';
import { PharmacyShiftService } from './pharmacy-shift.service';
import { PharmacyService } from './pharmacy.service';
import {
  PharmacyFiscalController,
  PharmacyShiftController,
  PharmacyWorkspaceController,
} from './pharmacy-workspace.controller';
import { PharmacyWorkspaceService } from './pharmacy-workspace.service';

// =============================================================================
// Dorixona moduli
// =============================================================================
//   pharmacy.service.ts            — ombor, sotuv (v2), prixod (atomar), dorilar
//   pharmacy-shift.service.ts      — dorixona kassasi (har kassaga smena, X/Z)
//   pharmacy-fiscal.service.ts     — fiskal chek navbati (adapter: fiscal-providers.ts)
//   pharmacy-workspace.service.ts  — alohida "Dorixona" kirishi: obuna, qurilma, PIN
//   pharmacy.schemas.ts            — zod sxemalar
// =============================================================================

export { PharmacyService } from './pharmacy.service';

@Module({
  imports: [TrashModule, DrugReferenceModule],
  controllers: [
    PharmacyController,
    PharmacyWorkspaceController,
    PharmacyShiftController,
    PharmacyFiscalController,
  ],
  providers: [
    PharmacyService,
    PharmacyShiftService,
    PharmacyFiscalService,
    PharmacyWorkspaceService,
    SupabaseService,
  ],
  exports: [PharmacyService, PharmacyWorkspaceService],
})
export class PharmacyModule {}
