import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PatientRegistryService } from './patient-registry.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientRegistryService, SupabaseService],
})
export class PatientsModule {}
