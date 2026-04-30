import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';

@Module({
  controllers: [PatientPortalController],
  providers: [PatientPortalService, SupabaseService],
})
export class PatientPortalModule {}
