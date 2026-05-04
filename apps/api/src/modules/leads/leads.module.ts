import { Module } from '@nestjs/common';

import { SupabaseService } from '../../common/services/supabase.service';

import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, SupabaseService],
})
export class LeadsModule {}
