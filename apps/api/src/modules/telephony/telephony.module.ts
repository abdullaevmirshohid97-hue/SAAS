import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';
import { AiReceptionModule } from '../ai-reception/ai-reception.module';

import { AdminTelephonyController } from './admin-telephony.controller';
import { PbxService } from './pbx.service';
import { TelephonyAgentController } from './telephony-agent.controller';
import { TelephonyController } from './telephony.controller';

// =============================================================================
// BULUTLI ATS — klinika IP-telefoniyasi (Uztelecom SIP) Clary serveridagi Asterisk'da
// =============================================================================
// Kiruvchi qo'ng'iroq → stol IP telefonlari + Clary softfoni (WebRTC) birdan
// jiringlaydi → hech kim olmasa AI qabulxona. Chiquvchi — bemor kartasidan.
// Batafsil: docs/ai-reception/05-bulut-ats.md
// =============================================================================

@Module({
  imports: [AiReceptionModule],
  controllers: [TelephonyController, TelephonyAgentController, AdminTelephonyController],
  providers: [SupabaseService, PbxService],
  exports: [PbxService],
})
export class TelephonyModule {}
