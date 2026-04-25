import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, SupabaseService],
})
export class PatientsModule {}
