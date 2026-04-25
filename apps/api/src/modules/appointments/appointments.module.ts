import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService, SupabaseService],
})
export class AppointmentsModule {}
